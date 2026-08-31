import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { isPidAlive } from './lifecycle';
import { logError, logInfo } from './log';
import {
  dedupeUsage,
  tokensOf,
  totalCost,
  usageRecordsOf,
} from '../shared/usage';
import { splitTok, type TokenSplit } from '../shared/cost';
import type { TranscriptRecord } from '../shared/transcript';

export type EventKind =
  | 'roster'
  | 'transcript'
  | 'task'
  | 'mail'
  | 'hook'
  | 'statusline'
  | 'substatus'
  | 'needsyou'
  | 'needsyou-resolved'
  | 'workflow';

export interface StoredEvent {
  seq: number;
  ts: number;
  kind: EventKind;
  agent?: string;
  payload: unknown;
}

export interface Store {
  append(kind: EventKind, payload: unknown, agent?: string): StoredEvent;
  replay(): StoredEvent[];
  /**
   * Binds the log to a team once the ingest learns which one it is. Events
   * recorded before that are adopted; every other team's are dropped.
   */
  setTeam(team: string): void;
  close(): void;
}

/**
 * The log is replayed in full on every publish, so it cannot be allowed to grow
 * without bound on a long-lived install. These kinds are all either last-wins
 * or keyed in the fold, so dropping the oldest rows costs history, never
 * correctness — and the startup sweep re-reads the files anyway.
 *
 * `needsyou` (the creates) stays uncapped: a still-open card has no `resolved`
 * row yet, so nothing here can tell "old" from "still relevant" by count alone.
 * `needsyou-resolved` gets a cap below, but `trim()` gives it paired handling
 * — see there — so a dropped resolution can never resurrect the card it closed.
 *
 * `transcript` is NOT here: what the publish walks is records, not events, and
 * one event holds anything from 1 record (a steady-state drain) to 2,630 (a boot
 * re-read of the largest real transcript), so no event count is a record bound.
 * See TRANSCRIPT_RECORDS_PER_AGENT.
 */
export const KIND_RETENTION: Partial<Record<EventKind, number>> = {
  task: 5_000,
  mail: 2_000,
  hook: 2_000,
  substatus: 500,
  roster: 200,
  statusline: 200,
  // A resolution is a human action (approve/deny/dismiss a card), not a
  // background event, so 500 is many days of them even on a busy console —
  // and safe regardless: trim() always drops a resolution's matching
  // `needsyou` create alongside it, so nothing here is ever left dangling.
  'needsyou-resolved': 500,
  // One row per run per re-read, folded last-wins per runId, so this caps
  // re-reads and not runs. A LIVE run is re-appended on every journal append —
  // the only kind here whose row count grows with a run's length rather than
  // with how many there are — and 16 runs was the whole of a heavy week on the
  // capture machine. Rows are ~9 KB each with the script stripped (leanRun).
  workflow: 500,
};

/**
 * How many transcript records the log keeps PER AGENT. project() is linear in
 * stored records (measured 0.64 us/record) and runs on every publish, up to 4 Hz,
 * against a 5 ms budget at 11 agents — 11,000 records team-wide, so 1,000 per
 * agent. The bound applies to every agent (transcriptDrops carries or
 * manufactures a cost snapshot before it drops that agent's records, so bounding
 * never costs money — see COST IS CARRIED there). Measured at that ceiling,
 * project + stringify is ~2.5 ms when the ingest's own snapshot is present and
 * ~5.5 ms worst case when the fold has to sum the records itself, which is now
 * a bounded worst case rather than an open one. 1,000 is 5x the 200-record
 * window at which the projected 60 lines are still exact on every real
 * transcript, and 91x the worst duplicate-message-id span (11).
 * Per agent, not team-wide, so a chatty agent cannot evict a quiet one's history
 * — and tuned for 11 agents, so a much larger team wants a smaller number.
 */
export const TRANSCRIPT_RECORDS_PER_AGENT = 1_000;

/** Backstop, so a flood of record-less transcript rows is still bounded. */
export const TRANSCRIPT_EVENTS_PER_AGENT = 1_200;

export const PRUNE_EVERY = 250;

const TEAM_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;

/** A team name safe to use as a file name — the leading class rejects `..`. */
export function isTeamName(team: string): boolean {
  return TEAM_NAME.test(team);
}

