import type { TokenSplit } from './cost';

export type AgentStatus = 'working' | 'idle' | 'plan_pending' | 'failed' | 'blocked' | 'departed';
export type TaskState = 'pending' | 'in_progress' | 'completed' | 'plan_pending' | 'failed' | 'blocked';
// `trace` is offered only on a solo session (decision 24); the id exists for
// every mode so a URL carrying it survives a reload on any session.
export type ViewId = 'wall' | 'overview' | 'comms' | 'tasks' | 'rail' | 'grid' | 'usage' | 'trace';
// `✉` is beyond the design README's own list — sanctioned by the CHANGELOG
// entry "Received messages carry attribution", which gives a delivered
// teammate message a marker of its own.
export type Marker = '❯' | '⏺' | '⎿' | '✓' | '✗' | '+' | '!' | '▲' | '○' | '✉';
export type PortraitId = 'lead' | 'security' | 'perf' | 'tests' | 'architect' | 'repro';

export interface TranscriptLine {
  id: string;          // transcript record uuid — React key, dedupe key
  marker: Marker;
  text: string;        // single line, flattened, capped at TRANSCRIPT_TEXT_CAP
  ts: number;          // epoch ms
  diff?: Diff;         // present only on a line that reports an edit
  sender?: string;     // teammate this row was delivered FROM; absent on the agent's own lines
}

export type DiffSign = ' ' | '-' | '+';

export interface DiffLine {
  sign: DiffSign;
  oldLineNo: number | null;  // null on an added line
  newLineNo: number | null;  // null on a removed line
  text: string;              // the source line WITHOUT its sign, capped at DIFF_LINE_TEXT_CAP
}

export interface DiffHunk {
  header: string;            // the `@@ … @@` line verbatim, trailing context and all
  lines: DiffLine[];
}

/**
 * A structured patch hanging off a transcript line, so a row reporting an edit
 * can open as the patch rather than as the sentence describing it.
 *
 * `agent` and `ts` restate what the containing line and the agent holding it
 * already know. They are here so a renderer takes one prop, and they are in
 * this file's OWN units: `ts` is epoch ms like every other `ts` in the domain,
 * not the display string the design prototype carried.
 *
 * `added` and `removed` count the WHOLE patch, including whatever `truncated`
 * cut, because that is the summary a collapsed row shows.
 */
export interface Diff {
  path: string;
  added: number;
  removed: number;
  agent: string;             // bare agent name — the join key, as everywhere else
  ts: number;                // epoch ms
  // A patch is not always committed at the moment it is observed, and an
  // uncommitted edit has no sha. Optional beats a fabricated value the row
  // would then render as fact.
  commit?: string;
  hunks: DiffHunk[];
  // Set when the caps below dropped content. Without it a cut patch reads as a
  // whole one; the text cap has no such flag and has to be recovered by
  // sniffing for a trailing ellipsis at exactly the cap length.
  truncated?: boolean;
}

/**
 * Bounds on one `Diff`, which rides the same SSE frame as the line carrying it.
 * TRANSCRIPT_TEXT_CAP bounds that line's text in one dimension; a patch has
 * two, and their product is what the wire pays for — 60KB worst case.
 *
 * The line cap is TOTAL across every hunk rather than per hunk. Per hunk leaves
 * the hunk COUNT unbounded, which is the shape the diffs that actually threaten
 * a frame take: a lockfile or generated file arrives as hundreds of small
 * hunks, not as one enormous one.
 *
 * 200 characters truncates a real source line only where it is already
 * generated or minified. As with the text cap, the store keeps the raw record,
 * so raising either constant brings the content back.
 */
export const DIFF_LINES_CAP = 300;
export const DIFF_LINE_TEXT_CAP = 200;

export interface Agent {
  name: string;              // bare name — the join key across every source
  agentId: string;           // `${name}@${team}`
  isLead: boolean;
  agentType: string;         // from config.json members[].agentType — the badge
  model: string;             // canonical, e.g. 'claude-haiku-4-5'
  role: string;              // sidecar description, else truncated config prompt
  color?: string;
  status: AgentStatus;
  currentTool?: string;
  /**
   * Prompts the operator has sent this agent — the `❯` lines, counted over the
   * agent's WHOLE record set rather than the capped transcript on the frame, so
   * a long session does not under-report. The sub-agents bar reads `turn N of
   * M` off it (canvas `8a`).
   */
  turns?: number;
  /**
   * When the CURRENT turn began — the last prompt's timestamp.
   *
   * `8a` pairs it with the turn counter as `working · 4m 08s`, and four minutes
   * beside `turn 12 of 12` is this turn, not the session. It also has to be
   * this: a resumed session's transcript carries its ancestor's records, so
   * measuring from the first one reported `188h 55m` on a session minutes old.
   */
  turnStartedAt?: number;
  contextTokens: number;
  contextLimit: number;
  compactAt: number;
  costUsd: number;
  /**
   * The four billed classes behind `costUsd` — absent on a fixture that never
   * set it, so every consumer must fall back rather than assume it is there.
   */
  tokenSplit?: TokenSplit;
  startedAt: number;         // epoch ms
  transcript: TranscriptLine[];
  unread: number;
  error?: string;
}

