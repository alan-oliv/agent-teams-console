import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compactAtFor, resolveModel } from './catalog';

const usageRecords = JSON.parse(
  readFileSync(new URL('../../fixtures/usage-records.json', import.meta.url), 'utf8'),
) as Array<{ agent: string; id: string; model: string }>;

describe('resolveModel', () => {
  it('resolves the Opus 5 tier and its 1M window', () => {
    const m = resolveModel('claude-opus-5');
    expect(m.canonical).toBe('claude-opus-5');
    expect(m.window).toBe(1_000_000);
    expect(m.compactAt).toBe(967_000);
    expect(m.approximate).toBe(false);
    expect(m.pricing).toEqual({
      input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, webSearch: 0.01,
    });
  });

  it('resolves the Sonnet 5 tier at the live $2/$10 rate, not the stale baked one', () => {
    const m = resolveModel('claude-sonnet-5');
    expect(m.pricing).toEqual({
      input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, webSearch: 0.01,
    });
    expect(m.window).toBe(1_000_000);
    expect(m.compactAt).toBe(967_000);
  });

  it('resolves the Haiku 4.5 tier and its 200k window', () => {
    const m = resolveModel('claude-haiku-4-5');
    expect(m.pricing).toEqual({
      input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, webSearch: 0.01,
    });
    expect(m.window).toBe(200_000);
    expect(m.compactAt).toBe(167_000);
    expect(m.approximate).toBe(false);
  });

  it('resolves the aliases config.json records verbatim', () => {
    expect(resolveModel('haiku').canonical).toBe('claude-haiku-4-5');
    expect(resolveModel('opus').canonical).toBe('claude-opus-5');
    expect(resolveModel('sonnet').canonical).toBe('claude-sonnet-5');
    expect(resolveModel('haiku').window).toBe(200_000);
  });

  it('normalises dated ids', () => {
    const m = resolveModel('claude-haiku-4-5-20251001');
    expect(m.canonical).toBe('claude-haiku-4-5');
    expect(m.window).toBe(200_000);
    expect(m.approximate).toBe(false);
  });

  it('strips the [1m] suffix case-insensitively before lookup', () => {
    expect(resolveModel('claude-opus-5[1m]').canonical).toBe('claude-opus-5');
    expect(resolveModel('claude-opus-5[1M]').canonical).toBe('claude-opus-5');
    expect(resolveModel('claude-opus-5[1M]').approximate).toBe(false);
    expect(resolveModel('claude-haiku-4-5-20251001[1M]').canonical).toBe('claude-haiku-4-5');
  });

  it('falls back to the Opus-5 tier and a 200k window for an unknown model', () => {
    const m = resolveModel('claude-mystery-9');
    expect(m.canonical).toBe('claude-mystery-9');
    expect(m.window).toBe(200_000);
    expect(m.compactAt).toBe(167_000);
    expect(m.pricing.input).toBe(5);
    expect(m.pricing.output).toBe(25);
    expect(m.approximate).toBe(true);
  });

  it('falls back for a missing model', () => {
    const m = resolveModel(undefined);
    expect(m.canonical).toBe('unknown');
    expect(m.approximate).toBe(true);
    expect(m.window).toBe(200_000);
  });

  it('resolves every model present in usage-records.json', () => {
    const models = [...new Set(usageRecords.map((r) => r.model))].sort();
    expect(models).toEqual(['claude-haiku-4-5-20251001', 'claude-opus-5']);
    for (const raw of models) {
      expect(resolveModel(raw).approximate).toBe(false);
    }
    expect(resolveModel('claude-haiku-4-5-20251001').pricing.output).toBe(5);
    expect(resolveModel('claude-opus-5').pricing.output).toBe(25);
  });
});

describe('compactAtFor', () => {
  it('subtracts the 20k output reserve and 13k compact headroom', () => {
    expect(compactAtFor(1_000_000)).toBe(967_000);
    expect(compactAtFor(200_000)).toBe(167_000);
  });
});
