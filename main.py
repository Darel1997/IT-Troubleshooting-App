"""
IT Troubleshooting Similutator
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DB_PATH = Path(__file__).parent / "lab.db"
CATALOG_PATH = Path(__file__).parent / "catalog.json"

WEIGHTS = {"accuracy": 35, "efficiency": 25, "diagnosis": 25, "fix": 15}

SCHEMA = """
CREATE TABLE IF NOT EXISTS scenarios (
    id                   TEXT PRIMARY KEY,
    title                TEXT NOT NULL,
    category             TEXT NOT NULL,
    difficulty           TEXT NOT NULL,
    ticket_number        TEXT NOT NULL,
    stages               TEXT NOT NULL,   -- json array of stage labels
    optimal_steps        INTEGER NOT NULL,
    correct_diagnosis_id TEXT NOT NULL,
    correct_fix_id       TEXT NOT NULL,
    action_stages        TEXT NOT NULL    -- json {action_id: stage|null}
);

CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    scenario_id   TEXT NOT NULL REFERENCES scenarios(id),
    technician    TEXT NOT NULL,
    started_at    TEXT NOT NULL,
    closed_at     TEXT,
    cursor        INTEGER NOT NULL DEFAULT 0,
    notes         TEXT NOT NULL DEFAULT '',
    diagnosis_id  TEXT,
    fix_id        TEXT,
    score_total   INTEGER,
    score_parts   TEXT,
    grade         TEXT
);

