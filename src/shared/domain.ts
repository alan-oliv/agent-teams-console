export type AgentStatus = 'working' | 'idle' | 'plan_pending' | 'failed' | 'blocked' | 'departed';
export type TaskState = 'pending' | 'in_progress' | 'completed' | 'plan_pending' | 'failed' | 'blocked';
export type ViewId = 'wall' | 'overview' | 'comms' | 'tasks' | 'rail' | 'grid';
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
  contextTokens: number;
  contextLimit: number;
  compactAt: number;
  costUsd: number;
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
  blockedBy: string[];
  metadata?: TaskMetadata;
}

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
}

export interface TeamsResponse {
  current: string;           // '' when the console has not resolved a team yet
  teams: TeamSummary[];      // current first, then live, then lastActivityAt desc, then name
}
