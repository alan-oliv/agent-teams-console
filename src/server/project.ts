import type { StoredEvent } from './store';
import type {
  Agent,
  AgentStatus,
  MailMessage,
  NeedsYouItem,
  RateLimits,
  Task,
  TeamState,
  TranscriptLine,
} from '../shared/domain';
import { buildRoster, type Sidecar, type TeamConfig } from '../shared/roster';
import { resolveModel } from '../shared/catalog';
import {
  contextOccupancy,
  dedupeUsage,
  tokensOf,
  totalCost,
  usageRecordsOf,
} from '../shared/usage';
import { currentToolOf, toTranscriptLines, type TranscriptRecord } from '../shared/transcript';
import {
  mergeMail,
  parseInboxEntry,
  parseTeammateFrames,
  type InboxEntry,
} from '../shared/mailbox';
import { AGENT_STALE_MS, deriveTaskState } from '../shared/status';

/**
 * How many transcript lines PER AGENT survive into the projected `TeamState`
 * that gets serialised into every SSE frame. The store keeps full history —
 * this trims only the projection. The views are bottom-anchored and the
 * largest of them (the rail) shows at most 18 lines, so 60 is generous
 * headroom over that, not a real budget — do not raise it "to be safe".
 * Measured live: an untrimmed frame for 11 agents ran 1683 KB, with
 * transcript JSON alone accounting for ~103% of it (one agent alone carried
 * 1002 lines) to draw at most 18 on screen.
 */
export const PROJECTED_TRANSCRIPT_LINES = 60;

// ---------------------------------------------------------------------------
// Event payload shapes. The pinned contract fixes `EventKind` but not what each
// kind carries, so these are defined here and consumed by src/server/ingest/*.
// ---------------------------------------------------------------------------
export interface RosterPayload {
  config: TeamConfig | null;
  sidecars: Array<{ meta: Sidecar; transcriptPath: string }>;
}
/**
 * What the agent has spent over its WHOLE transcript, not over the records this
 * payload carries: cumulative and total, never incremental. The store bounds
 * stored records per agent, so the fold can no longer add up a full history —
 * and an additive aggregate is not a substitute, because `dedupeUsage` groups by
 * message id and an eviction cut can split a group. Measured on a real fixture:
 * aggregate(dropped prefix) + cost(kept tail) inflates by 37.7%, while a
 * cumulative last-wins snapshot is exact. Nothing is summed across the boundary,
 * so no message id can be counted twice.
 */
export interface AgentUsageTotals {
  costUsd: number;
  tokens: number;
}
export interface TranscriptPayload {
  agent: string;
  records: TranscriptRecord[];
  /** This batch begins at the transcript file's first byte — see watch/tail.ts. */
  fromStart?: boolean;
  /** Only on the LAST batch of a drain, so a partial read never publishes a partial total. */
  totals?: AgentUsageTotals;
}
export interface TaskPayload {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  owner?: string;
  status: 'pending' | 'in_progress' | 'completed';
  blocks: string[];
  blockedBy: string[];
}
export type MailPayload =
  | { source: 'inbox'; to: string; entries: InboxEntry[] }
  | { source: 'transcript'; to: string; text: string; deliveredAt: number };
export interface HookPayload {
  event: string;
  agent: string;
  toolName?: string;
  text?: string;
  error?: string;
}
export interface StatuslinePayload {
  totalCostUsd?: number;
  contextTokens?: number;
  contextWindow?: number;
  branch?: string;
  fiveHourPct?: number;
  sevenDayPct?: number;
  resetsAt?: string;
}
export interface SubstatusPayload {
  agent: string;
  tokenCount?: number;
  contextWindowSize?: number;
  status?: string;
  model?: string;
}
export interface NeedsYouResolvedPayload {
  id: string;
}

function lastAssistantModel(records: TranscriptRecord[]): string | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const m = records[i].message?.model;
    if (records[i].type === 'assistant' && m) return m;
  }
  return undefined;
}

