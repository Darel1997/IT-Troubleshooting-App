/**
 * IT Troubleshooting Lab — scenario and session model.
 *
 * The whole simulator is driven by these types. Adding a scenario means adding
 * one `Scenario` record; no component knows anything about a specific ticket.
 */

export type Difficulty = "Beginner" | "Intermediate" | "Advanced";

export type ActionCategory =
  | "Console" | "System" | "Hardware" | "Network"
  | "Apps" | "User" | "Server" | "Escalation";

/** How the engine judged one step. */
export type Verdict =
  | "onpath"     // the action for the current stage
  | "premature"  // a later stage's action, run before its evidence exists
  | "wrong"      // not on the path at all
  | "repeat";    // already performed

export interface Ticket {
  num: string;
  user: string;
  dept: string;
  device: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  opened: string;
  issue: string;
}

/** One network adapter as the command simulator sees it. */
export interface Adapter {
  type: "Ethernet" | "Wireless LAN";
  name: string;
  desc: string;
  mac: string;
  status: "connected" | "disconnected";
  dhcp: boolean;
  ip: string;
  mask: string;
  gw: string;
  dns: string[];
  /** Self-assigned 169.254.x.x address — changes how ping and tracert behave. */
  apipa?: boolean;
  dnsStatic?: boolean;
  dhcpServer?: string;
  suffix?: string;
  lease?: string;
  expires?: string;
}

/**
 * The machine profile. Every simulated command reads from this and nothing
 * else, which is what keeps `ipconfig`, `ping`, `nslookup` and `tracert`
 * telling the same story.
 */
export interface MachineProfile {
  hostname: string;
  user: string;
  /** "ok" resolves names; "fail" makes name lookups fail while IPs still work. */
  dns: "ok" | "fail";
  adapter: Adapter;
  adapters?: Adapter[];
  /** ICMP reachability by address, with a `default` and `gateway` fallback. */
  reach: Record<string, boolean> & { default?: boolean; gateway?: boolean };
  latency?: Record<string, number>;
  resolve?: Record<string, string | null>;
  dnsNames?: Record<string, string>;
  trace?: { hops: string[]; failFrom: number | null };
  releaseText?: string;
  renewText?: string;
  /** Scenario-specific commands: [prefix to match, output]. */
  extra?: Array<[string, string]>;
}

export interface Action {
  id: string;
  label: string;
  cat: ActionCategory;
  /** Index into `Scenario.stages`, or null for a wrong turn. */
  stage: number | null;
  /** Rendered as a typed command; output comes from the simulator unless `out` is set. */
  cmd?: string;
  /** Literal output for investigative steps that aren't console commands. */
  out?: string;
  /** Finding added to the evidence panel. */
  ev?: string;
  /** Coaching line — why this is (or isn't) the right next step. */
  fb: string;
  /** Applied to the machine profile after this action, e.g. a lease appearing. */
  simOverride?: Partial<MachineProfile>;
}

export interface Choice {
  id: string;
  text: string;
  correct?: boolean;
}

export interface Scenario {
  id: string;
  title: string;
  category: string;
  difficulty: Difficulty;
  ticket: Ticket;
  /** What the user said, not what is wrong. */
  complaint: string;
  sim: MachineProfile;
  /** The optimal path, in order. One action per stage. */
  stages: string[];
  actions: Action[];
  diagnoses: Choice[];
  fixes: Choice[];
  concept: { term: string; body: string };
  report: { diagnosis: string; root: string; fix: string; prevent: string };
}

/* ------------------------------------------------------------------ session */

export interface Step {
  id: string;
  label: string;
  verdict: Verdict;
  at: number;
  cmd?: string | null;
}

export interface Finding {
  text: string;
  from: string;
  at: number;
  verdict: Verdict;
}

export interface ScoreBreakdown {
  parts: { accuracy: number; efficiency: number; diagnosis: number; fix: number };
  total: number;
  grade: "A" | "B" | "C" | "D" | "E";
  onPath: number;
  counted: number;
  optimal: number;
  accuracy: number;
  efficiency: number;
}

export interface Run {
  scenarioId: string;
  steps: Step[];
  evidence: Finding[];
  notes: string;
  dx: string | null;
  fix: string | null;
  dxOk: boolean;
  fixOk: boolean;
  elapsed: number;
  result: ScoreBreakdown;
}

export type TerminalLineKind = "cmd" | "out" | "sys" | "good" | "bad" | "warn";
export interface TerminalLine {
  kind: TerminalLineKind;
  text: string;
}
