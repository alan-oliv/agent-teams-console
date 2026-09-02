import type { Subagent, SubagentState, SubagentTree } from './domain';
import type { TranscriptRecord } from './transcript';
import { contextOccupancy, tokensOf, usageRecordsOf, type UsageRecord } from './usage';

/**
 * The read model behind `TeamState.subagents`, built from the only two files a
 * subagent leaves behind:
 *
 *   the PARENT's transcript   the `Task`/`Agent` tool_use, its tool_result, and
 *                             the `<task-notification>` that closes a background
 *                             launch — the spine, and all a subagent whose
 *                             sidecar never landed will ever have
 *   its OWN transcript        `<session>/subagents/agent-<agentId>.jsonl`, every
 *                             record `isSidechain` — what it spent, what it
 *                             called, what it last said
 *
 * plus `agent-<agentId>.meta.json`, whose `toolUseId` is the join between them.
 *
 * NOT a roster contract. A subagent never enters `config.json` `members[]` and
 * must never be drawn as a teammate; ingest/hooks.ts keeps them out of
 * `members[]` deliberately and that stays true.
 */

/** How much of a returned result travels. Long enough to read, short enough that a fan-out of twenty still fits one frame. */
export const SUBAGENT_SUMMARY_CAP = 400;

/** The two names this runtime has given the subagent-dispatch tool. */
const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);

/**
 * One `Task`/`Agent` call as its PARENT recorded it. Everything here is
 * readable from the parent alone, which is what makes it the spine of the tree
 * rather than one more optional source.
 */
export interface SubagentSpawn {
  toolUseId: string;
  /** The parent record that dispatched it — one turn's calls are a fan-out. */
  siblingGroup: string;
  queuedAt: number;
  name?: string;
  description?: string;
  agentType?: string;
  model?: string;
  /** Reported by a background launch's own tool_result, which is not a return. */
  agentId?: string;
  returnedAt?: number;
  returnedSummary?: string;
  failed?: boolean;
}

/**
 * What one subagent's own transcript adds, folded rather than stored: the
 * records themselves are not kept — a fan-out of twenty would put twenty whole
 * transcripts through the log — so this is the whole of what a drain leaves
 * behind, cumulative and last-wins.
 */
export interface SubagentDigest {
  /** Records folded so far. 0 is the difference between queued and running. */
  records: number;
  startedAt?: number;
  lastAt?: number;
  tokens: number;
  toolCalls: number;
  contextTokens: number;
  summary?: string;
  /** Its own dispatches — this is what makes the tree nest to any depth. */
  spawns: SubagentSpawn[];
}

/**
 * The mutable state behind a digest, one per transcript FILE. Kept by the
 * ingest across drains because a transcript arrives in chunks: a dispatch and
 * its result routinely land in different reads, and `usage` has to survive
 * between them so a re-read cannot bill a message id twice.
 */
export interface SubagentFold {
  records: number;
  startedAt?: number;
  lastAt?: number;
  toolCalls: number;
  contextTokens: number;
  summary?: string;
  /** messageId -> the best record seen, the rule `dedupeUsage` applies. */
  usage: Map<string, UsageRecord>;
  spawns: SubagentSpawn[];
  /** toolUseId -> its index in `spawns`, so a later result finds its own call. */
  at: Map<string, number>;
}

export function emptySubagentFold(): SubagentFold {
  return {
    records: 0,
    toolCalls: 0,
    contextTokens: 0,
    usage: new Map(),
    spawns: [],
    at: new Map(),
  };
}

export function digestOf(fold: SubagentFold): SubagentDigest {
  return {
    records: fold.records,
    startedAt: fold.startedAt,
    lastAt: fold.lastAt,
    tokens: tokensOf([...fold.usage.values()]),
    toolCalls: fold.toolCalls,
    contextTokens: fold.contextTokens,
    summary: fold.summary,
    spawns: fold.spawns,
  };
}

/** The dispatch and the answer to one, as read off a single record. */
export type SpawnEvent =
  | { kind: 'dispatch'; spawn: SubagentSpawn }
  /**
   * The dispatch turned out not to be a subagent at all. One `Agent` call can
   * spawn a TEAMMATE or launch a WORKFLOW RUN, and only its tool_result says
   * which — so a dispatch is provisional until the answer comes back.
   */
  | { kind: 'retract'; toolUseId: string }
  | {
      kind: 'update';
      toolUseId: string;
      agentId?: string;
      returnedAt?: number;
      /**
       * The raw tool_result body, flattened only once it is known to belong to
       * a dispatch — every Bash result in the transcript reaches this branch,
       * and building a string for each of them is the one cost that would
       * matter at four publishes a second.
       */
      content?: unknown;
      returnedSummary?: string;
      failed?: boolean;
    };

