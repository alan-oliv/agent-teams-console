// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { formatCost, formatElapsed } from '../format';
import { FIXTURE_NOW, sampleTeamState, sampleTeams } from '../test/state-fixture';
import { LeftSession } from './LeftSession';

afterEach(cleanup);

const state = sampleTeamState();
const elsewhere = sampleTeams().slice(1);

function renderScreen(props: Partial<Parameters<typeof LeftSession>[0]> = {}) {
  const onWatchAgain = vi.fn();
  const onEndForReal = vi.fn();
  const onSwitchTo = vi.fn();
  render(
    <LeftSession
      state={state}
      now={FIXTURE_NOW}
      awaySince={{ at: FIXTURE_NOW - 90_000, cost: 1.5 }}
      elsewhere={elsewhere}
      onWatchAgain={onWatchAgain}
      onEndForReal={onEndForReal}
      onSwitchTo={onSwitchTo}
      {...props}
    />,
  );
  return { onWatchAgain, onEndForReal, onSwitchTo };
}

it('heads the screen with the session that was dismissed, not a generic message', () => {
  renderScreen();
  expect(screen.getByTestId('left-session-heading').textContent).toBe(
    `You stopped watching ${state.teamName}.`,
  );
  expect(screen.getByText(/nothing was interrupted/i)).toBeTruthy();
});

// The whole point of this screen is that it never claims the session stopped —
// so its numbers have to be live, not a snapshot frozen at dismissal.
it('reads the working/done/spend counts straight off the live state, not a frozen copy', () => {
  renderScreen();
  const working = state.agents.filter((a) => a.status === 'working').length;
  const done = state.tasks.filter((t) => t.state === 'completed').length;
  expect(screen.getByTestId('left-session-agents').textContent).toBe(
    `${working} of ${state.agents.length} agents still working`,
  );
  expect(screen.getByTestId('left-session-tasks').textContent).toBe(
    `${done} of ${state.tasks.length} tasks done`,
  );
  // 2.56 total - 1.5 already spent when dismissed = 1.06 accrued while away.
  expect(screen.getByTestId('left-session-spend').textContent).toBe(
    `${formatCost(state.totalCostUsd - 1.5)} spent since you looked away`,
  );
});

it('ticks the time away forward as `now` advances, never freezing it', () => {
  const { rerender } = render(
    <LeftSession
      state={state}
      now={FIXTURE_NOW}
      awaySince={{ at: FIXTURE_NOW - 60_000, cost: 0 }}
      elsewhere={[]}
      onWatchAgain={vi.fn()}
      onEndForReal={vi.fn()}
      onSwitchTo={vi.fn()}
    />,
  );
  expect(screen.getByTestId('left-session-away').textContent).toBe(`away ${formatElapsed(60_000)}`);

  rerender(
    <LeftSession
      state={state}
      now={FIXTURE_NOW + 30_000}
      awaySince={{ at: FIXTURE_NOW - 60_000, cost: 0 }}
      elsewhere={[]}
      onWatchAgain={vi.fn()}
      onEndForReal={vi.fn()}
      onSwitchTo={vi.fn()}
    />,
  );
  expect(screen.getByTestId('left-session-away').textContent).toBe(`away ${formatElapsed(90_000)}`);
});

it('watch again and end it for real call back without needing their own confirmation copy', () => {
  const { onWatchAgain, onEndForReal } = renderScreen();
  fireEvent.click(screen.getByTestId('watch-again'));
  expect(onWatchAgain).toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('end-for-real'));
  expect(onEndForReal).toHaveBeenCalled();
});

it('lists the other sessions on the machine, each one click away', () => {
  const { onSwitchTo } = renderScreen();
  const rows = screen.getAllByTestId('left-session-elsewhere-row');
  expect(rows).toHaveLength(elsewhere.length);
  fireEvent.click(rows[0]);
  expect(onSwitchTo).toHaveBeenCalledWith(elsewhere[0].name);
});
