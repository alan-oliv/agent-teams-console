import { expect, it } from 'vitest';
import { contextBar, formatCost, formatElapsed, formatPct, formatTokens, meterCells } from './format';

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
