import { describe, expect, it } from 'vitest';
import {
  briefAge,
  clockLabel,
  contextBar,
  costLabel,
  ctxLabel,
  elapsedLabel,
  formatCost,
  formatElapsed,
  formatPct,
  formatTokens,
  meterCells,
  pctLabel,
  tokensLabel,
  warnMark,
} from './format';

it('fills the 16-cell bar at 0%, 50% and 100%', () => {
  expect(meterCells(0)).toBe('░░░░░░░░░░░░░░░░');
  expect(meterCells(0.5)).toBe('████████░░░░░░░░');
  expect(meterCells(1)).toBe('████████████████');
  expect(meterCells(0).length).toBe(16);
});

it('clamps the bar outside 0..1', () => {
  expect(meterCells(-0.4)).toBe('░░░░░░░░░░░░░░░░');
  expect(meterCells(2)).toBe('████████████████');
});

it('marks the auto-compact tick inside the bar', () => {
  // opus-5: compact at 967k of 1M -> floor(0.967 * 16) = cell 15
  expect(contextBar(0, 1_000_000, 967_000)).toBe('░░░░░░░░░░░░░░░█');
  expect(contextBar(500_000, 1_000_000, 967_000)).toBe('████████░░░░░░░█');
  expect(contextBar(1_000_000, 1_000_000, 967_000)).toBe('████████████████');
  // haiku-4-5: compact at 167k of 200k -> floor(0.835 * 16) = cell 13
  expect(contextBar(156_000, 200_000, 167_000)).toBe('████████████░█░░');
});

it('formats token counts the way the design writes them', () => {
  expect(formatTokens(53_100)).toBe('53.1k');
  expect(formatTokens(156_000)).toBe('156k');
  expect(formatTokens(200_000)).toBe('200k');
  expect(formatTokens(829_100)).toBe('829k');
  expect(formatTokens(1_000_000)).toBe('1M');
  expect(formatTokens(1_250_000)).toBe('1.3M');
  expect(formatTokens(412)).toBe('412');
});

it('formats percentages, cost and elapsed', () => {
  expect(formatPct(53_100 / 1_000_000)).toBe('5%');
  expect(formatPct(156_000 / 200_000)).toBe('78%');
  expect(formatCost(1.31)).toBe('≈$1.31');
  expect(formatCost(2.56)).toBe('≈$2.56');
  expect(formatElapsed(2_712_000)).toBe('45m 12s');
  expect(formatElapsed(45_000)).toBe('0m 45s');
  expect(formatElapsed(3_660_000)).toBe('1h 01m');
});

describe('tokensLabel', () => {
  it('renders the spec §4.3 meter figures', () => {
    expect(tokensLabel(53_100)).toBe('53.1k');
    expect(tokensLabel(1_000_000)).toBe('1M');
    expect(tokensLabel(200_000)).toBe('200k');
    expect(tokensLabel(156_000)).toBe('156k');
    expect(tokensLabel(167_000)).toBe('167k');
    expect(tokensLabel(940)).toBe('940');
  });

  it('renders the real captured occupancies from usage-records.json', () => {
    expect(tokensLabel(34_469)).toBe('34.5k');
    expect(tokensLabel(34_561)).toBe('34.6k');
    expect(tokensLabel(23_639)).toBe('23.6k');
  });
});

describe('pctLabel and ctxLabel', () => {
  it('matches the two spec §4.3 example rows', () => {
    expect(pctLabel(53_100, 1_000_000)).toBe('5%');
    expect(ctxLabel(53_100, 1_000_000)).toBe('53.1k / 1M');
    expect(pctLabel(156_000, 200_000)).toBe('78%');
    expect(ctxLabel(156_000, 200_000)).toBe('156k / 200k');
  });

  it('matches probe-alpha and probe-charlie from the captured usage records', () => {
    expect(pctLabel(34_469, 1_000_000)).toBe('3%');
    expect(ctxLabel(34_469, 1_000_000)).toBe('34.5k / 1M');
    expect(pctLabel(23_639, 200_000)).toBe('12%');
    expect(ctxLabel(23_639, 200_000)).toBe('23.6k / 200k');
  });
});

describe('warnMark', () => {
  it('fires relative to compactAt, not a fixed window fraction', () => {
    expect(warnMark(156_000, 167_000)).toBe('!');
    expect(warnMark(53_100, 967_000)).toBe('');
    expect(warnMark(34_469, 967_000)).toBe('');
    expect(warnMark(23_639, 167_000)).toBe('');
  });
});

describe('costLabel', () => {
  it('renders the real per-agent costs computed from usage-records.json', () => {
    expect(costLabel(0.464434)).toBe('≈$0.46');
    expect(costLabel(0.390121)).toBe('≈$0.39');
    expect(costLabel(0.044338)).toBe('≈$0.04');
    expect(costLabel(0)).toBe('≈$0.00');
  });
});

describe('elapsedLabel', () => {
  it('measures probe-alpha from its real joinedAt', () => {
    expect(elapsedLabel(1787843382976, 1787843425000)).toBe('0m 42s');
  });

  it('switches to hours for the lead, whose team was created much earlier', () => {
    expect(elapsedLabel(1787798107581, 1787843425000)).toBe('12h 35m');
  });
});

describe('clockLabel', () => {
  it('renders the SENT time of the real probe-alpha inbox entry', () => {
    expect(clockLabel(Date.parse('2026-08-27T15:10:17.891Z'))).toBe('15:10:17');
  });

  it('renders the batched delivery time of the lead-transcript frames', () => {
    expect(clockLabel(Date.parse('2026-08-27T15:12:17.951Z'))).toBe('15:12:17');
  });
});

describe('briefAge', () => {
  it('holds a delivery footnote to one unit', () => {
    expect(briefAge(34_000)).toBe('34s');
    expect(briefAge(0)).toBe('0s');
    expect(briefAge(59_999)).toBe('59s');
    expect(briefAge(60_000)).toBe('1m');
    expect(briefAge(15 * 60_000)).toBe('15m');
    expect(briefAge(3_600_000)).toBe('1h');
    expect(briefAge(5 * 3_600_000 + 40 * 60_000)).toBe('5h');
  });

  it('reads a clock that has not caught up yet as no time at all', () => {
    expect(briefAge(-2_000)).toBe('0s');
  });
});
