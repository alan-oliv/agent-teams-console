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
  close(): void;
}

interface Row {
  seq: number;
  ts: number;
  kind: string;
  agent: string | null;
  payload: string;
}

export function openStore(dbPath: string): Store {
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
      payload TEXT    NOT NULL
    );
  `);

  const insert = db.prepare(
    'INSERT INTO events (ts, kind, agent, payload) VALUES (?, ?, ?, ?)',
  );
  const selectAll = db.prepare(
    'SELECT seq, ts, kind, agent, payload FROM events ORDER BY seq ASC',
  );

  return {
    append(kind, payload, agent) {
      const ts = Date.now();
      const info = insert.run(ts, kind, agent ?? null, JSON.stringify(payload ?? null));
      return { seq: Number(info.lastInsertRowid), ts, kind, agent, payload };
    },
    replay() {
      return (selectAll.all() as Row[]).map((r) => ({
        seq: r.seq,
        ts: r.ts,
        kind: r.kind as EventKind,
        agent: r.agent ?? undefined,
        payload: JSON.parse(r.payload) as unknown,
      }));
    },
    close() {
      db.close();
    },
  };
}
