import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from './store';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'store-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('openStore', () => {
  it('survives close and reopen, replaying in seq order', () => {
    const dbPath = path.join(dir, 'events.db');
    const first = openStore(dbPath);
    const a = first.append('roster', { config: { name: 'session-98b0b4a7' } });
    const b = first.append('task', { id: '1', status: 'in_progress' });
    const c = first.append('mail', { to: 'team-lead' }, 'probe-alpha');
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    first.close();

    const second = openStore(dbPath);
    const events = second.replay();
    second.close();

    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(events.map((e) => e.kind)).toEqual(['roster', 'task', 'mail']);
    expect(events[0].payload).toEqual({ config: { name: 'session-98b0b4a7' } });
    expect(events[1].payload).toEqual({ id: '1', status: 'in_progress' });
    expect(events[2].agent).toBe('probe-alpha');
    expect(events[0].agent).toBeUndefined();
  });

  it('stamps ts with epoch milliseconds', () => {
    const store = openStore(path.join(dir, 'ts.db'));
    const before = Date.now();
    const ev = store.append('hook', { event: 'PreToolUse' }, 'probe-bravo');
    const after = Date.now();
    store.close();
    expect(ev.ts).toBeGreaterThanOrEqual(before);
    expect(ev.ts).toBeLessThanOrEqual(after);
  });

  it('creates the parent directory when it does not exist', () => {
    const store = openStore(path.join(dir, 'nested', 'deeper', 'events.db'));
    store.append('statusline', { fiveHourPct: 41 });
    expect(store.replay()).toHaveLength(1);
    store.close();
  });

  it('runs in WAL mode', () => {
    const dbPath = path.join(dir, 'wal.db');
    const store = openStore(dbPath);
    store.append('substatus', { agent: 'probe-charlie', tokenCount: 23639 });
    store.close();
    const reopened = openStore(dbPath);
    expect(reopened.replay()[0].payload).toEqual({ agent: 'probe-charlie', tokenCount: 23639 });
    reopened.close();
  });
});
