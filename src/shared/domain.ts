export type AgentStatus = 'working' | 'idle' | 'plan_pending' | 'failed' | 'blocked' | 'departed';
export type TaskState = 'pending' | 'in_progress' | 'completed' | 'plan_pending' | 'failed' | 'blocked';
export type ViewId = 'wall' | 'overview' | 'tasks' | 'rail' | 'grid';
export type Marker = '❯' | '⏺' | '⎿' | '✓' | '✗' | '+' | '!' | '▲' | '○';
export type PortraitId = 'lead' | 'security' | 'perf' | 'tests' | 'architect' | 'repro';

export interface TranscriptLine {
  id: string;          // transcript record uuid — React key, dedupe key
  marker: Marker;
  text: string;        // single line, flattened, capped at TRANSCRIPT_TEXT_CAP
  ts: number;          // epoch ms
}

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

export interface Task {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  owner?: string;            // bare agent name
  state: TaskState;
  blocks: string[];
  blockedBy: string[];
}

export type ProtocolFrameType =
  | 'task_assignment' | 'task_completed' | 'idle_notification'
  | 'plan_approval_request' | 'plan_approval_response'
  | 'permission_request' | 'permission_response'
  | 'shutdown_request' | 'shutdown_approved' | 'shutdown_rejected'
  | 'mode_set_request' | 'teammate_terminated';

export interface MailMessage {
  msgId: string;             // msg_id from the inbox; synthesised for backfill frames
  from: string;
  to: string;
  text: string;
  summary?: string;
  ts: number;                // SENT time when known (inbox), delivery time otherwise
  tsIsDelivery: boolean;     // true when only the batched transcript time was available
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