function cap(s: string): string {
  if (s.length <= SUBAGENT_SUMMARY_CAP) return s;
  // A bare slice can leave a lone high surrogate, which the browser paints as
  // U+FFFD — the same guard transcript.ts's capText applies.
  return `${s.slice(0, SUBAGENT_SUMMARY_CAP - 1).replace(/[\uD800-\uDBFF]$/, '')}…`;
}

function flatten(content: unknown): string {
  if (typeof content === 'string') return content.replace(/\s+/g, ' ').trim();
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (block && typeof block === 'object') {
          const text = (block as { text?: unknown }).text;
          if (typeof text === 'string') return text;
        }
        return '';
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

const NOTIFICATION = /<task-notification>([\s\S]*?)<\/task-notification>/;
const NOTIFIED_TOOL_USE = /<tool-use-id>([\s\S]*?)<\/tool-use-id>/;
const NOTIFIED_STATUS = /<status>([\s\S]*?)<\/status>/;
const NOTIFIED_SUMMARY = /<summary>([\s\S]*?)<\/summary>/;

/**
 * The completion of a BACKGROUND launch. Its tool_result answered at dispatch
 * time and said nothing about the outcome, so this frame is the only record on
 * either side that says a background subagent came back.
 *
 * It arrives in two forms — as an ordinary user turn once delivered, and as a
 * `type: 'attachment'` record with no `message` at all while it is still queued
 * — and both are ordinary on a real machine, so both are read.
 */
function notificationOf(rec: TranscriptRecord): SpawnEvent | null {
  const content = rec.message?.content;
  const text = typeof content === 'string' ? content : rec.attachment?.prompt;
  if (typeof text !== 'string' || !text.includes('<task-notification>')) return null;
  const body = NOTIFICATION.exec(text)?.[1];
  if (!body) return null;
  const toolUseId = str(NOTIFIED_TOOL_USE.exec(body)?.[1]?.trim());
  if (!toolUseId) return null;
  const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
  if (Number.isNaN(ts)) return null;
  const status = NOTIFIED_STATUS.exec(body)?.[1]?.trim();
  const summary = str(NOTIFIED_SUMMARY.exec(body)?.[1]?.trim());
  return {
    kind: 'update',
    toolUseId,
    returnedAt: ts,
    ...(summary ? { returnedSummary: cap(summary) } : {}),
    // Every notification observed so far reads `completed`; anything else is
    // the runtime saying it did not, so it is reported rather than smoothed.
    ...(status !== undefined && status !== 'completed' ? { failed: true } : {}),
  };
}

/**
 * What one record says about subagent dispatches. Empty for the overwhelming
 * majority of records, which is what makes it cheap enough to run over every
 * record of every publish.
 */
export function spawnEventsOf(rec: TranscriptRecord): SpawnEvent[] {
  const events: SpawnEvent[] = [];
  const notified = notificationOf(rec);
  if (notified) events.push(notified);

  const content = rec.message?.content;
  if (!Array.isArray(content)) return events;
  const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
  if (Number.isNaN(ts)) return events;

  // `toolUseResult` hangs off the RECORD, not the block. A record carries one
  // tool_result in every corpus seen, so reading it per block is safe.
  const raw = rec.toolUseResult;
  const result = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined;

  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as {
      type?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    };
    if (rec.type === 'assistant' && b.type === 'tool_use' && SUBAGENT_TOOLS.has(b.name ?? '')) {
      if (typeof b.id !== 'string' || !rec.uuid) continue;
      const input = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>;
      const spawn: SubagentSpawn = { toolUseId: b.id, siblingGroup: rec.uuid, queuedAt: ts };
      const name = str(input.name);
      const description = str(input.description);
      const agentType = str(input.subagent_type);
      const model = str(input.model);
      if (name) spawn.name = name;
      if (description) spawn.description = description;
      if (agentType) spawn.agentType = agentType;
      if (model) spawn.model = model;
      events.push({ kind: 'dispatch', spawn });
    } else if (rec.type === 'user' && b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
      // The same `Agent` tool spawns teammates and launches workflow runs, and
      // the call site looks identical — only the answer distinguishes them. A
      // teammate has a roster row of its own and a run has its own console
      // mode, so either one left in this tree would be a second, wrong copy.
      if (
        result?.status === 'teammate_spawned' ||
        typeof result?.teammate_id === 'string' ||
        typeof result?.runId === 'string'
      ) {
        events.push({ kind: 'retract', toolUseId: b.tool_use_id });
        continue;
      }
      const agentId = str(result?.agentId);
      // A background launch answers the instant it is dispatched. Treating that
      // as a return would report every backgrounded agent as finished before it
      // had read its own prompt.
      const launched = result?.status === 'async_launched' || result?.isAsync === true;
      events.push({
        kind: 'update',
        toolUseId: b.tool_use_id,
        ...(agentId ? { agentId } : {}),
        ...(launched ? {} : { returnedAt: ts, content: b.content, failed: b.is_error === true }),
      });
    }
  }
  return events;
}

