import { describe, expect, it } from 'vitest';
import type { Agent, Task } from '../../shared/domain';
import type { TokenSplit } from '../../shared/cost';
import {
  billedTokens,
  cacheHitRatio,
  costPerHour,
  costPerTask,
  dollarsAvoided,
  ledgerRowOf,
  spendBuckets,
  spendByModel,
  splitOf,
  sumSplit,
  tasksClosedBy,
} from './usage-team';

function split(over: Partial<TokenSplit> = {}): TokenSplit {
  return { in: 0, out: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, ...over };
}

function agent(over: Partial<Agent> = {}): Agent {
  return {
    name: 'probe',
    agentId: 'probe@t',
    isLead: false,
    agentType: 'general-purpose',
    model: 'claude-opus-5',
    role: 'worker',
    status: 'working',
    contextTokens: 0,
    contextLimit: 1_000_000,
    compactAt: 967_000,
    costUsd: 0,
    startedAt: 0,
    transcript: [],
    unread: 0,
    ...over,
  };
}

describe('splitOf / sumSplit', () => {
  it('treats an agent with no tokenSplit as all-zero, not a crash', () => {
    expect(splitOf(agent({ tokenSplit: undefined }))).toEqual(split());
  });

  it('sums every class across every agent', () => {
    const a = agent({ tokenSplit: split({ in: 10, out: 20, cacheWrite: 30, cacheRead: 40 }) });
    const b = agent({ tokenSplit: split({ in: 1, out: 2, cacheWrite: 3, cacheRead: 4 }) });
    expect(sumSplit([a, b])).toEqual(split({ in: 11, out: 22, cacheWrite: 33, cacheRead: 44 }));
  });

  it('sums to zero over an empty roster', () => {
    expect(sumSplit([])).toEqual(split());
  });
});

describe('billedTokens', () => {
  it('sums all four billed classes, cache reads included', () => {
    // The dashboard's own tile deliberately includes cache reads — the status
    // bar's totalTokens deliberately does not. Different question, both honest.
    expect(billedTokens(split({ in: 1, out: 2, cacheWrite: 3, cacheRead: 4 }))).toBe(10);
  });
});

describe('cacheHitRatio', () => {
  it('is cache reads over reads plus fresh writes and input', () => {
    expect(cacheHitRatio(split({ in: 10, cacheWrite: 10, cacheRead: 80 }))).toBeCloseTo(0.8, 10);
  });

  it('is undefined rather than NaN when nothing billable happened yet', () => {
    expect(cacheHitRatio(split())).toBeUndefined();
  });
});

describe('dollarsAvoided', () => {
  it('is zero when nothing was cached', () => {
    expect(dollarsAvoided([agent({ tokenSplit: split() })])).toBe(0);
  });

  it('is what the cache-read tokens would have cost as fresh input, minus what they actually cost', () => {
    // opus in catalog.json: input 5, cacheRead 0.5 ($/Mtok) — see fixtures/../shared/catalog.json.
    const a = agent({ model: 'claude-opus-5', tokenSplit: split({ cacheRead: 1_000_000 }) });
    const avoided = dollarsAvoided([a]);
    // 1M tokens at input rate minus 1M tokens at cache-read rate.
    expect(avoided).toBeGreaterThan(0);
    expect(avoided).toBeCloseTo(4.5, 5);
  });
});

describe('costPerHour', () => {
  it('is undefined before any time has elapsed, never Infinity', () => {
    expect(costPerHour(1.5, 1000, 1000)).toBeUndefined();
  });

  it('is the total divided by elapsed hours', () => {
    expect(costPerHour(3, 0, 30 * 60_000)).toBeCloseTo(6, 10); // $3 over 30 minutes = $6/hr
  });
});

