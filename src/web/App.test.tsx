// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Diff } from '../shared/domain';
import { App } from './App';
import { MockEventSource, installMockEventSource } from './test/mockEventSource';
import { sampleTeamState, sampleTeams } from './test/state-fixture';

beforeEach(() => {
  installMockEventSource();
  window.history.replaceState(null, '', '/');
  // Hidden sessions and appearance both persist per browser, so without this a
  // test that hides a session leaves it hidden for every test after it — which
  // shows up as an empty picker several cases later, nowhere near the cause.
  window.localStorage.clear();
});

// This suite renders once per `it`; without explicit cleanup the un-unmounted
// nodes from one test leak into the next and getByRole/getByText start
// matching more than one element.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Counts per-agent renders in the dock: every chip renders exactly one StatusGlyph, and
// in the tasks view the dock is the only thing on screen that renders one at all.
const chip = vi.hoisted(() => ({ renders: 0 }));
vi.mock('./components/StatusGlyph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components/StatusGlyph')>();
  return {
    ...actual,
    StatusGlyph(props: Parameters<typeof actual.StatusGlyph>[0]) {
      chip.renders += 1;
      return <actual.StatusGlyph {...props} />;
    },
  };
});

it('renders the console shell with a body slot', () => {
  render(<App />);
  expect(screen.getByRole('main')).toBeTruthy();
});

it('paints the page behind the console on the theme ground, not just the console', () => {
  render(<App />);
  // Nocturne's --term. An overscroll on a light theme would otherwise flash the
  // stylesheet's dark default from behind the console.
  expect(document.documentElement.style.backgroundColor).toBe('rgb(18, 20, 31)');
});

it('gives every non-token colour an explicit custom-property home', async () => {
  // Aliased so Vite's `new URL('literal', import.meta.url)` static asset-URL
  // rewrite (which resolves against the served origin, not disk) doesn't fire.
  const here = import.meta.url;
  const css = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('./theme.css', here), 'utf8'),
  );
  // Renamed deliberately in the theming pass: the old names (--terminal-ground,
  // --attention, --attention-border, --failure-rose, --row-hairline) were
  // Nocturne literals asserted as fixed hex, which is exactly what six themes
  // break. --row-hairline folded into the ramp, where 900 IS the hairline.
  expect(css).toContain('--term: #12141f;');
  expect(css).toContain('--warn: #d99e5c;');
  expect(css).toContain('--warn-edge: #6b4f2c;');
  expect(css).toContain('--warn-tint: #2b2028;');
  expect(css).toContain('--fail: #c98d8d;');
  expect(css).toContain('--on-accent: #161826;');
  // The JSON palette's two new hues; its other four roles reuse tokens above.
  expect(css).toContain('--json-string: #9ec9a8;');
  expect(css).toContain('--json-boolean: #7fb4d9;');
  // No component may paint from a literal, or a light theme breaks around it.
  expect(css).not.toContain('--terminal-ground');
  expect(css).not.toContain('--attention');
  expect(css).toContain('outline: 2px solid var(--color-accent);');
  expect(css).toContain('outline-offset: 2px;');
});

it('holds every view to the width of the body slot', async () => {
  const here = import.meta.url;
  const css = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('./theme.css', here), 'utf8'),
  );
  // At the default `min-width: auto` a view root cannot shrink below its
  // widest unwrapped line, and the page — not the pane — scrolls sideways.
  expect(css).toMatch(/\.console-body > \*\s*\{\s*min-width: 0;\s*\}/);
  // Bottom-anchoring is scoped to streams; a roster or task list anchored this
  // way opens with dead space above its first row.
  expect(css).toContain('.tscroll.tail > *:first-child {');
  // Y only. Containing both axes swallowed the sideways wheel over a transcript
  // pane, and the panes cover nearly the whole wall — the columns off-screen
  // were then reachable only by the scrollbar itself.
  expect(css).toContain('overscroll-behavior-y: contain;');
  expect(css).not.toMatch(/^\s*overscroll-behavior: contain;/m);
  // The wall's horizontal bar is themed like every pane, not left to the OS.
  expect(css).toMatch(/\.tscroll::-webkit-scrollbar,\s*\n\s*\.hscroll::-webkit-scrollbar\s*\{/);
  expect(css).toContain('height: 9px;');
});