/**
 * Applies what a record said. An update for a dispatch we do not hold is
 * DROPPED rather than promoted to a spawn of its own: without the tool_use
 * there is no queue time and no sibling group, and a row with neither is not a
 * dispatch the tree can place.
 */
export function applySpawnEvents(fold: SubagentFold, events: readonly SpawnEvent[]): void {
  for (const event of events) {
    if (event.kind === 'dispatch') {
      if (fold.at.has(event.spawn.toolUseId)) continue;
      fold.at.set(event.spawn.toolUseId, fold.spawns.length);
      fold.spawns.push(event.spawn);
      continue;
    }
    if (event.kind === 'retract') {
      const gone = fold.at.get(event.toolUseId);
      if (gone === undefined) continue;
      fold.spawns.splice(gone, 1);
      // Every index after the hole moved. A retraction happens once per
      // teammate spawn against a handful of dispatches, so rebuilding beats
      // carrying a tombstone every reader would have to know to skip.
      fold.at.clear();
      fold.spawns.forEach((s, i) => fold.at.set(s.toolUseId, i));
      continue;
    }
    const at = fold.at.get(event.toolUseId);
    if (at === undefined) continue;
    const spawn = fold.spawns[at];
    if (event.agentId) spawn.agentId = event.agentId;
    if (event.returnedAt !== undefined) spawn.returnedAt = event.returnedAt;
    if (event.failed) spawn.failed = true;
    const summary = event.returnedSummary ?? (event.content === undefined ? undefined : flatten(event.content));
    if (summary) spawn.returnedSummary = cap(summary);
  }
}

/** Every dispatch one transcript made, in order, with whatever closed it. */
export function spawnsOf(records: readonly TranscriptRecord[]): SubagentSpawn[] {
  const fold = emptySubagentFold();
  for (const rec of records) applySpawnEvents(fold, spawnEventsOf(rec));
  return fold.spawns;
}

/** A record that moves the context figure — see `contextOccupancy`. */
function bearsContext(rec: TranscriptRecord): boolean {
  if (rec.type === 'system') return rec.subtype === 'compact_boundary';
  return rec.type === 'assistant' && rec.isApiErrorMessage !== true && rec.message?.usage != null;
}

/**
 * Folds one drain of a subagent's own transcript. Chunk-order independent by
 * construction: every field is a min, a max, a running total or a last-wins,
 * so reading a file in one go and reading it a record at a time agree.
 */
export function foldSubagentRecords(fold: SubagentFold, records: readonly TranscriptRecord[]): void {
  let moved = false;
  for (const rec of records) {
    fold.records++;
    const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      if (fold.startedAt === undefined || ts < fold.startedAt) fold.startedAt = ts;
      if (fold.lastAt === undefined || ts > fold.lastAt) fold.lastAt = ts;
    }
    const content = rec.message?.content;
    if (rec.type === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as { type?: string; text?: string };
        if (b.type === 'tool_use') fold.toolCalls++;
        else if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          // Last one wins: the final thing a subagent says is its report.
          fold.summary = cap(b.text.replace(/\s+/g, ' ').trim());
        }
      }
    }
    if (bearsContext(rec)) moved = true;
    applySpawnEvents(fold, spawnEventsOf(rec));
  }

  for (const u of usageRecordsOf(records as TranscriptRecord[])) {
    const best = fold.usage.get(u.messageId);
    if (!best || u.usage.output_tokens > best.usage.output_tokens) fold.usage.set(u.messageId, u);
  }
  // Only when this chunk actually holds the newest context-bearing record —
  // `contextOccupancy` of a chunk that holds none is 0, which would erase a
  // figure the file already established.
  if (moved) fold.contextTokens = contextOccupancy(records as TranscriptRecord[]);
}