describe('tasksClosedBy / costPerTask', () => {
  const tasks: Task[] = [
    { id: '1', subject: 'a', description: '', owner: 'probe', state: 'completed', blocks: [], blockedBy: [] },
    { id: '2', subject: 'b', description: '', owner: 'probe', state: 'in_progress', blocks: [], blockedBy: [] },
    { id: '3', subject: 'c', description: '', owner: 'other', state: 'completed', blocks: [], blockedBy: [] },
  ];

  it('counts only this agent\'s completed tasks', () => {
    expect(tasksClosedBy(tasks, 'probe')).toBe(1);
  });

  it('is undefined rather than dividing by zero when nothing has closed', () => {
    expect(costPerTask(5, 0)).toBeUndefined();
  });

  it('is the total over the closed count', () => {
    expect(costPerTask(9, 3)).toBe(3);
  });
});

describe('ledgerRowOf', () => {
  it('draws the four segments in fixed order, each a share of the row\'s own tokens', () => {
    const a = agent({
      costUsd: 2,
      tokenSplit: split({ cacheRead: 80, cacheWrite: 10, in: 5, out: 5 }),
    });
    const row = ledgerRowOf(a);
    expect(row.segments.map((s) => s.key)).toEqual(['cacheRead', 'cacheWrite', 'in', 'out']);
    expect(row.segments.map((s) => s.pct)).toEqual([80, 10, 5, 5]);
    expect(row.tokens).toBe(100);
    expect(row.cost).toBe(2);
    expect(row.perMtok).toBeCloseTo(2 / (100 / 1e6), 6);
  });

  it('draws no segments and no $/Mtok for an agent with no billed tokens yet', () => {
    const row = ledgerRowOf(agent({ tokenSplit: split() }));
    expect(row.segments.every((s) => s.pct === 0)).toBe(true);
    expect(row.perMtok).toBeUndefined();
    expect(row.cacheHit).toBeUndefined();
  });
});

describe('spendByModel', () => {
  it('groups cost and count by model, sharing against the team total', () => {
    const rows = spendByModel([
      agent({ name: 'a', model: 'claude-opus-5', costUsd: 3 }),
      agent({ name: 'b', model: 'claude-opus-5', costUsd: 1 }),
      agent({ name: 'c', model: 'claude-haiku-4-5', costUsd: 1 }),
    ]);
    const opus = rows.find((r) => r.model === 'claude-opus-5')!;
    const haiku = rows.find((r) => r.model === 'claude-haiku-4-5')!;
    expect(opus.cost).toBe(4);
    expect(opus.count).toBe(2);
    expect(opus.share).toBeCloseTo(0.8, 10);
    expect(haiku.cost).toBe(1);
    expect(haiku.share).toBeCloseTo(0.2, 10);
  });

  it('carries the live rate and its approximate flag for each model', () => {
    const rows = spendByModel([agent({ model: 'claude-fable-5', costUsd: 1 })]);
    expect(rows[0].rate.approximate).toBe(true);
  });

  it('sorts the highest spender first', () => {
    const rows = spendByModel([
      agent({ name: 'a', model: 'claude-haiku-4-5', costUsd: 0.1 }),
      agent({ name: 'b', model: 'claude-opus-5', costUsd: 9 }),
    ]);
    expect(rows.map((r) => r.model)).toEqual(['claude-opus-5', 'claude-haiku-4-5']);
  });
});

describe('spendBuckets', () => {
  it('is empty with no samples', () => {
    expect(spendBuckets([], 1000)).toEqual([]);
  });

  it('buckets cumulative cost into 2-minute deltas since the first sample', () => {
    const T0 = 1_000_000;
    const buckets = spendBuckets(
      [
        { at: T0, cost: 1 }, // the baseline — what happened before this is not this chart's to say
        { at: T0 + 60_000, cost: 1.5 }, // still in bucket 0: 1.5 - 1 = 0.5
        { at: T0 + 130_000, cost: 2 }, // bucket 1: 2 - 1.5 = 0.5
      ],
      T0 + 130_000,
    );
    expect(buckets.map((b) => b.cost)).toEqual([0.5, 0.5]);
  });

  it('never reports a negative bucket even if a sample regresses', () => {
    const T0 = 0;
    const buckets = spendBuckets([{ at: T0, cost: 5 }, { at: T0 + 10_000, cost: 4 }], T0 + 10_000);
    expect(buckets[0].cost).toBeGreaterThanOrEqual(0);
  });
});
