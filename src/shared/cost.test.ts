import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import catalog from './catalog.json';
import { RATES, rateOf, splitByModel, splitTok, usdCost, type TokenSplit } from './cost';
import { totalCost, type UsageRecord } from './usage';

interface FixtureRecord {
  agent: string;
  id: string;
  model: string;
  usage: UsageRecord['usage'];
}

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/usage-records.json', import.meta.url), 'utf8'),
) as FixtureRecord[];

const records = (needle: string): UsageRecord[] =>
  fixture
    .filter((r) => r.agent.includes(needle))
    .map((r) => ({ messageId: r.id, model: r.model, usage: r.usage }));

const all = (): UsageRecord[] =>
  fixture.map((r) => ({ messageId: r.id, model: r.model, usage: r.usage }));

const record = (model: string, usage: UsageRecord['usage'], id = 'msg_1'): UsageRecord => ({
  messageId: id,
  model,
  usage,
});

const empty: TokenSplit = { in: 0, out: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 };

// A model id no release can ever claim. Naming a real-but-missing model couples
// these tests to which rows the catalog happens to carry today.
const UNCATALOGUED = 'claude-not-in-the-catalog-9';

const priced = (model: string) =>
  (catalog.models as Record<string, { pricing: { input: number; output: number } }>)[model].pricing;

describe('RATES', () => {
  it('lists every model the catalog prices, and nothing invented', () => {
    expect(RATES().map((r) => r.model)).toEqual(Object.keys(catalog.models));
  });

  it('reads the rates from the catalog rather than a table of its own', () => {
    const opus = RATES().find((r) => r.model === 'claude-opus-5')!;
    expect(opus.input).toBe(priced('claude-opus-5').input);
    expect(opus.output).toBe(priced('claude-opus-5').output);
  });

  it('reports catalog rates as exact, not approximate', () => {
    expect(RATES().every((r) => r.approximate)).toBe(false);
  });
});

// The design's cost model states cache writes bill at 1.25x the input rate and
// cache reads at 0.1x. Those two multipliers are the difference between the
// shown total and roughly 2.6x it, so the catalog is held to them rather than
// trusted: a hand-edit that breaks the relationship must fail here, loudly.
describe('the cache multipliers the whole model turns on', () => {
  it('prices a 5-minute cache write at 1.25x the input rate for every model', () => {
    for (const rate of RATES()) expect(rate.cacheWrite).toBeCloseTo(rate.input * 1.25, 10);
  });

  it('prices a cache read at 0.1x the input rate for every model', () => {
    for (const rate of RATES()) expect(rate.cacheRead).toBeCloseTo(rate.input * 0.1, 10);
  });

  it('charges a cache read a tenth of what the same tokens cost as input', () => {
    const asInput = usdCost('claude-opus-5', { ...empty, in: 1_000_000 });
    const asCacheRead = usdCost('claude-opus-5', { ...empty, cacheRead: 1_000_000 });
    expect(asCacheRead).toBeCloseTo(asInput * 0.1, 10);
  });

  it('charges a cache write a quarter more than the same tokens cost as input', () => {
    const asInput = usdCost('claude-opus-5', { ...empty, in: 1_000_000 });
    const asCacheWrite = usdCost('claude-opus-5', { ...empty, cacheWrite: 1_000_000 });
    expect(asCacheWrite).toBeCloseTo(asInput * 1.25, 10);
  });
});

describe('rateOf', () => {
  it('resolves a bare alias to the model the catalog prices', () => {
    expect(rateOf('sonnet').model).toBe('claude-sonnet-5');
  });

  it('resolves the 1M-window suffix to the same model', () => {
    expect(rateOf('claude-opus-5[1m]')).toEqual(rateOf('claude-opus-5'));
  });

  // Observed live: the lead ran on a model the catalog had never heard of, and
  // it was the majority of that session's bill. An unknown model is priced from
  // the fallback tier — the flag is what stops the rate card presenting a guess
  // as a published price.
  //
  // The id here is deliberately one no release can claim. Written against a
  // real-but-missing id (`claude-fable-5`), this test went green-to-red the day
  // that row was added to the catalog, which is the opposite of what it checks.
  it('marks a model the catalog does not know as approximate', () => {
    const rate = rateOf(UNCATALOGUED);
    expect(rate.approximate).toBe(true);
    expect(rate.input).toBe(priced(catalog.fallbackModel).input);
  });

  it('keeps the unknown model under its own name so the card can name it', () => {
    expect(rateOf(UNCATALOGUED).model).toBe(UNCATALOGUED);
  });
});

