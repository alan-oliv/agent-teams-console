// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Subagent } from '../../shared/domain';
import { Trace, axisTicks } from './Trace';

afterEach(cleanup);

const T = 1787843382976;

function subagent(over: Partial<Subagent> = {}): Subagent {
  return {
    toolUseId: 'toolu_1',
    name: 'scout',
    agent: 'team-lead',
    parent: 'team-lead',
    depth: 1,
    spawnIndex: 0,
    siblingGroup: 'rec-1',
    state: 'returned',
    queuedAt: T,
    returnedAt: T + 30_000,
    durationMs: 30_000,
    tokens: 4_000,
    children: [],
    ...over,
  };
}

function renderTrace(props: Partial<Parameters<typeof Trace>[0]> = {}) {
  const onSelect = vi.fn();
  render(
    <Trace
      agent="team-lead"
      subagents={[subagent()]}
      now={T + 60_000}
      selected={null}
      onSelect={onSelect}
      {...props}
    />,
  );
  return onSelect;
}

describe('Trace lanes', () => {
  it('indents a nested lane 24px per depth level and steps its bar height and opacity down', () => {
    renderTrace({
      subagents: [
        subagent({
          children: [
            subagent({
              toolUseId: 'toolu_2',
              name: 'grepper',
              depth: 2,
              parent: 'toolu_1',
              children: [
                subagent({ toolUseId: 'toolu_3', name: 'digger', depth: 3, parent: 'toolu_2' }),
              ],
            }),
          ],
        }),
      ],
    });
    const lanes = screen.getAllByTestId('trace-lane');
    expect(lanes.map((l) => l.getAttribute('data-depth'))).toEqual(['1', '2', '3']);

    const bars = screen.getAllByTestId('trace-bar');
    expect([bars[0].style.height, bars[0].style.opacity]).toEqual(['8px', '0.72']);
    expect([bars[1].style.height, bars[1].style.opacity]).toEqual(['6px', '0.45']);
    expect([bars[2].style.height, bars[2].style.opacity]).toEqual(['4px', '0.3']);

    const names = lanes.map((l) => within(l).getByTestId('trace-lane-name').parentElement!);
    // 10px base + (depth-1)*24px
    expect(names[0].style.paddingLeft).toBe('10px');
    expect(names[1].style.paddingLeft).toBe('34px');
    expect(names[2].style.paddingLeft).toBe('58px');
  });
});

describe('Trace header strip', () => {
  it('derives every number from the same tree the lanes draw, so they cannot disagree', () => {
    renderTrace({
      subagents: [
        subagent({ toolUseId: 'toolu_1', tokens: 4_000, returnedSummary: 'a'.repeat(40) }),
        subagent({
          toolUseId: 'toolu_2',
          tokens: 2_000,
          returnedSummary: 'b'.repeat(20),
          children: [
            subagent({ toolUseId: 'toolu_3', depth: 2, parent: 'toolu_2', tokens: 1_000 }),
          ],
        }),
      ],
    });
    const lanes = screen.getAllByTestId('trace-lane');
    expect(lanes).toHaveLength(3);
    expect(screen.getByTestId('trace-subagents').textContent).toBe('3');
    expect(screen.getByTestId('trace-max-depth').textContent).toBe('2');
    // 4000 + 2000 + 1000 = 7000, formatted
    expect(screen.getByTestId('trace-tokens-in').textContent).toBe('7.0k');
  });

  // The ratio between tokens spent inside subagents and what actually reached
  // the parent is the whole reason this view exists — called out in prose.
  it('calls out the ratio between tokens spent and tokens shown to the parent', () => {
    renderTrace({
      subagents: [subagent({ tokens: 4_400, returnedSummary: 'x'.repeat(400) })],
    });
    // returnedSummary is 400 chars -> ~100 estimated tokens; 4400 / 100 = 44:1.
    expect(screen.getByTestId('trace-shown-to-parent').textContent).toBe('100');
    expect(screen.getByTestId('trace-ratio').textContent).toContain('44:1');
  });
});

describe('Trace detail panel', () => {
  it('opens the detail panel for a selected nested row, carrying its own depth and result', () => {
    const child = subagent({
      toolUseId: 'toolu_2',
      name: 'grepper',
      agentType: 'Explore',
      depth: 2,
      parent: 'toolu_1',
      returnedSummary: 'watch/root.ts wraps fs.watch and debounces it.',
    });
    render(
      <Trace
        agent="team-lead"
        subagents={[subagent({ children: [child] })]}
        now={T + 60_000}
        selected="toolu_2"
        onSelect={vi.fn()}
      />,
    );
    const detail = screen.getByTestId('trace-detail');
    expect(within(detail).getByTestId('trace-detail-name').textContent).toBe('grepper');
    expect(within(detail).getByTestId('trace-detail-result').textContent).toContain(
      'watch/root.ts wraps fs.watch and debounces it.',
    );
  });

  it('selects a lane on click', () => {
    const onSelect = renderTrace();
    fireEvent.click(screen.getByTestId('trace-lane'));
    expect(onSelect).toHaveBeenCalledWith('toolu_1');
  });

  it('shows no detail panel when nothing is selected', () => {
    renderTrace();
    expect(screen.queryByTestId('trace-detail')).toBeNull();
  });
});

// Canvas 8a puts a ruler above the lanes: CALL, minute ticks, TOKENS. Without
// it every bar is a length with nothing to read it against, which is most of
// what this view is for.
describe('the axis ruler', () => {
  it('labels the span at a step that keeps the ruler readable', () => {
    // 4m 08s, the canvas's own span — minute ticks, five labels.
    expect(axisTicks(248_000).map((t) => t.label)).toEqual(['0:00', '1:00', '2:00', '3:00', '4:00']);
    // A twenty-second fan-out is not labelled once...
    expect(axisTicks(20_000).length).toBeGreaterThan(1);
    // ...and no span is ever labelled more than seven times, however long.
    for (const span of [60 * 60_000, 24 * 3_600_000, 7 * 86_400_000, 400 * 86_400_000]) {
      expect(axisTicks(span).length).toBeLessThanOrEqual(7);
    }
  });

  // Real data: four subagents stopped days ago and never marked returned, so
  // the span was 5.6 days. Minutes-only labels rendered `8160:00` twenty times
  // across the ruler, which is what this view drew the first time it met one.
  it('labels in the largest unit the span needs', () => {
    expect(axisTicks(248_000)[1].label).toBe('1:00');
    expect(axisTicks(6 * 3_600_000).some((t) => t.label.includes(':'))).toBe(true);
    const week = axisTicks(7 * 86_400_000);
    expect(week.every((t) => /^\d+d \d+h$|^\d+h$/.test(t.label))).toBe(true);
  });

  it('positions ticks as percentages of the same span the bars use', () => {
    const ticks = axisTicks(248_000);
    expect(ticks[0].at).toBe(0);
    expect(Math.round(ticks[1].at * 10) / 10).toBe(24.2);
  });
});
