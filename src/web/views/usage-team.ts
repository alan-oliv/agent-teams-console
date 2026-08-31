import type { Agent, MailMessage } from '../../shared/domain';
import { rateOf, usdCost, type ModelRate, type TokenSplit } from '../../shared/cost';

export const EMPTY_SPLIT: TokenSplit = { in: 0, out: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 };

/**
 * Undefined, not EMPTY_SPLIT, when the agent has none — a row on disk from
 * before the split existed carries `costUsd` but no split, and collapsing
 * "not recorded" into "measured zero" is how a team that plainly spent money
 * ends up rendering a token split of zero next to it.
 */
export function splitOf(agent: Agent): TokenSplit | undefined {
  return agent.tokenSplit;
}

/**
 * Undefined when ANY agent's split is unrecorded, not just when all of them
 * are: a sum missing one agent's real (unknown) contribution reads as
 * complete when it isn't, which is the same lie a bare zero would tell. An
 * agent self-heals its split on its next drain, so this is transient except
 * for a departed agent in a pre-existing log — see USAGE-STATE.md and the
 * store.ts eviction-carrying tests this pairs with.
 */
export function sumSplit(agents: readonly Agent[]): TokenSplit | undefined {
  const splits = agents.map(splitOf);
  if (splits.some((s) => s === undefined)) return undefined;
  return splits.reduce<TokenSplit>((sum, s) => {
    const split = s!;
    return {
      in: sum.in + split.in,
      out: sum.out + split.out,
      cacheWrite: sum.cacheWrite + split.cacheWrite,
      cacheWrite1h: sum.cacheWrite1h + split.cacheWrite1h,
      cacheRead: sum.cacheRead + split.cacheRead,
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
 * never blended into one rate. Undefined, not partial, when any agent's split
 * is unrecorded — same reasoning as sumSplit.
 *
 * Prices every one of an agent's cache reads at its CURRENT agent.model, the
 * last resolved model — exact today (0 of the live team's agents span two
 * models) but not guaranteed: a `/model` switch on the lead would price its
 * earlier cache reads at the wrong rate, silently, with no test to catch it.
 */
export function dollarsAvoided(agents: readonly Agent[]): number | undefined {
  let sum = 0;
  for (const a of agents) {
    const split = splitOf(a);
    if (split === undefined) return undefined;
    if (split.cacheRead <= 0) continue;
    const asInput = usdCost(a.model, { ...EMPTY_SPLIT, in: split.cacheRead });
    const asCacheRead = usdCost(a.model, { ...EMPTY_SPLIT, cacheRead: split.cacheRead });
    sum += Math.max(0, asInput - asCacheRead);
  }
  return sum;
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
  /** Empty, not a zero-width bar, when the agent has no split to draw. */
  segments: Array<{ key: SegmentKey; pct: number }>;
  tokens: number | undefined;
  cacheHit: number | undefined;
  perMtok: number | undefined;
  cost: number;
}

export function ledgerRowOf(agent: Agent): LedgerRow {
  const split = splitOf(agent);
  const tokens = split ? billedTokens(split) : undefined;
  return {
    name: agent.name,
    color: agent.color,
    segments: split
      ? SEGMENT_ORDER.map((key) => ({ key, pct: tokens && tokens > 0 ? (split[key] / tokens) * 100 : 0 }))
      : [],
    tokens,
    cacheHit: split ? cacheHitRatio(split) : undefined,
    perMtok: tokens !== undefined && tokens > 0 ? agent.costUsd / (tokens / 1e6) : undefined,
    cost: agent.costUsd,
  };
}

export interface ModelSpend {
  model: string;
  cost: number;
  share: number;
  count: number;
  rate: ModelRate;
  /**
   * Billed tokens across this model's agents, and undefined when ANY of them
   * has no split — the donut legend's `$/Mtok` is a blended figure over this,
   * so a partial denominator would overstate the rate rather than admit it is
   * unknown. Same reasoning as sumSplit.
   */
  tokens?: number;
}

/**
 * Grouped by each agent's own resolved model — the same grouping the design's
 * fixture uses. Attributes an agent's WHOLE cost to its current agent.model,
 * the last resolved model — exact today (0 of the live team's agents span two
 * models) but not guaranteed: a `/model` switch on the lead would land its
 * earlier spend under the new model too, silently, with no test to catch it.
 * Cost and share stay correct regardless (both sum agent.costUsd directly);
 * only the per-model attribution can drift.
 */
export function spendByModel(agents: readonly Agent[]): ModelSpend[] {
  const total = agents.reduce((s, a) => s + a.costUsd, 0);
  const grouped = new Map<string, Agent[]>();
  for (const a of agents) {
    const bucket = grouped.get(a.model);
    if (bucket) bucket.push(a);
    else grouped.set(a.model, [a]);
  }
  return [...grouped]
    .map(([model, mine]) => {
      const splits = mine.map(splitOf);
      return {
        model,
        cost: mine.reduce((s, a) => s + a.costUsd, 0),
        count: mine.length,
        share: total > 0 ? mine.reduce((s, a) => s + a.costUsd, 0) / total : 0,
        rate: rateOf(model),
        tokens: splits.some((s) => s === undefined)
          ? undefined
          : (splits as TokenSplit[]).reduce((sum, s) => sum + billedTokens(s), 0),
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

export interface SpendSample {
  at: number;
  cost: number;
  /**
   * Cumulative `agent.costUsd` per agent at `at`. Optional because the sampler
   * predates it and because a caller with only the team total is still a valid
   * caller — the panels that need the breakdown say so rather than assuming it.
   */
  byAgent?: Record<string, number>;
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

/**
 * A whole-dollar ladder. A quarter-of-max step on a $4.55 total rounds to
 * 0/1/2/4/5 — ticks that are not a constant distance apart, which reads as a
 * rendering fault rather than a scale. The step is picked from a fixed set so
 * every tick is a multiple of it, and the top tick covers the value.
 */
const LADDER_STEPS = [0.5, 1, 2];

export function moneyLadder(max: number): number[] {
  const target = Math.max(max, 0.5);
  const step = LADDER_STEPS.find((s) => target / s <= 5) ?? Math.ceil(target / 5);
  const top = Math.ceil(target / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

export interface SpendBand {
  name: string;
  color: string;
  /** Cumulative cost for this agent at each sample, in sample order. */
  values: number[];
}

export interface StackedSpend {
  at: number[];
  /** Bottom-to-top draw order: the lead is last so its area reads on top. */
  bands: SpendBand[];
  max: number;
}

// The ramp in order, never a categorical palette. More agents than steps wraps
// rather than inventing a hue.
const BAND_RAMP = [
  'var(--color-accent-700)',
  'var(--color-accent-600)',
  'var(--color-accent-500)',
  'var(--color-accent-400)',
  'var(--color-accent-300)',
];

/**
 * The stacked-area series, built ONLY from samples this console took itself.
 *
 * Undefined when no sample carries a per-agent breakdown: the alternative is to
 * spread each agent's current total back over the session from `startedAt`,
 * which is the one thing USAGE-STATE.md §6 says this chart must never do — the
 * staircase of spawns is the measurement, and a synthetic one is invented
 * history. An agent absent from a sample reads as zero because it genuinely had
 * not spent anything yet, which is the same statement the chart is making.
 */
export function stackedSpend(
  samples: readonly SpendSample[],
  agents: readonly Agent[],
): StackedSpend | undefined {
  const usable = samples.filter((s) => s.byAgent !== undefined);
  if (usable.length === 0 || agents.length === 0) return undefined;
  const ordered = [...agents].sort((a, b) => Number(a.isLead) - Number(b.isLead));
  const bands = ordered.map((a, i) => ({
    name: a.name,
    color: BAND_RAMP[i % BAND_RAMP.length],
    values: usable.map((s) => s.byAgent![a.name] ?? 0),
  }));
  const max = Math.max(
    0,
    ...usable.map((_, i) => bands.reduce((sum, band) => sum + band.values[i], 0)),
  );
  return { at: usable.map((s) => s.at), bands, max };
}

// The design's own bar count for this strip.
const MESSAGE_BARS = 17;

/**
 * Messages per 2 minutes over the last 34 minutes, oldest bar first. Mail is
 * the one history the frame genuinely carries, so unlike the spend series this
 * needs no client-side sampling. Always MESSAGE_BARS wide so the strip does not
 * change width as a session ages.
 */
export function messageBuckets(mail: readonly MailMessage[], now: number): number[] {
  const buckets = new Array<number>(MESSAGE_BARS).fill(0);
  const start = now - MESSAGE_BARS * BUCKET_MS;
  for (const m of mail) {
    if (m.ts <= start || m.ts > now) continue;
    const index = Math.min(MESSAGE_BARS - 1, Math.floor((m.ts - start) / BUCKET_MS));
    buckets[index] += 1;
  }
  return buckets;
}

/**
 * How long since this agent last produced a transcript line. Undefined, never
 * zero, for an agent with no lines on the frame: zero would read as "active
 * right now", which is the opposite of what an empty transcript means.
 */
export function idleMsOf(agent: Agent, now: number): number | undefined {
  const last = agent.transcript[agent.transcript.length - 1];
  return last === undefined ? undefined : Math.max(0, now - last.ts);
}

/**
 * What the same work might have cost run serially. AN ESTIMATE, and the panel
 * that draws it says so in those words — there is no serial run to measure.
 *
 * The assumption, stated on the page as well as here: one agent doing the same
 * work writes and re-reads ONE cached context instead of N, so input and output
 * sum across the team while cache traffic collapses to the heaviest single
 * agent's. Priced at one model because a lone agent runs on one model.
 *
 * Undefined when any agent's split is unrecorded — same reasoning as sumSplit.
 */
export function serialEstimate(
  agents: readonly Agent[],
  model: string,
): number | undefined {
  const splits = agents.map(splitOf);
  if (splits.length === 0 || splits.some((s) => s === undefined)) return undefined;
  const known = splits as TokenSplit[];
  return usdCost(model, {
    in: known.reduce((sum, s) => sum + s.in, 0),
    out: known.reduce((sum, s) => sum + s.out, 0),
    cacheWrite: Math.max(...known.map((s) => s.cacheWrite)),
    cacheWrite1h: Math.max(...known.map((s) => s.cacheWrite1h)),
    cacheRead: Math.max(...known.map((s) => s.cacheRead)),
  });
}
