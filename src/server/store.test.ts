import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  openStore,
  logPathFor,
  runsDirFor,
  KIND_RETENTION,
  PRUNE_EVERY,
  STALE_LOG_MS,
  TRANSCRIPT_EVENTS_PER_AGENT,
  TRANSCRIPT_RECORDS_PER_AGENT,
} from './store';
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
  const legacyCard = () => ({
    id: 'card-legacy',
    kind: 'permission',
    agent: 'probe-alpha',
    reason: 'permission',
    detail: 'Bash — awaiting your decision',
    expiresAt: Date.now() + 540_000,
  });

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

  it('migrates a log written before the log was team-scoped into the per-team logs', async () => {
    const dbPath = path.join(dir, 'legacy.db');
    const legacy = [
      { seq: 1, ts: 1, kind: 'needsyou', payload: { id: 'card-a' }, team: 'session-aaaa1111' },
      { seq: 2, ts: 2, kind: 'statusline', payload: { branch: 'main' }, team: 'session-aaaa1111' },
      { seq: 3, ts: 3, kind: 'hook', payload: { event: 'PreToolUse' }, team: 'session-bbbb2222' },
      // A row from a run that never discovered its team: its permits died with
      // that process, so it is not carried forward.
      { seq: 4, ts: 4, kind: 'hook', payload: { event: 'PreToolUse' }, team: '' },
    ];
    const raw = `${legacy.map((r) => JSON.stringify(r)).join('\n')}\n`;
    await fs.writeFile(dbPath, raw);

    const store = openStore(dbPath, 'session-aaaa1111');
    // The push-only kinds are back: nothing on disk could rebuild them.
    expect(store.replay().map((e) => e.kind)).toEqual(['needsyou', 'statusline']);
    store.close();

    const other = openStore(dbPath, 'session-bbbb2222');
    expect(other.replay().map((e) => e.kind)).toEqual(['hook']);
    other.close();

    // The team-less row is dropped rather than pooled into a shared log.
    const logs = (await fs.readdir(path.join(dir, 'logs'))).filter((n) => n.endsWith('.jsonl'));
    expect(logs.sort()).toEqual(['session-aaaa1111.jsonl', 'session-bbbb2222.jsonl']);

    // The original is renamed aside, never deleted, and byte-identical.
    await expect(fs.stat(dbPath)).rejects.toThrow();
    const aside = (await fs.readdir(dir)).filter((n) => n.includes('.migrated-'));
    expect(aside).toHaveLength(1);
    expect(await fs.readFile(path.join(dir, aside[0]), 'utf8')).toBe(raw);

    // And it does not run twice: reopening adds nothing.
    const again = openStore(dbPath, 'session-aaaa1111');
    expect(again.replay()).toHaveLength(2);
    again.close();
  });

  it('folds a legacy log into a team log a newer run already wrote', async () => {
    const dbPath = path.join(dir, 'legacy-late.db');
    const fresh = openStore(dbPath, 'session-aaaa1111');
    fresh.append('roster', { config: null, sidecars: [] });
    fresh.close();

    const legacy = [
      { seq: 1, ts: 1, kind: 'hook', payload: { id: 'stale' }, team: 'session-aaaa1111' },
      { seq: 2, ts: 2, kind: 'needsyou', payload: legacyCard(), team: 'session-aaaa1111' },
    ];
    await fs.writeFile(dbPath, `${legacy.map((r) => JSON.stringify(r)).join('\n')}\n`);

    const store = openStore(dbPath, 'session-aaaa1111');
    try {
      // Ordered by ts, so the older rows land ahead of the roster rather than
      // after it, where they would beat it in the last-wins fold.
      expect(store.replay().map((e) => e.kind)).toEqual(['hook', 'needsyou', 'roster']);
      expect(project(store.replay(), false).needsYou.map((c) => c.id)).toEqual(['card-legacy']);
    } finally {
      store.close();
    }
  });

  it('does not duplicate rows when the migration runs a second time', async () => {
    const dbPath = path.join(dir, 'legacy-twice.db');
    const legacy = [
      { seq: 1, ts: 1, kind: 'needsyou', payload: { id: 'card-a' }, team: 'session-aaaa1111' },
      { seq: 2, ts: 2, kind: 'statusline', payload: { branch: 'main' }, team: 'session-aaaa1111' },
    ];
    const raw = `${legacy.map((r) => JSON.stringify(r)).join('\n')}\n`;
    await fs.writeFile(dbPath, raw);

    const first = openStore(dbPath, 'session-aaaa1111');
    expect(first.replay()).toHaveLength(2);
    first.close();

    // A crash between the split and the rename leaves the source in place, so
    // the next start migrates the same rows again.
    await fs.writeFile(dbPath, raw);
    const second = openStore(dbPath, 'session-aaaa1111');
    try {
      expect(second.replay().map((e) => e.kind)).toEqual(['needsyou', 'statusline']);
    } finally {
      second.close();
    }
  });

  it('keeps a resolution ahead of the create it closed', async () => {
    const dbPath = path.join(dir, 'legacy-resolved.db');
    const team = 'session-aaaa1111';
    await fs.mkdir(path.join(dir, 'logs'), { recursive: true });
    await fs.writeFile(
      logPathFor(dbPath, team),
      `${JSON.stringify({ seq: 1, ts: 500, kind: 'needsyou-resolved', payload: { id: 'card-legacy' }, team })}\n`,
    );
    await fs.writeFile(
      dbPath,
      `${JSON.stringify({ seq: 1, ts: 100, kind: 'needsyou', payload: legacyCard(), team })}\n`,
    );

    const store = openStore(dbPath, team);
    try {
      expect(store.replay().map((e) => e.kind)).toEqual(['needsyou', 'needsyou-resolved']);
      expect(project(store.replay(), false).needsYou).toEqual([]);
    } finally {
      store.close();
    }
  });

  it('lets a newer row still win after a merge', async () => {
    const dbPath = path.join(dir, 'legacy-older.db');
    const team = 'session-aaaa1111';
    const fresh = openStore(dbPath, team);
    fresh.append('statusline', { branch: 'current' });
    fresh.close();
    await fs.writeFile(
      dbPath,
      `${JSON.stringify({ seq: 1, ts: 100, kind: 'statusline', payload: { branch: 'legacy' }, team })}\n`,
    );

    const store = openStore(dbPath, team);
    try {
      expect(project(store.replay(), false).branch).toBe('current');
    } finally {
      store.close();
    }
  });

  it('leaves the legacy log in place when another console is writing a team log', async () => {
    const dbPath = path.join(dir, 'legacy-live.db');
    const team = 'session-aaaa1111';
    let appendDuringMerge: (() => void) | undefined;

    // The deferral only shows up when an append lands INSIDE the merge, which
    // nothing but the merge's own writes can schedule on a synchronous path.
    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        default: actual,
        writeFileSync: (target: unknown, ...rest: unknown[]) => {
          const written = (actual.writeFileSync as (...args: unknown[]) => unknown)(target, ...rest);
          if (String(target).endsWith('.tmp')) appendDuringMerge?.();
          return written;
        },
      };
    });
    const { openStore: openMocked } = await import('./store');

    try {
      const live = openMocked(dbPath, team);
      live.append('hook', { event: 'PreToolUse', agent: 'alpha', toolName: 'LIVE-1' }, 'alpha');
      await fs.writeFile(
        dbPath,
        `${JSON.stringify({ seq: 1, ts: 100, kind: 'needsyou', payload: legacyCard(), team })}\n`,
      );

      appendDuringMerge = () => {
        live.append('hook', { event: 'PostToolUse', agent: 'alpha' }, 'alpha');
      };
      openMocked(dbPath, team).close();
      appendDuringMerge = undefined;

      // Nothing was taken and nothing was left behind: the next start retries.
      await expect(fs.stat(dbPath)).resolves.toBeTruthy();
      const onDisk = (await fs.readFile(logPathFor(dbPath, team), 'utf8')).trim().split('\n');
      expect(onDisk.map((l) => JSON.parse(l).kind)).toEqual(['hook', 'hook']);
      const during = await fs.readdir(path.join(dir, 'logs'));
      expect(during.filter((n) => n.endsWith('.tmp'))).toEqual([]);
      live.close();

      const retry = openMocked(dbPath, team);
      expect(project(retry.replay(), false).needsYou.map((c) => c.id)).toEqual(['card-legacy']);
      retry.close();
      await expect(fs.stat(dbPath)).rejects.toThrow();
      expect((await fs.readdir(dir)).filter((n) => n.includes('.migrated-'))).toHaveLength(1);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  it('caps a high-volume kind so a long-lived install cannot degrade forever', () => {
    const cap = KIND_RETENTION.task!;
    const store = openStore(path.join(dir, 'cap.db'), 'session-cap00000');
    try {
      for (let i = 0; i < cap + 600; i++) store.append('task', { id: `t-${i}` });
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

// project() walks every stored record on every publish, so what has to be
// bounded is RECORDS, not events: the ingest's own shape puts a whole file in
// one event at boot, which a flat event cap cannot see.
describe('transcript retention', () => {
  const batch = (agent: string, tag: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      type: 'assistant',
      uuid: `${agent}-${tag}-${i}`,
      timestamp: '2026-08-27T15:20:00.000Z',
    }));

  // The ingest ends every drain with a cumulative snapshot, and the record bound
  // only applies to an agent that has one — without it, dropping records drops
  // that agent's cost with them. See the pre-snapshot log test below.
  const snapshot = { costUsd: 1.5, tokens: 42 };

  const recordsIn = (events: Array<{ kind: string; payload: unknown }>, agent?: string) =>
    events
      .filter((e) => e.kind === 'transcript')
      .filter((e) => !agent || (e.payload as { agent: string }).agent === agent)
      .reduce((n, e) => n + (e.payload as { records: unknown[] }).records.length, 0);

  it('keeps at most the newest TRANSCRIPT_RECORDS_PER_AGENT records of an agent', () => {
    const store = openStore(path.join(dir, 'records.db'), 'session-rec00000');
    try {
      for (let i = 0; i < PRUNE_EVERY; i++) {
        store.append(
          'transcript',
          { agent: 'a', records: batch('a', `b${i}`, 200), totals: snapshot },
          'a',
        );
      }
      const kept = store.replay();
      expect(recordsIn(kept)).toBeLessThanOrEqual(TRANSCRIPT_RECORDS_PER_AGENT);
      // The newest survive: the last batch appended is still the last one held.
      expect(kept.at(-1)!.seq).toBe(PRUNE_EVERY);
      const last = (kept.at(-1)!.payload as { records: Array<{ uuid: string }> }).records;
      expect(last[0].uuid).toBe(`a-b${PRUNE_EVERY - 1}-0`);
    } finally {
      store.close();
    }
  });

  it("does not evict a quiet agent's records to make room for a chatty one's", () => {
    const store = openStore(path.join(dir, 'quiet.db'), 'session-qui00000');
    try {
      store.append(
        'transcript',
        { agent: 'quiet', records: batch('quiet', 'only', 3), totals: snapshot },
        'quiet',
      );
      for (let i = 0; i < PRUNE_EVERY - 1; i++) {
        store.append(
          'transcript',
          { agent: 'chatty', records: batch('chatty', `b${i}`, 200), totals: snapshot },
          'chatty',
        );
      }
      const kept = store.replay();
      expect(recordsIn(kept, 'quiet')).toBe(3);
      expect(recordsIn(kept, 'chatty')).toBeLessThanOrEqual(TRANSCRIPT_RECORDS_PER_AGENT);
    } finally {
      store.close();
    }
  });

  // Records that cost something, so the assertions below are about money and
  // not about zero. One assistant line per record, each its own message id.
  const spend = (agent: string, tag: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      type: 'assistant',
      uuid: `${agent}-${tag}-${i}`,
      timestamp: '2026-08-27T15:20:00.000Z',
      message: {
        id: `msg-${agent}-${tag}-${i}`,
        model: 'claude-sonnet-4-5-20250929',
        usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 5_000 },
      },
    }));

  const roster = {
    config: {
      name: 'session-leg00000',
      leadSessionId: 'lead',
      createdAt: 0,
      members: [{ name: 'a', agentId: 'a', model: 'claude-sonnet-4-5-20250929' }],
    },
    sidecars: [],
  };
  const costOfAgent = (events: ReturnType<ReturnType<typeof openStore>['replay']>) =>
    project(events, false).agents.find((x) => x.name === 'a')!.costUsd;

  // A log written before the cumulative snapshot existed carries records and no
  // totals, and project() derives that agent's cost by summing them. The bound
  // has to apply to it all the same — for an agent whose transcript file is
  // gone nothing else will ever bound it — so the cost is written down as a
  // snapshot of its own FIRST, and the records go after that, never before.
  it('bounds an agent with no snapshot, having first written its cost down', () => {
    const store = openStore(path.join(dir, 'legacy.db'), 'session-leg00000');
    try {
      store.append('roster', roster);
      for (let i = 0; i < PRUNE_EVERY - 2; i++) {
        store.append('transcript', { agent: 'a', records: spend('a', `b${i}`, 200) }, 'a');
      }
      const before = costOfAgent(store.replay());
      expect(before).toBeGreaterThan(0);

      // The append that crosses PRUNE_EVERY is the one that bounds the agent.
      store.append('transcript', { agent: 'a', records: spend('a', 'last', 200) }, 'a');
      const whole = costOfAgent([
        { seq: 0, ts: 0, kind: 'roster' as const, payload: roster },
        ...Array.from({ length: PRUNE_EVERY - 1 }, (_, i) => ({
          seq: i + 1,
          ts: i + 1,
          kind: 'transcript' as const,
          agent: 'a',
          payload: { agent: 'a', records: spend('a', i === PRUNE_EVERY - 2 ? 'last' : `b${i}`, 200) },
        })),
      ]);

      expect(recordsIn(store.replay())).toBe(TRANSCRIPT_RECORDS_PER_AGENT);
      expect(costOfAgent(store.replay())).toBeCloseTo(whole, 10);
    } finally {
      store.close();
    }
  });

  // project() reads cost from the NEWEST row that carries `totals` and ignores
  // the records once it has one. Dropping that row therefore drops the money —
  // so its snapshot moves to a row that survives instead.
  it("carries a dropped row's snapshot onto a surviving row", () => {
    const store = openStore(path.join(dir, 'carry.db'), 'session-leg00000');
    try {
      store.append('roster', roster);
      // Only the OLDEST row carries the snapshot: an interrupted multi-chunk
      // drain, a downgraded build, or a hand-edited log.
      store.append(
        'transcript',
        { agent: 'a', records: spend('a', 'b0', 200), totals: { costUsd: 99.5, tokens: 1234 } },
        'a',
      );
      for (let i = 1; i <= 6; i++) {
        store.append('transcript', { agent: 'a', records: spend('a', `b${i}`, 200) }, 'a');
      }
      expect(costOfAgent(store.replay())).toBe(99.5);

      for (let i = 0; i < PRUNE_EVERY; i++) store.append('hook', { event: 'x' }, 'a');
      expect(recordsIn(store.replay())).toBe(TRANSCRIPT_RECORDS_PER_AGENT);
      expect(costOfAgent(store.replay())).toBe(99.5);
      expect(project(store.replay(), false).totalTokens).toBe(1234);
    } finally {
      store.close();
    }
  });

  // The from-byte-0 cut drops rows the fold can no longer read, which can
  // include the only row carrying the snapshot. Same rule, same reason.
  it('carries the snapshot across a from-byte-0 cut that drops the row holding it', () => {
    const store = openStore(path.join(dir, 'reset-cost.db'), 'session-leg00000');
    try {
      store.append('roster', roster);
      store.append(
        'transcript',
        { agent: 'a', records: spend('a', 'old', 200), totals: { costUsd: 50, tokens: 500 } },
        'a',
      );
      store.append('transcript', { agent: 'a', records: spend('a', 'boot', 200), fromStart: true }, 'a');
      expect(costOfAgent(store.replay())).toBe(50);

      for (let i = 0; i < PRUNE_EVERY; i++) store.append('hook', { event: 'x' }, 'a');
      expect(store.replay().filter((e) => e.kind === 'transcript')).toHaveLength(1);
      expect(costOfAgent(store.replay())).toBe(50);
    } finally {
      store.close();
    }
  });

  // A console restart re-reads every transcript from byte 0, and the fold clears
  // the agent when it reaches that marker — so every row of that agent older
  // than the marker can never be read again. Dropping them is what stops the log
  // growing by one whole transcript per boot, forever.
  it('drops every transcript row older than an agent\'s newest from-byte-0 batch', () => {
    const store = openStore(path.join(dir, 'reset.db'), 'session-res00000');
    try {
      for (let i = 0; i < 200; i++) {
        store.append('transcript', { agent: 'a', records: batch('a', `old${i}`, 1) }, 'a');
      }
      store.append('transcript', { agent: 'a', records: batch('a', 'boot', 1), fromStart: true }, 'a');
      for (let i = 0; i < PRUNE_EVERY - 201; i++) {
        store.append('transcript', { agent: 'a', records: batch('a', `new${i}`, 1) }, 'a');
      }
      const kept = store.replay();
      expect(kept).toHaveLength(PRUNE_EVERY - 200);
      expect((kept[0].payload as { fromStart?: boolean }).fromStart).toBe(true);
      expect(recordsIn(kept)).toBe(PRUNE_EVERY - 200);
    } finally {
      store.close();
    }
  });

  // A single row can be larger than the whole budget: migrateLegacyLog recovers
  // rows from a pre-batching events.db verbatim, and that ingest put a whole
  // 2,000-record file in one event. The budget is checked BEFORE each row, so
  // such a row used to be admitted whole and the bound silently missed.
  it('trims an oversized transcript event down to the records that fit', () => {
    const store = openStore(path.join(dir, 'oversize.db'), 'session-ovr00000');
    try {
      const whole = batch('a', 'legacy', 2_600);
      store.append(
        'transcript',
        { agent: 'a', records: whole, fromStart: true, totals: snapshot },
        'a',
      );
      for (let i = 0; i < PRUNE_EVERY - 1; i++) store.append('hook', { event: 'x' }, 'a');

      const kept = store.replay().filter((e) => e.kind === 'transcript');
      expect(recordsIn(kept)).toBe(TRANSCRIPT_RECORDS_PER_AGENT);
      const payload = kept[0].payload as {
        records: Array<{ uuid: string }>;
        fromStart?: boolean;
        totals?: unknown;
      };
      // The NEWEST records of the row are the ones kept...
      expect(payload.records[0].uuid).toBe(whole.at(-TRANSCRIPT_RECORDS_PER_AGENT)!.uuid);
      expect(payload.records.at(-1)!.uuid).toBe(whole.at(-1)!.uuid);
      // ...and everything that says how to READ the row rides along untouched:
      // `fromStart` still clears the agent, and `totals` is a snapshot of the
      // whole transcript, so trimming records must never trim cost with them.
      expect(payload.fromStart).toBe(true);
      expect(payload.totals).toEqual(snapshot);
    } finally {
      store.close();
    }
  });

  // Trimming a row changes no row COUNT, so the compaction has to be driven by
  // whether trim() rewrote anything at all — otherwise the bound holds in
  // memory while the log file keeps the whole 36 MB of it on disk forever.
  it('writes the trimmed row back over the oversized one on disk', async () => {
    const dbPath = path.join(dir, 'oversize-disk.db');
    const store = openStore(dbPath, 'session-ovd00000');
    try {
      store.append(
        'transcript',
        { agent: 'a', records: batch('a', 'legacy', 2_600), totals: snapshot },
        'a',
      );
      for (let i = 0; i < PRUNE_EVERY - 1; i++) store.append('hook', { event: 'x' }, 'a');

      const lines = (await fs.readFile(logPathFor(dbPath, 'session-ovd00000'), 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { kind: string; payload: { records?: unknown[] } });
      const onDisk = lines.filter((e) => e.kind === 'transcript');
      expect(onDisk).toHaveLength(1);
      expect(onDisk[0].payload.records).toHaveLength(TRANSCRIPT_RECORDS_PER_AGENT);
    } finally {
      store.close();
    }
  });

  it('still bounds a flood of transcript rows that carry no records at all', () => {
    const store = openStore(path.join(dir, 'flood.db'), 'session-flo00000');
    try {
      // Rounded up to a prune boundary so the last append is the one that trims.
      const appends = Math.ceil((TRANSCRIPT_EVENTS_PER_AGENT + 1) / PRUNE_EVERY) * PRUNE_EVERY;
      for (let i = 0; i < appends; i++) {
        store.append('transcript', { agent: 'a', records: [] }, 'a');
      }
      const kept = store.replay();
      expect(kept.length).toBe(TRANSCRIPT_EVENTS_PER_AGENT);
      expect(kept.at(-1)!.seq).toBe(appends);
    } finally {
      store.close();
    }
  });
});

