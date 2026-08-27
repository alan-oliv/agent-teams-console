// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { MockEventSource, installMockEventSource } from './test/mockEventSource';
import { sampleTeamState } from './test/state-fixture';

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

it('renders the console shell with a body slot', () => {
  render(<App />);
  expect(screen.getByRole('main')).toBeTruthy();
});

it('paints the root on the terminal ground #12141f', () => {
  render(<App />);
  expect(getComputedStyle(document.documentElement).backgroundColor).toBe('rgb(18, 20, 31)');
});

it('gives the five non-token colours explicit custom-property homes', async () => {
  // Aliased so Vite's `new URL('literal', import.meta.url)` static asset-URL
  // rewrite (which resolves against the served origin, not disk) doesn't fire.
  const here = import.meta.url;
  const css = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('./theme.css', here), 'utf8'),
  );
  expect(css).toContain('--terminal-ground: #12141f;');
  expect(css).toContain('--row-hairline: #1b1d2b;');
  expect(css).toContain('--attention: #d99e5c;');
  expect(css).toContain('--attention-border: #6b4f2c;');
  expect(css).toContain('--failure-rose: #c98d8d;');
  expect(css).toContain('outline: 2px solid var(--color-accent);');
  expect(css).toContain('outline-offset: 2px;');
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

  fireEvent.click(screen.getByRole('tab', { name: 'tasks' }));
  expect(screen.getByTestId('tasks')).toBeTruthy();
  expect(screen.getByTestId('mailbox')).toBeTruthy();
  expect(screen.queryByTestId('overview')).toBeNull();
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