/**
 * Set at task creation, by convention rather than a schema the task store
 * enforces — a task from another session may carry none of it, or fields
 * beyond these four.
 *
 * `model` is a TIER NAME ('opus', 'sonnet', 'haiku'): what the task is judged
 * to be worth, not the agent that ends up running it. It is a different
 * vocabulary from `Agent.model`'s canonical id ('claude-haiku-4-5') and the
 * two must never be rendered as though they were the same field.
 */
export interface TaskMetadata {
  complexity?: string;
  model?: string;
  effort?: string;
  why?: string;
}

export interface Task {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  owner?: string;            // bare agent name
  state: TaskState;
  blocks: string[];
  /** Every declared blocker, resolved or not — DEPENDS ON draws the full list. */
  blockedBy: string[];
  /**
   * The blockers still open. `blockedBy` minus this is how many dependencies
   * are done, which is the only honest progress figure a task carries. A
   * server-side derivation: absent means none has been resolved yet, so read
   * it as equal to `blockedBy`.
   */
  openBlockedBy?: string[];
  metadata?: TaskMetadata;
}

/**
 * A subagent is DISPATCHED, not hired: the parent's `Task`/`Agent` tool call is
 * the only record that always exists for one, so `queued` is a real state and
 * every other field below can be absent while it is in it.
 *
 * `returned` and `failed` are only reachable when the parent's transcript closed
 * the call — a synchronous tool_result, or the `<task-notification>` that lands
 * when a background agent finishes. A background agent whose notification has
 * not arrived reads as `running`, which is what the two files honestly say.
 */
export type SubagentState = 'queued' | 'running' | 'returned' | 'failed';

/**
 * One `Task`/`Agent` call, joined to whatever the subagent's own transcript and
 * `.meta.json` sidecar added to it. NOT a team member — a subagent never enters
 * `config.json` `members[]`, and `Agent` is deliberately its own contract rather
 * than a second kind of {@link Agent}.
 *
 * `toolUseId` is the primary key: it exists from the instant the call is made,
 * it is what the sidecar links back with, and it is how a transcript row finds
 * the subagent it dispatched. `agentId` is richer but arrives later and only for
 * a background launch.
 *
 * Every field below `state` is optional in the same sense `WorkflowAgent`'s are:
 * absent means the source that carries it has not landed, never zero. A subagent
 * whose sidecar never arrived keeps only what its parent's journal knows.
 */
export interface Subagent {
  toolUseId: string;
  name: string;              // sidecar name, else the call's `name`/`description`
  /** The roster agent whose transcript this subtree hangs off — the tree's key. */
  agent: string;
  /**
   * Immediate parent: `agent` at depth 1, the parent subagent's `toolUseId`
   * deeper. Read it with `depth` — the two are different vocabularies, and
   * nothing here promises they cannot collide.
   */
  parent: string;
  depth: number;             // 1 for a subagent of a roster agent, +1 per nesting level
  /** Dispatch order within the parent, 0-based. Siblings keep their call order. */
  spawnIndex: number;
  /**
   * The parent record that dispatched it. N calls in ONE assistant turn are a
   * fan-out and share this; sequential calls each get their own.
   */
  siblingGroup: string;
  state: SubagentState;
  agentId?: string;          // `a` + name? + 16 hex — names its own transcript file
  agentType?: string;        // the call's subagent_type, e.g. 'general-purpose'
  model?: string;
  description?: string;      // the call's one-line description
  queuedAt: number;          // epoch ms — the parent's tool_use record
  startedAt?: number;        // first record of its own transcript; absent while queued
  returnedAt?: number;
  durationMs?: number;       // absent until it returns
  tokens?: number;
  toolCalls?: number;
  contextTokens?: number;
  returnedSummary?: string;
  /** Its own `Task`/`Agent` calls, same ordering and grouping rules. */
  children: Subagent[];
}

/**
 * Roster agent name -> the subagents it dispatched, in spawn order. Keyed by
 * parent so a transcript row can reach its own agent's calls without walking
 * the whole tree, and so a trace view can walk one agent at a time.
 */
