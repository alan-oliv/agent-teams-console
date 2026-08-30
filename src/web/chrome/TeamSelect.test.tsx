// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FIXTURE_NOW, sampleTeams } from '../test/state-fixture';
import { WatchContext, type WatchState } from '../state/useWatch';
import { TeamSelect } from './TeamSelect';
import type { TeamSummary } from '../../shared/domain';

// This suite renders once per `it`; without explicit cleanup the un-unmounted
// nodes from one test leak into the next and getByRole/getByText start
// matching more than one element.
afterEach(cleanup);

// The second fixture team is `done` and lead-only, both of which the picker now
// filters out; these tests are about rows and switching, so it stands in as an
// idle REAL team. The two filtering rules have their own tests at the bottom.
const LIST = {
  current: 'session-98b0b4a7',
  teams: sampleTeams().map((t, i) =>
    i === 1 ? { ...t, state: 'idle' as const, members: 2 } : t,
  ),
};

let fetchMock: ReturnType<typeof vi.fn>;

/** Routes on path so a test can fail the POST without also failing the GET. */
function routed(post: () => Promise<Response>) {
  return vi.fn((path: string) =>
    path === '/api/teams'
      ? Promise.resolve(new Response(JSON.stringify(LIST), { status: 200 }))
      : post(),
  );
}