describe('multi-team log safety', () => {
  it("keeps a second team's console from destroying the first's log", async () => {
    const dbPath = path.join(dir, 'events.db');
    const first = openStore(dbPath, 'session-aaaa1111');
    for (let i = 0; i < 200; i++) {
      first.append('transcript', { agent: 'probe-alpha', records: [i] }, 'probe-alpha');
    }
    first.close();

    const firstLog = logPathFor(dbPath, 'session-aaaa1111');
    const bytes = (await fs.stat(firstLog)).size;
    expect(bytes).toBeGreaterThan(0);

    const second = openStore(dbPath, 'session-bbbb2222');
    second.append('transcript', { agent: 'probe-bravo', records: [] }, 'probe-bravo');
    second.close();

    expect((await fs.stat(firstLog)).size).toBe(bytes);
    const reopened = openStore(dbPath, 'session-aaaa1111');
    expect(reopened.replay()).toHaveLength(200);
    reopened.close();
  });

  it('leaves a log written by another team alone when the team is unknown', async () => {
    const dbPath = path.join(dir, 'events.db');
    const named = openStore(dbPath, 'session-aaaa1111');
    for (let i = 0; i < 200; i++) named.append('task', { id: `t-${i}`, status: 'in_progress' });
    named.close();

    const namedLog = logPathFor(dbPath, 'session-aaaa1111');
    const bytes = (await fs.stat(namedLog)).size;

    const unknown = openStore(dbPath);
    expect(unknown.replay()).toEqual([]);
    unknown.close();

    expect((await fs.stat(namedLog)).size).toBe(bytes);
  });

  it('rejects a team name that would escape the log directory', () => {
    const dbPath = path.join(dir, 'events.db');
    const unknownLog = logPathFor(dbPath, 'unknown');
    const logsDir = path.join(path.dirname(dbPath), 'logs');

    for (const hostile of ['..', '.', '../../evil', 'a/b', '']) {
      const resolved = path.resolve(logPathFor(dbPath, hostile));
      expect(path.dirname(resolved)).toBe(path.resolve(logsDir));
      expect(resolved).toBe(path.resolve(unknownLog));
    }

    expect(logPathFor(dbPath, 'session-7c01fcd1')).toBe(
      path.join(logsDir, 'session-7c01fcd1.jsonl'),
    );
  });

  it('records which process is writing a team log, and says so when two do', async () => {
    const dbPath = path.join(dir, 'events.db');
    const owner = `${logPathFor(dbPath, 'session-aaaa1111')}.owner`;
    const first = openStore(dbPath, 'session-aaaa1111');
    expect(JSON.parse(await fs.readFile(owner, 'utf8')).pid).toBe(process.pid);
    first.close();
    await expect(fs.stat(owner)).rejects.toThrow();

    // A live process already holding the log. The stamp is advisory — this
    // console keeps serving — but nothing else would tell the operator why
    // every row is doubled and half the cards will not resolve.
    await fs.writeFile(owner, JSON.stringify({ pid: process.ppid, since: Date.now() }));
    const said: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((m: unknown) => {
      said.push(String(m));
    });
    const second = openStore(dbPath, 'session-aaaa1111');
    spy.mockRestore();
    expect(said.join('\n')).toContain(`already open in process ${process.ppid}`);
    second.append('roster', { config: null, sidecars: [] });
    expect(second.replay()).toHaveLength(1);
    second.close();

    // A run that switches teams stops owning the log it left behind.
    const moved = openStore(dbPath, 'session-first000');
    moved.setTeam('session-second00');
    await expect(fs.stat(`${logPathFor(dbPath, 'session-first000')}.owner`)).rejects.toThrow();
    const held = await fs.readFile(`${logPathFor(dbPath, 'session-second00')}.owner`, 'utf8');
    expect(JSON.parse(held).pid).toBe(process.pid);
    moved.close();
  });

  it('keeps a name that is not a team name off the shared fallback log', async () => {
    const dbPath = path.join(dir, 'events.db');
    const hostile = openStore(dbPath, '../../evil');
    hostile.append('needsyou', { id: 'card-a' });

    const other = openStore(dbPath);
    other.append('needsyou', { id: 'card-b' });
    // A name the log directory cannot hold is not a team, so this run stays on
    // its own scratch log instead of joining every other run on the fallback.
    other.setTeam('a/b');
    expect(other.replay().map((e) => (e.payload as { id: string }).id)).toEqual(['card-b']);

    await expect(fs.stat(logPathFor(dbPath, 'unknown'))).rejects.toThrow();
    hostile.close();
    other.close();
  });

  it('adopts pre-team events into a team log that already has history', () => {
    const dbPath = path.join(dir, 'events.db');
    const earlier = openStore(dbPath, 'session-xxxx0001');
    earlier.append('task', { id: 'from-an-earlier-run', status: 'in_progress' });
    earlier.close();

    const store = openStore(dbPath);
    store.append('statusline', { branch: 'main' });
    store.setTeam('session-xxxx0001');
    expect(store.replay().map((e) => e.kind)).toEqual(['task', 'statusline']);
    store.close();

    const reopened = openStore(dbPath, 'session-xxxx0001');
    expect(reopened.replay().map((e) => e.kind)).toEqual(['task', 'statusline']);
    reopened.close();
  });

  it('replays the team it was last pointed at, and finds its way back', () => {
    const dbPath = path.join(dir, 'events.db');

    const earlier = openStore(dbPath, 'session-bbbb0002');
    earlier.append('task', { id: 'b-history', status: 'in_progress' });
    earlier.close();

    const store = openStore(dbPath, 'session-aaaa0001');
    store.append('task', { id: 'a-only', status: 'in_progress' });

    // A named -> named switch is the whole team switch: nothing of A survives
    // in state, and B's own history is picked up from its log.
    store.setTeam('session-bbbb0002');
    expect(store.replay().map((e) => (e.payload as { id: string }).id)).toEqual(['b-history']);

    // And it is reversible — which is what makes paging back through teams
    // safe, and what makes a needs-you card resolvable after a round trip.
    store.setTeam('session-aaaa0001');
    expect(store.replay().map((e) => (e.payload as { id: string }).id)).toEqual(['a-only']);
    store.close();
  });

  it('repairs a torn tail in the team log it adopts into', async () => {
    const dbPath = path.join(dir, 'events.db');
    const teamLog = logPathFor(dbPath, 'session-torn0001');
    const earlier = openStore(dbPath, 'session-torn0001');
    earlier.append('roster', { config: null, sidecars: [] });
    earlier.append('task', { id: 'half-written', status: 'in_progress' });
    earlier.close();
    const whole = await fs.readFile(teamLog, 'utf8');
    await fs.writeFile(teamLog, whole.slice(0, whole.length - 12));

    const store = openStore(dbPath);
    store.append('statusline', { branch: 'main' });
    store.setTeam('session-torn0001');
    store.close();

    const reopened = openStore(dbPath, 'session-torn0001');
    expect(reopened.replay().map((e) => e.kind)).toEqual(['roster', 'statusline']);
    reopened.close();
  });

  it('deletes a team log nothing has touched in a week', async () => {
    const dbPath = path.join(dir, 'events.db');
    const dead = logPathFor(dbPath, 'session-dead0000');
    const recent = logPathFor(dbPath, 'session-recent01');
    await fs.mkdir(path.dirname(dead), { recursive: true });
    await fs.writeFile(dead, '');
    await fs.writeFile(recent, '');

    const eightDaysAgo = new Date(Date.now() - STALE_LOG_MS - 24 * 60 * 60 * 1000);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await fs.utimes(dead, eightDaysAgo, eightDaysAgo);
    await fs.utimes(recent, yesterday, yesterday);

    openStore(dbPath, 'session-live0000').close();

    await expect(fs.stat(dead)).rejects.toThrow();
    await expect(fs.stat(recent)).resolves.toBeDefined();
  });
});