/**
 * One log FILE per team, so a console opened for team B can never write over
 * team A's history. `dbPath` is no longer a file, only the anchor that names
 * the console's own directory. The team comes off disk (`config.json`), so a
 * name that is not a plain slug falls back to a fixed name rather than
 * escaping the directory. Callers gate on isTeamName() first; this fallback is
 * the second, independent gate, and nothing reaches it from openStore.
 */
export function logPathFor(dbPath: string, team: string): string {
  const name = isTeamName(team) ? team : 'unknown';
  return path.join(path.dirname(dbPath), 'logs', `${name}.jsonl`);
}

/**
 * A run with no team yet writes here, one file per run, rather than into a log
 * every teamless run shares: a stamp inside a shared file cannot say which
 * rows are ours, but a path no other run can name can. It is a SUBDIRECTORY
 * because `TEAM_NAME` accepts names like `unknown-1234-a1b2c3d4`, so a
 * same-directory scheme would leave a collision class with a team log.
 */
export function runsDirFor(dbPath: string): string {
  return path.join(path.dirname(dbPath), 'logs', 'runs');
}

export function scratchLogPath(dbPath: string, runId: string): string {
  return path.join(runsDirFor(dbPath), `${runId}.jsonl`);
}

/**
 * A live team's log is capped by its own process; a dead team's is frozen at
 * whatever it held, so only the number of dead teams is unbounded. Seven days
 * is longer than any team lives and short enough that abandoned logs do not
 * accumulate. A team dormant for longer that comes back loses its history —
 * the same outcome as before per-team logs, and the sweep rebuilds the half
 * that came from files.
 */
export const STALE_LOG_MS = 7 * 24 * 60 * 60 * 1000;

function encode(event: StoredEvent, team: string): string {
  return `${JSON.stringify({ ...event, team })}\n`;
}

/**
 * A line that does not parse is dropped rather than fatal. Appends are one
 * line each, so the only damage a crash can do is truncate the last one — and
 * an install upgrading from the sqlite era finds a binary blob at this path,
 * which degrades to an empty log instead of an exception. Losing history costs
 * nothing: the startup sweep re-reads the source files.
 */
function decode(line: string): { team: string; event: StoredEvent } | null {
  let raw: Partial<StoredEvent & { team: unknown }>;
  try {
    raw = JSON.parse(line) as Partial<StoredEvent & { team: unknown }>;
  } catch {
    return null;
  }
  if (typeof raw?.seq !== 'number' || typeof raw.ts !== 'number' || typeof raw.kind !== 'string') {
    return null;
  }
  return {
    // A log written before the log was team-scoped has no `team`.
    team: typeof raw.team === 'string' ? raw.team : '',
    event: {
      seq: raw.seq,
      ts: raw.ts,
      kind: raw.kind as EventKind,
      agent: typeof raw.agent === 'string' ? raw.agent : undefined,
      payload: raw.payload ?? null,
    },
  };
}

function needsYouId(payload: unknown): string | undefined {
  const id = payload && typeof payload === 'object' ? (payload as { id?: unknown }).id : undefined;
  return typeof id === 'string' ? id : undefined;
}

// Two scalars off a TranscriptPayload (project.ts owns the shape). The store
// cannot rewrite a payload without forcing a whole-file compaction, but it can
// read one to decide whether to keep the row — the same exception needsYouId is.
function recordCount(payload: unknown): number {
  const recs =
    payload && typeof payload === 'object' ? (payload as { records?: unknown }).records : undefined;
  return Array.isArray(recs) ? recs.length : 0;
}

function readsFromStart(payload: unknown): boolean {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    (payload as { fromStart?: unknown }).fromStart === true
  );
}

function carriesTotals(payload: unknown): boolean {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    (payload as { totals?: unknown }).totals != null
  );
}

/** The cumulative snapshot a transcript row carries, if it carries one. */
interface Snapshot {
  costUsd: number;
  tokens: number;
  split: TokenSplit;
}
function totalsOf(payload: unknown): Snapshot | undefined {
  const totals =
    payload && typeof payload === 'object' ? (payload as { totals?: unknown }).totals : undefined;
  return totals != null && typeof totals === 'object' ? (totals as Snapshot) : undefined;
}

function recordsOf(payload: unknown): TranscriptRecord[] {
  const recs =
    payload && typeof payload === 'object' ? (payload as { records?: unknown }).records : undefined;
  return Array.isArray(recs) ? (recs as TranscriptRecord[]) : [];
}

