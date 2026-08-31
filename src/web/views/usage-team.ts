import type { Agent } from '../../shared/domain';
import { rateOf, usdCost, type ModelRate, type TokenSplit } from '../../shared/cost';

export const EMPTY_SPLIT: TokenSplit = { in: 0, out: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 };

/** Never undefined at the call site: a fixture or a brand-new agent may not have one yet. */
export function splitOf(agent: Agent): TokenSplit {
  return agent.tokenSplit ?? EMPTY_SPLIT;
}

export function sumSplit(agents: readonly Agent[]): TokenSplit {
  return agents.reduce((sum, a) => {
    const s = splitOf(a);
    return {
      in: sum.in + s.in,
      out: sum.out + s.out,
      cacheWrite: sum.cacheWrite + s.cacheWrite,
      cacheWrite1h: sum.cacheWrite1h + s.cacheWrite1h,
      cacheRead: sum.cacheRead + s.cacheRead,
    };
  }, EMPTY_SPLIT);
}

/**
 * The dashboard's own "tokens" tile, which INCLUDES cache reads on purpose —
 * unlike TeamState.totalTokens, which excludes them so it does not summarise
 * over a session to a number 23x too large. Both are correct; they must never
 * be printed side by side without saying which is which (USAGE-STATE.md §2).
 */
export function billedTokens(split: TokenSplit): number {
  return split.in + split.out + split.cacheWrite + split.cacheRead;
}

/** Undefined rather than NaN before anything billable has happened yet. */
export function cacheHitRatio(split: TokenSplit): number | undefined {
  const denom = split.cacheRead + split.in + split.cacheWrite;
  return denom > 0 ? split.cacheRead / denom : undefined;
}

/**
 * What the team's cache reads saved against paying full input price for the
 * same tokens, priced per agent through usdCost so a multi-model team is
 * never blended into one rate.
 */
export function dollarsAvoided(agents: readonly Agent[]): number {
  return agents.reduce((sum, a) => {
    const cacheRead = splitOf(a).cacheRead;
    if (cacheRead <= 0) return sum;
    const asInput = usdCost(a.model, { ...EMPTY_SPLIT, in: cacheRead });
    const asCacheRead = usdCost(a.model, { ...EMPTY_SPLIT, cacheRead });
    return sum + Math.max(0, asInput - asCacheRead);
  }, 0);
}

/** Undefined rather than Infinity in the instant a team is created. */
export function costPerHour(totalCostUsd: number, startedAt: number, now: number): number | undefined {
  const hours = (now - startedAt) / 3_600_000;
  return hours > 0 ? totalCostUsd / hours : undefined;
}

/** Undefined rather than a divide-by-zero when the list has nothing closed. */
export function costPerTask(totalCostUsd: number, tasksClosed: number): number | undefined {
  return tasksClosed > 0 ? totalCostUsd / tasksClosed : undefined;
}

export type SegmentKey = 'cacheRead' | 'cacheWrite' | 'in' | 'out';

/** Fixed draw order, ramp -700 → -500 → -400 → -300 — never re-sorted by size. */
export const SEGMENT_ORDER: readonly SegmentKey[] = ['cacheRead', 'cacheWrite', 'in', 'out'];

export interface LedgerRow {
  name: string;
  color?: string;
  segments: Array<{ key: SegmentKey; pct: number }>;
  tokens: number;
  cacheHit: number | undefined;
  perMtok: number | undefined;
  cost: number;
}

export function ledgerRowOf(agent: Agent): LedgerRow {
  const split = splitOf(agent);
  const tokens = billedTokens(split);
  return {
    name: agent.name,
    color: agent.color,
    segments: SEGMENT_ORDER.map((key) => ({ key, pct: tokens > 0 ? (split[key] / tokens) * 100 : 0 })),
    tokens,
    cacheHit: cacheHitRatio(split),
    perMtok: tokens > 0 ? agent.costUsd / (tokens / 1e6) : undefined,
    cost: agent.costUsd,
  };
}

export interface ModelSpend {
  model: string;
  cost: number;
  share: number;
  count: number;
  rate: ModelRate;
}

/** Grouped by each agent's own resolved model — the same grouping the design's fixture uses. */
export function spendByModel(agents: readonly Agent[]): ModelSpend[] {
  const total = agents.reduce((s, a) => s + a.costUsd, 0);
  const grouped = new Map<string, { cost: number; count: number }>();
  for (const a of agents) {
    const g = grouped.get(a.model) ?? { cost: 0, count: 0 };
    g.cost += a.costUsd;
    g.count += 1;
    grouped.set(a.model, g);
  }
  return [...grouped]
    .map(([model, g]) => ({
      model,
      cost: g.cost,
      count: g.count,
      share: total > 0 ? g.cost / total : 0,
      rate: rateOf(model),
    }))
    .sort((a, b) => b.cost - a.cost);
}

export interface SpendSample {
  at: number;
  cost: number;
}

export interface SpendBucket {
  at: number;
  cost: number;
}

const BUCKET_MS = 120_000;
// Matches the design's own bar count precedent (17 bars, coordination panel) —
// a live sampler only grows, so the panel shows the newest window rather than
// widening forever.
const MAX_BUCKETS = 17;

/**
 * Cost is cumulative, so a bucket's spend is the delta between the cumulative
 * total at its start and at its end — walked once from the first sample this
 * console took, never backfilled from spawnedAt (USAGE-STATE.md §6: a synthetic
 * staircase is invented history, not measured).
 */
export function spendBuckets(samples: readonly SpendSample[], now: number): SpendBucket[] {
  if (samples.length === 0) return [];
  const start = samples[0].at;
  const count = Math.max(1, Math.ceil((now - start) / BUCKET_MS));
  const buckets: SpendBucket[] = [];
  let prevCost = samples[0].cost;
  let i = 0;
  for (let b = 0; b < count; b++) {
    const bucketEnd = start + (b + 1) * BUCKET_MS;
    let costAtEnd = prevCost;
    while (i < samples.length && samples[i].at <= bucketEnd) {
      costAtEnd = samples[i].cost;
      i++;
    }
    buckets.push({ at: bucketEnd, cost: Math.max(0, costAtEnd - prevCost) });
    prevCost = costAtEnd;
  }
  return buckets.length > MAX_BUCKETS ? buckets.slice(buckets.length - MAX_BUCKETS) : buckets;
}
