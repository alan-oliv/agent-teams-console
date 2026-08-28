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

export type EventKind =
  | 'roster'
  | 'transcript'
  | 'task'
  | 'mail'
  | 'hook'
  | 'statusline'
  | 'substatus'
  | 'needsyou'
  | 'needsyou-resolved';

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
 */
export const KIND_RETENTION: Partial<Record<EventKind, number>> = {
  transcript: 5_000,
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
};

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

/** Drops the oldest events of any kind that is over its retention cap. */
function trim(events: StoredEvent[]): StoredEvent[] {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);

  const excess = new Map<string, number>();
  for (const [kind, keep] of Object.entries(KIND_RETENTION)) {
    const over = (counts.get(kind) ?? 0) - keep;
    if (over > 0) excess.set(kind, over);
  }
  if (excess.size === 0) return events;

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
  return events.filter((e) => {
    if (e.kind === 'needsyou') {
      const id = needsYouId(e.payload);
      if (id && closedIds.has(id)) return false;
    }
    const over = excess.get(e.kind);
    if (!over) return true;
    excess.set(e.kind, over - 1);
    return false;
  });
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

/**
 * One-shot upgrade from the single shared log this console kept at `dbPath`
 * before logs were per-team. Its rows already carry the team they belong to,
 * so the file is split by that column — the push-only kinds (cards, statusline,
 * substatus) are the half no sweep of `~/.claude` could rebuild. The rename is
 * also the exclusion: only one process can rename a path, so two consoles
 * starting together cannot both migrate, and doing it FIRST means a crash
 * mid-split leaves the source safe under the aside name rather than looping
 * and duplicating rows on the next open.
 */
function migrateLegacyLog(dbPath: string): void {
  const aside = `${dbPath}.migrated-${Date.now()}`;
  try {
    renameSync(dbPath, aside);
  } catch {
    // No legacy log, or another console migrated it first: the normal case.
    return;
  }
  let contents = '';
  try {
    contents = readFileSync(aside, 'utf8');
  } catch (err) {
    logError(`reading ${aside}`, err);
    return;
  }
  const byTeam = new Map<string, string[]>();
  for (const line of contents.split('\n')) {
    if (!line) continue;
    const record = decode(line);
    // A row recorded before its run knew its team belonged to a process that
    // is now gone: its permits died with it, and everything else it holds the
    // startup sweep reads back off disk.
    if (!record || !isTeamName(record.team)) continue;
    const rows = byTeam.get(record.team) ?? [];
    rows.push(`${line}\n`);
    byTeam.set(record.team, rows);
  }
  let migrated = 0;
  for (const [name, rows] of byTeam) {
    try {
      // `wx`: a team log that already exists was written by a newer run, whose
      // history supersedes this file's — appending these rows to the end of it
      // would let a stale roster win the last-wins fold. It is also the
      // TOCTOU-free form of an existsSync check.
      writeFileSync(logPathFor(dbPath, name), rows.join(''), { flag: 'wx' });
      migrated += rows.length;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') logError(`migrating ${name}`, err);
    }
  }
  logInfo(
    `migrated ${migrated} rows from ${path.basename(dbPath)} into ${byTeam.size} team log(s); ` +
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

  migrateLegacyLog(dbPath);
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
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      size = 0;
    }
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
  const loaded = events.length;
  events = trim(events);
  if (dirty || events.length !== loaded) {
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
        const before = events.length;
        events = trim(events);
        if (events.length !== before) rewrite();
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
      const before = events.length;
      events = trim(events);
      if (dirty || events.length !== before) {
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