/**
 * The snapshot project() would derive from these rows by summing their records
 * — its own fallback when the log carries none, reproduced here so the store
 * can write it down before dropping the records it came from. `dedupeUsage`
 * groups by message id, which is why this sums RECORDS and never adds an
 * aggregate to them: an aggregate is not a term, and a cut can split a group.
 */
function usageFrom(rows: StoredEvent[]): Snapshot {
  const recs: TranscriptRecord[] = [];
  // A null row would throw inside usageRecordsOf, and a throw HERE takes the
  // whole store down rather than one publish. parseLine keeps such rows out,
  // but the log is a text file an operator can hand-edit.
  for (const e of rows) for (const r of recordsOf(e.payload)) if (r != null) recs.push(r);
  const usage = dedupeUsage(usageRecordsOf(recs));
  return { costUsd: totalCost(usage), tokens: tokensOf(usage), split: splitTok(usage) };
}

/** A copy of `e` carrying `totals`. Everything else on the payload rides along. */
function withTotals(e: StoredEvent, totals: Snapshot): StoredEvent {
  return { ...e, payload: { ...(e.payload as object), totals } };
}

/**
 * A copy of `e` holding only the newest `keep` of its records. The payload is
 * replaced rather than mutated: replay() hands the live rows out, and project()
 * memoises each record's derived lines on the record object, so the records
 * themselves have to stay the same objects. Everything else on the payload
 * rides along — `totals` above all, a cumulative snapshot of the whole
 * transcript, so trimming records must never trim cost with them.
 */
function withNewestRecords(e: StoredEvent, keep: number): StoredEvent {
  const payload = e.payload as { records: unknown[] };
  const records = payload.records;
  return { ...e, payload: { ...payload, records: records.slice(records.length - keep) } };
}

/**
 * The agent's transcript rows the fold can still read, oldest first: everything
 * back to and including its newest from-byte-0 batch, which is where project()
 * clears what it holds. The rows before that one can never be read again.
 */
function readableRows(events: StoredEvent[], agent: string): StoredEvent[] {
  const rows: StoredEvent[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== 'transcript' || (e.agent ?? '') !== agent) continue;
    rows.push(e);
    if (readsFromStart(e.payload)) break;
  }
  return rows.reverse();
}

/**
 * Per agent, newest first, the transcript rows to drop, and the ones to replace
 * with a bounded and/or snapshot-bearing copy. Two reasons to drop a row: the
 * agent's record (or event) budget is already spent, or the row is older than
 * that agent's newest from-byte-0 batch — the fold clears the agent when it
 * reaches that batch, so nothing before it can ever be read again. The second
 * clause is what stops the log growing by one whole transcript per console
 * restart: measured over five successive boots against 11 unchanged 2,000-record
 * transcripts, the log reaches a fixed point (105 rows, 6.9 MB) instead of
 * gaining a whole copy of every transcript on each boot, forever.
 *
 * The budget is spent WITHIN a row too, not only between rows: this ingest
 * batches at 200 records, but migrateLegacyLog recovers rows from a pre-batching
 * events.db verbatim, and that ingest put a whole 2,000-record file in one. A
 * row bigger than the remaining budget is kept as a bounded copy of its newest
 * records instead of being admitted whole.
 *
 * COST IS CARRIED, NEVER DROPPED. project() reads an agent's spend from the
 * newest transcript row that carries a cumulative `totals`, and falls back to
 * summing the records it holds when there is none. So before this drops
 * anything of an agent's, it makes sure the number project() would report
 * SURVIVES: the winning snapshot is copied onto the newest surviving row when
 * the row it sat on is going, and an agent that has no snapshot at all gets one
 * derived from the records about to go — the same sum project() would have
 * done. Bounding records then costs history and never money, which is what lets
 * the bound apply to every agent instead of exempting the ones a snapshot never
 * reached (a log older than `totals`, or an agent whose transcript file is gone).
 */