export type SubagentTree = Record<string, Subagent[]>;

export type ProtocolFrameType =
  | 'task_assignment' | 'task_completed' | 'idle_notification'
  | 'plan_approval_request' | 'plan_approval_response'
  | 'permission_request' | 'permission_response'
  | 'shutdown_request' | 'shutdown_approved' | 'shutdown_rejected'
  | 'mode_set_request' | 'teammate_terminated';

/**
 * Who a message the OPERATOR sent is stamped as. Only messages to the lead
 * carry it: one sent to a teammate arrives as the lead, because that is who
 * directs teammates in the team's model — so a console-sent message to a
 * teammate is genuinely indistinguishable from one the lead wrote.
 */
export const CONSOLE_SENDER = 'console';

export interface MailMessage {
  msgId: string;             // msg_id from the inbox; synthesised for backfill frames
  from: string;
  to: string;
  text: string;
  summary?: string;
  ts: number;                // SENT time when known (inbox), delivery time otherwise
  tsIsDelivery: boolean;     // true when only the batched transcript time was available
  // Whether the recipient has drained it. A message sits in the inbox file until
  // the recipient's next turn boundary, so this is the difference between "sent"
  // and "arrived" — the comms view is built on it.
  read: boolean;
  color?: string;
  protocol?: { type: ProtocolFrameType; data: Record<string, unknown> };
}

export interface NeedsYouItem {
  id: string;
  kind: 'plan' | 'permission' | 'failure';
  agent: string;
  reason: string;            // e.g. 'plan approval', 'failed'
  detail: string;            // e.g. '4 steps · step 4 drops migrations/legacy/'
  expiresAt?: number;        // permission holds only
}

export interface RateLimits { fiveHourPct: number; sevenDayPct: number; resetsAt?: string }

export interface TeamState {
  teamName: string;
  /**
   * What the operator called this session (`/branch` writes it), as opposed to
   * the directory id `teamName` carries. Absent until the lead's session file
   * has been read, and for a session that was never named.
   */
  sessionName?: string;
  leadSessionId: string;
  branch?: string;
  startedAt: number;
  totalTokens: number;
  totalCostUsd: number;
  rateLimits?: RateLimits;
  agents: Agent[];
  tasks: Task[];
  mail: MailMessage[];
  needsYou: NeedsYouItem[];
  readOnly: boolean;
  /**
   * Which shell to draw. Optional because `project()` builds a team's state
   * without knowing about workflows at all — the server stamps both of these on
   * at the publish boundary, so a frame off the wire always carries them.
   * Absent means `'team'`, which is what every pre-workflow frame was.
   */
  mode?: ConsoleMode;
  /** Newest first. Present in both modes: a team can have run workflows too. */
  workflows?: WorkflowRun[];
  /**
   * Every subagent the roster dispatched, keyed by the agent that dispatched it.
   * Absent when nobody called `Task`/`Agent` — an empty map and "no subagents"
   * are the same fact, so only one of them travels.
   *
   * Bounded by the store's per-agent record budget, like `transcript`: a call
   * whose record has aged out of the log is no longer in the tree.
   */
  subagents?: SubagentTree;
}

/**
 * One entry of `GET /api/teams`. Deliberately metadata only: folding a team's
 * event log to report its cost measured 48x the cost of this whole listing per
 * team, and another team's spend is a fact you learn by switching to it.
 */
