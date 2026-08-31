import { describe, expect, it } from 'vitest';
import type { Agent } from '../../shared/domain';
import type { TokenSplit } from '../../shared/cost';
import { usdCost } from '../../shared/cost';
import {
  billedTokens,
  cacheHitRatio,
  costPerHour,
  costPerTask,
  dollarsAvoided,
  idleMsOf,
  ledgerRowOf,
  messageBuckets,
  moneyLadder,
  serialEstimate,
  spendBuckets,
  spendByModel,
  splitOf,
  stackedSpend,
  sumSplit,
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
  // A row on disk from before the split existed carries `costUsd` but no
  // split — totalsOf's cast in store.ts hands one out as undefined at
  // runtime regardless of the wire type. "Not recorded" must stay
  // distinguishable from "measured zero", or a team that plainly spent money
  // renders a token split of zero next to it.
  it('is undefined for an agent with no tokenSplit, never EMPTY_SPLIT', () => {
    expect(splitOf(agent({ tokenSplit: undefined }))).toBeUndefined();
  });

  it('sums every class across every agent', () => {
    const a = agent({ tokenSplit: split({ in: 10, out: 20, cacheWrite: 30, cacheRead: 40 }) });
    const b = agent({ tokenSplit: split({ in: 1, out: 2, cacheWrite: 3, cacheRead: 4 }) });
    expect(sumSplit([a, b])).toEqual(split({ in: 11, out: 22, cacheWrite: 33, cacheRead: 44 }));
  });

  it('sums to zero over an empty roster', () => {
    expect(sumSplit([])).toEqual(split());
  });

  // The aggregate must not read as complete when it isn't: a partial sum
  // missing one agent's real (unknown) contribution is the same lie a bare
  // zero would tell.
  it('is undefined when any one agent in the roster has no split, even if the rest do', () => {
    const a = agent({ tokenSplit: split({ in: 10, out: 20, cacheWrite: 30, cacheRead: 40 }) });
    const b = agent({ tokenSplit: undefined });
    expect(sumSplit([a, b])).toBeUndefined();
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

  it('is undefined, not partial, when any agent in the roster has no split', () => {
    const a = agent({ model: 'claude-opus-5', tokenSplit: split({ cacheRead: 1_000_000 }) });
    const b = agent({ tokenSplit: undefined });
    expect(dollarsAvoided([a, b])).toBeUndefined();
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

describe('costPerTask', () => {
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

  // A genuine zero split (above) still draws four segments at 0%. No split
  // at all draws none — the row has nothing to say, not a measured nothing.
  it('draws zero segments, not four at 0%, for an agent with no split at all', () => {
    const row = ledgerRowOf(agent({ tokenSplit: undefined, costUsd: 1.2 }));
    expect(row.segments).toHaveLength(0);
    expect(row.tokens).toBeUndefined();
    expect(row.cacheHit).toBeUndefined();
    expect(row.perMtok).toBeUndefined();
    expect(row.cost).toBe(1.2); // cost never depended on the split
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
    const rows = spendByModel([agent({ model: 'claude-not-in-the-catalog-9', costUsd: 1 })]);
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

describe('moneyLadder', () => {
  // The design's own bug: a quarter-of-max ladder on $4.55 rounded to
  // 0, 1, 2, 4, 5 — visibly uneven. The step is picked from a fixed set so
  // every tick lands on a multiple of it.
  it('picks a step that divides every tick evenly', () => {
    for (const max of [0.4, 1.1, 2.6, 4.55, 9, 23, 140]) {
      const ticks = moneyLadder(max);
      const step = ticks[1] - ticks[0];
      for (const tick of ticks) {
        expect(Math.abs(tick / step - Math.round(tick / step))).toBeLessThan(1e-9);
      }
    }
  });

  it('starts at zero and covers the value it was given', () => {
    const ticks = moneyLadder(4.55);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(4.55);
  });

  it('never returns a zero-width ladder for an empty team', () => {
    const ticks = moneyLadder(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThan(0);
  });
});

describe('stackedSpend', () => {
  const T0 = 1_000_000;
  const lead = agent({ name: 'lead', isLead: true, startedAt: T0 });
  const late = agent({ name: 'late', startedAt: T0 + 120_000 });

  it('is undefined when no sample carries a per-agent breakdown', () => {
    expect(stackedSpend([{ at: T0, cost: 1 }], [lead, late])).toBeUndefined();
  });

  // The whole point of the chart. A teammate that did not exist yet must read
  // as zero, not as a share of the team's spend backdated to the session start.
  it('holds a teammate flat at zero for every sample before it spawned', () => {
    const series = stackedSpend(
      [
        { at: T0, cost: 1, byAgent: { lead: 1 } },
        { at: T0 + 180_000, cost: 3, byAgent: { lead: 2, late: 1 } },
      ],
      [lead, late],
    )!;
    const lateBand = series.bands.find((b) => b.name === 'late')!;
    expect(lateBand.values[0]).toBe(0);
    expect(lateBand.values[1]).toBe(1);
  });

  it('stacks the lead last so its area reads on top', () => {
    const series = stackedSpend(
      [{ at: T0, cost: 3, byAgent: { lead: 2, late: 1 } }],
      [lead, late],
    )!;
    expect(series.bands[series.bands.length - 1].name).toBe('lead');
  });

  it('tops out at the summed cost of every band, which is the team total', () => {
    const series = stackedSpend(
      [{ at: T0, cost: 3, byAgent: { lead: 2, late: 1 } }],
      [lead, late],
    )!;
    expect(series.max).toBeCloseTo(3, 10);
  });

  // A sample taken before an agent joined has no key for it at all, which is
  // absence, not a measured zero — but on THIS chart absence and zero are the
  // same statement, because the agent genuinely had not spent anything.
  it('reads a missing agent key as zero rather than dropping the sample', () => {
    const series = stackedSpend(
      [{ at: T0, cost: 1, byAgent: { lead: 1 } }],
      [lead, late],
    )!;
    expect(series.bands.find((b) => b.name === 'late')!.values).toEqual([0]);
  });
});

describe('messageBuckets', () => {
  const T0 = 5_000_000;
  const mail = (ts: number) => ({
    msgId: String(ts), from: 'a', to: 'b', text: '', ts, tsIsDelivery: false, read: true,
  });

  it('counts messages into 2-minute buckets ending at now', () => {
    const buckets = messageBuckets([mail(T0 - 30_000), mail(T0 - 10_000)], T0);
    expect(buckets[buckets.length - 1]).toBe(2);
  });

  it('always returns the design\'s 17 bars, so the strip has a fixed width', () => {
    expect(messageBuckets([], T0)).toHaveLength(17);
  });

  it('drops a message older than the window rather than piling it into bar one', () => {
    const buckets = messageBuckets([mail(T0 - 17 * 120_000 - 1)], T0);
    expect(buckets.reduce((s, n) => s + n, 0)).toBe(0);
  });
});

describe('idleMsOf', () => {
  const T0 = 9_000_000;

  it('measures from the agent\'s last transcript line', () => {
    const a = agent({ transcript: [{ id: '1', marker: '⏺', text: 'x', ts: T0 - 60_000 }] });
    expect(idleMsOf(a, T0)).toBe(60_000);
  });

  // A frame carries only the last PROJECTED_TRANSCRIPT_LINES per agent, and an
  // agent that has produced none has no last activity to measure from. Zero
  // would read as "active right now", which is the opposite of the truth.
  it('is undefined, never zero, for an agent with no lines on the frame', () => {
    expect(idleMsOf(agent({ transcript: [] }), T0)).toBeUndefined();
  });
});

describe('serialEstimate', () => {
  it('is undefined when any agent\'s split is unrecorded', () => {
    expect(serialEstimate([agent({ tokenSplit: undefined })], 'claude-opus-5')).toBeUndefined();
  });

  // The estimate's stated assumption: one agent doing the same work keeps one
  // cached context instead of N, so the cache traffic collapses to the largest
  // single agent's rather than summing across the team.
  it('collapses cache traffic to the heaviest single agent, keeping in and out summed', () => {
    const estimate = serialEstimate(
      [
        agent({ name: 'a', tokenSplit: split({ in: 100, out: 10, cacheRead: 900 }) }),
        agent({ name: 'b', tokenSplit: split({ in: 200, out: 20, cacheRead: 300 }) }),
      ],
      'claude-opus-5',
    )!;
    const expected = usdCost('claude-opus-5', split({ in: 300, out: 30, cacheRead: 900 }));
    expect(estimate).toBeCloseTo(expected, 12);
  });
});