it('mounts status bar, body, needs-you strip and panel once the snapshot lands', () => {
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  expect(screen.getByRole('tablist')).toBeTruthy();
  expect(screen.getByText('session-98b0b4a7')).toBeTruthy();
  expect(screen.getByRole('main')).toBeTruthy();
  expect(screen.getByText('NEEDS YOU · 0')).toBeTruthy();
  expect(screen.getByText('PANEL')).toBeTruthy();
  expect(screen.getAllByTestId('agent-chip')).toHaveLength(4);
});

function expectChromeMounted() {
  expect(screen.getByRole('tablist')).toBeTruthy();
  expect(screen.getByText('NEEDS YOU · 0')).toBeTruthy();
  expect(screen.getByText('PANEL')).toBeTruthy();
  expect(screen.getAllByTestId('agent-chip')).toHaveLength(4);
}

it('wires each view into the body and never unmounts the chrome switching between them', () => {
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  // Chrome elements captured once; the same nodes must persist across every view switch below —
  // only <main>'s contents may swap, per "the chrome never moves between views".
  const tablist = screen.getByRole('tablist');
  const panel = screen.getByText('PANEL');

  // Default view (no ?view= param) is 'wall'.
  expect(screen.getByTestId('wall')).toBeTruthy();
  expect(screen.getAllByTestId('wall-column')).toHaveLength(4);
  expectChromeMounted();
  expect(screen.getByRole('tablist')).toBe(tablist);
  expect(screen.getByText('PANEL')).toBe(panel);

  fireEvent.click(screen.getByRole('tab', { name: 'overview' }));
  expect(screen.getByTestId('overview')).toBeTruthy();
  expect(screen.getAllByTestId('overview-tile')).toHaveLength(4);
  expect(screen.queryByTestId('wall')).toBeNull();
  expectChromeMounted();
  expect(screen.getByRole('tablist')).toBe(tablist);
  expect(screen.getByText('PANEL')).toBe(panel);

  fireEvent.click(screen.getByRole('tab', { name: 'comms' }));
  expect(screen.getByTestId('comms')).toBeTruthy();
  expect(screen.getByTestId('thread-list')).toBeTruthy();
  expect(screen.queryByTestId('overview')).toBeNull();
  expectChromeMounted();
  expect(screen.getByRole('tablist')).toBe(tablist);
  expect(screen.getByText('PANEL')).toBe(panel);

  fireEvent.click(screen.getByRole('tab', { name: 'tasks' }));
  expect(screen.getByTestId('tasks')).toBeTruthy();
  // The task list is the whole view: mailbox traffic moved to the comms view,
  // which shows the same inbox data as a conversation rather than a log.
  expect(screen.queryByTestId('mailbox')).toBeNull();
  expect(screen.queryByTestId('comms')).toBeNull();
  expectChromeMounted();
  expect(screen.getByRole('tablist')).toBe(tablist);
  expect(screen.getByText('PANEL')).toBe(panel);

  fireEvent.click(screen.getByRole('tab', { name: 'rail' }));
  expect(screen.getByTestId('rail-left')).toBeTruthy();
  expect(screen.getByTestId('rail-detail-header')).toBeTruthy();
  expect(screen.queryByTestId('tasks')).toBeNull();
  expectChromeMounted();
  expect(screen.getByRole('tablist')).toBe(tablist);
  expect(screen.getByText('PANEL')).toBe(panel);

  fireEvent.click(screen.getByRole('tab', { name: 'grid' }));
  expect(screen.getByTestId('grid')).toBeTruthy();
  expect(screen.getAllByTestId('grid-pane')).toHaveLength(4);
  expect(screen.queryByTestId('rail-left')).toBeNull();
  expectChromeMounted();
  expect(screen.getByRole('tablist')).toBe(tablist);
  expect(screen.getByText('PANEL')).toBe(panel);
});

it('wires useKeyboard to the store — ⌘2 switches from the wall to overview', () => {
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  expect(screen.getByTestId('wall')).toBeTruthy();
  fireEvent.keyDown(document.body, { key: '2', metaKey: true });
  expect(screen.getByTestId('overview')).toBeTruthy();
  expect(screen.queryByTestId('wall')).toBeNull();
});

