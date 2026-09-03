import type { StoredEvent } from './store';
import type {
  Agent,
  AgentStatus,
  MailMessage,
  NeedsYouItem,
  RateLimits,
  Task,
  TaskMetadata,
  TeamState,
  TranscriptLine,
} from '../shared/domain';
import {
  applySpawnEvents,
  buildSubagentTree,
  emptySubagentFold,
  spawnEventsOf,
  type SpawnEvent,
  type SubagentDigest,
  type SubagentFacts,
  type SubagentFold,
  type SubagentMeta,
} from '../shared/subagents';
import { buildRoster, type Sidecar, type TeamConfig } from '../shared/roster';
import { resolveModel } from '../shared/catalog';
import { splitTok, type TokenSplit } from '../shared/cost';
import {
  contextOccupancy,
  dedupeUsage,
  tokensOf,
  totalCost,
  usageRecordsOf,
} from '../shared/usage';
import {
  currentToolOf,
  fullLineText,
  toTranscriptLines,
  type TranscriptRecord,
} from '../shared/transcript';
import {
  mergeMail,
  parseInboxEntry,
  parseTeammateFrames,
  type InboxEntry,
} from '../shared/mailbox';
import { AGENT_STALE_MS, deriveTaskState, isWallClockLog } from '../shared/status';

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
  /** The four billed classes behind `costUsd` — what the usage view's per-agent ledger draws. */
  split: TokenSplit;
}
export interface TranscriptPayload {
  agent: string;
  records: TranscriptRecord[];
  /** This batch begins at the transcript file's first byte — see watch/tail.ts. */
  fromStart?: boolean;
  /** Only on the LAST batch of a drain, so a partial read never publishes a partial total. */
  totals?: AgentUsageTotals;
  /**
   * The transcript file's own mtime, carried for the staleness rule alone —
   * `isWallClockLog` compares it against the newest record here to decide
   * whether the wall clock means anything on this log. Absent on a batch that
   * came from a buffer rather than a read, and on any event a test built.
   */
  mtimeMs?: number;
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
  metadata?: TaskMetadata;
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
  /** What the operator called the session; the lead's session file carries it. */
  sessionName?: string;
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
/**
 * One subagent's own two files, folded. Cumulative and last-wins per
 * `toolUseId`, for the same reason `AgentUsageTotals` is: the log cannot hold a
 * subagent's records — a fan-out of twenty would put twenty whole transcripts
 * through it — so a digest replaces the last one rather than adding to it.
 *
 * `toolUseId` is the key rather than `agentId` because it is what the PARENT's
 * transcript names, and the parent is the only side that always exists.
 */
export interface SubagentPayload {
  toolUseId: string;
  agentId: string;
  meta?: SubagentMeta;
  digest: SubagentDigest;
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
 * `toTranscriptLines` and `currentToolOf` are pure functions of one record
 * (plus, for the former, the agent it is being read for — see below), and
 * `store.replay()` hands back the SAME record objects on every publish — it
 * copies the array, not the rows, and `trim()`/`setTeam()` re-wrap the event but
 * keep the payload. Without these the fold re-derived byte-identical strings
 * four times a second: 53 ms of a 56 ms publish at the transcript retention cap.
 * Keyed on the record, so an entry dies with the row `trim()` drops.
 *
 * `linesOf` hands back the memoised array itself. Nothing may mutate it or the
 * lines in it — every later frame would carry the damage, and the projection
 * tests would not see it.
 *
 * The inner Map adds the AGENT to the key, needed now that a diff-bearing line
 * carries `Diff.agent`. A record is in practice only ever read for the one
 * agent whose file it came from — every `store.append('transcript', …, agent)`
 * call in ingest/files.ts resolves and fixes that agent before any record from
 * the read reaches the store — but keying on the record alone would make that
 * an invariant this file has to keep re-proving against ingest's attribution
 * logic forever. Keying on both instead makes a wrong agent structurally
 * impossible here, for the cost of one small Map per record — no cache miss
 * on the common path, since a record is read for its one real agent every
 * time. The Map lives only inside the WeakMap entry, so it dies with it.
 */
const lineMemo = new WeakMap<TranscriptRecord, Map<string, TranscriptLine[]>>();
function linesOf(rec: TranscriptRecord, agent: string): TranscriptLine[] {
  if (!memoisable(rec)) return toTranscriptLines(rec, agent);
  const byAgent = lineMemo.get(rec) ?? new Map<string, TranscriptLine[]>();
  let lines = byAgent.get(agent);
  if (!lines) {
    lines = toTranscriptLines(rec, agent);
    byAgent.set(agent, lines);
    lineMemo.set(rec, byAgent);
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

/**
 * The same memo again, for the subagent dispatches a record reports. Empty for
 * all but a handful of records, but the check that PROVES it is empty walks the
 * record's content blocks — and this fold runs over every stored record of
 * every agent, four times a second.
 */
const spawnMemo = new WeakMap<TranscriptRecord, SpawnEvent[]>();
function spawnEventsFor(rec: TranscriptRecord): SpawnEvent[] {
  if (!memoisable(rec)) return spawnEventsOf(rec);
  let events = spawnMemo.get(rec);
  if (events === undefined) {
    events = spawnEventsOf(rec);
    spawnMemo.set(rec, events);
  }
  return events;
}

/**
 * Every line the log still holds for one agent, oldest first.
 *
 * The live frame carries only the last {@link PROJECTED_TRANSCRIPT_LINES} per
 * agent — that cap is what keeps an SSE frame small, so it must not grow. This
 * is the other half: the operator scrolls up, asks for what came before, and
 * gets it once instead of on every publish.
 */
export function transcriptHistory(events: StoredEvent[], agent: string): TranscriptLine[] {
  const records: TranscriptRecord[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    if (ev.kind !== 'transcript') continue;
    const p = ev.payload as TranscriptPayload;
    if (p.agent !== agent) continue;
    // Same restart semantics as the projection: a re-read from byte zero
    // replaces what came before rather than appending a second copy.
    if (p.fromStart) {
      records.length = 0;
      seen.clear();
    }
    for (const rec of p.records) {
      const key = rec.uuid ?? '';
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      records.push(rec);
    }
  }
  const lines: TranscriptLine[] = [];
  for (const rec of records) lines.push(...linesOf(rec, agent));
  return lines;
}

/**
 * The uncapped text behind one line of an agent's transcript, for a row the
 * operator expanded. `id` is a TranscriptLine id — `<record uuid>#<index>`.
 *
 * Undefined when the id names nothing we still hold: the store keeps only
 * TRANSCRIPT_RECORDS_PER_AGENT records per agent, so a row can outlive the
 * record it was projected from. A drawer that asks too late gets the capped
 * text it already has, which is the honest answer.
 */
export function transcriptLineText(
  events: StoredEvent[],
  agent: string,
  id: string,
): string | undefined {
  const hash = id.lastIndexOf('#');
  if (hash <= 0) return undefined;
  const uuid = id.slice(0, hash);
  // Digits only, and at least one: `Number('')` is 0, so a bare `uuid#` would
  // otherwise resolve to the record's first row.
  const suffix = id.slice(hash + 1);
  if (!/^\d+$/.test(suffix)) return undefined;
  const index = Number(suffix);

  // Newest wins: a re-read from byte zero can leave two copies of a uuid in the
  // log, and the later one is the one the projection kept.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind !== 'transcript') continue;
    const p = ev.payload as TranscriptPayload;
    if (p.agent !== agent) continue;
    for (const rec of p.records) {
      if (rec.uuid !== uuid) continue;
      return fullLineText(rec, index);
    }
  }
  return undefined;
}

export function project(events: StoredEvent[], readOnly: boolean, now = Date.now()): TeamState {
  let config: TeamConfig | null = null;
  let sidecars: Array<{ meta: Sidecar; transcriptPath: string }> = [];
  let branch: string | undefined;
  let sessionName: string | undefined;
  let rateLimits: RateLimits | undefined;

  const records = new Map<string, TranscriptRecord[]>();
  const seenRecords = new Map<string, Set<string>>();
  const tasksRaw = new Map<string, TaskPayload>();
  const unread = new Map<string, number>();
  const substatus = new Map<string, SubstatusPayload>();
  const currentTool = new Map<string, string | undefined>();
  const errors = new Map<string, string>();
  const lastActivity = new Map<string, number>();
  // Per agent, the mtime of the transcript file its newest batch came from —
  // the second clock `isWallClockLog` needs. Last-wins rather than max: the
  // freshest read is the one that describes the file as it is now.
  const logClock = new Map<string, number>();
  const needsYou = new Map<string, NeedsYouItem>();
  const usageTotals = new Map<string, AgentUsageTotals>();
  // Per roster agent, the `Task`/`Agent` calls its transcript made — collected
  // inside the record loop below rather than by a second walk, because that
  // walk would be over every stored record on every publish.
  const spawnFolds = new Map<string, SubagentFold>();
  const subagentFacts = new Map<string, SubagentFacts>();
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
        if (p.mtimeMs !== undefined) logClock.set(p.agent, p.mtimeMs);
        // The file is being read again from its first byte, so everything held
        // for this agent is about to arrive again. Clearing the uuid set matters
        // as much as clearing the list: without it every re-read record would be
        // deduped away against a list that was just emptied.
        if (p.fromStart) {
          records.set(p.agent, []);
          seenRecords.set(p.agent, new Set<string>());
          spawnFolds.set(p.agent, emptySubagentFold());
        }
        const list = records.get(p.agent) ?? [];
        const seen = seenRecords.get(p.agent) ?? new Set<string>();
        const spawns = spawnFolds.get(p.agent) ?? emptySubagentFold();
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
              errors.set(p.agent, linesOf(rec, p.agent)[0]?.text ?? 'api error');
            } else {
              errors.delete(p.agent);
            }
          }
          applySpawnEvents(spawns, spawnEventsFor(rec));
          const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
          if (!Number.isNaN(ts)) bump(p.agent, ts);
        }
        records.set(p.agent, list);
        seenRecords.set(p.agent, seen);
        spawnFolds.set(p.agent, spawns);
        break;
      }
      case 'subagent': {
        const p = ev.payload as SubagentPayload;
        // Cumulative, so the newest digest REPLACES the last one, like `totals`.
        subagentFacts.set(p.toolUseId, {
          agentId: p.agentId,
          meta: p.meta,
          digest: p.digest,
        });
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
        if (p.sessionName) sessionName = p.sessionName;
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

  // An ordinary session that was never a team has no config.json and no
  // teammate sidecars, so buildRoster finds nobody — yet its own transcript is
  // right there, and the whole trace view keys off that one agent existing.
  // The transcript's own agent name is the key everything else (records,
  // spawns, substatus) is already filed under, so the synthetic lead must
  // borrow it rather than invent one.
  const roster = buildRoster(config, sidecars);
  const soloLead = roster.length === 0 ? [...records.keys()][0] : undefined;
  if (soloLead !== undefined) {
    roster.push({
      name: soloLead,
      agentId: soloLead,
      isLead: true,
      agentType: '',
      role: '',
      joinedAt: 0,
    });
  }

  const agents: Agent[] = roster.map((id) => {
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
      const some = linesOf(recs[i], id.name);
      if (some.length === 0) continue;
      tail.push(some);
      have += some.length;
    }
    const lines: TranscriptLine[] = [];
    for (let i = tail.length - 1; i >= 0; i--) for (const line of tail[i]) lines.push(line);

    let status: AgentStatus = 'working';
    // The synthetic lead has no membership to be missing from — its transcript
    // is the only evidence either way, so it goes through the activity ladder
    // below instead of being declared dead on arrival.
    if (id.name !== soloLead && (!liveMembers || !liveMembers.has(id.name))) status = 'departed';
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
      // The branch above measures each agent against the team's newest
      // activity, and on a ONE-AGENT team that agent IS the newest, so the
      // difference is always 0 and it can never fire. The wall clock can say
      // what the team cannot — but only on a log whose own file clock proves it
      // is on the wall clock, or every replayed fixture would depart at once.
      // `idle` and not `departed`: the branch above has a contrast to read as
      // evidence something died, and this one has only the silence.
      else if (isWallClockLog(logClock.get(id.name), act) && now - act > AGENT_STALE_MS) {
        status = 'idle';
      }
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
      tokenSplit: carried ? carried.split : splitTok(usage),
      startedAt: id.joinedAt,
      transcript: lines.slice(-PROJECTED_TRANSCRIPT_LINES),
      unread: unread.get(id.name) ?? 0,
      error: errors.get(id.name),
    };
  });

  const tasks: Task[] = [...tasksRaw.values()].map((t) => {
    // blockedBy ids stay on a task after the blocker completes — deriveTaskState
    // must see only the ones still open, or a resolved dependency blocks its
    // dependent forever. Both lists travel: the full one is the dependency the
    // task declared, the open one is what is actually holding it up.
    const blockedBy = t.blockedBy ?? [];
    const openBlockedBy = blockedBy.filter((id) => tasksRaw.get(id)?.status !== 'completed');
    return {
      id: t.id,
      subject: t.subject,
      description: t.description,
      activeForm: t.activeForm,
      owner: t.owner,
      state: deriveTaskState(t.status, { owner: t.owner, blockedBy: openBlockedBy }, agents),
      blocks: t.blocks ?? [],
      blockedBy,
      openBlockedBy,
      metadata: t.metadata,
    };
  });

  // Agent 'blocked' needs the derived task states, so it is a second pass.
  // An owner actively working one task is not blocked just because another
  // task they own hasn't started and is waiting on a dependency.
  for (const agent of agents) {
    if (agent.status !== 'working') continue;
    const owned = tasks.filter((t) => t.owner === agent.name);
    if (owned.some((t) => t.state === 'in_progress')) continue;
    if (owned.some((t) => t.state === 'blocked')) agent.status = 'blocked';
  }

  // Roster order, so the tree walks the same agents the wall does — and only
  // roster agents, so a subagent can never be mistaken for a team member.
  const subagents = buildSubagentTree(
    agents.map((a) => ({ agent: a.name, spawns: spawnFolds.get(a.name)?.spawns ?? [] })),
    subagentFacts,
  );

  return {
    teamName: config?.name ?? '',
    sessionName,
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
    ...(Object.keys(subagents).length > 0 ? { subagents } : {}),
  };
}
