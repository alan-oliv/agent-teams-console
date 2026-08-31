// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { Agent } from '../../shared/domain';
import { useSpendSamples } from './useSpendSamples';

it('takes no sample before the team has a cost to report', () => {
  const { result } = renderHook(() => useSpendSamples(undefined));
  expect(result.current).toEqual([]);
});

it('samples the first cost it sees', () => {
  const { result } = renderHook(() => useSpendSamples(1.5));
  expect(result.current).toHaveLength(1);
  expect(result.current[0].cost).toBe(1.5);
});

it('adds a sample only when the cost actually changes', () => {
  const { result, rerender } = renderHook(({ cost }) => useSpendSamples(cost), {
    initialProps: { cost: 1 },
  });
  rerender({ cost: 1 });
  rerender({ cost: 1 });
  expect(result.current).toHaveLength(1);

  rerender({ cost: 2 });
  expect(result.current).toHaveLength(2);
  expect(result.current.map((s) => s.cost)).toEqual([1, 2]);
});

it('keeps sampling across a switch to undefined and back, rather than resetting', () => {
  const { result, rerender } = renderHook(({ cost }) => useSpendSamples(cost), {
    initialProps: { cost: 1 as number | undefined },
  });
  rerender({ cost: undefined });
  rerender({ cost: 2 });
  expect(result.current.map((s) => s.cost)).toEqual([1, 2]);
});

it('bounds how many samples it holds', async () => {
  const { result, rerender } = renderHook(({ cost }) => useSpendSamples(cost), {
    initialProps: { cost: 0 },
  });
  for (let i = 1; i <= 600; i++) {
    act(() => rerender({ cost: i }));
  }
  expect(result.current.length).toBeLessThan(600);
  expect(result.current.at(-1)!.cost).toBe(600);
});

// The per-agent breakdown is what makes the stacked-spend chart a measurement
// rather than a backfill. A teammate that had not spawned yet is simply absent
// from the sample it predates, which is how its area stays flat at zero.
it('records each agent\'s own cumulative cost alongside the team total', () => {
  const roster = (over: Array<{ name: string; costUsd: number }>) =>
    over.map((a) => ({ ...a }) as unknown as Agent);

  const { result, rerender } = renderHook(
    ({ cost, agents }) => useSpendSamples(cost, agents),
    {
      initialProps: {
        cost: 1,
        agents: roster([{ name: 'lead', costUsd: 1 }]),
      },
    },
  );
  rerender({
    cost: 3,
    agents: roster([{ name: 'lead', costUsd: 2 }, { name: 'late', costUsd: 1 }]),
  });

  expect(result.current[0].byAgent).toEqual({ lead: 1 });
  expect(result.current[1].byAgent).toEqual({ lead: 2, late: 1 });
});

it('still samples the total when no roster is handed to it', () => {
  const { result } = renderHook(() => useSpendSamples(2));
  expect(result.current[0].cost).toBe(2);
  expect(result.current[0].byAgent).toBeUndefined();
});
