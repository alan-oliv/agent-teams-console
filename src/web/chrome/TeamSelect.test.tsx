// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FIXTURE_NOW, sampleTeams } from '../test/state-fixture';
import { TeamSelect } from './TeamSelect';

// This suite renders once per `it`; without explicit cleanup the un-unmounted
// nodes from one test leak into the next and getByRole/getByText start
// matching more than one element.
afterEach(cleanup);

const LIST = { current: 'session-98b0b4a7', teams: sampleTeams() };

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

function renderSelect(props: Partial<Parameters<typeof TeamSelect>[0]> = {}) {
  const onOpenChange = vi.fn();
  const all = { current: 'session-98b0b4a7', open: true, onOpenChange, now: FIXTURE_NOW, ...props };
  const view = render(<TeamSelect {...all} />);
  const rerender = (next: Partial<typeof all> = {}) =>
    view.rerender(<TeamSelect {...all} {...next} />);
  return { onOpenChange, rerender };
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

it('heads the list with the team count and the switch hint', async () => {
  renderSelect();
  expect(await screen.findByText('TEAMS · 2')).toBeTruthy();
  expect(screen.getByText('click to switch')).toBeTruthy();
  expect(screen.getByText('↑↓ select · ⏎ switch · esc close')).toBeTruthy();
});

it('says live for a running team and how long ago a finished one stopped', async () => {
  renderSelect();
  const rows = await screen.findAllByRole('option');
  expect(rows.map((r) => within(r).getByTestId('team-meta').textContent)).toEqual([
    'live · 4 members',
    'finished · 1 member · 4h 12m ago',
  ]);
});

it('marks the team the console is actually showing', async () => {
  renderSelect();
  const rows = await screen.findAllByRole('option');
  expect(rows[0].getAttribute('aria-selected')).toBe('true');
  expect(rows[0].style.borderLeft).toBe('2px solid var(--color-accent-600)');
  expect(within(rows[0]).getByTestId('team-mark').textContent).toBe('current');
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
  expect(await screen.findByText('no teams found')).toBeTruthy();
});

it('says so when the listing cannot be read', async () => {
  fetchMock.mockRejectedValue(new Error('offline'));
  renderSelect();
  const line = await screen.findByText('could not read teams');
  expect(line.style.color).toBe('var(--failure-rose)');
});

it('marks the row when the switch is refused', async () => {
  vi.stubGlobal('fetch', routed(() => Promise.resolve(new Response('{}', { status: 500 }))));
  const { onOpenChange } = renderSelect();
  const rows = await screen.findAllByRole('option');
  fireEvent.click(rows[1]);

  const mark = await within(rows[1]).findByText('switch failed');
  expect(mark.style.color).toBe('var(--failure-rose)');
  expect(onOpenChange).not.toHaveBeenCalled();
});

it('marks the row gone when the team vanished before the click', async () => {
  vi.stubGlobal('fetch', routed(() => Promise.resolve(new Response('{}', { status: 404 }))));
  renderSelect();
  const rows = await screen.findAllByRole('option');
  fireEvent.click(rows[1]);

  const mark = await within(rows[1]).findByText('gone');
  expect(mark.style.color).toBe('var(--failure-rose)');
});
