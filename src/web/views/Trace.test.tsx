// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Subagent } from '../../shared/domain';
import { Trace } from './Trace';

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
