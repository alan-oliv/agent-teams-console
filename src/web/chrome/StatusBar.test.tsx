// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FIXTURE_NOW, sampleTeamState } from '../test/state-fixture';
import { StatusBar } from './StatusBar';
import { DEFAULT_SETTINGS } from '../state/useSettings';
import { cssVarsFor, DENSITY } from '../themes';

const APPEARANCE = {
  settings: DEFAULT_SETTINGS,
  set: vi.fn(),
  reset: vi.fn(),
  vars: cssVarsFor(DEFAULT_SETTINGS.theme, DEFAULT_SETTINGS.scheme),
  gap: DENSITY[DEFAULT_SETTINGS.density],
};

// This suite renders once per `it`; without explicit cleanup the un-unmounted
// nodes from one test leak into the next and getByRole/getByText start
// matching more than one element.
afterEach(cleanup);

function renderBar(view: Parameters<typeof StatusBar>[0]['view'] = 'wall') {
  const onViewChange = vi.fn();
  render(
    <StatusBar
      state={sampleTeamState()}
      view={view}
      onViewChange={onViewChange}
      now={FIXTURE_NOW}
      teamsOpen={false}
      onTeamsOpenChange={vi.fn()}
      appearance={APPEARANCE}
    />,
  );
  return onViewChange;
}

