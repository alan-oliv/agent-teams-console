import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
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

interface Row {
  seq: number;
  ts: number;
  kind: string;
  agent: string | null;
  payload: string;
}

/**
 * The log is replayed in full on every publish, so it cannot be allowed to grow
 * without bound on a long-lived install. These kinds are all either last-wins
 * or keyed in the fold, so dropping the oldest rows costs history, never
 * correctness — and the startup sweep re-reads the files anyway.
 *
 * `needsyou` and `needsyou-resolved` are deliberately uncapped: dropping a
 * `resolved` row while its `needsyou` survived would resurrect a dismissed card.
 */
export const KIND_RETENTION: Partial<Record<EventKind, number>> = {
  transcript: 5_000,
  task: 5_000,
  mail: 2_000,
  hook: 2_000,
  substatus: 500,
  roster: 200,
  statusline: 200,
};

const PRUNE_EVERY = 250;

export function openStore(dbPath: string, team = ''): Store {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      seq     INTEGER PRIMARY KEY AUTOINCREMENT,
      ts      INTEGER NOT NULL,
      kind    TEXT    NOT NULL,
      agent   TEXT,
      payload TEXT    NOT NULL,
      team    TEXT    NOT NULL DEFAULT ''
    );
  `);
  // A database written before the log was team-scoped has no `team` column.
  const columns = db.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === 'team')) {
    db.exec(`ALTER TABLE events ADD COLUMN team TEXT NOT NULL DEFAULT ''`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS events_team_kind ON events (team, kind, seq)');

  const insert = db.prepare('INSERT INTO events (ts, kind, agent, payload, team) VALUES (?, ?, ?, ?, ?)');
  const selectTeam = db.prepare(
    'SELECT seq, ts, kind, agent, payload FROM events WHERE team = ? ORDER BY seq ASC',
  );
  const dropOtherTeams = db.prepare('DELETE FROM events WHERE team <> ?');
  const adoptUnscoped = db.prepare(`UPDATE events SET team = ? WHERE team = ''`);
  const trimKind = db.prepare(`
    DELETE FROM events
     WHERE team = ? AND kind = ? AND seq < (
       SELECT MIN(seq) FROM (
         SELECT seq FROM events WHERE team = ? AND kind = ? ORDER BY seq DESC LIMIT ?
       )
     )
  `);

  let current = team;
  let sincePrune = 0;

  // A second team's run inherited the first's tasks, mail and — worst —
  // permission cards whose permits died with the previous process, so they
  // 404'd on allow and could never be dismissed.
  dropOtherTeams.run(current);

  const trim = () => {
    for (const [kind, keep] of Object.entries(KIND_RETENTION)) {
      trimKind.run(current, kind, current, kind, keep);
    }
  };
  trim();

  return {
    append(kind, payload, agent) {
      const ts = Date.now();
      const info = insert.run(ts, kind, agent ?? null, JSON.stringify(payload ?? null), current);
      if (++sincePrune >= PRUNE_EVERY) {
        sincePrune = 0;
        trim();
      }
      return { seq: Number(info.lastInsertRowid), ts, kind, agent, payload };
    },
    replay() {
      return (selectTeam.all(current) as Row[]).map((r) => ({
        seq: r.seq,
        ts: r.ts,
        kind: r.kind as EventKind,
        agent: r.agent ?? undefined,
        payload: JSON.parse(r.payload) as unknown,
      }));
    },
    setTeam(next) {
      if (next === current || next === '') return;
      // Events recorded before the team was known belong to this run.
      adoptUnscoped.run(next);
      current = next;
      dropOtherTeams.run(current);
      trim();
    },
    close() {
      db.close();
    },
  };
}