/**
 * `WeakMap.set` throws on a primitive key, so a record that is not an object
 * would take the whole publish down — and with it every later one, since
 * `flush()` swallows the throw and the SSE just stops sending. `parseLine`
 * keeps such rows out of the store, but the log is a plain text file an
 * operator can hand-edit, and one corrupt row must cost only its own lines.
 * The derivations are pure, so skipping the memo costs nothing but repeat work.
 */
function memoisable(rec: TranscriptRecord): boolean {
  return rec !== null && typeof rec === 'object';
}

/**
 * `toTranscriptLines` and `currentToolOf` are pure functions of one record, and
 * `store.replay()` hands back the SAME record objects on every publish — it
 * copies the array, not the rows, and `trim()`/`setTeam()` re-wrap the event but
 * keep the payload. Without these the fold re-derived byte-identical strings
 * four times a second: 53 ms of a 56 ms publish at the transcript retention cap.
 * Keyed on the record, so an entry dies with the row `trim()` drops.
 *
 * `linesOf` hands back the memoised array itself. Nothing may mutate it or the
 * lines in it — every later frame would carry the damage, and the projection
 * tests would not see it.
 */
const lineMemo = new WeakMap<TranscriptRecord, TranscriptLine[]>();
function linesOf(rec: TranscriptRecord): TranscriptLine[] {
  if (!memoisable(rec)) return toTranscriptLines(rec);
  let lines = lineMemo.get(rec);
  if (!lines) {
    lines = toTranscriptLines(rec);
    lineMemo.set(rec, lines);
  }
  return lines;
}

// `describeTool` can render a falsy string, which the fold treats as "no tool"
// rather than as a clear — so undefined needs a distinct miss marker.
const NO_TOOL = Symbol('no tool');
const toolMemo = new WeakMap<TranscriptRecord, string | typeof NO_TOOL>();
function toolOf(rec: TranscriptRecord): string | undefined {
  if (!memoisable(rec)) return currentToolOf(rec);
  const hit = toolMemo.get(rec);
  if (hit !== undefined) return hit === NO_TOOL ? undefined : hit;
  const tool = currentToolOf(rec);
  toolMemo.set(rec, tool ?? NO_TOOL);
  return tool;
}

