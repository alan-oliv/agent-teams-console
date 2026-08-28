import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

const PRUNE_EVERY = 250;

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

export function openStore(dbPath: string, team = ''): Store {
  mkdirSync(path.dirname(dbPath), { recursive: true });

  let current = team;
  let sincePrune = 0;
  let nextSeq = 1;
  // Everything held here belongs to `current`: the load below drops the other
  // teams, and every append stamps `current`. Only the file carries the team.
  let events: StoredEvent[] = [];

  let contents = '';
  try {
    contents = readFileSync(dbPath, 'utf8');
  } catch {
    contents = '';
  }
  for (const line of contents.split('\n')) {
    if (!line) continue;
    const record = decode(line);
    if (!record) continue;
    // seq is never reused, not even by a record the prune below drops.
    if (record.event.seq >= nextSeq) nextSeq = record.event.seq + 1;
    // A second team's run inherited the first's tasks, mail and — worst —
    // permission cards whose permits died with the previous process, so they
    // 404'd on allow and could never be dismissed.
    if (record.team === current) events.push(record.event);
  }

  const rewrite = () => {
    const tmp = `${dbPath}.tmp`;
    writeFileSync(tmp, events.map((e) => encode(e, current)).join(''));
    // A rename is the only whole-file write that cannot leave a torn log.
    renameSync(tmp, dbPath);
  };

  events = trim(events);
  rewrite();

  return {
    append(kind, payload, agent) {
      const ts = Date.now();
      const seq = nextSeq++;
      const event: StoredEvent = { seq, ts, kind, agent, payload: payload ?? null };
      events.push(event);
      appendFileSync(dbPath, encode(event, current));
      if (++sincePrune >= PRUNE_EVERY) {
        sincePrune = 0;
        const before = events.length;
        events = trim(events);
        if (events.length !== before) rewrite();
      }
      return { seq, ts, kind, agent, payload };
    },
    replay() {
      return events.slice();
    },
    setTeam(next) {
      if (next === current || next === '') return;
      // Events recorded before the team was known belong to this run; a switch
      // between two named teams adopts nothing.
      if (current !== '') events = [];
      current = next;
      events = trim(events);
      rewrite();
    },
    close() {
      // Every append is already on disk — there is nothing buffered to flush.
    },
  };
}