describe('two runs that have not found their team yet', () => {
  it("cannot read, move or destroy each other's rows", async () => {
    const dbPath = path.join(dir, 'events.db');

    const a = openStore(dbPath);
    for (let i = 0; i < 50; i++) a.append('needsyou', { id: `card-a-${i}` });
    expect(a.replay()).toHaveLength(50);

    // B starts empty: A's rows are not in a file B can name.
    const b = openStore(dbPath);
    expect(b.replay()).toEqual([]);
    b.append('needsyou', { id: 'card-b' });
    b.setTeam('session-bbbb2222');
    expect(b.replay().map((e) => (e.payload as { id: string }).id)).toEqual(['card-b']);

    // A is untouched, and still writing to its own log.
    a.append('needsyou', { id: 'card-a-late' });
    expect(a.replay()).toHaveLength(51);

    a.setTeam('session-aaaa1111');
    const aLog = (await fs.readFile(logPathFor(dbPath, 'session-aaaa1111'), 'utf8'))
      .split('\n')
      .filter(Boolean);
    expect(aLog).toHaveLength(51);
    const bLog = (await fs.readFile(logPathFor(dbPath, 'session-bbbb2222'), 'utf8'))
      .split('\n')
      .filter(Boolean);
    expect(bLog).toHaveLength(1);
    a.close();
    b.close();
  });

  it('does not adopt the rows of a run that died before it found its team', () => {
    const dbPath = path.join(dir, 'events.db');
    // No setTeam and no close: this run was killed before discovery.
    const dead = openStore(dbPath);
    dead.append('needsyou', { id: 'card-from-a-dead-run' });

    const next = openStore(dbPath);
    expect(next.replay()).toEqual([]);
    next.close();
  });

  it('leaves no scratch log behind once the team is known', async () => {
    const dbPath = path.join(dir, 'events.db');
    const store = openStore(dbPath);
    store.append('needsyou', { id: 'card' });
    store.setTeam('session-aaaa1111');
    expect(await fs.readdir(runsDirFor(dbPath))).toEqual([]);
    store.close();
  });
});

