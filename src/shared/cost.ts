import catalogJson from './catalog.json';
import { resolveModel } from './catalog';
import { dedupeUsage, type UsageRecord } from './usage';

/**
 * The usage dashboard's cost model: one rate source, one token split, one
 * `usdCost` call. Every currency figure in both usage views comes through here
 * so no two panels can disagree, and so none of them can disagree with the
 * spend the status bar already ticks — see the reconciliation tests.
 *
 * Neither engine reports dollars. Every figure this produces is derived at API
 * list price and must be labelled as such wherever it is drawn.
 */

/**
 * The four classes the dashboard draws, plus the one it does not.
 *
 * `cacheWrite1h` is a SUBSET of `cacheWrite`, not a fifth bar: a 1-hour cache
 * write bills at 2x the input rate where a 5-minute one bills at 1.25x, and on
 * a real session 44% of write tokens were in the 1-hour bucket. Splitting them
 * for display would contradict the design; not splitting them for pricing
 * under-billed that session by 5.75%. So the class is one and the price is two.
 */
export interface TokenSplit {
  in: number;
  out: number;
  cacheWrite: number;
  cacheWrite1h: number;
  cacheRead: number;
}

/** One row of the rate-card panel, in USD per million tokens. */
export interface ModelRate {
  model: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheWrite1h: number;
  cacheRead: number;
  /**
   * The catalog has never heard of this model and it is priced from the
   * fallback tier. Observed live rather than hypothetically: the lead ran on a
   * model the catalog did not list and it was the majority of the bill. A rate
   * card that presents a guess as a published price is the stale card the panel
   * exists to prevent, so this rides with every rate.
   */
  approximate: boolean;
}

const rateFromModel = (raw: string): ModelRate => {
  const { canonical, pricing, approximate } = resolveModel(raw);
  return {
    model: canonical,
    input: pricing.input,
    output: pricing.output,
    cacheWrite: pricing.cacheWrite5m,
    cacheWrite1h: pricing.cacheWrite1h,
    cacheRead: pricing.cacheRead,
    approximate,
  };
};

/**
 * The rate card, read from `catalog.json` — the console's one rate source, and
 * the reason the dashboard can claim to show live rates. Never a table of its
 * own: a second copy is how a card goes stale without anyone noticing.
 */
export function RATES(): ModelRate[] {
  return Object.keys(catalogJson.models).map(rateFromModel);
}

/** The rate a given model id is actually billed at, alias and suffix resolved. */
export function rateOf(model: string): ModelRate {
  return rateFromModel(model);
}

/**
 * The four classes over a set of usage records, deduped by message id first: a
 * streamed message is written several times with a growing `output_tokens`, so
 * summing the raw rows bills one turn once per rewrite.
 */
export function splitTok(records: readonly UsageRecord[]): TokenSplit {
  const split: TokenSplit = { in: 0, out: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 };
  for (const { usage } of dedupeUsage([...records])) {
    const created = usage.cache_creation_input_tokens ?? 0;
    split.in += usage.input_tokens ?? 0;
    split.out += usage.output_tokens ?? 0;
    split.cacheWrite += created;
    split.cacheWrite1h += Math.min(usage.cache_creation?.ephemeral_1h_input_tokens ?? 0, created);
    split.cacheRead += usage.cache_read_input_tokens ?? 0;
  }
  return split;
}

/**
 * One split per model, in first-seen order — what the spend-by-model panel
 * draws, and the unit a total must be summed over. A set spanning two models
 * priced as one would be wrong by the gap between their rates, which for Opus
 * against Sonnet is 2.5x.
 */
export function splitByModel(
  records: readonly UsageRecord[],
): Array<{ model: string; split: TokenSplit }> {
  const grouped = new Map<string, UsageRecord[]>();
  for (const record of records) {
    const model = resolveModel(record.model).canonical;
    const bucket = grouped.get(model);
    if (bucket) bucket.push(record);
    else grouped.set(model, [record]);
  }
  return [...grouped].map(([model, rows]) => ({ model, split: splitTok(rows) }));
}

/** What a split costs at list price. The only place dollars are produced. */
export function usdCost(model: string, split: TokenSplit): number {
  const rate = rateOf(model);
  const oneHour = Math.min(split.cacheWrite1h, split.cacheWrite);
  return (
    (split.in * rate.input +
      split.out * rate.output +
      oneHour * rate.cacheWrite1h +
      (split.cacheWrite - oneHour) * rate.cacheWrite +
      split.cacheRead * rate.cacheRead) /
    1e6
  );
}