it('exposes the switcher as a tablist with the six views', () => {
  renderBar();
  const tablist = screen.getByRole('tablist');
  expect(within(tablist).getAllByRole('tab').map((t) => t.textContent)).toEqual([
    'wall',
    'overview',
    'comms',
    'tasks',
    'rail',
    'grid',
  ]);
  expect(screen.getByRole('tab', { name: 'wall' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tab', { name: 'grid' }).getAttribute('aria-selected')).toBe('false');
});

it('fires the view change when a tab is clicked', () => {
  const onViewChange = renderBar();
  fireEvent.click(screen.getByRole('tab', { name: 'grid' }));
  expect(onViewChange).toHaveBeenCalledWith('grid');
  fireEvent.click(screen.getByRole('tab', { name: 'tasks' }));
  expect(onViewChange).toHaveBeenLastCalledWith('tasks');
});

it('renders the wordmark and the team name', () => {
  renderBar();
  const wordmark = screen.getByText('TEAM');
  expect(wordmark.style.color).toBe('var(--color-accent)');
  expect(wordmark.style.letterSpacing).toBe('.14em');
  expect(wordmark.style.fontWeight).toBe('700');
  expect(wordmark.style.fontSize).toBe('11px');
  expect(screen.getByText('session-98b0b4a7')).toBeTruthy();
  // The pill is gone: agent teams are not experimental any more, and this bar
  // is the one place where every pixel has to be paid for.
  expect(screen.queryByText('experimental')).toBeNull();
});

it('does not pin the meter full when the cumulative token count is large', () => {
  // The meter used to be `totalTokens / sum(contextLimit)`. totalTokens is
  // cumulative, so on a real session it exceeded capacity by three orders of
  // magnitude and clamped to 16/16 forever.
  const state = sampleTeamState();
  state.totalTokens = 1_833_968_297;
  render(
    <StatusBar
      state={state}
      view="wall"
      onViewChange={vi.fn()}
      now={FIXTURE_NOW}
      teamsOpen={false}
      onTeamsOpenChange={vi.fn()}
      appearance={APPEARANCE}
    />,
  );
  expect(screen.getByTestId('aggregate-meter').textContent).toBe('████░░░░░░░░░░░░');
});

it('renders the right-hand readouts from the fixture team', () => {
  renderBar();
  expect(screen.getByText('tasks 1/2')).toBeTruthy();
  expect(screen.getByText('4 windows')).toBeTruthy();
  expect(screen.getByText('829k')).toBeTruthy();
  // The meter is team context occupancy: sum(contextTokens) / sum(contextLimit).
  expect(screen.getByTestId('aggregate-meter').textContent).toBe('████░░░░░░░░░░░░');
  expect(screen.getByTestId('aggregate-meter').style.color).toBe('var(--color-accent-500)');
  // Elapsed and spend are one chip: the sixth switcher pill took the gap that
  // used to sit between them.
  expect(screen.getByText('45m 12s · ≈$2.56 api-equiv')).toBeTruthy();
  expect(screen.getByText('5h 41% · 7d 12%')).toBeTruthy();
});

it('shows the branch when the state carries one', () => {
  const state = sampleTeamState();
  state.branch = 'fix/design-sync-wave-1';
  render(
    <StatusBar
      state={state}
      view="wall"
      onViewChange={vi.fn()}
      now={FIXTURE_NOW}
      teamsOpen={false}
      onTeamsOpenChange={vi.fn()}
      appearance={APPEARANCE}
    />,
  );
  const branch = screen.getByText('fix/design-sync-wave-1');
  expect(branch.style.color).toBe('var(--color-accent-400)');
});

it('renders no branch when the state has none', () => {
  const state = sampleTeamState();
  expect(state.branch).toBeUndefined();
  render(
    <StatusBar
      state={state}
      view="wall"
      onViewChange={vi.fn()}
      now={FIXTURE_NOW}
      teamsOpen={false}
      onTeamsOpenChange={vi.fn()}
      appearance={APPEARANCE}
    />,
  );
  expect(screen.queryByTestId('status-branch')).toBeNull();
});

it('makes the team name the control that opens the team list', () => {
  const onTeamsOpenChange = vi.fn();
  render(
    <StatusBar
      state={sampleTeamState()}
      view="wall"
      onViewChange={vi.fn()}
      now={FIXTURE_NOW}
      teamsOpen={false}
      onTeamsOpenChange={onTeamsOpenChange}
      appearance={APPEARANCE}
    />,
  );
  const trigger = screen.getByRole('button', { name: 'TEAM session-98b0b4a7' });
  expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');

  fireEvent.click(trigger);
  expect(onTeamsOpenChange).toHaveBeenCalledWith(true);
});

it('pins the trigger wide enough that switching teams cannot move the switcher', () => {
  // The tabs' x already depends on the team name's length; a fluid trigger would
  // shove them sideways as a result of the operator's own click.
  const short = sampleTeamState();
  render(
    <StatusBar
      state={short}
      view="wall"
      onViewChange={vi.fn()}
      now={FIXTURE_NOW}
      teamsOpen={false}
      onTeamsOpenChange={vi.fn()}
      appearance={APPEARANCE}
    />,
  );
  expect(screen.getByTestId('team-trigger').style.width).toBe('146px');
  cleanup();

  const long = sampleTeamState();
  long.teamName = 'session-b5129c7b-with-a-very-long-name';
  render(
    <StatusBar
      state={long}
      view="wall"
      onViewChange={vi.fn()}
      now={FIXTURE_NOW}
      teamsOpen={false}
      onTeamsOpenChange={vi.fn()}
      appearance={APPEARANCE}
    />,
  );
  expect(screen.getByTestId('team-trigger').style.width).toBe('146px');
  expect(screen.getByText('session-b5129c7b-with-a-very-long-name').style.textOverflow).toBe(
    'ellipsis',
  );
});

// The bar is one 40px line. A child that can shrink wraps, doubling its height —
// the one way this layout breaks, so the invariant is pinned rather than eyeballed.
it('never wraps, and every child but the spacer is unshrinkable', () => {
  renderBar();
  const bar = screen.getByText('TEAM').parentElement!;
  expect(bar.style.flexWrap).toBe('nowrap');

  // jsdom normalises the shorthand: `flex: 1` -> `1 1 0%`, `flex: none` -> `0 0 auto`.
  const spacers = [...bar.children].filter((c) => (c as HTMLElement).style.flex === '1 1 0%');
  expect(spacers).toHaveLength(1);

  for (const child of bar.children) {
    const el = child as HTMLElement;
    if (el === spacers[0]) continue;
    expect([el.textContent, el.style.flex]).toEqual([el.textContent, '0 0 auto']);
  }
});

it('keeps the view switcher on one line', () => {
  renderBar();
  const tab = screen.getByRole('tab', { name: 'wall' });
  expect(tab.style.whiteSpace).toBe('nowrap');
  expect(tab.style.padding).toBe('1px 9px');
});

// The sixth switcher pill costs ~65px, which is what pushed the bar past
// 1180px and bled the spend figure off-frame in the first place.
it('carries elapsed and spend as one unshrinkable chip', () => {
  renderBar();
  const chip = screen.getByText('45m 12s · ≈$2.56 api-equiv');
  expect(chip.style.flex).toBe('0 0 auto');
  expect(chip.style.whiteSpace).toBe('nowrap');
  // Two children would spend a 10px gap the bar no longer has.
  expect(screen.queryByText('45m 12s')).toBeNull();
  expect(screen.queryByText('≈$2.56 api-equiv')).toBeNull();
});

// The design took it out of the bar for the room; the session rows carry it.
it('spends no bar width on a diffstat', () => {
  renderBar();
  const bar = screen.getByText('TEAM').parentElement!;
  expect(bar.textContent).not.toMatch(/[+−-]\d+\s*[−-]\d+/);
});