describe('a second writer on one team log', () => {
  const idsOnDisk = async (dbPath: string, team: string) =>
    new Set(
      (await fs.readFile(logPathFor(dbPath, team), 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { payload: { id?: string } }).payload?.id)
        .filter(Boolean),
    );

  it('never compacts away rows it did not write', async () => {
    const dbPath = path.join(dir, 'events.db');
    const team = 'session-aaaa1111';

    const a = openStore(dbPath, team);
    for (let i = 0; i < 10; i++) a.append('task', { id: `a-task-${i}`, status: 'in_progress' });

    const b = openStore(dbPath, team);
    expect(b.replay()).toHaveLength(10);
    for (let i = 0; i < 5; i++) a.append('needsyou', { id: `a-card-${i}` });
    expect((await idsOnDisk(dbPath, team)).size).toBe(15);

    // B crosses PRUNE_EVERY with a kind over its cap, so it wants to compact.
    for (let i = 0; i < PRUNE_EVERY; i++) b.append('roster', { config: null, sidecars: [] });

    const ids = await idsOnDisk(dbPath, team);
    for (let i = 0; i < 5; i++) expect(ids.has(`a-card-${i}`)).toBe(true);
    for (let i = 0; i < 10; i++) expect(ids.has(`a-task-${i}`)).toBe(true);
    a.close();
    b.close();
  });

  it('compacts again once it is the only writer', async () => {
    const dbPath = path.join(dir, 'events.db');
    const team = 'session-aaaa1111';
    const cap = KIND_RETENTION.roster!;
    const lines = async () =>
      (await fs.readFile(logPathFor(dbPath, team), 'utf8')).split('\n').filter(Boolean);

    const a = openStore(dbPath, team);
    const b = openStore(dbPath, team);
    a.append('roster', { config: null, sidecars: [] });
    for (let i = 0; i < PRUNE_EVERY + 10; i++) b.append('roster', { config: null, sidecars: [] });
    // Uncompacted while two runs are writing: 1 + 260 rows, well over the cap.
    expect(await lines()).toHaveLength(PRUNE_EVERY + 11);
    a.close();
    b.close();

    const alone = openStore(dbPath, team);
    expect(alone.replay().length).toBeLessThanOrEqual(cap);
    alone.close();
    expect((await lines()).length).toBeLessThanOrEqual(cap);
  });
});