export interface TeamSummary {
  name: string;              // the teams/ DIRECTORY name — what /select takes
  members: number;
  createdAt: number;         // epoch ms
  leadSessionId: string;
  leadAlive: boolean;        // a running pid in sessions/*.json carries this session id
  lastActivityAt: number;    // epoch ms — max mtime over config.json and inboxes/*.json
  // `/branch` moves the live conversation to a new session id without touching
  // config.json, so a genuinely live team can report leadAlive false. Recency
  // covers that case; the pid covers a team idle longer than the grace window.
  live: boolean;             // leadAlive || within IDLE_GRACE_MS of lastActivityAt
  current: boolean;
  // The dropdown's row. All three are best-effort: a team whose lead session
  // sidecar or working tree is gone still lists, just with less on the row.
  branch?: string;           // read from <cwd>/.git/HEAD, not the statusline hook
  goal?: string;             // the lead session's name (`/branch` sets it)
  state: 'live' | 'idle' | 'done';
  /**
   * A live session with no team of its own — a row the picker can still offer,
   * but one that `/api/teams/<name>/select` knows nothing about: `name` is a
   * session id, so it is selected through `/api/select-session/<id>`. Absent,
   * never false, on a real team.
   */
  sessionOnly?: boolean;
  /**
   * The newest dynamic-workflow run in this session, when there is one.
   *
   * A workflow's agents never enter `members[]`, so a session running one looks
   * exactly like an empty window on every other field here — and the picker,
   * which drops rosters under two, had no reason to offer it. `name` arrives
   * with the run's snapshot, which is written only at termination: a live run
   * genuinely has no name yet, and one must not be invented for it.
   */
  workflow?: { runId: string; name?: string; live: boolean };
  /**
   * How many Task-subagent transcripts sit under this session — the second
   * exception to the member-count bar (decision 23): a subagent never enters
   * `members[]`, exactly like a workflow's agents, so a solo session with a
   * tree is somewhere to go all the same. Absent, never zero, when there are
   * none, so a bare window keeps its refused treatment.
   */
  subagents?: number;
  /**
   * Work sitting uncommitted in the lead's tree, against HEAD.
   *
   * The narrowest reading of the design's "diffstat", and the only one with a
   * source that survives standing rule 3: a branch-against-base figure needs a
   * base branch, which means guessing `main` or reading an `origin/HEAD` most
   * clones never set — blank or wrong for most operators.
   *
   * Absent on a clean tree as well as on a directory that is not a repo. `+0
   * −0` on every well-committed team would read as "did nothing", which is the
   * opposite of what a clean tree means.
   */
  diffstat?: { added: number; removed: number };
}

export interface TeamsResponse {
  current: string;           // '' when the console has not resolved a team yet
  teams: TeamSummary[];      // current first, then live, then lastActivityAt desc, then name
}

/**
 * Which shell the browser draws. A dynamic workflow is not a team — its agents
 * never enter `members[]` — so the two are separate modes over one connection
 * rather than one screen that tries to be both.
 */
export type ConsoleMode = 'team' | 'workflow';

/**
 * The runtime emits `start | progress | done | error` plus the orthogonal flags
 * `cached` / `skipped` / `blocked`. The script sees `null` for a skipped,
 * blocked or thrown agent alike, but the console must not: `null` is reserved
 * for the operator's own decision to skip, `fail` is a thrown agent and `block`
 * a classifier refusal. Only one of the three wants attention, and squashing
 * them made all three look like the same shrug.
 */
export type WorkflowAgentState = 'done' | 'run' | 'cache' | 'null' | 'wait' | 'fail' | 'block';

/**
 * A `phase()` grouping, as DECLARED in the script's `meta.phases`. Every
 * declared phase is recorded whether or not it ran, so a phase with no agents
 * under it is one the run never reached — not missing data.
 *
 * There is deliberately no `kind` and no barrier flag. The runtime models a
 * phase as a title and a detail and nothing else: a barrier belongs to an
 * individual `parallel()`/`pipeline()` call, and one phase can hold several.
 * See agents-team-ui-docs/WORKFLOW-STATE.md §7.
 */
export interface WorkflowPhase {
  index: number;             // 1-based, matches WorkflowAgent.phaseIndex
  title: string;
  detail?: string;
}

/**
 * One `agent()` call. Only the id and the state are guaranteed, and that is not
 * defensiveness: on a LIVE run the journal carries nothing else, so everything
 * below `state` is exactly the set of fields that arrive with the snapshot at
 * termination. Optional means absent rather than defaulted — a running agent
 * genuinely has no duration, and writing 0 would render as "finished instantly".
 */
export interface WorkflowAgent {
  agentId: string;           // `a` + 16 hex — names its own transcript file
  state: WorkflowAgentState;
  label?: string;            // opts.label, else the prompt's first 60 chars
  model?: string;            // resolved id, e.g. 'claude-sonnet-5'
  queuedAt?: number;         // epoch ms
  tokens?: number;
  toolCalls?: number;
  attempt?: number;
  prompt?: string;           // promptPreview — truncated by the runtime
  phaseIndex?: number;       // absent when the script called no phase()
  phaseTitle?: string;
  startedAt?: number;        // absent while still queued for a concurrency slot
  durationMs?: number;       // absent while running
  result?: string;           // resultPreview; on a live run, the journal's FULL text
  lastTool?: string;
  error?: string;            // the runtime's message, incl. 'skipped by user'
  isolation?: string;        // only ever 'worktree' in this build
  agentType?: string;        // set only when the script passed opts.agentType
  /**
   * What this agent actually put through the model, from its OWN transcript
   * rather than from the snapshot.
   *
   * `tokens` above is final context occupancy and is 8-60x smaller — measured
   * across the 19 runs on the capture machine, cache reads alone are 62-98% of
   * real traffic and the snapshot carries none of them. The two are different
   * quantities and must never be added or drawn as one.
   *
   * Absent until this agent's transcript has been read, which on a live run is
   * the ordinary state for an agent that has not had a turn yet.
   */
  tokenSplit?: TokenSplit;
}