function transcriptDrops(events: StoredEvent[]): {
  drop: Set<StoredEvent>;
  trimmed: Map<StoredEvent, StoredEvent>;
} {
  const drop = new Set<StoredEvent>();
  const trimmed = new Map<StoredEvent, StoredEvent>();
  const keptRecords = new Map<string, number>();
  const keptEvents = new Map<string, number>();
  const pastReset = new Set<string>();
  // The newest row of each agent that survives this pass. Always exists for an
  // agent with any row at all: the newest one can never be over budget.
  const newestKept = new Map<string, StoredEvent>();
  // The newest row of each agent carrying `totals` — the one project() reads,
  // whether or not the pastReset cut can still reach its records.
  const newestTotals = new Map<string, StoredEvent>();
  // Agents this pass takes records or rows away from.
  const losing = new Set<string>();

  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== 'transcript') continue;
    const agent = e.agent ?? '';
    if (!newestTotals.has(agent) && carriesTotals(e.payload)) newestTotals.set(agent, e);
    if (pastReset.has(agent)) {
      drop.add(e);
      losing.add(agent);
      continue;
    }
    if (readsFromStart(e.payload)) pastReset.add(agent);
    const records = keptRecords.get(agent) ?? 0;
    const count = keptEvents.get(agent) ?? 0;
    if (records >= TRANSCRIPT_RECORDS_PER_AGENT || count >= TRANSCRIPT_EVENTS_PER_AGENT) {
      drop.add(e);
      losing.add(agent);
      continue;
    }
    const held = recordCount(e.payload);
    const room = TRANSCRIPT_RECORDS_PER_AGENT - records;
    if (held > room) {
      trimmed.set(e, withNewestRecords(e, room));
      keptRecords.set(agent, TRANSCRIPT_RECORDS_PER_AGENT);
      losing.add(agent);
    } else {
      keptRecords.set(agent, records + held);
    }
    keptEvents.set(agent, count + 1);
    // Only a row with an object payload can carry a snapshot; a log whose rows
    // are not objects is one project() cannot fold at all.
    if (!newestKept.has(agent) && e.payload !== null && typeof e.payload === 'object') {
      newestKept.set(agent, e);
    }
  }

  // Second pass, over agents only: the first could not know which rows survive
  // until it had walked them all, and the snapshot has to land on one that does.
  for (const agent of losing) {
    const survivor = newestKept.get(agent);
    if (!survivor) continue;
    const winner = newestTotals.get(agent);
    // The snapshot project() reads is still there — nothing to carry.
    if (winner && !drop.has(winner)) continue;
    // Deriving one costs a second walk, so it is done HERE rather than
    // collected in the pass above: an agent needs it at most once in the life
    // of a log — the row this writes is a snapshot, so the next pass finds one.
    const carried = (winner && totalsOf(winner.payload)) || usageFrom(readableRows(events, agent));
    trimmed.set(survivor, withTotals(trimmed.get(survivor) ?? survivor, carried));
  }
  return { drop, trimmed };
}

/**
 * Drops the oldest events of any kind that is over its retention cap, plus the
 * transcript rows the per-agent record bound has made unreadable — and shrinks
 * the one row that straddles the bound. Returns `events` itself when there was
 * nothing to do, which is how the caller knows whether to compact the file:
 * a shrunk row leaves the row COUNT unchanged.
 */
function trim(events: StoredEvent[]): StoredEvent[] {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);

  const excess = new Map<string, number>();
  for (const [kind, keep] of Object.entries(KIND_RETENTION)) {
    const over = (counts.get(kind) ?? 0) - keep;
    if (over > 0) excess.set(kind, over);
  }
  const { drop: transcripts, trimmed } = transcriptDrops(events);
  if (excess.size === 0 && transcripts.size === 0 && trimmed.size === 0) return events;

  // The ids of the `needsyou-resolved` rows this pass is about to drop. Their
  // matching `needsyou` create rows must go with them (below) — a card with no
  // resolve yet is never in this set, so a still-open card is never touched.
  const closedIds = new Set<string>();
  let closedOver = excess.get('needsyou-resolved') ?? 0;
  for (const e of events) {
    if (closedOver <= 0) break;
    if (e.kind !== 'needsyou-resolved') continue;
    const id = needsYouId(e.payload);
    if (id) closedIds.add(id);
    closedOver--;
  }

  // Ascending seq order, so the first `over` events of a kind are its oldest.
  const kept = events.filter((e) => {
    if (transcripts.has(e)) return false;
    if (e.kind === 'needsyou') {
      const id = needsYouId(e.payload);
      if (id && closedIds.has(id)) return false;
    }
    const over = excess.get(e.kind);
    if (!over) return true;
    excess.set(e.kind, over - 1);
    return false;
  });
  return trimmed.size === 0 ? kept : kept.map((e) => trimmed.get(e) ?? e);
}