describe('needsyou-resolved retention', () => {
  it('plateaus past the cap without ever leaving a create outliving its resolution', () => {
    const cap = KIND_RETENTION['needsyou-resolved']!;
    const store = openStore(path.join(dir, 'resolved-cap.db'), 'session-cap00001');
    try {
      // Still open right now — no resolution at all — so it must survive no
      // matter how many OTHER cards get resolved after it.
      store.append('needsyou', {
        id: 'open-card',
        kind: 'plan',
        agent: 'probe-alpha',
        reason: 'plan approval',
        detail: 'still open',
      } satisfies NeedsYouItem);

      for (let i = 0; i < cap + 600; i++) {
        const id = `resolved-${i}`;
        store.append('needsyou', {
          id,
          kind: 'permission',
          agent: 'probe-bravo',
          reason: 'permission',
          detail: 'Bash',
          expiresAt: Date.now() + 540_000,
        } satisfies NeedsYouItem);
        store.append('needsyou-resolved', { id });
      }

      const kept = store.replay();
      const resolvedKept = kept.filter((e) => e.kind === 'needsyou-resolved');
      expect(resolvedKept.length).toBeLessThanOrEqual(cap + 250);
      expect(resolvedKept.length).toBeGreaterThan(cap - 1);

      const keptCreateIds = new Set(
        kept.filter((e) => e.kind === 'needsyou').map((e) => (e.payload as { id: string }).id),
      );
      const keptResolvedIds = new Set(resolvedKept.map((e) => (e.payload as { id: string }).id));

      expect(keptCreateIds.has('open-card')).toBe(true);
      // Every surviving `needsyou` create for a resolved id still has its
      // `needsyou-resolved` row too — a create can never outlive the
      // resolution that closed it, or the card would resurrect when
      // project() replays the trimmed log.
      for (const id of keptCreateIds) {
        if (id === 'open-card') continue;
        expect(keptResolvedIds.has(id)).toBe(true);
      }
    } finally {
      store.close();
    }
  });

  it('still resolves a card out of needsYou under the new cap', () => {
    const store = openStore(path.join(dir, 'resolve-once.db'), 'session-resolve1');
    try {
      store.append('needsyou', {
        id: 'p1',
        kind: 'plan',
        agent: 'probe-alpha',
        reason: 'plan approval',
        detail: '4 steps',
      } satisfies NeedsYouItem);
      store.append('needsyou-resolved', { id: 'p1' });
      expect(project(store.replay(), false).needsYou).toEqual([]);
    } finally {
      store.close();
    }
  });
});

