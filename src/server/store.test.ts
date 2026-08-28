import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, KIND_RETENTION } from './store';
import { project } from './project';
import type { NeedsYouItem } from '../shared/domain';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'store-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('team scoping', () => {
  it('keeps one team\'s events out of another team\'s state', async () => {
    const dbPath = path.join(dir, 'teams.db');

    const runOne = openStore(dbPath, 'session-aaaa1111');
    runOne.append('task', {
      id: 'task-from-run-1',
      subject: 'A task from run 1',
      description: '',
      status: 'in_progress',
      blocks: [],
      blockedBy: [],
    });
    runOne.append('mail', { source: 'inbox', to: 'team-lead', entries: [] }, 'team-lead');
    runOne.append('needsyou', {
      id: 'permit-from-run-1',
      kind: 'permission',
      agent: 'probe-alpha',
      reason: 'permission',
      detail: 'Bash — awaiting your decision',
      expiresAt: Date.now() + 540_000,
    } satisfies NeedsYouItem);
    expect(runOne.replay()).toHaveLength(3);
    runOne.close();

    const runTwo = openStore(dbPath, 'session-bbbb2222');
    try {
      expect(runTwo.replay()).toEqual([]);
      const state = project(runTwo.replay(), false);
      expect(state.tasks).toEqual([]);
      expect(state.mail).toEqual([]);
      expect(state.needsYou).toEqual([]);
    } finally {
      runTwo.close();
    }
  });

  it('adopts events recorded before the team was known, and drops the rest', () => {
    const dbPath = path.join(dir, 'adopt.db');
    const stale = openStore(dbPath, 'session-old00000');
    stale.append('hook', { event: 'PreToolUse' });
    stale.close();

    const store = openStore(dbPath);
    try {
      store.append('statusline', { branch: 'main' });
      store.setTeam('session-new00000');
      const kinds = store.replay().map((e) => e.kind);
      expect(kinds).toEqual(['statusline']);
    } finally {
      store.close();
    }
  });

  it('reads a database written before the log was team-scoped', () => {
    const dbPath = path.join(dir, 'legacy.db');
    const legacy = openStore(dbPath);
    legacy.append('roster', { config: null, sidecars: [] });
    legacy.close();

    const reopened = openStore(dbPath);
    expect(reopened.replay()).toHaveLength(1);
    reopened.close();
  });

  it('caps a high-volume kind so a long-lived install cannot degrade forever', () => {
    const cap = KIND_RETENTION.transcript!;
    const store = openStore(path.join(dir, 'cap.db'), 'session-cap00000');
    try {
      for (let i = 0; i < cap + 600; i++) store.append('transcript', { agent: 'a', records: [] }, 'a');
      const kept = store.replay();
      expect(kept.length).toBeLessThanOrEqual(cap + 250);
      expect(kept.length).toBeGreaterThan(cap - 1);
      // The newest survive; the oldest are the ones dropped.
      expect(kept[kept.length - 1].seq).toBe(cap + 600);
    } finally {
      store.close();
    }
  });
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