/**
 * Drops the logs of teams that have not been written to in STALE_LOG_MS, plus
 * the scratch logs and compaction temp files a hard-killed run left behind.
 */
function gcStaleLogs(dir: string, keep: string): void {
  const cutoff = Date.now() - STALE_LOG_MS;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith('.jsonl') && !name.endsWith('.tmp')) continue;
    const candidate = path.join(dir, name);
    if (candidate === keep) continue;
    try {
      if (statSync(candidate).mtimeMs < cutoff) unlinkSync(candidate);
    } catch {
      // Another console may have removed it first; the GC is best-effort.
    }
  }
}

/** The bytes of `file`, 0 when it is not there. */
function sizeOf(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * Identifies a row by what it says rather than by where it sits, so the same
 * legacy row can be recognised in a team log it was already merged into. `seq`
 * is deliberately out: the merge renumbers it. Both sides reach this through
 * decode(), so JSON.stringify sees identically-ordered keys.
 */
function rowKey(e: StoredEvent): string {
  return `${e.ts} ${e.kind} ${e.agent ?? ''} ${JSON.stringify(e.payload)}`;
}

/**
 * One-shot upgrade from the single shared log this console kept at `dbPath`
 * before logs were per-team. Its rows already carry the team they belong to,
 * so the file is split by that column — the push-only kinds (cards, statusline,
 * substatus) are the half no sweep of `~/.claude` could rebuild.
 *
 * Rows are merged into a team log that already exists, ORDERED by `ts`, never
 * appended: project() is a strictly ordered fold, so a legacy `needsyou` landing
 * after the `needsyou-resolved` that closed it would resurrect the card, and a
 * stale roster or branch would win its last-wins case.
 *
 * The rename of `dbPath` is the commit, not the claim, so it happens LAST and
 * only once every team merged: a crash, a full disk or a team log another
 * console is writing then leaves the source where the next start can retry it.
 * Retrying is free because the merge is keyed on row content — a second pass
 * finds every legacy row already there and writes nothing.
 */
function migrateLegacyLog(dbPath: string, runId: string): void {
  let contents: string;
  try {
    contents = readFileSync(dbPath, 'utf8');
  } catch {
    // No legacy log: the normal case on every start after the first.
    return;
  }

  const byTeam = new Map<string, StoredEvent[]>();
  for (const line of contents.split('\n')) {
    if (!line) continue;
    const record = decode(line);
    // A row recorded before its run knew its team belonged to a process that
    // is now gone: its permits died with it, and everything else it holds the
    // startup sweep reads back off disk.
    if (!record || !isTeamName(record.team)) continue;
    const rows = byTeam.get(record.team) ?? [];
    rows.push(record.event);
    byTeam.set(record.team, rows);
  }

  let recovered = 0;
  let touched = 0;
  let deferred = 0;
  for (const [team, legacy] of byTeam) {
    const file = logPathFor(dbPath, team);
    const before = sizeOf(file);
    const tmp = `${file}.${runId}.tmp`;
    try {
      const existing: StoredEvent[] = [];
      if (before > 0) {
        for (const line of readFileSync(file, 'utf8').split('\n')) {
          if (!line) continue;
          const record = decode(line);
          if (record) existing.push(record.event);
        }
      }
      const have = new Set(existing.map(rowKey));
      const fresh = legacy.filter((e) => !have.has(rowKey(e)));
      if (fresh.length === 0) continue;

      const out: StoredEvent[] = [];
      let l = 0;
      let n = 0;
      while (l < fresh.length || n < existing.length) {
        // A tie puts the legacy row first: it is the older of the two writers.
        const takeLegacy =
          n >= existing.length || (l < fresh.length && fresh[l].ts <= existing[n].ts);
        out.push(takeLegacy ? fresh[l++] : existing[n++]);
      }
      writeFileSync(tmp, out.map((e, i) => encode({ ...e, seq: i + 1 }, team)).join(''));
      // rewrite()'s check, for rewrite()'s reason: a team log that grew while
      // we worked has a live console appending rows that are not in `out`.
      if (sizeOf(file) !== before) {
        unlinkSync(tmp);
        deferred++;
        continue;
      }
      renameSync(tmp, file);
      recovered += fresh.length;
      touched++;
    } catch (err) {
      logError(`migrating ${team}`, err);
      deferred++;
    }
  }

  const base = path.basename(dbPath);
  if (deferred > 0) {
    logInfo(
      `recovered ${recovered} row(s) from ${base} into ${touched} team log(s); ${deferred} team ` +
        `log(s) are open in another console, so ${base} is left in place and the ` +
        'next start retries',
    );
    return;
  }
  const aside = `${dbPath}.migrated-${Date.now()}`;
  try {
    renameSync(dbPath, aside);
  } catch (err) {
    // ENOENT: another console migrated the same file and renamed it first,
    // which is a finished migration rather than a failure.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logError(`renaming ${base} aside`, err);
    return;
  }
  logInfo(
    `recovered ${recovered} row(s) from ${base} into ${touched} team log(s); ` +
      `the original is at ${aside}`,
  );
}

function ownerPathFor(file: string): string {
  return `${file}.owner`;
}

/**
 * Records that this process is writing `file`, and says so when another live
 * one already is. Advisory only — nothing branches on it — which is why it
 * needs no atomicity: a stale stamp is simply overwritten. Refusing to open
 * instead would hand `console-launch.sh` a console that will not restart for
 * seconds after a hard kill; this at least tells the operator, who otherwise
 * has nothing that would explain doubled rows and cards that will not resolve.
 */
function stampOwner(file: string): void {
  const owner = ownerPathFor(file);
  try {
    const prev = JSON.parse(readFileSync(owner, 'utf8')) as { pid?: unknown };
    const pid = typeof prev.pid === 'number' ? prev.pid : 0;
    if (pid && pid !== process.pid && isPidAlive(pid)) {
      logInfo(
        `${file} is already open in process ${pid} — two consoles on one team log double ` +
          'every ingested row, and each can only resolve its own permission cards',
      );
    }
  } catch {
    // No stamp, or an unreadable one: nothing to warn about.
  }
  try {
    writeFileSync(owner, `${JSON.stringify({ pid: process.pid, since: Date.now() })}\n`);
  } catch (err) {
    logError(`stamping ${owner}`, err);
  }
}

function clearOwner(file: string): void {
  const owner = ownerPathFor(file);
  try {
    const prev = JSON.parse(readFileSync(owner, 'utf8')) as { pid?: unknown };
    if (prev.pid !== process.pid) return;
    unlinkSync(owner);
  } catch {
    // Already gone, or taken over by another run: not ours to remove.
  }
}

export function openStore(dbPath: string, team = ''): Store {
  // This run's own rows are identified by the PATH they live at, which no
  // other run can name. A `team: ''` stamp inside a file every teamless run
  // shared could not: the next run to open it adopted those rows as its own.
  // Per openStore CALL, not per process — two Stores in one process must not
  // share a scratch file either.
  const runId = `${process.pid}-${randomUUID().slice(0, 8)}`;
  let current = isTeamName(team) ? team : '';
  let file = current === '' ? scratchLogPath(dbPath, runId) : logPathFor(dbPath, current);
  const logsDir = path.join(path.dirname(dbPath), 'logs');
  const runsDir = runsDirFor(dbPath);
  mkdirSync(runsDir, { recursive: true });

  migrateLegacyLog(dbPath, runId);
  // After the migration, so its fresh mtimes keep the GC off what it just wrote.
  gcStaleLogs(logsDir, file);
  gcStaleLogs(runsDir, file);
  if (current !== '') stampOwner(file);

  let sincePrune = 0;
  let nextSeq = 1;
  // Everything held here belongs to `current`: the load below drops the other
  // teams, and every append stamps `current`. Only the file carries the team.
  let events: StoredEvent[] = [];
  // Set when the file stops matching a clean encode of `events` — a line
  // decode() rejected, i.e. a crash-torn tail. A whole-file rewrite is only
  // justified when the file is actually wrong.
  let dirty = false;
  // Bytes of `file` this run has accounted for: what load() read, plus every
  // append since. A whole-file rewrite is only safe while that still matches
  // what is on disk — see rewrite().
  let accounted = 0;
  let warnedShared = false;

  const load = () => {
    events = [];
    nextSeq = 1;
    // A Buffer, not a utf8 string: `accounted` has to be the exact byte count,
    // and Buffer.byteLength of a decoded string lies on invalid UTF-8.
    let buf: Buffer;
    try {
      buf = readFileSync(file);
    } catch {
      buf = Buffer.alloc(0);
    }
    accounted = buf.length;
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line) continue;
      const record = decode(line);
      if (!record) {
        dirty = true;
        continue;
      }
      // seq is never reused, not even by a record the prune below drops.
      if (record.event.seq >= nextSeq) nextSeq = record.event.seq + 1;
      // The path already scopes the file to one team, or to this run, so the
      // stamp is now a second gate rather than the only one: it is what keeps
      // a foreign row an older-format or hand-edited log holds out of state.
      if (record.team === current) events.push(record.event);
    }
  };

  /**
   * A compaction: the one operation here that can REMOVE rows from the file.
   * Any byte on disk this run did not put there means a second writer is
   * appending to the same log and its rows are not in `events`, so writing our
   * snapshot over the file would delete them. Leave the file alone and say so;
   * it stays uncompacted until a run that owns it alone reopens it, which
   * costs disk, never rows. Everything else here is O_APPEND, which two
   * writers can do losslessly.
   */
  const rewrite = (): boolean => {
    const size = sizeOf(file);
    if (size !== accounted) {
      // Once per run: a second writer does not go away, and this would
      // otherwise print every PRUNE_EVERY appends for the life of the console.
      if (!warnedShared) {
        warnedShared = true;
        logInfo(
          `${file} holds ${size - accounted} bytes this run did not write — another console ` +
            'is writing the same team log, so this one will stop compacting it',
        );
      }
      return false;
    }
    const body = events.map((e) => encode(e, current)).join('');
    // A per-run temp name: a fixed `.tmp` is itself shared state between two
    // writers. gcStaleLogs collects any a crash leaves behind.
    const tmp = `${file}.${runId}.tmp`;
    writeFileSync(tmp, body);
    // A rename is the only whole-file write that cannot leave a torn log.
    renameSync(tmp, file);
    accounted = Buffer.byteLength(body);
    return true;
  };

  /** Removes the scratch log this run owns outright. */
  const discardScratch = (scratch: string) => {
    try {
      unlinkSync(scratch);
    } catch {
      // Never written (no appends before the team was known), or already gone.
    }
  };

  load();
  const loaded = events;
  events = trim(events);
  if (dirty || events !== loaded) {
    if (rewrite()) dirty = false;
  }

  return {
    append(kind, payload, agent) {
      const ts = Date.now();
      const seq = nextSeq++;
      const event: StoredEvent = { seq, ts, kind, agent, payload: payload ?? null };
      events.push(event);
      const encoded = encode(event, current);
      appendFileSync(file, encoded);
      accounted += Buffer.byteLength(encoded);
      if (++sincePrune >= PRUNE_EVERY) {
        sincePrune = 0;
        const before = events;
        events = trim(events);
        if (events !== before) rewrite();
      }
      return { seq, ts, kind, agent, payload };
    },
    // The array is a copy; the rows in it are not. project() memoises each
    // record's derived lines on the record object, so handing back copies here
    // would leave the console correct and silently 18x slower.
    replay() {
      return events.slice();
    },
    setTeam(next) {
      if (next === current || !isTeamName(next)) return;
      // Events recorded before the team was known belong to this run; a switch
      // between two named teams adopts nothing. Captured before `current`
      // moves, so a named -> named switch can never delete a team log below.
      const wasScratch = current === '';
      const adopted = wasScratch ? events : [];
      const scratch = file;
      current = next;
      file = logPathFor(dbPath, current);
      stampOwner(file);
      load();
      for (const e of adopted) {
        const moved = { ...e, seq: nextSeq++ };
        events.push(moved);
        const encoded = encode(moved, current);
        appendFileSync(file, encoded);
        accounted += Buffer.byteLength(encoded);
      }
      const before = events;
      events = trim(events);
      if (dirty || events !== before) {
        if (rewrite()) dirty = false;
      }
      // Drained into the team's own log. Removing the file rather than blanking
      // it is safe only because it is this run's alone: no other run can name
      // that path, so nothing here can take another run's history with it.
      if (wasScratch) discardScratch(scratch);
      // A named -> named switch leaves the previous team's log behind, and
      // this run is no longer the one writing it.
      else clearOwner(scratch);
    },
    close() {
      // Every append is already on disk — there is nothing buffered to flush.
      if (current === '') discardScratch(file);
      else clearOwner(file);
    },
  };
}