/**
 * The run's token burn over time, evenly spaced so a chart can draw it without
 * re-binning and so a frame never pays per turn.
 *
 * Evenly spaced and CUMULATIVE because that is what a burn line is. The sample
 * count is capped ({@link WORKFLOW_BURN_SAMPLES}) and `stepMs` widens as a run
 * outgrows it: the largest run measured carries 716 billed turns, and 19 runs
 * of those on one frame would be ~456 KB of points to draw a line a few hundred
 * pixels wide — the same argument that strips `script` off a run.
 */
export interface WorkflowBurn {
  startedAt: number;         // epoch ms of the first bucket's start
  stepMs: number;            // bucket width
  cumulative: number[];      // running total of all four classes at each bucket's end
}

/** How many points a {@link WorkflowBurn} carries, however long the run ran. */
export const WORKFLOW_BURN_SAMPLES = 60;

/**
 * A run's real token traffic, read from its agents' own transcripts under
 * `subagents/workflows/wf_<runId>/agent-*.jsonl`.
 *
 * This exists because `WorkflowRun.totalTokens` is not spend: it is final
 * context occupancy, and it understates real traffic by 8-60x per run. Both
 * travel, and they answer different questions — see CONSOLE-NOTES.md §24.
 *
 * NOT dollars. The four classes and the model are what a price is computed
 * from; the cost model lives in one place (`src/shared/cost.ts`) and is applied
 * where it is drawn, exactly as the team ledger does it.
 */
export interface WorkflowUsage {
  /** Summed over every agent of the run whose transcript has been read. */
  split: TokenSplit;
  /**
   * Per declared phase, by `WorkflowPhase.index`. EMPTY on a live run rather
   * than zeroed: an agent's `phaseIndex` reaches the console only with the
   * snapshot, so before that there is nothing to group by — not a run whose
   * phases each spent nothing.
   */
  byPhase: Array<{ phaseIndex: number; split: TokenSplit }>;
  burn: WorkflowBurn;
  /**
   * How many agents' transcripts this covers. Less than `WorkflowRun.agents`
   * while a run is starting, so a view can say what the figure is still missing
   * rather than presenting a partial total as the whole.
   */
  agentsMeasured: number;
}

/**
 * One workflow run. Built from `workflows/wf_<runId>.json`, which the runtime
 * writes ONCE, at termination — so a run with `live: true` was assembled from
 * `journal.jsonl` alone and carries only what the journal knows.
 *
 * `budget` is absent by design, not by omission: it exists nowhere on disk, and
 * `totalTokens` is this run's own agents rather than the session-level counter
 * `budget.spent()` reports. See WORKFLOW-STATE.md §7.
 */
export interface WorkflowRun {
  runId: string;
  status: 'completed' | 'killed' | 'failed' | 'running';
  agents: WorkflowAgent[];
  /**
   * `meta.name`. Absent on a live run: the name reaches disk in the snapshot,
   * and in the persisted script's FILENAME — which exists only for a run
   * launched with an inline `script`, not one launched with `{scriptPath}`.
   */
  name?: string;
  startedAt?: number;        // epoch ms; absent on a live run
  phases: WorkflowPhase[];
  logs: string[];            // the log() narration, in order
  /**
   * True while the snapshot does not exist yet. Everything the snapshot alone
   * carries — phases, labels, tokens, durations — is missing or empty on a live
   * run, so this is the flag a view degrades on rather than a decoration.
   */
  live: boolean;
  taskId?: string;
  description?: string;      // meta.description, via the snapshot's `summary`
  scriptPath?: string;       // a pointer, and not unique across runs
  script?: string;           // the source AS EXECUTED — prefer this to the path
  durationMs?: number;       // absent while running
  agentCount?: number;
  /**
   * Final context occupancy, NOT spend — the runtime's own figure, kept because
   * it is what the snapshot says. `usage.split` below is what the run actually
   * cost. See WorkflowUsage.
   */
  totalTokens?: number;
  totalToolCalls?: number;
  defaultModel?: string;
  result?: string;
  error?: string;
  /**
   * Read from the run's agent transcripts, which are appended LIVE — so unlike
   * everything the snapshot carries, this is present while the run is going.
   * Absent when no agent of the run has had a billed turn yet.
   */
  usage?: WorkflowUsage;
}