describe('openStore', () => {
  it('survives close and reopen, replaying in seq order', () => {
    const dbPath = path.join(dir, 'events.db');
    const first = openStore(dbPath, 'session-reopen01');
    const a = first.append('roster', { config: { name: 'session-98b0b4a7' } });
    const b = first.append('task', { id: '1', status: 'in_progress' });
    const c = first.append('mail', { to: 'team-lead' }, 'probe-alpha');
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    first.close();

    const second = openStore(dbPath, 'session-reopen01');
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

  it('keeps a payload intact across a close and reopen', () => {
    const dbPath = path.join(dir, 'reopen.db');
    const store = openStore(dbPath, 'session-reopen02');
    store.append('substatus', { agent: 'probe-charlie', tokenCount: 23639 });
    store.close();
    const reopened = openStore(dbPath, 'session-reopen02');
    expect(reopened.replay()[0].payload).toEqual({ agent: 'probe-charlie', tokenCount: 23639 });
    reopened.close();
  });

  it('drops a final line a crash truncated mid-write', async () => {
    const dbPath = path.join(dir, 'torn.db');
    const logPath = logPathFor(dbPath, 'session-torn0002');
    const store = openStore(dbPath, 'session-torn0002');
    store.append('roster', { config: null, sidecars: [] });
    store.append('task', { id: 'half-written', status: 'in_progress' });
    store.close();

    const whole = await fs.readFile(logPath, 'utf8');
    await fs.writeFile(logPath, whole.slice(0, whole.length - 12));

    const reopened = openStore(dbPath, 'session-torn0002');
    expect(reopened.replay().map((e) => e.kind)).toEqual(['roster']);
    // The next append lands on a whole line, not glued to the torn one.
    reopened.append('hook', { event: 'PreToolUse' });
    reopened.close();
    const last = openStore(dbPath, 'session-torn0002');
    expect(last.replay().map((e) => e.kind)).toEqual(['roster', 'hook']);
    last.close();
  });

  // project() memoises the derived transcript lines of a record on the record
  // object itself, which only pays off because replay() hands back the rows —
  // not copies of them. If this ever becomes a defensive deep copy the console
  // stays correct and silently gets slow again, so the invariant is pinned here.
  it('replays the same row objects, so a memo keyed on them stays warm', () => {
    const store = openStore(path.join(dir, 'identity.db'), 'session-ident000');
    try {
      const records = [{ uuid: 'r-1', type: 'assistant', timestamp: '2026-08-27T15:20:00.000Z' }];
      store.append('transcript', { agent: 'probe-alpha', records }, 'probe-alpha');

      const first = store.replay();
      const second = store.replay();
      expect(first).not.toBe(second);
      expect(first[0]).toBe(second[0]);
      expect(first[0].payload).toBe(second[0].payload);
      expect((first[0].payload as { records: unknown[] }).records[0]).toBe(records[0]);

      // Crossing PRUNE_EVERY with roster over its own cap forces a real trim and
      // a whole-file rewrite; the rows it keeps must survive as the same objects.
      const rosterCap = KIND_RETENTION.roster!;
      for (let i = 0; i < PRUNE_EVERY; i++) store.append('roster', { config: null, sidecars: [] });
      const roster = store.replay().filter((e) => e.kind === 'roster');
      expect(roster.length).toBeLessThan(PRUNE_EVERY);
      expect(roster.length).toBeGreaterThanOrEqual(rosterCap);
      expect(store.replay().find((e) => e.kind === 'transcript')).toBe(first[0]);
    } finally {
      store.close();
    }
  });

  it('prunes the log file itself, so a trim is not undone by a reopen', async () => {
    const dbPath = path.join(dir, 'trimmed.db');
    const cap = KIND_RETENTION.substatus!;
    const store = openStore(dbPath, 'session-trim0000');
    for (let i = 0; i < cap + 600; i++) store.append('substatus', { n: i }, 'a');
    const kept = store.replay();
    store.close();

    const lines = (await fs.readFile(logPathFor(dbPath, 'session-trim0000'), 'utf8'))
      .split('\n')
      .filter(Boolean);
    expect(lines).toHaveLength(kept.length);
    expect(JSON.parse(lines[0]).seq).toBe(kept[0].seq);
  });
});