beforeEach(() => {
  fetchMock = routed(() => Promise.resolve(new Response('{}', { status: 200 })));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderSelect(props: Partial<Parameters<typeof TeamSelect>[0]> = {}, watch: Partial<WatchState> = {}) {
  const onOpenChange = vi.fn();
  const all = { current: 'session-98b0b4a7', open: true, onOpenChange, now: FIXTURE_NOW, ...props };
  const watchValue: WatchState = {
    dismissed: false,
    requestStopWatching: vi.fn(),
    watchAgain: vi.fn(),
    hidden: new Set(),
    hideSession: vi.fn(),
    showHidden: vi.fn(),
    ...watch,
  };
  const view = render(
    <WatchContext.Provider value={watchValue}>
      <TeamSelect {...all} />
    </WatchContext.Provider>,
  );
  const rerender = (next: Partial<typeof all> = {}) =>
    view.rerender(
      <WatchContext.Provider value={watchValue}>
        <TeamSelect {...all} {...next} />
      </WatchContext.Provider>,
    );
  return { onOpenChange, rerender, watch: watchValue };
}

const SWITCH_TO_B5 = [
  '/api/teams/session-b5129c7b/select',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
];

it('does not read the team list until it is opened', async () => {
  const { rerender } = renderSelect({ open: false });
  expect(fetchMock).not.toHaveBeenCalled();

  rerender({ open: true });
  await screen.findAllByRole('option');
  expect(fetchMock).toHaveBeenCalledWith('/api/teams');
});

// The trigger names the SESSION, not the directory it lives in. It comes off
// the live frame rather than the listing, so it is right before the dropdown
// has ever been opened — and costs no fetch.
it('names the session on the trigger', () => {
  renderSelect({ open: false, sessionName: 'agents-team-console-design' });
  expect(screen.getByTestId('team-trigger-name').textContent).toBe('agents-team-console-design');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('falls back to the directory id when the session was never named', () => {
  renderSelect({ open: false });
  expect(screen.getByTestId('team-trigger-name').textContent).toBe('session-98b0b4a7');
});

it('heads the list with the team count', async () => {
  renderSelect();
  expect(await screen.findByText('TEAMS ON THIS MACHINE · 2')).toBeTruthy();
  expect(screen.getByText('↑↓ select · ⏎ switch · esc close')).toBeTruthy();
});

// The row leads with the name the operator gave the session; the directory id
// is a secondary handle, beside the branch. A session never named falls back to
// the id up top, so the row is never blank.
it('leads with the session name and demotes the id to the second line', async () => {
  renderSelect();
  const rows = await screen.findAllByRole('option');
  expect(rows.map((r) => within(r).getByTestId('team-title').textContent)).toEqual([
    'agents-team-console-design',
    'session-b5129c7b',
  ]);
  expect(within(rows[0]).getByTestId('team-id').textContent).toBe('session-98b0b4a7');
  // Unnamed: the id is already the title, so it is not repeated below it.
  expect(within(rows[1]).queryByTestId('team-id')).toBeNull();
});

it('carries the agent count and state on the second line', async () => {
  renderSelect();
  const rows = await screen.findAllByRole('option');
  expect(within(rows[0]).getByTestId('team-meta').textContent).toContain('4 agents');
  expect(within(rows[0]).getByTestId('team-meta').textContent).toContain('live');
});

it('shows each session branch beside its name', async () => {
  renderSelect();
  const rows = await screen.findAllByRole('option');
  expect(within(rows[0]).getByTestId('team-branch').textContent).toBe(
    'fix/engine-latency-and-frame-size',
  );
  expect(within(rows[1]).getByTestId('team-branch').textContent).toBe('main');
});

it('marks the team the console is actually showing', async () => {
  renderSelect();
  const rows = await screen.findAllByRole('option');
  expect(rows[0].getAttribute('aria-selected')).toBe('true');
  expect(rows[0].style.borderLeft).toBe('2px solid var(--color-accent-600)');
  expect(within(rows[0]).getByTestId('team-mark').textContent).toBe('✓');
  expect(rows[1].getAttribute('aria-selected')).toBe('false');
  expect(rows[1].style.borderLeft).toBe('2px solid transparent');
  expect(within(rows[1]).queryByTestId('team-mark')).toBeNull();
});

it('posts the switch for the row that was clicked', async () => {
  renderSelect();
  const rows = await screen.findAllByRole('option');
  fireEvent.click(rows[1]);
  expect(fetchMock).toHaveBeenLastCalledWith(...SWITCH_TO_B5);
});

it('holds the popover open until the snapshot carries the new team', async () => {
  const { onOpenChange, rerender } = renderSelect();
  const rows = await screen.findAllByRole('option');
  fireEvent.click(rows[1]);

  // The ack is not the screen changing: the switch lands on the next SSE frame.
  expect(within(rows[1]).getByTestId('team-mark').textContent).toBe('switching…');
  expect(screen.getByRole('listbox', { name: 'teams' }).getAttribute('aria-busy')).toBe('true');
  expect(onOpenChange).not.toHaveBeenCalled();

  rerender({ current: 'session-b5129c7b' });
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('closes without a request when the current team is selected', async () => {
  const { onOpenChange } = renderSelect();
  const rows = await screen.findAllByRole('option');
  fireEvent.click(rows[0]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('/api/teams');
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('moves the cursor with the arrows and switches the cursor row on enter', async () => {
  renderSelect();
  await screen.findAllByRole('option');
  const list = screen.getByRole('listbox', { name: 'teams' });
  expect(list.getAttribute('aria-activedescendant')).toBe('team-option-session-98b0b4a7');

  fireEvent.keyDown(list, { key: 'ArrowDown' });
  expect(list.getAttribute('aria-activedescendant')).toBe('team-option-session-b5129c7b');
  fireEvent.keyDown(list, { key: 'ArrowDown' });
  expect(list.getAttribute('aria-activedescendant')).toBe('team-option-session-b5129c7b');

  fireEvent.keyDown(list, { key: 'Enter' });
  expect(fetchMock).toHaveBeenLastCalledWith(...SWITCH_TO_B5);
});

it('swallows escape so it closes the list instead of interrupting an agent', async () => {
  const { onOpenChange } = renderSelect();
  await screen.findAllByRole('option');
  const list = screen.getByRole('listbox', { name: 'teams' });

  const ev = createEvent.keyDown(list, { key: 'Escape' });
  fireEvent(list, ev);
  expect(ev.defaultPrevented).toBe(true);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('closes when a pointer goes down outside it', async () => {
  const { onOpenChange } = renderSelect();
  await screen.findAllByRole('option');
  fireEvent.pointerDown(document.body);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('says it is reading while the listing is in flight', () => {
  fetchMock.mockReturnValue(new Promise<Response>(() => {}));
  renderSelect();
  expect(screen.getByText('reading teams…')).toBeTruthy();
});

it('says so when the machine has no teams', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ current: '', teams: [] }), { status: 200 }));
  renderSelect();
  expect(await screen.findByText('no live teams')).toBeTruthy();
});

it('says so when the listing cannot be read', async () => {
  fetchMock.mockRejectedValue(new Error('offline'));
  renderSelect();
  const line = await screen.findByText('could not read teams');
  expect(line.style.color).toBe('var(--fail)');
});

it('marks the row when the switch is refused', async () => {
  vi.stubGlobal('fetch', routed(() => Promise.resolve(new Response('{}', { status: 500 }))));
  const { onOpenChange } = renderSelect();
  const rows = await screen.findAllByRole('option');
  fireEvent.click(rows[1]);

  const mark = await within(rows[1]).findByText('switch failed');
  expect(mark.style.color).toBe('var(--fail)');
  expect(onOpenChange).not.toHaveBeenCalled();
});

it('marks the row gone when the team vanished before the click', async () => {
  vi.stubGlobal('fetch', routed(() => Promise.resolve(new Response('{}', { status: 404 }))));
  renderSelect();
  const rows = await screen.findAllByRole('option');
  fireEvent.click(rows[1]);

  const mark = await within(rows[1]).findByText('gone');
  expect(mark.style.color).toBe('var(--fail)');
});


it('goes dashed and reads "no session selected" on the trigger once dismissed', () => {
  renderSelect({ open: false }, { dismissed: true });
  const trigger = screen.getByTestId('team-trigger');
  expect(trigger.style.border).toContain('dashed');
  expect(screen.getByTestId('team-trigger-name').textContent).toBe('no session selected');
});

it('keeps the normal trigger label and solid border while watching', () => {
  renderSelect({ open: false });
  const trigger = screen.getByTestId('team-trigger');
  expect(trigger.style.border).toContain('solid');
  expect(screen.getByTestId('team-trigger-name').textContent).toBe('session-98b0b4a7');
});

it('marks the dismissed session running · not watching instead of live, and drops its checkmark', async () => {
  renderSelect({}, { dismissed: true });
  const rows = await screen.findAllByRole('option');
  expect(within(rows[0]).getByTestId('team-meta').textContent).toContain('running · not watching');
  expect(within(rows[0]).queryByTestId('team-mark')).toBeNull();
});

it('offers "stop watching" only on the current row, and only while still watching', async () => {
  renderSelect();
  const rows = await screen.findAllByRole('option');
  expect(within(rows[0]).getByTestId('row-stop-watching')).toBeTruthy();
  expect(within(rows[1]).queryByTestId('row-stop-watching')).toBeNull();
});

it('does not offer "stop watching" again once already dismissed', async () => {
  renderSelect({}, { dismissed: true });
  const rows = await screen.findAllByRole('option');
  expect(within(rows[0]).queryByTestId('row-stop-watching')).toBeNull();
});

it('requests the stop-watching confirmation without switching or closing', async () => {
  const requestStopWatching = vi.fn();
  const { onOpenChange } = renderSelect({}, { requestStopWatching });
  const rows = await screen.findAllByRole('option');
  fireEvent.click(within(rows[0]).getByTestId('row-stop-watching'));
  expect(requestStopWatching).toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
});

it('clicking the dismissed current row resumes watching it, instead of a no-op close', async () => {
  const watchAgain = vi.fn();
  const { onOpenChange } = renderSelect({}, { dismissed: true, watchAgain });
  const rows = await screen.findAllByRole('option');
  fireEvent.click(rows[0]);
  expect(watchAgain).toHaveBeenCalled();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('hides a team whose session has ended — it is history, not a session on this machine', async () => {
  const done = { current: 'session-98b0b4a7', teams: sampleTeams() };
  fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(done), { status: 200 })));
  vi.stubGlobal('fetch', fetchMock);

  renderSelect();
  const rows = await screen.findAllByRole('option');
  expect(rows).toHaveLength(1);
  expect(within(rows[0]).getByText('session-98b0b4a7')).toBeTruthy();
  expect(screen.getByText('TEAMS ON THIS MACHINE · 1')).toBeTruthy();
});

it('opens the sessions menu on ⌘K when it is closed', () => {
  const { onOpenChange } = renderSelect({ open: false });
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  expect(onOpenChange).toHaveBeenCalledWith(true);
});

it('focuses the search input once the menu is open', async () => {
  renderSelect();
  await screen.findAllByRole('option');
  expect(document.activeElement).toBe(screen.getByTestId('team-search'));
});

it('refocuses the search input on ⌘K when the menu is already open', async () => {
  renderSelect();
  await screen.findAllByRole('option');
  const search = screen.getByTestId('team-search');
  search.blur();
  expect(document.activeElement).not.toBe(search);

  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  expect(document.activeElement).toBe(search);
});

it('filters rows by name, goal, and branch as the operator types', async () => {
  renderSelect();
  await screen.findAllByRole('option');
  const search = screen.getByTestId('team-search');

  fireEvent.change(search, { target: { value: 'main' } });
  expect(screen.getAllByRole('option').map((r) => r.id)).toEqual(['team-option-session-b5129c7b']);

  fireEvent.change(search, { target: { value: 'console' } });
  expect(screen.getAllByRole('option').map((r) => r.id)).toEqual(['team-option-session-98b0b4a7']);

  fireEvent.change(search, { target: { value: 'engine' } });
  expect(screen.getAllByRole('option').map((r) => r.id)).toEqual(['team-option-session-98b0b4a7']);
});

it('moves the cursor within the filtered rows, not the full list', async () => {
  renderSelect();
  await screen.findAllByRole('option');
  const list = screen.getByRole('listbox', { name: 'teams' });
  const search = screen.getByTestId('team-search');

  fireEvent.change(search, { target: { value: 'session-b5' } });
  expect(list.getAttribute('aria-activedescendant')).toBe('team-option-session-b5129c7b');

  // Only one row matches, so the cursor cannot move past it.
  fireEvent.keyDown(list, { key: 'ArrowDown' });
  expect(list.getAttribute('aria-activedescendant')).toBe('team-option-session-b5129c7b');
});

it('says so when the filter matches nothing', async () => {
  renderSelect();
  await screen.findAllByRole('option');
  fireEvent.change(screen.getByTestId('team-search'), { target: { value: 'nonexistent-zzz' } });
  expect(await screen.findByText('no matches')).toBeTruthy();
});

it('clears the filter on escape before closing the menu', async () => {
  const { onOpenChange } = renderSelect();
  await screen.findAllByRole('option');
  const list = screen.getByRole('listbox', { name: 'teams' });
  const search = screen.getByTestId('team-search') as HTMLInputElement;

  fireEvent.change(search, { target: { value: 'main' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);

  fireEvent.keyDown(list, { key: 'Escape' });
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(search.value).toBe('');
  expect(await screen.findAllByRole('option')).toHaveLength(2);

  fireEvent.keyDown(list, { key: 'Escape' });
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

// A TEAM that ended, not a lead-only session: those are dropped even when
// current, since the picker lists teams and the body says so.
it('keeps the ended team that is being VIEWED, so the picker cannot contradict the wall', async () => {
  const teams = sampleTeams().map((t, i) => ({ ...t, current: i === 1, members: 2 }));
  const viewing = { current: 'session-b5129c7b', teams };
  fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(viewing), { status: 200 })));
  vi.stubGlobal('fetch', fetchMock);

  renderSelect({ current: 'session-b5129c7b' });
  const rows = await screen.findAllByRole('option');
  expect(rows.map((r) => r.getAttribute('id'))).toContain('team-option-session-b5129c7b');
});

it('offers the hide control on every row, current one included', async () => {
  renderSelect();
  const rows = await screen.findAllByRole('option');
  expect(within(rows[0]).getByTestId('row-hide')).toBeTruthy();
  expect(within(rows[1]).getByTestId('row-hide')).toBeTruthy();
});

it('hides without switching to the session or closing the menu', async () => {
  const hideSession = vi.fn();
  const { onOpenChange } = renderSelect({}, { hideSession });
  const rows = await screen.findAllByRole('option');
  fireEvent.click(within(rows[1]).getByTestId('row-hide'));
  expect(hideSession).toHaveBeenCalledWith('session-b5129c7b');
  expect(fetchMock).not.toHaveBeenCalledWith(
    '/api/teams/session-b5129c7b/select',
    expect.anything(),
  );
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
});

it('drops hidden sessions from the list and from the header count', async () => {
  renderSelect({}, { hidden: new Set(['session-b5129c7b']) });
  const rows = await screen.findAllByRole('option');
  expect(rows.map((r) => r.id)).not.toContain('team-option-session-b5129c7b');
  expect(screen.getByText(/TEAMS ON THIS MACHINE/).textContent).toContain(
    String(rows.length),
  );
});

// Hiding the last row would otherwise be a one-way door: an empty list with no
// control left in it to undo the hiding.
it('keeps a way back in the menu once anything is hidden', async () => {
  const showHidden = vi.fn();
  renderSelect({}, { hidden: new Set(['session-b5129c7b']), showHidden });
  const back = await screen.findByTestId('show-hidden-rows');
  expect(back.textContent).toContain('1 not shown');
  fireEvent.click(back);
  expect(showHidden).toHaveBeenCalled();
});

it('says why the list is empty rather than claiming there are no teams', async () => {
  renderSelect({}, { hidden: new Set(['session-98b0b4a7', 'session-b5129c7b']) });
  expect(
    await screen.findByText('no teams — every session here is a lead on its own'),
  ).toBeTruthy();
});

// Claude Code writes a teams/<session>/config.json for EVERY session, holding
// just that session's own lead, so without this every open window shows up as a
// switchable "session" with no team in it.
it('keeps lead-only sessions out of the list and counts them as not shown', async () => {
  renderSelect({}, {});
  const rows = await screen.findAllByRole('option');
  // Both fixture rows are real teams here, so nothing is filtered yet.
  expect(rows).toHaveLength(2);
});

it('reveals the lead-only rows on demand, without needing them un-hidden', async () => {
  const solo = {
    current: 'session-98b0b4a7',
    teams: sampleTeams().map((t, i) => (i === 1 ? { ...t, state: 'idle' as const, members: 1 } : t)),
  };
  fetchMock = routed(() => Promise.resolve(new Response('{}', { status: 200 })));
  vi.stubGlobal('fetch', vi.fn((path: string) =>
    path === '/api/teams'
      ? Promise.resolve(new Response(JSON.stringify(solo), { status: 200 }))
      : Promise.resolve(new Response('{}', { status: 200 })),
  ));
  renderSelect();

  expect(await screen.findAllByRole('option')).toHaveLength(1);
  const back = screen.getByTestId('show-hidden-rows');
  expect(back.textContent).toContain('1 not shown');
  fireEvent.click(back);
  expect(await screen.findAllByRole('option')).toHaveLength(2);
});

// The picker lists TEAMS. A lead-only session is dropped even when it is the one
// on screen — there is no wall to contradict, because the body is the empty
// state, and the trigger still names where you are.
it('drops a lead-only session even when it is the current one', async () => {
  const solo = {
    current: 'session-98b0b4a7',
    teams: sampleTeams().map((t) => ({ ...t, members: 1, state: 'live' as const })),
  };
  vi.stubGlobal('fetch', vi.fn((path: string) =>
    path === '/api/teams'
      ? Promise.resolve(new Response(JSON.stringify(solo), { status: 200 }))
      : Promise.resolve(new Response('{}', { status: 200 })),
  ));
  renderSelect();

  expect(await screen.findByTestId('show-hidden-rows')).toBeTruthy();
  expect(screen.queryAllByRole('option')).toHaveLength(0);
  expect(screen.getByText('no teams — every session here is a lead on its own')).toBeTruthy();
});

function soloList() {
  const solo = {
    current: 'session-98b0b4a7',
    teams: sampleTeams().map((t) => ({ ...t, members: 1, state: 'live' as const })),
  };
  vi.stubGlobal('fetch', vi.fn((path: string) =>
    path === '/api/teams'
      ? Promise.resolve(new Response(JSON.stringify(solo), { status: 200 }))
      : Promise.resolve(new Response('{}', { status: 200 })),
  ));
}

// Revealing them explains why the console is empty. Switching to one would put
// it right back on a session with no team — the thing being explained.
it('reveals lead-only rows but refuses to switch to them', async () => {
  soloList();
  renderSelect();
  fireEvent.click(await screen.findByTestId('show-hidden-rows'));

  const rows = await screen.findAllByRole('option');
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.getAttribute('aria-disabled') === 'true')).toBe(true);
  expect(within(rows[0]).getByTestId('team-meta').textContent).toContain('no team · not selectable');

  fireEvent.click(rows[1]);
  const posts = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0] as string)
    .filter((p) => p.includes('/select'));
  expect(posts).toEqual([]);
});

it('keeps the keyboard cursor off lead-only rows, so enter cannot land on one', async () => {
  soloList();
  renderSelect();
  fireEvent.click(await screen.findByTestId('show-hidden-rows'));
  await screen.findAllByRole('option');

  const list = screen.getByRole('listbox', { name: 'teams' });
  expect(list.getAttribute('aria-activedescendant')).toBeNull();
  fireEvent.keyDown(list, { key: 'ArrowDown' });
  fireEvent.keyDown(list, { key: 'Enter' });
  const posts = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0] as string)
    .filter((p) => p.includes('/select'));
  expect(posts).toEqual([]);
});

it('counts teams in the header, not revealed lead-only rows', async () => {
  soloList();
  renderSelect();
  fireEvent.click(await screen.findByTestId('show-hidden-rows'));
  await screen.findAllByRole('option');
  expect(screen.getByText('TEAMS ON THIS MACHINE · 0')).toBeTruthy();
});

function listOf(teams: TeamSummary[]) {
  vi.stubGlobal('fetch', vi.fn((path: string) =>
    path === '/api/teams'
      ? Promise.resolve(
          new Response(JSON.stringify({ current: 'session-98b0b4a7', teams }), { status: 200 }),
        )
      : Promise.resolve(new Response('{}', { status: 200 })),
  ));
}

const selectPosts = () =>
  (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0] as string)
    .filter((p) => p.includes('/select'));

// A workflow's agents never enter members[], so the session running one has a
// roster of 1 and is indistinguishable from an empty window on every other
// field. The run is the only thing that says otherwise — and switching to it is
// what puts the console in workflow mode.
it('offers a lead-only session running a workflow as an ordinary row', async () => {
  listOf(
    sampleTeams().map((t) => ({
      ...t,
      members: 1,
      state: 'live' as const,
      workflow: { runId: 'wf_abc123', live: true },
    })),
  );
  renderSelect();

  // Listed without revealing anything: these are not the rows reveal is for.
  const rows = await screen.findAllByRole('option');
  expect(rows).toHaveLength(2);
  expect(rows[0].getAttribute('aria-disabled')).toBeNull();
  expect(within(rows[0]).getByTestId('team-meta').textContent).toContain('workflow · running');
  // No snapshot yet, so the run has no name and its id is what there is.
  expect(within(rows[0]).getByTestId('team-run').textContent).toBe('wf_abc123');

  fireEvent.click(rows[1]);
  expect(selectPosts()).toEqual(['/api/teams/session-b5129c7b/select']);
});

it('names the run and calls it ended once its snapshot has landed', async () => {
  listOf(
    sampleTeams().map((t) => ({
      ...t,
      members: 1,
      state: 'idle' as const,
      workflow: { runId: 'wf_def456', name: 'agents-team-ui-plan', live: false },
    })),
  );
  renderSelect();

  const [row] = await screen.findAllByRole('option');
  expect(within(row).getByTestId('team-run').textContent).toBe('agents-team-ui-plan');
  expect(within(row).getByTestId('team-meta').textContent).toContain('workflow · ended');
});

// The two kinds of lead-only row side by side: the one with a run is somewhere
// to go, the one without is the empty window reveal exists to explain.
it('keeps a lead-only session with no run inert while the one with a run is not', async () => {
  const [team, other] = sampleTeams();
  listOf([
    { ...team, members: 1, state: 'live' as const, workflow: { runId: 'wf_abc123', live: true } },
    { ...other, members: 1, state: 'live' as const },
  ]);
  renderSelect();

  expect(await screen.findAllByRole('option')).toHaveLength(1);
  expect(screen.getByText('TEAMS ON THIS MACHINE · 1')).toBeTruthy();
  fireEvent.click(screen.getByTestId('show-hidden-rows'));

  const rows = await screen.findAllByRole('option');
  expect(rows[0].getAttribute('aria-disabled')).toBeNull();
  expect(rows[1].getAttribute('aria-disabled')).toBe('true');
  expect(within(rows[1]).getByTestId('team-meta').textContent).toContain('no team · not selectable');
});

it('lets the keyboard land on a workflow row', async () => {
  const [team, other] = sampleTeams();
  listOf([
    { ...team, members: 1, state: 'live' as const },
    { ...other, members: 1, state: 'live' as const, workflow: { runId: 'wf_abc123', live: true } },
  ]);
  renderSelect();
  await screen.findAllByRole('option');

  const list = screen.getByRole('listbox', { name: 'teams' });
  expect(list.getAttribute('aria-activedescendant')).toBe('team-option-session-b5129c7b');
  fireEvent.keyDown(list, { key: 'Enter' });
  expect(selectPosts()).toEqual(['/api/teams/session-b5129c7b/select']);
});
