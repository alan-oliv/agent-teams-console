// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { sampleTeams } from '../test/state-fixture';
import { NoSessions } from './NoSessions';

afterEach(cleanup);

function renderScreen(props: Partial<Parameters<typeof NoSessions>[0]> = {}) {
  const onShowHidden = vi.fn();
  const onSwitchTo = vi.fn();
  render(
    <NoSessions
      remaining={[]}
      notShownCount={0}
      onShowHidden={onShowHidden}
      onSwitchTo={onSwitchTo}
      {...props}
    />,
  );
  return { onShowHidden, onSwitchTo };
}

// The count covers both kinds of dropped row — ✕-hidden and lead-only — so
// `hidden` would be the wrong word for most of it. The picker says `not shown`
// for the same total, and the two screens must not disagree about it.
it('states how many rows are not shown, in the picker own words', () => {
  renderScreen({ notShownCount: 2 });
  expect(screen.getByText('2 not shown')).toBeTruthy();
});

// Hiding the last row would otherwise be a one-way door: empty picker, empty
// body, and no control anywhere that puts them back.
it('offers the way back whenever anything is not shown, and nothing when all is', () => {
  const { onShowHidden } = renderScreen({ notShownCount: 1 });
  fireEvent.click(screen.getByTestId('show-hidden'));
  expect(onShowHidden).toHaveBeenCalled();

  cleanup();
  renderScreen({ notShownCount: 0 });
  expect(screen.queryByTestId('show-hidden')).toBeNull();
});

it('lists the sessions it was given and switches to one on click', () => {
  const remaining = sampleTeams();
  const { onSwitchTo } = renderScreen({ remaining });
  const rows = screen.getAllByTestId('no-sessions-other');
  expect(rows).toHaveLength(remaining.length);
  fireEvent.click(rows[1]);
  expect(onSwitchTo).toHaveBeenCalledWith(remaining[1].name);
});

// Paging back into a session that has finished is the point of the list, so a
// done row gets the picker's ✓ rather than being dropped or drawn as live.
it('marks a finished session with a check, not a live dot', () => {
  renderScreen({ remaining: [{ ...sampleTeams()[1], members: 2, state: 'done' }] });
  expect(screen.getByTestId('no-sessions-other').textContent).toContain('✓');
});
