// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { MockEventSource, installMockEventSource } from './test/mockEventSource';
import { sampleTeamState, sampleTeams } from './test/state-fixture';

beforeEach(() => {
  installMockEventSource();
  window.history.replaceState(null, '', '/');
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