export function project(events: StoredEvent[], readOnly: boolean): TeamState {
  let config: TeamConfig | null = null;
  let sidecars: Array<{ meta: Sidecar; transcriptPath: string }> = [];
  let branch: string | undefined;
  let rateLimits: RateLimits | undefined;

  const records = new Map<string, TranscriptRecord[]>();
  const seenRecords = new Map<string, Set<string>>();
  const tasksRaw = new Map<string, TaskPayload>();
  const unread = new Map<string, number>();
  const substatus = new Map<string, SubstatusPayload>();
  const currentTool = new Map<string, string | undefined>();
  const errors = new Map<string, string>();
  const lastActivity = new Map<string, number>();
  const needsYou = new Map<string, NeedsYouItem>();
  const usageTotals = new Map<string, AgentUsageTotals>();
  let mail: MailMessage[] = [];

  const bump = (agent: string, ts: number) => {
    if (ts > (lastActivity.get(agent) ?? -1)) lastActivity.set(agent, ts);
  };

  for (const ev of events) {
    switch (ev.kind) {
      case 'roster': {
        const p = ev.payload as RosterPayload;
        if (p.config) config = p.config;
        if (p.sidecars && p.sidecars.length > 0) sidecars = p.sidecars;
        break;
      }
      case 'transcript': {
        const p = ev.payload as TranscriptPayload;
        // Cumulative, so the newest snapshot REPLACES the last one. Summing them
        // would double-count every message id both cover.
        if (p.totals) usageTotals.set(p.agent, p.totals);
        // The file is being read again from its first byte, so everything held
        // for this agent is about to arrive again. Clearing the uuid set matters
        // as much as clearing the list: without it every re-read record would be
        // deduped away against a list that was just emptied.
        if (p.fromStart) {
          records.set(p.agent, []);
          seenRecords.set(p.agent, new Set<string>());
        }
        const list = records.get(p.agent) ?? [];
        const seen = seenRecords.get(p.agent) ?? new Set<string>();
        for (const rec of p.records) {
          // The 5s reconciliation sweep deliberately re-reads files, so the same
          // record can arrive twice; the record uuid is the dedupe key.
          const key = rec.uuid ?? '';
          if (key && seen.has(key)) continue;
          if (key) seen.add(key);
          list.push(rec);

          const tool = toolOf(rec);
          if (tool) currentTool.set(p.agent, tool);
          else if (rec.type === 'user' && rec.toolUseResult !== undefined) {
            currentTool.set(p.agent, undefined);
          }
          if (rec.type === 'assistant') {
            if (rec.isApiErrorMessage) {
              errors.set(p.agent, linesOf(rec)[0]?.text ?? 'api error');
            } else {
              errors.delete(p.agent);
            }
          }
          const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
          if (!Number.isNaN(ts)) bump(p.agent, ts);
        }
        records.set(p.agent, list);
        seenRecords.set(p.agent, seen);
        break;
      }
      case 'task': {
        const p = ev.payload as TaskPayload;
        tasksRaw.set(p.id, p);
        break;
      }
      case 'mail': {
        const p = ev.payload as MailPayload;
        if (p.source === 'inbox') {
          mail = mergeMail(mail, p.entries.map((e) => parseInboxEntry(e, p.to)));
          unread.set(p.to, p.entries.filter((e) => e.read === false).length);
        } else {
          mail = mergeMail(mail, parseTeammateFrames(p.text, p.deliveredAt, p.to));
        }
        break;
      }
      case 'hook': {
        const p = ev.payload as HookPayload;
        if (p.event === 'PreToolUse' && p.toolName) currentTool.set(p.agent, p.toolName);
        if (p.event === 'PostToolUse') currentTool.set(p.agent, undefined);
        if (p.error) errors.set(p.agent, p.error);
        bump(p.agent, ev.ts);
        break;
      }
      case 'statusline': {
        const p = ev.payload as StatuslinePayload;
        if (p.branch) branch = p.branch;
        if (p.fiveHourPct !== undefined || p.sevenDayPct !== undefined) {
          rateLimits = {
            fiveHourPct: p.fiveHourPct ?? 0,
            sevenDayPct: p.sevenDayPct ?? 0,
            resetsAt: p.resetsAt,
          };
        }
        break;
      }
      case 'substatus': {
        const p = ev.payload as SubstatusPayload;
        substatus.set(p.agent, { ...substatus.get(p.agent), ...p });
        break;
      }
      case 'needsyou': {
        const item = ev.payload as NeedsYouItem;
        needsYou.set(item.id, item);
        break;
      }
      case 'needsyou-resolved': {
        needsYou.delete((ev.payload as NeedsYouResolvedPayload).id);
        break;
      }
    }
  }

  const lastIdle = new Map<string, number>();
  for (const m of mail) {
    if (m.protocol?.type === 'idle_notification' && m.ts > (lastIdle.get(m.from) ?? -1)) {
      lastIdle.set(m.from, m.ts);
    }
  }

  // The team's own most recent pulse, not the wall clock: project() is a pure
  // fold over the log elsewhere, and a replayed historical log (a fixture, a
  // restart replaying old events) must not have every agent go 'departed' just
  // because real time moved on since it was written. In the live server this
  // tracks real time closely regardless — the lead's own session is polled
  // every 250ms while anyone has the console open — so a genuinely silent
  // straggler still reads as stale against it.
  let latestActivity = -1;
  for (const ts of lastActivity.values()) if (ts > latestActivity) latestActivity = ts;

  // A permission card outlives the permit it stands for when the process that
  // held it is gone, and `allow` then 404s forever. Expiry is the only thing
  // that can retire one, so it is enforced here rather than trusted to arrive.
  const cards = [...needsYou.values()].filter(
    (c) => c.expiresAt === undefined || c.expiresAt > Date.now(),
  );
  let totalTokens = 0;

  // Liveness comes ONLY from config.json membership. The sidecars survive a
  // teammate's exit on purpose (§2.2), so an agent present there but no longer
  // in `members[]` has finished, not gone idle — and a null config (lead
  // exited, team dir gone) means nobody is live.
  const liveMembers = config ? new Set(config.members.map((m) => m.name)) : null;

  const agents: Agent[] = buildRoster(config, sidecars).map((id) => {
    const recs = records.get(id.name) ?? [];
    const sub = substatus.get(id.name);
    const resolved = resolveModel(lastAssistantModel(recs) ?? sub?.model ?? id.rawModel);
    // No snapshot means an old log, or a test log the ingest did not write: fall
    // back to the records, which is exactly what this did before they existed.
    const carried = usageTotals.get(id.name);
    const usage = carried ? [] : dedupeUsage(usageRecordsOf(recs));
    totalTokens += carried ? carried.tokens : tokensOf(usage);

    // Only the last PROJECTED_TRANSCRIPT_LINES survive the slice below, so walk
    // backwards and stop once there are enough: an agent with 9,000 records
    // costs ~60 conversions, not 9,000. The records collected are a suffix of
    // the list, so their lines are a suffix of the full line list at least 60
    // long — and slice(-60) of that is slice(-60) of the whole.
    const tail: TranscriptLine[][] = [];
    let have = 0;
    for (let i = recs.length - 1; i >= 0 && have < PROJECTED_TRANSCRIPT_LINES; i--) {
      const some = linesOf(recs[i]);
      if (some.length === 0) continue;
      tail.push(some);
      have += some.length;
    }
    const lines: TranscriptLine[] = [];
    for (let i = tail.length - 1; i >= 0; i--) for (const line of tail[i]) lines.push(line);

    let status: AgentStatus = 'working';
    if (!liveMembers || !liveMembers.has(id.name)) status = 'departed';
    else if (errors.has(id.name)) status = 'failed';
    else if (cards.some((c) => c.agent === id.name && c.kind === 'plan')) status = 'plan_pending';
    else {
      const act = lastActivity.get(id.name) ?? -1;
      const idle = lastIdle.get(id.name) ?? -1;
      if (act < 0 || idle >= act) status = 'idle';
      // Still in config.members, but silent well past any turn this system
      // ever lets run unattended, with no idle frame to explain the silence —
      // config.json survives a crashed process, so membership alone cannot
      // tell 'working' from 'gone'.
      else if (latestActivity - act > AGENT_STALE_MS) status = 'departed';
    }

    return {
      name: id.name,
      agentId: id.agentId,
      isLead: id.isLead,
      agentType: id.agentType,
      model: resolved.canonical,
      role: id.role,
      color: id.color,
      status,
      currentTool: currentTool.get(id.name),
      contextTokens: sub?.tokenCount ?? contextOccupancy(recs),
      contextLimit: resolved.window,
      compactAt: resolved.compactAt,
      costUsd: carried ? carried.costUsd : totalCost(usage),
      startedAt: id.joinedAt,
      transcript: lines.slice(-PROJECTED_TRANSCRIPT_LINES),
      unread: unread.get(id.name) ?? 0,
      error: errors.get(id.name),
    };
  });

  const tasks: Task[] = [...tasksRaw.values()].map((t) => ({
    id: t.id,
    subject: t.subject,
    description: t.description,
    activeForm: t.activeForm,
    owner: t.owner,
    state: deriveTaskState(t.status, { owner: t.owner, blockedBy: t.blockedBy ?? [] }, agents),
    blocks: t.blocks ?? [],
    blockedBy: t.blockedBy ?? [],
  }));

  // Agent 'blocked' needs the derived task states, so it is a second pass.
  for (const agent of agents) {
    if (agent.status !== 'working') continue;
    if (tasks.some((t) => t.owner === agent.name && t.state === 'blocked')) agent.status = 'blocked';
  }

  return {
    teamName: config?.name ?? '',
    leadSessionId: config?.leadSessionId ?? '',
    branch,
    startedAt: config?.createdAt ?? 0,
    totalTokens,
    totalCostUsd: agents.reduce((sum, a) => sum + a.costUsd, 0),
    rateLimits,
    agents,
    tasks,
    mail,
    needsYou: cards,
    readOnly,
  };
}