/** What a subagent's own transcript and sidecar add to the call that made it. */
export interface SubagentMeta {
  name?: string;
  agentType?: string;
  model?: string;
  description?: string;
}

export interface SubagentFacts {
  agentId?: string;
  meta?: SubagentMeta;
  digest?: SubagentDigest;
}

function stateOf(spawn: SubagentSpawn, digest: SubagentDigest | undefined): SubagentState {
  if (spawn.failed) return 'failed';
  if (spawn.returnedAt !== undefined) return 'returned';
  // Records of its own are the only proof it ever started. A sidecar is not:
  // it is written at spawn time, before the agent has read its prompt.
  return digest && digest.records > 0 ? 'running' : 'queued';
}

function nodesOf(
  spawns: readonly SubagentSpawn[],
  agent: string,
  parent: string,
  depth: number,
  facts: ReadonlyMap<string, SubagentFacts>,
  seen: Set<string>,
): Subagent[] {
  const out: Subagent[] = [];
  for (let i = 0; i < spawns.length; i++) {
    const spawn = spawns[i];
    // A log an operator has hand-edited, or a toolUseId reused across two
    // parents, would otherwise recurse until the stack gives out.
    if (seen.has(spawn.toolUseId)) continue;
    seen.add(spawn.toolUseId);

    const found = facts.get(spawn.toolUseId);
    const digest = found?.digest;
    const started = digest && digest.records > 0 ? digest.startedAt : undefined;
    const node: Subagent = {
      toolUseId: spawn.toolUseId,
      name:
        found?.meta?.name ??
        spawn.name ??
        spawn.description ??
        found?.agentId ??
        spawn.agentId ??
        spawn.toolUseId,
      agent,
      parent,
      depth,
      spawnIndex: i,
      siblingGroup: spawn.siblingGroup,
      state: stateOf(spawn, digest),
      queuedAt: spawn.queuedAt,
      children: nodesOf(digest?.spawns ?? [], agent, spawn.toolUseId, depth + 1, facts, seen),
    };

    const agentId = found?.agentId ?? spawn.agentId;
    const agentType = found?.meta?.agentType ?? spawn.agentType;
    const model = found?.meta?.model ?? spawn.model;
    const description = spawn.description ?? found?.meta?.description;
    if (agentId) node.agentId = agentId;
    if (agentType) node.agentType = agentType;
    if (model) node.model = model;
    if (description) node.description = description;
    if (started !== undefined) node.startedAt = started;
    if (spawn.returnedAt !== undefined) {
      node.returnedAt = spawn.returnedAt;
      // From its first record when we have its transcript, from the dispatch
      // otherwise — the two differ by the time it waited for a slot.
      node.durationMs = spawn.returnedAt - (started ?? spawn.queuedAt);
    }
    if (spawn.returnedSummary) node.returnedSummary = spawn.returnedSummary;
    if (digest && digest.records > 0) {
      node.tokens = digest.tokens;
      node.toolCalls = digest.toolCalls;
      node.contextTokens = digest.contextTokens;
      if (!node.returnedSummary && digest.summary) node.returnedSummary = digest.summary;
    }
    out.push(node);
  }
  return out;
}

/**
 * The whole tree, keyed by the roster agent that dispatched each root.
 *
 * An agent that dispatched nothing is left OUT rather than mapped to an empty
 * array: "no subagents" is the ordinary case for most of a roster, and an empty
 * array per agent is a frame paying for a fact nobody draws.
 */
export function buildSubagentTree(
  roots: ReadonlyArray<{ agent: string; spawns: readonly SubagentSpawn[] }>,
  facts: ReadonlyMap<string, SubagentFacts>,
): SubagentTree {
  const tree: SubagentTree = {};
  for (const root of roots) {
    const nodes = nodesOf(root.spawns, root.agent, root.agent, 1, facts, new Set());
    if (nodes.length > 0) tree[root.agent] = nodes;
  }
  return tree;
}

/** Every subagent in a tree's list, at every depth — a nested dispatch is still activity. */
export function flattenSubagents(subagents: readonly Subagent[]): Subagent[] {
  return subagents.flatMap((s) => [s, ...flattenSubagents(s.children)]);
}