describe('splitTok', () => {
  it('reads the four classes off a usage record', () => {
    const split = splitTok([
      record('claude-opus-5', {
        input_tokens: 7,
        output_tokens: 11,
        cache_creation_input_tokens: 500,
        cache_read_input_tokens: 9_000,
      }),
    ]);
    expect(split).toEqual({ in: 7, out: 11, cacheWrite: 500, cacheWrite1h: 0, cacheRead: 9_000 });
  });

  it('treats an absent cache class as zero rather than dropping the record', () => {
    const split = splitTok([record('claude-opus-5', { input_tokens: 3, output_tokens: 4 })]);
    expect(split).toEqual({ in: 3, out: 4, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 });
  });

  // A streamed message is written several times with a growing output_tokens.
  // Summing them bills the same turn once per rewrite, so the whole page would
  // read high — the same rule dedupeUsage already applies to the status bar.
  it('counts a message rewritten mid-stream once, at its largest output', () => {
    const split = splitTok([
      record('claude-opus-5', { input_tokens: 1, output_tokens: 5 }),
      record('claude-opus-5', { input_tokens: 1, output_tokens: 40 }),
    ]);
    expect(split.out).toBe(40);
    expect(split.in).toBe(1);
  });

  // The dashboard draws ONE cache-write bar, but the two buckets bill
  // differently (1.25x vs 2x input), so the 1h share rides along as a subset of
  // cacheWrite. A view that ignores it still draws the right four classes.
  it('carries the 1-hour bucket as a subset of the one cache-write class', () => {
    const split = splitTok([
      record('claude-opus-5', {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 1_000,
        cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 600 },
      }),
    ]);
    expect(split.cacheWrite).toBe(1_000);
    expect(split.cacheWrite1h).toBe(600);
  });

  it('adds up to nothing when there is nothing to add up', () => {
    expect(splitTok([])).toEqual(empty);
  });
});

describe('usdCost', () => {
  it('prices each class at its own rate', () => {
    const cost = usdCost('claude-opus-5', {
      in: 1_000_000,
      out: 1_000_000,
      cacheWrite: 1_000_000,
      cacheWrite1h: 0,
      cacheRead: 1_000_000,
    });
    const rate = rateOf('claude-opus-5');
    expect(cost).toBeCloseTo(rate.input + rate.output + rate.cacheWrite + rate.cacheRead, 10);
  });

  // Measured on the live team: 763,421 of 1,748,083 cache-write tokens were in
  // the 1-hour bucket, which bills at 2x input rather than 1.25x. Pricing the
  // whole write class at 1.25x under-billed that session by 5.75%, which is
  // exactly the disagreement between the usage view and the status bar this
  // module exists to make impossible.
  it('bills the 1-hour cache-write bucket above the 5-minute one', () => {
    const fiveMinute = usdCost('claude-opus-5', { ...empty, cacheWrite: 1_000_000 });
    const oneHour = usdCost('claude-opus-5', {
      ...empty,
      cacheWrite: 1_000_000,
      cacheWrite1h: 1_000_000,
    });
    expect(oneHour).toBeGreaterThan(fiveMinute);
    expect(oneHour).toBeCloseTo(rateOf('claude-opus-5').cacheWrite1h, 10);
  });

  it('charges nothing for no tokens', () => {
    expect(usdCost('claude-opus-5', empty)).toBe(0);
  });

  it('prices an unknown model from the fallback tier rather than as free', () => {
    const split: TokenSplit = { ...empty, out: 1_000_000 };
    expect(usdCost(UNCATALOGUED, split)).toBe(usdCost(catalog.fallbackModel, split));
  });
});

describe('splitByModel', () => {
  it('keeps each model of a mixed set apart, in first-seen order', () => {
    const byModel = splitByModel([
      record('claude-opus-5', { input_tokens: 1, output_tokens: 2 }, 'a'),
      record('claude-haiku-4-5', { input_tokens: 4, output_tokens: 8 }, 'b'),
      record('claude-opus-5', { input_tokens: 16, output_tokens: 32 }, 'c'),
    ]);
    expect(byModel.map((m) => m.model)).toEqual(['claude-opus-5', 'claude-haiku-4-5']);
    expect(byModel[0].split.out).toBe(34);
    expect(byModel[1].split.out).toBe(8);
  });

  it('groups a dated model id with its undated self', () => {
    const byModel = splitByModel([
      record('claude-haiku-4-5-20251001', { input_tokens: 1, output_tokens: 1 }, 'a'),
      record('haiku', { input_tokens: 1, output_tokens: 1 }, 'b'),
    ]);
    expect(byModel).toHaveLength(1);
    expect(byModel[0].model).toBe('claude-haiku-4-5');
  });
});

// The contract this module exists for: the usage view's dollars and the spend
// the status bar already ticks are the same number. The status bar's figure is
// totalCost() over the same records, so nothing here may be a parallel total.
describe('reconciliation with the spend the status bar ticks', () => {
  it('matches totalCost over a real single-model agent', () => {
    const bravo = records('bravo');
    const byModel = splitByModel(bravo);
    const summed = byModel.reduce((s, m) => s + usdCost(m.model, m.split), 0);
    expect(summed).toBeCloseTo(totalCost(bravo), 10);
  });

  it('matches totalCost over the whole fixture, which spans two models', () => {
    const byModel = splitByModel(all());
    const summed = byModel.reduce((s, m) => s + usdCost(m.model, m.split), 0);
    expect(summed).toBeCloseTo(totalCost(all()), 10);
  });

  it('matches totalCost when a 1-hour cache write is in play', () => {
    const withTtl = [
      record('claude-opus-5', {
        input_tokens: 12,
        output_tokens: 34,
        cache_creation_input_tokens: 5_000,
        cache_read_input_tokens: 700_000,
        cache_creation: { ephemeral_5m_input_tokens: 1_000, ephemeral_1h_input_tokens: 4_000 },
      }),
    ];
    const byModel = splitByModel(withTtl);
    const summed = byModel.reduce((s, m) => s + usdCost(m.model, m.split), 0);
    expect(summed).toBeCloseTo(totalCost(withTtl), 10);
  });
});
