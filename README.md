# IT Troubleshooting Lab

A desktop-support training simulator. Fifteen tickets from a working service desk, each
opening with what the user said rather than what is wrong. You investigate with a simulated
console, choose what to do next, and close with a diagnosis you have to defend.

Built to demonstrate the reasoning a Desktop Support / Help Desk / IT Technician / IT Analyst /
System Administrator role is actually assessed on: reading evidence, working the OSI model in
order, resisting the reflex fix, and writing up the result.

---

## What is in the box

| Path | What it is |
| --- | --- |
| `it-troubleshooting-lab.jsx` | The complete playable app — scenarios, simulator, scoring, report, architecture page. Runs standalone in the browser. |
| `frontend/src/types.ts` | The TypeScript model everything is built on: `Scenario`, `Action`, `MachineProfile`, `Run`. |
| `backend/main.py` | FastAPI service: session persistence, server-side re-judging of every step, cohort analytics. |
| `backend/catalog.json` | Scenario metadata and the stage table, generated from the client catalogue. |
| `backend/requirements.txt` | Three dependencies. |

## The fifteen tickets

| Ticket | Scenario | Level | Root cause |
| --- | --- | --- | --- |
| INC-104721 | No internet on a wired desk | Beginner | Dead wall jack — no carrier at Layer 1 |
| INC-104733 | Connected, but no site will load | Beginner | Static DNS entry pointing at a retired domain controller |
| INC-104750 | A row of desks loses the network | Intermediate | DHCP scope exhaustion (APIPA) |
| INC-104762 | Print jobs vanish into the queue | Beginner | Spooler crashed on a malformed `.SPL` |
| INC-104779 | Everything takes minutes to open | Intermediate | Orphaned backup agent saturating a 5400 rpm disk |
| INC-104790 | A cumulative update that will not install | Intermediate | `0x80070070` — system volume full |
| INC-104801 | No bootable device on a warehouse PC | Beginner | USB left in a port, boot order changed by a firmware tool |
| INC-104815 | Outlook disconnected after a password change | Intermediate | Stale token in Credential Manager |
| INC-104822 | A mapped drive with a red X | Intermediate | Persistent mapping to a decommissioned server |
| INC-104834 | Corporate Wi-Fi rejects a returning laptop | Advanced | Expired EAP-TLS certificate, autoenrolment never ran |
| INC-104841 | An account that locks every twenty minutes | Beginner | Phone replaying the pre-change password (Event 4740) |
| INC-104856 | Signed in at home, refused by everything | Beginner | Expired password masked by cached-credential logon |
| INC-104863 | An application that closes itself | Intermediate | AppLocker blocking a relocated, re-signed binary |
| INC-104877 | Repeated blue screens under CAD load | Advanced | Faulty optional display driver (`nvlddmkm.sys`) |
| INC-104889 | Silence after docking | Beginner | Default output moved to a monitor with no speakers |

Each scenario carries an optimal path, four written wrong turns with specific consequences,
a concept explainer, and a closure report with diagnosis, root cause, fix and prevention.

## The simulated console

`ipconfig` · `ping` · `nslookup` · `tracert` · `netstat` · `hostname` · `whoami`, plus
per-scenario commands (`net use`, `klist`, `cmdkey /list`, `sc query`, `gpresult`, `arp -a`).

Nothing is executed. Every command is a pure function of the scenario's machine profile, which
is what keeps the output internally consistent — a host holding an APIPA address reports it in
`ipconfig`, fails `tracert`, and returns *Destination host unreachable* from `ping`, because all
three read the same state. Command history works with the arrow keys, and typing the command an
action would run counts as taking that action.

## How a step is judged

The decision tree is a cursor over an ordered stage list rather than a literal graph — same
branching behaviour, a fraction of the authoring cost, and one verdict a classic tree cannot
express.

```
action.stage === null      -> off path         (explains why this is not the next step)
action.stage === cursor    -> on path          (cursor advances)
action.stage >  cursor     -> out of sequence  (output still shown; no advance)
action.stage <  cursor     -> superseded       (evidence already established)
already performed          -> repeated         (costs time, adds nothing)
```

Out-of-sequence actions still print their real output. In practice you can run any command you
like; what you cannot do is claim the conclusion before the evidence supports it. The penalty
lives in the score, not in a disabled button.

## Scoring

```
accuracy   = on-path steps / counted steps         ->  35
efficiency = optimal steps / max(counted, optimal) ->  25
diagnosis  = correct root cause selected           ->  25
action     = correct remediation selected          ->  15
                                                      ---
                                                      100
```

Repeated steps are excluded from accuracy but still count against efficiency, which is how
handling time behaves in real life. The breakdown is shown to the learner in full.

## Running it

**The app alone** — drop `it-troubleshooting-lab.jsx` into any React 18 project (Vite,
Next, CRA). Tailwind utility classes, no other runtime dependencies, no configuration, no keys.

```bash
npm create vite@latest lab -- --template react
cp it-troubleshooting-lab.jsx lab/src/App.jsx
cd lab && npm install && npm run dev
```

**With the API**

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload          # http://127.0.0.1:8000/docs
```

`catalog.json` is loaded into SQLite on startup, so the database builds itself on first run.

## Why the split

Scenario content is versioned with the client build rather than stored as rows: it is authored
prose that belongs under code review, and it is the same on every deployment. The API owns what
a client should not be trusted with — it re-judges every submitted step against its own copy of
the stage table, so the recorded score is server-computed, and step-level history makes the
analytics endpoint worth reading:

```
GET  /api/scenarios                  catalogue
POST /api/sessions                   open a run
POST /api/sessions/{id}/steps        record + independently judge one action
PUT  /api/sessions/{id}/notes        technician notes
POST /api/sessions/{id}/close        diagnosis, fix, final score
GET  /api/sessions/{id}/report       closure report
GET  /api/stats/scenarios            average score and the three most common missteps each
```

## Deployment

The public demo costs nothing and needs no keys: the engine, the catalogue and the console
simulator all run in the browser, so a static build deploys to GitHub Pages, Netlify or
Cloudflare Pages on a free tier. The FastAPI service is optional and adds persistence, cohort
reporting and server-side verification when the lab is hosted for a team — SQLite means a single
file, no managed database.

## Notes

Tickets, users, hostnames and infrastructure are fictional. Error codes, event IDs, command
output and remediation steps are real, and the concept explainers are written to be correct on
their own terms — `0x80070070` really is `ERROR_DISK_FULL`, Event 4740 really does name the
caller computer, and 169.254.x.x really is the client telling you nobody answered its
DHCPDISCOVER.