CREATE TABLE IF NOT EXISTS session_steps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq         INTEGER NOT NULL,
    action_id   TEXT NOT NULL,
    verdict     TEXT NOT NULL,   -- onpath | premature | wrong | repeat
    stage       INTEGER,
    at_seconds  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_steps_session ON session_steps(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_scenario ON sessions(scenario_id);
"""


# --------------------------------------------------------------------- store
@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def init_db() -> None:
    with db() as conn:
        conn.executescript(SCHEMA)
        if not CATALOG_PATH.exists():
            return
        catalog = json.loads(CATALOG_PATH.read_text())
        conn.executemany(
            """INSERT INTO scenarios
                 (id, title, category, difficulty, ticket_number, stages,
                  optimal_steps, correct_diagnosis_id, correct_fix_id, action_stages)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 title=excluded.title, category=excluded.category,
                 difficulty=excluded.difficulty, ticket_number=excluded.ticket_number,
                 stages=excluded.stages, optimal_steps=excluded.optimal_steps,
                 correct_diagnosis_id=excluded.correct_diagnosis_id,
                 correct_fix_id=excluded.correct_fix_id,
                 action_stages=excluded.action_stages""",
            [
                (
                    s["id"], s["title"], s["category"], s["difficulty"], s["ticket_number"],
                    json.dumps(s["stages"]), s["optimal_steps"],
                    s["correct_diagnosis_id"], s["correct_fix_id"],
                    json.dumps(s["action_stages"]),
                )
                for s in catalog
            ],
        )


# -------------------------------------------------------------------- models
class SessionOpen(BaseModel):
    scenario_id: str
    technician: str = Field(default="anonymous", max_length=120)


class StepIn(BaseModel):
    action_id: str
    at_seconds: int = 0


class StepOut(BaseModel):
    verdict: Literal["onpath", "premature", "wrong", "repeat"]
    stage: Optional[int]
    cursor: int
    optimal_steps: int
    hint: str


class NotesIn(BaseModel):
    notes: str = ""


class CloseIn(BaseModel):
    diagnosis_id: str
    fix_id: str
    notes: str = ""


# ------------------------------------------------------------------- scoring
def judge(action_stages: dict, cursor: int, action_id: str, already: set[str]) -> tuple[str, Optional[int]]:
    """The same four-verdict rule the client applies, recomputed here."""
    if action_id not in action_stages:
        raise HTTPException(404, f"unknown action '{action_id}' for this scenario")
    stage = action_stages[action_id]
    if action_id in already:
        return "repeat", stage
    if stage is None:
        return "wrong", stage
    if stage == cursor:
        return "onpath", stage
    if stage > cursor:
        return "premature", stage
    return "wrong", stage


def advance(action_stages: dict, cursor: int, already: set[str]) -> int:
    """Skip past any stage whose action was already run out of sequence."""
    nxt = cursor + 1
    while any(s == nxt and a in already for a, s in action_stages.items()):
        nxt += 1
    return nxt


def score(optimal: int, steps: list[sqlite3.Row], dx_ok: bool, fix_ok: bool) -> dict:
    counted = [s for s in steps if s["verdict"] != "repeat"]
    on_path = sum(1 for s in counted if s["verdict"] == "onpath")
    accuracy = on_path / len(counted) if counted else 0.0
    efficiency = min(1.0, optimal / max(len(counted), optimal)) if counted else 0.0
    parts = {
        "accuracy": round(accuracy * WEIGHTS["accuracy"]),
        "efficiency": round(efficiency * WEIGHTS["efficiency"]),
        "diagnosis": WEIGHTS["diagnosis"] if dx_ok else 0,
        "fix": WEIGHTS["fix"] if fix_ok else 0,
    }
    total = sum(parts.values())
    grade = "A" if total >= 90 else "B" if total >= 80 else "C" if total >= 68 else "D" if total >= 55 else "E"
    return {
        "parts": parts, "total": total, "grade": grade,
        "on_path": on_path, "counted": len(counted), "optimal_steps": optimal,
    }


# ----------------------------------------------------------------------- app
@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="IT Troubleshooting Lab API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _scenario(conn: sqlite3.Connection, scenario_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM scenarios WHERE id = ?", (scenario_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"unknown scenario '{scenario_id}'")
    return row


def _session(conn: sqlite3.Connection, session_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "unknown session")
    return row


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "time": now()}


@app.get("/api/scenarios")
def list_scenarios() -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT id, title, category, difficulty, ticket_number, optimal_steps FROM scenarios"
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/sessions", status_code=201)
def open_session(payload: SessionOpen) -> dict:
    with db() as conn:
        scn = _scenario(conn, payload.scenario_id)
        sid = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO sessions (id, scenario_id, technician, started_at) VALUES (?, ?, ?, ?)",
            (sid, scn["id"], payload.technician, now()),
        )
    return {
        "session_id": sid,
        "scenario_id": scn["id"],
        "stages": json.loads(scn["stages"]),
        "optimal_steps": scn["optimal_steps"],
    }


@app.post("/api/sessions/{session_id}/steps", response_model=StepOut)
def record_step(session_id: str, payload: StepIn) -> StepOut:
    with db() as conn:
        sess = _session(conn, session_id)
        if sess["closed_at"]:
            raise HTTPException(409, "session is already closed")
        scn = _scenario(conn, sess["scenario_id"])
        action_stages = json.loads(scn["action_stages"])
        prior = conn.execute(
            "SELECT action_id, seq FROM session_steps WHERE session_id = ? ORDER BY seq", (session_id,)
        ).fetchall()
        already = {r["action_id"] for r in prior}
        cursor = sess["cursor"]

        verdict, stage = judge(action_stages, cursor, payload.action_id, already)
        conn.execute(
            """INSERT INTO session_steps (session_id, seq, action_id, verdict, stage, at_seconds, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (session_id, len(prior) + 1, payload.action_id, verdict, stage, payload.at_seconds, now()),
        )
        if verdict == "onpath":
            cursor = advance(action_stages, cursor, already | {payload.action_id})
            conn.execute("UPDATE sessions SET cursor = ? WHERE id = ?", (cursor, session_id))

        stages = json.loads(scn["stages"])
        pending = stages[cursor] if cursor < len(stages) else None
        if verdict == "onpath":
            hint = f"On path. Next: {pending}" if pending else "On path. Every stage is complete."
        elif verdict == "premature":
            hint = f"Out of sequence — finish '{pending}' first." if pending else "Out of sequence."
        elif verdict == "repeat":
            hint = "Already performed; no new evidence."
        else:
            hint = "Off path for this scenario."

    return StepOut(verdict=verdict, stage=stage, cursor=cursor,
                   optimal_steps=scn["optimal_steps"], hint=hint)


@app.put("/api/sessions/{session_id}/notes")
def save_notes(session_id: str, payload: NotesIn) -> dict:
    with db() as conn:
        _session(conn, session_id)
        conn.execute("UPDATE sessions SET notes = ? WHERE id = ?", (payload.notes, session_id))
    return {"saved": True, "characters": len(payload.notes)}


@app.post("/api/sessions/{session_id}/close")
def close_session(session_id: str, payload: CloseIn) -> dict:
    with db() as conn:
        sess = _session(conn, session_id)
        if sess["closed_at"]:
            raise HTTPException(409, "session is already closed")
        scn = _scenario(conn, sess["scenario_id"])
        steps = conn.execute(
            "SELECT * FROM session_steps WHERE session_id = ? ORDER BY seq", (session_id,)
        ).fetchall()

        dx_ok = payload.diagnosis_id == scn["correct_diagnosis_id"]
        fix_ok = payload.fix_id == scn["correct_fix_id"]
        result = score(scn["optimal_steps"], steps, dx_ok, fix_ok)

        conn.execute(
            """UPDATE sessions SET closed_at = ?, diagnosis_id = ?, fix_id = ?, notes = ?,
                                   score_total = ?, score_parts = ?, grade = ?
               WHERE id = ?""",
            (now(), payload.diagnosis_id, payload.fix_id, payload.notes or sess["notes"],
             result["total"], json.dumps(result["parts"]), result["grade"], session_id),
        )
    return {"session_id": session_id, "diagnosis_correct": dx_ok, "fix_correct": fix_ok, **result}


@app.get("/api/sessions/{session_id}/report")
def report(session_id: str) -> dict:
    with db() as conn:
        sess = _session(conn, session_id)
        scn = _scenario(conn, sess["scenario_id"])
        steps = conn.execute(
            "SELECT seq, action_id, verdict, stage, at_seconds FROM session_steps WHERE session_id = ? ORDER BY seq",
            (session_id,),
        ).fetchall()
    return {
        "session_id": session_id,
        "scenario": {"id": scn["id"], "title": scn["title"], "ticket_number": scn["ticket_number"],
                     "difficulty": scn["difficulty"], "stages": json.loads(scn["stages"])},
        "technician": sess["technician"],
        "started_at": sess["started_at"],
        "closed_at": sess["closed_at"],
        "steps": [dict(s) for s in steps],
        "notes": sess["notes"],
        "diagnosis_id": sess["diagnosis_id"],
        "fix_id": sess["fix_id"],
        "score": None if sess["score_total"] is None else {
            "total": sess["score_total"],
            "grade": sess["grade"],
            "parts": json.loads(sess["score_parts"]),
        },
    }


@app.get("/api/stats/scenarios")
def scenario_stats() -> list[dict]:
    """Where a cohort goes wrong — the reason step-level data is persisted at all."""
    with db() as conn:
        rows = conn.execute(
            """SELECT s.id, s.title, s.difficulty,
                      COUNT(DISTINCT se.id)                                  AS attempts,
                      ROUND(AVG(se.score_total), 1)                          AS avg_score,
                      SUM(CASE WHEN se.diagnosis_id = s.correct_diagnosis_id THEN 1 ELSE 0 END) AS correct_diagnoses
               FROM scenarios s
               LEFT JOIN sessions se ON se.scenario_id = s.id AND se.closed_at IS NOT NULL
               GROUP BY s.id ORDER BY avg_score"""
        ).fetchall()
        misses = conn.execute(
            """SELECT sc.id AS scenario_id, st.action_id, COUNT(*) AS n
               FROM session_steps st
               JOIN sessions se ON se.id = st.session_id
               JOIN scenarios sc ON sc.id = se.scenario_id
               WHERE st.verdict IN ('wrong', 'premature')
               GROUP BY sc.id, st.action_id ORDER BY n DESC"""
        ).fetchall()
    by_scenario: dict[str, list] = {}
    for m in misses:
        by_scenario.setdefault(m["scenario_id"], []).append({"action_id": m["action_id"], "count": m["n"]})
    return [{**dict(r), "common_missteps": by_scenario.get(r["id"], [])[:3]} for r in rows]