it('does not let ⌘2 switch the view while a composer has focus', () => {
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  const composer = screen.getAllByTestId('composer-input')[0];
  composer.focus();
  fireEvent.keyDown(composer, { key: '2', metaKey: true });

  expect(screen.getByTestId('wall')).toBeTruthy();
  expect(screen.queryByTestId('overview')).toBeNull();
});

it('costs the dock no per-agent renders on an identical frame or a clock tick', () => {
  window.history.replaceState(null, '', '/?view=tasks');
  vi.useFakeTimers();
  try {
    render(<App />);
    act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
    expect(screen.getAllByTestId('agent-chip')).toHaveLength(4);

    chip.renders = 0;
    act(() => MockEventSource.last().emit('state', sampleTeamState()));
    expect(chip.renders).toBe(0);

    act(() => vi.advanceTimersByTime(1000));
    expect(chip.renders).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

function stubTeamsFetch() {
  const fetchMock = vi.fn((path: string) =>
    path === '/api/teams'
      ? Promise.resolve(
          new Response(JSON.stringify({ current: 'session-98b0b4a7', teams: sampleTeams() }), {
            status: 200,
          }),
        )
      : Promise.resolve(new Response('{}', { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

it('t opens the team list over any view', async () => {
  stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  expect(screen.queryByRole('listbox', { name: 'teams' })).toBeNull();
  fireEvent.keyDown(document.body, { key: 't' });
  expect(screen.getByRole('listbox', { name: 'teams' })).toBeTruthy();
  await screen.findAllByRole('option');

  fireEvent.keyDown(document.body, { key: 't' });
  expect(screen.queryByRole('listbox', { name: 'teams' })).toBeNull();
});

it('switches to the team the launcher announced, once', () => {
  // The launcher announces a bare /?team= when a console is already running for
  // another team; that is the only case where the URL and the server disagree.
  window.history.replaceState(null, '', '/?team=session-b5129c7b');
  const fetchMock = stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  expect(fetchMock).toHaveBeenCalledWith('/api/teams/session-b5129c7b/select', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

  act(() => MockEventSource.last().emit('state', sampleTeamState()));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('does not switch when the announced team is already the one on screen', () => {
  window.history.replaceState(null, '', '/?team=session-98b0b4a7');
  const fetchMock = stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not switch for a ?team= that came from a reload rather than the launcher', () => {
  // A bookmark or a restored tab replays the URL we wrote, which always has a
  // view. Honouring it would let a background tab yank a console someone else
  // is watching, since the switch is server-global.
  window.history.replaceState(null, '', '/?view=wall&team=session-b5129c7b');
  const fetchMock = stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  expect(fetchMock).not.toHaveBeenCalled();
});

it('opens the comms view straight from the URL and keeps it there', () => {
  window.history.replaceState(null, '', '/?view=comms');
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  expect(screen.getByTestId('comms')).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'comms' }).getAttribute('aria-selected')).toBe('true');
  expect(window.location.search).toContain('view=comms');
});

it('hands the wall the agent whose thread was open — one store, not six screens', () => {
  window.history.replaceState(null, '', '/?view=comms');
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  fireEvent.click(screen.getByTestId('show-in-wall'));

  expect(screen.getByTestId('wall')).toBeTruthy();
  expect(screen.queryByTestId('comms')).toBeNull();
  // The focused agent came from the thread and is now in the URL, so the rail
  // and the panel are looking at the same teammate. With nothing focused the
  // room is what opens, and the room points at whoever spoke last.
  expect(window.location.search).toBe('?view=wall&agent=probe-bravo&team=session-98b0b4a7');
});

it('⌘3 switches to comms', () => {
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  fireEvent.keyDown(document.body, { key: '3', metaKey: true });
  expect(screen.getByTestId('comms')).toBeTruthy();
});

// The stop control. A stop is not a kill: it POSTs a shutdown_request into the
// agent's inbox, which it reads at its next turn boundary and may decline. The
// confirmation exists because that request is hard to take back, and the whole
// flow lives in the shared chrome so every view is served by one of it.
//
// The wall pins the lead leftmost, so the buttons come back in roster order and
// index is a stabler handle than a label three teammates share.
const LEAD = 0;
const ALPHA = 1;
const stopButtons = () => screen.getAllByTestId('stop-button');

it('asks before stopping, and sends nothing until the operator confirms', () => {
  const fetchMock = stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  expect(screen.queryByTestId('stop-confirm')).toBeNull();
  fireEvent.click(stopButtons()[ALPHA]);

  expect(screen.getByTestId('stop-confirm')).toBeTruthy();
  expect(screen.getByTestId('stop-confirm-go').textContent).toBe('stop probe-alpha');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('sends the stop only for the confirmed teammate', () => {
  const fetchMock = stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  fireEvent.click(stopButtons()[ALPHA]);
  fireEvent.click(screen.getByTestId('stop-confirm-go'));

  expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/agents/probe-alpha/stop']);
  expect(screen.queryByTestId('stop-confirm')).toBeNull();
});

it('cancel closes the strip without sending anything', () => {
  const fetchMock = stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  fireEvent.click(stopButtons()[ALPHA]);
  fireEvent.click(screen.getByTestId('stop-confirm-cancel'));

  expect(screen.queryByTestId('stop-confirm')).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

// Teammates run inside the lead's session, so ending it ends them. Each one is
// asked explicitly — an agent that never received a request has no reason to
// wind down, and the strip promises they stop with it.
it('ending the session asks every teammate to stop as well', () => {
  const fetchMock = stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  fireEvent.click(stopButtons()[LEAD]);
  expect(screen.getByTestId('stop-confirm-go').textContent).toBe('end session');
  expect(screen.getByTestId('stop-confirm-why').textContent).toContain('every teammate');
  fireEvent.click(screen.getByTestId('stop-confirm-go'));

  expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
    '/api/agents/probe-alpha/stop',
    '/api/agents/probe-bravo/stop',
    '/api/agents/probe-charlie/stop',
    '/api/agents/team-lead/stop',
  ]);
});

it('x opens the same confirmation rather than stopping outright', () => {
  const fetchMock = stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  // `x` acts on the focused teammate, and nothing is focused until you pick one.
  fireEvent.click(screen.getAllByTestId('wall-column')[ALPHA]);
  fireEvent.keyDown(window, { key: 'x' });

  expect(screen.getByTestId('stop-confirm-go').textContent).toBe('stop probe-alpha');
  expect(fetchMock).not.toHaveBeenCalled();
});

// The row must not claim the agent is stopped: the request is only in its
// inbox until it reaches a turn boundary, and it may refuse.
it('marks the row as requested, not stopped, once the request is sent', () => {
  stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  fireEvent.click(stopButtons()[ALPHA]);
  fireEvent.click(screen.getByTestId('stop-confirm-go'));

  expect(stopButtons()[ALPHA].getAttribute('aria-label')).toBe(
    'stop requested — it stops at its next turn boundary',
  );
  expect(screen.queryByText('stopped by you')).toBeNull();
});

it('a read-only console shows the control but will not arm it', () => {
  const fetchMock = stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', { ...sampleTeamState(), readOnly: true }));

  const button = stopButtons()[ALPHA] as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(screen.queryByTestId('stop-confirm')).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

// The diff modal reads the store's openDiff, which any view's TranscriptFeed
// can set — proof the App-level wiring (DiffContext.Provider + the mount
// point) actually connects a click on a real row to the shared store.
it('opens a diff-bearing row into the modal, from the same store every view shares', () => {
  const diff: Diff = {
    path: 'src/web/state/useTeamState.ts',
    added: 14,
    removed: 2,
    agent: 'probe-alpha',
    ts: Date.parse('2026-08-27T14:22:08.000Z'),
    commit: '9be5ee0',
    hunks: [],
  };
  const withDiff = {
    ...sampleTeamState(),
    agents: sampleTeamState().agents.map((a) =>
      a.name === 'probe-alpha'
        ? { ...a, transcript: [...a.transcript, { id: 'edit#0', marker: '⎿' as const, text: 'Update(x)', ts: 1, diff }] }
        : a,
    ),
  };
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', withDiff));

  expect(screen.queryByTestId('diff-modal')).toBeNull();
  fireEvent.click(screen.getByTestId('diff-chip'));

  expect(screen.getByTestId('diff-path').textContent).toBe(diff.path);
  fireEvent.click(screen.getByTestId('diff-close'));
  expect(screen.queryByTestId('diff-modal')).toBeNull();
});

// "Stop watching" vs "end session": the team keeps running either way unless
// the operator explicitly ends it — this section is about the console merely
// looking away, and never claiming the session ended while it does.
async function openAndStopWatching() {
  fireEvent.keyDown(document.body, { key: 't' });
  const rows = await screen.findAllByRole('option');
  fireEvent.click(within(rows[0]).getByTestId('row-stop-watching'));
  fireEvent.click(screen.getByTestId('watch-confirm-go'));
}

it('empties the body into the left-session screen and dashes the picker', async () => {
  stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  expect(screen.queryByTestId('left-session-heading')).toBeNull();
  await openAndStopWatching();

  expect(screen.getByTestId('left-session-heading').textContent).toBe(
    `You stopped watching ${sampleTeamState().teamName}.`,
  );
  expect(screen.queryByTestId('wall')).toBeNull();
  expect(screen.getByTestId('team-trigger-name').textContent).toBe('no session selected');
});

it('cancelling the stop-watching confirmation leaves the wall exactly as it was', async () => {
  stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  fireEvent.keyDown(document.body, { key: 't' });
  const rows = await screen.findAllByRole('option');
  fireEvent.click(within(rows[0]).getByTestId('row-stop-watching'));
  fireEvent.click(screen.getByTestId('watch-confirm-cancel'));

  expect(screen.queryByTestId('watch-confirm')).toBeNull();
  expect(screen.queryByTestId('left-session-heading')).toBeNull();
  expect(screen.getByTestId('team-trigger-name').textContent).toBe(sampleTeamState().teamName);
});

it('watch again returns to the normal view', async () => {
  stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  await openAndStopWatching();

  fireEvent.click(screen.getByTestId('watch-again'));

  expect(screen.queryByTestId('left-session-heading')).toBeNull();
  expect(screen.getByTestId('wall')).toBeTruthy();
  expect(screen.getByTestId('team-trigger-name').textContent).toBe(sampleTeamState().teamName);
});

it('end it for real, from the left-session screen, reuses the existing destructive session-end flow', async () => {
  const fetchMock = stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  await openAndStopWatching();

  fireEvent.click(screen.getByTestId('end-for-real'));
  expect(screen.getByTestId('stop-confirm-go').textContent).toBe('end session');

  fireEvent.click(screen.getByTestId('stop-confirm-go'));
  const stopCalls = fetchMock.mock.calls.map((c) => c[0] as string).filter((p) => p.includes('/stop'));
  expect(stopCalls.sort()).toEqual([
    '/api/agents/probe-alpha/stop',
    '/api/agents/probe-bravo/stop',
    '/api/agents/probe-charlie/stop',
    '/api/agents/team-lead/stop',
  ]);
});

it('clears the dismissal automatically once the console actually switches teams', async () => {
  stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  await openAndStopWatching();
  expect(screen.getByTestId('left-session-heading')).toBeTruthy();

  act(() => MockEventSource.last().emit('snapshot', { ...sampleTeamState(), teamName: 'session-b5129c7b' }));

  expect(screen.queryByTestId('left-session-heading')).toBeNull();
  expect(screen.getByTestId('wall')).toBeTruthy();
});

it('lists the other live sessions on the machine and switches to one on click', async () => {
  const fetchMock = vi.fn((path: string) =>
    path === '/api/teams'
      ? Promise.resolve(
          new Response(
            JSON.stringify({
              current: 'session-98b0b4a7',
              teams: [
                sampleTeams()[0],
                // A real team: the ELSEWHERE list offers only what the picker
                // would let you switch to, and a lead-only session is not that.
                { ...sampleTeams()[1], members: 3, state: 'idle' as const, current: false },
              ],
            }),
            { status: 200 },
          ),
        )
      : Promise.resolve(new Response('{}', { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  await openAndStopWatching();

  const elsewhereRow = await screen.findByTestId('left-session-elsewhere-row');
  expect(elsewhereRow.textContent).toContain('session-b5129c7b');
  fireEvent.click(elsewhereRow);

  expect(fetchMock).toHaveBeenLastCalledWith('/api/teams/session-b5129c7b/select', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
});

// Workflow mode replaces the whole shell, not the body: `RUN` in place of
// `TEAM`, and none of the team chrome — no roster, no needs-you, no composer.
it('draws workflow mode instead of the team shell when the frame says so', () => {
  render(<App />);
  act(() =>
    MockEventSource.last().emit('snapshot', {
      ...sampleTeamState(),
      agents: [],
      mode: 'workflow',
      workflows: [
        {
          runId: 'wf_d36b25c0-f96',
          name: 'team-selector',
          status: 'completed',
          live: false,
          startedAt: 1_000_000,
          durationMs: 60_000,
          logs: [],
          phases: [{ index: 1, title: 'Build' }],
          agents: [{ agentId: 'a1', label: 'impl:task-9', phaseIndex: 1, state: 'done' }],
        },
      ],
    }),
  );

  expect(screen.getByTestId('bar-wordmark').textContent).toBe('RUN');
  expect(screen.getByTestId('workflow-run')).toBeTruthy();
  expect(screen.queryByText('NEEDS YOU · 0')).toBeNull();
  // The shell is the shared one, so the way out of a run and the way to the
  // theme are both still on screen.
  expect(screen.getByTestId('team-trigger')).toBeTruthy();
  expect(screen.getByTestId('config-trigger')).toBeTruthy();
});

// A roster always wins, so nothing about workflow mode can regress team mode.
it('stays in the team shell when a roster exists, runs or not', () => {
  render(<App />);
  act(() =>
    MockEventSource.last().emit('snapshot', { ...sampleTeamState(), mode: 'team', workflows: [] }),
  );

  expect(screen.getByTestId('bar-wordmark').textContent).toBe('TEAM');
  expect(screen.getByText('NEEDS YOU · 0')).toBeTruthy();
});

const RUNS = [
  {
    runId: 'wf_newer',
    name: 'team-selector',
    status: 'completed' as const,
    live: false,
    startedAt: 1_000_000,
    durationMs: 60_000,
    logs: [],
    phases: [{ index: 1, title: 'Build' }],
    agents: [{ agentId: 'a1', label: 'impl:task-9', phaseIndex: 1, state: 'done' as const }],
  },
  {
    runId: 'wf_older',
    name: 'first-pass',
    status: 'failed' as const,
    live: false,
    startedAt: 500_000,
    durationMs: 30_000,
    logs: [],
    phases: [],
    agents: [],
  },
];

// modeOf gives a team the mode whenever there is one, so a workflow launched
// beside a live team was ingested and held on the frame and never drawable. The
// selection is the client's override of that.
it('draws the run named in the URL even when the frame says team', () => {
  window.history.replaceState(null, '', '/?view=wall&run=wf_older');
  render(<App />);
  act(() =>
    MockEventSource.last().emit('snapshot', {
      ...sampleTeamState(),
      mode: 'team',
      workflows: RUNS,
    }),
  );

  expect(screen.getByTestId('bar-wordmark').textContent).toBe('RUN');
  expect(screen.getByTestId('wf-identity').textContent).toContain('first-pass');
});

it('goes back to the team the run was running beside', () => {
  window.history.replaceState(null, '', '/?view=wall&run=wf_older');
  render(<App />);
  act(() =>
    MockEventSource.last().emit('snapshot', {
      ...sampleTeamState(),
      mode: 'team',
      workflows: RUNS,
    }),
  );

  fireEvent.click(screen.getByTestId('run-trigger'));
  fireEvent.click(screen.getByTestId('run-back-to-team'));
  expect(screen.getByTestId('bar-wordmark').textContent).toBe('TEAM');
  expect(window.location.search).not.toContain('run=');
});

it('opens the newest run from the team bar, and switches runs from the run bar', () => {
  render(<App />);
  act(() =>
    MockEventSource.last().emit('snapshot', {
      ...sampleTeamState(),
      mode: 'team',
      workflows: RUNS,
    }),
  );

  fireEvent.click(screen.getByTestId('runs-chip'));
  expect(screen.getByTestId('wf-identity').textContent).toContain('team-selector');

  fireEvent.click(screen.getByTestId('run-trigger'));
  fireEvent.click(screen.getAllByTestId('run-option')[1]);
  expect(screen.getByTestId('wf-identity').textContent).toContain('first-pass');
  expect(window.location.search).toContain('run=wf_older');
});

async function openAndHideCurrent() {
  fireEvent.keyDown(document.body, { key: 't' });
  const rows = await screen.findAllByRole('option');
  fireEvent.click(within(rows[0]).getByTestId('row-hide'));
}

it('empties the body into the no-sessions screen once the session on screen is hidden', async () => {
  stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  expect(screen.queryByTestId('no-sessions')).toBeNull();
  await openAndHideCurrent();
  expect(screen.getByTestId('no-sessions')).toBeTruthy();
  // Chrome stays: hiding empties the body, it does not tear the console down.
  expect(screen.getByTestId('team-trigger')).toBeTruthy();
});

// The whole point of the control is that it never touches the engine.
it('hiding writes nothing to the server', async () => {
  const fetchMock = stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  await openAndHideCurrent();

  // Reading the listing is the only traffic hiding may cause. Anything else —
  // a select, a stop — would mean it had reached into the engine.
  const paths = fetchMock.mock.calls.map((c) => c[0] as string);
  expect([...new Set(paths)]).toEqual(['/api/teams']);
});

it('offers the way back on the empty screen and restores the session', async () => {
  stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  await openAndHideCurrent();

  fireEvent.click(screen.getByTestId('show-hidden'));
  expect(screen.queryByTestId('no-sessions')).toBeNull();
  expect(screen.getByTestId('wall')).toBeTruthy();
});

it('remembers hidden sessions across a reload, per browser', async () => {
  stubTeamsFetch();
  const first = render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  await openAndHideCurrent();
  first.unmount();

  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  expect(screen.getByTestId('no-sessions')).toBeTruthy();
});

/** current + one real team, one lead-only session, one finished team. */
function stubMixedFetch() {
  const [current, other] = sampleTeams();
  const teams = [
    current,
    { ...other, name: 'session-real0002', members: 3, state: 'live' as const, live: true },
    { ...other, name: 'session-solo0003', members: 1, state: 'live' as const, live: true },
    { ...other, name: 'session-done0004', members: 3, state: 'done' as const, live: false },
  ];
  const fetchMock = vi.fn((path: string) =>
    path === '/api/teams'
      ? Promise.resolve(
          new Response(JSON.stringify({ current: 'session-98b0b4a7', teams }), { status: 200 }),
        )
      : Promise.resolve(new Response('{}', { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// The reveal used to live inside the picker, so this screen could only count
// the ✕-hidden rows — and hiding the last one was a one-way door.
it('counts the lead-only sessions the picker drops as well as the hidden one', async () => {
  stubTeamsFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  await openAndHideCurrent();

  // The session just hidden, plus the lead-only one the picker never offers.
  expect(await screen.findByText('2 not shown')).toBeTruthy();
});

// One filter, or the two screens contradict each other: hidden and lead-only
// sessions were one-click destinations on one and absent on the other.
it('offers the same sessions on both empty screens — no hidden, no lead-only', async () => {
  stubMixedFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  await openAndStopWatching();

  const rows = await screen.findAllByTestId('left-session-elsewhere-row');
  const named = rows.map((r) => r.textContent ?? '');
  expect(named.some((t) => t.includes('session-solo0003'))).toBe(false);
  expect(named.some((t) => t.includes('session-real0002'))).toBe(true);
});

// Paging back into a session that has finished is what the picker is for, so
// the screens that list sessions must not quietly drop the finished ones.
it('keeps a finished session in the list you can page back into', async () => {
  stubMixedFetch();
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  await openAndStopWatching();

  const rows = await screen.findAllByTestId('left-session-elsewhere-row');
  expect(rows.map((r) => r.textContent ?? '').some((t) => t.includes('session-done0004'))).toBe(
    true,
  );
});
