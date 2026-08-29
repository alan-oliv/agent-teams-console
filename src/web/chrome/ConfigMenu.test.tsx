// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { MockEventSource, installMockEventSource } from '../test/mockEventSource';
import { sampleTeamState } from '../test/state-fixture';
import { SETTINGS_KEY, SettingsContext, DEFAULT_SETTINGS, type Settings } from '../state/useSettings';
import { THEMES } from '../themes';
import { TranscriptFeed } from '../components/TranscriptFeed';
import type { TranscriptLine } from '../../shared/domain';

beforeEach(() => {
  installMockEventSource();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The whole console, so every assertion below is about the real render. */
function mount(view = 'wall') {
  window.history.replaceState(null, '', `/?view=${view}`);
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  return document.querySelector('.console') as HTMLElement;
}

const open = () => fireEvent.click(screen.getByTestId('config-trigger'));

describe('the config popover', () => {
  it('opens from the gear and closes again', () => {
    mount();
    expect(screen.queryByTestId('config-menu')).toBeNull();
    expect(screen.getByTestId('config-trigger').textContent).toBe('⚙');

    open();
    const menu = screen.getByTestId('config-menu');
    expect(menu.style.width).toBe('302px');
    expect(menu.style.background).toBe('var(--color-bg)');
    expect(menu.style.border).toBe('1px solid var(--color-neutral-800)');
    // Right-aligned under the button, which is the far right of the bar.
    expect(menu.style.right).toBe('0px');
    expect(screen.getByTestId('config-trigger').textContent).toBe('✕');

    open();
    expect(screen.queryByTestId('config-menu')).toBeNull();
  });

  it('offers all six themes, each previewing itself', () => {
    mount();
    open();
    for (const id of ['nocturne', 'organic', 'ember', 'frost', 'slate', 'phosphor'] as const) {
      const tile = screen.getByTestId(`theme-${id}`);
      expect(tile.title).toBe(THEMES[id].note);
      // Ground / accent / text, painted in the theme's OWN colours so the
      // choice is visible before it is applied.
      const stripes = [...tile.querySelectorAll('span > span')] as HTMLElement[];
      // jsdom normalises a hex background to rgb(), so compare through the DOM.
      const asRendered = (hex: string) => {
        const probe = document.createElement('span');
        probe.style.background = hex;
        return probe.style.background;
      };
      expect(stripes[0].style.background).toBe(asRendered(THEMES[id].term));
      expect(stripes[1].style.background).toBe(asRendered(THEMES[id].accents.a.steps[0]));
      expect(stripes[2].style.background).toBe(asRendered(THEMES[id].text));
    }
  });

  it('names the four accents by the picked theme own names', () => {
    mount();
    open();
    expect(screen.getByTestId('scheme-a').getAttribute('aria-label')).toBe('blurple');
    fireEvent.click(screen.getByTestId('theme-organic'));
    expect(screen.getByTestId('scheme-a').getAttribute('aria-label')).toBe('moss');
    expect(screen.getByTestId('scheme-c').getAttribute('aria-label')).toBe('clay');
  });

  it('says where the settings live', () => {
    mount();
    open();
    expect(screen.getByText('saved per machine, not per session')).toBeTruthy();
  });
});

// The acceptance bar: a decorative settings panel is worse than none, so every
// control is asserted against what it does to the DOM, not to the store.
describe('every control changes the render', () => {
  it('theme repaints the console root', () => {
    const console_ = mount();
    expect(console_.style.getPropertyValue('--term')).toBe(THEMES.nocturne.term);

    open();
    fireEvent.click(screen.getByTestId('theme-organic'));
    expect(console_.style.getPropertyValue('--term')).toBe(THEMES.organic.term);
    expect(console_.style.getPropertyValue('--color-text')).toBe(THEMES.organic.text);
    // The light theme's ramp runs the other way, which is the whole trick.
    expect(console_.style.getPropertyValue('--color-neutral-900')).toBe(THEMES.organic.n[7]);
  });

  it('accent scheme swaps the accent and leaves the ground alone', () => {
    const console_ = mount();
    open();
    const ground = console_.style.getPropertyValue('--term');
    fireEvent.click(screen.getByTestId('scheme-b'));
    expect(console_.style.getPropertyValue('--color-accent')).toBe(
      THEMES.nocturne.accents.b.steps[0],
    );
    expect(console_.style.getPropertyValue('--term')).toBe(ground);
  });

  it('line density changes the transcript gap', () => {
    mount();
    const feed = () => screen.getAllByTestId('transcript-feed')[0];
    expect(feed().style.gap).toBe('10px');

    open();
    fireEvent.click(screen.getByTestId('density-compact'));
    expect(feed().style.gap).toBe('5px');
    fireEvent.click(screen.getByTestId('density-roomy'));
    expect(feed().style.gap).toBe('16px');
  });

  // The fixture team carries no transcript, so these two drive the feed itself
  // through the same context the popover writes to.
  const LINES: TranscriptLine[] = [
    { id: 'a', marker: '\u276f', text: 'first', ts: 1 },
    { id: 'b', marker: '\u23fa', text: 'second', ts: 2 },
    { id: 'c', marker: '\u23fa', text: '{"ok":true,"n":2}', ts: 3 },
  ];
  const feedWith = (over: Partial<Settings>) =>
    render(
      <SettingsContext.Provider value={{ ...DEFAULT_SETTINGS, ...over }}>
        <TranscriptFeed lines={LINES} size="wall" />
      </SettingsContext.Provider>,
    );

  it('fade flattens the opacity ladder', () => {
    feedWith({ fade: true });
    const laddered = screen.getAllByTestId('transcript-row').map((r) => r.style.opacity);
    expect(laddered.some((o) => o !== '' && o !== '1')).toBe(true);
    cleanup();

    feedWith({ fade: false });
    const flat = screen.getAllByTestId('transcript-row').map((r) => r.style.opacity);
    expect(flat.every((o) => o === '' || o === '1')).toBe(true);
  });

  it('portraits removes the faces entirely, not just their colour', () => {
    mount();
    expect(screen.getAllByTestId('portrait').length).toBeGreaterThan(0);
    open();
    fireEvent.click(screen.getByTestId('toggle-avatars'));
    expect(screen.queryAllByTestId('portrait')).toHaveLength(0);
  });

  it('motion marks the root, which is what kills the blink and the dots', () => {
    const console_ = mount();
    expect(console_.dataset.motion).toBe('on');
    open();
    fireEvent.click(screen.getByTestId('toggle-motion'));
    expect(console_.dataset.motion).toBe('off');
  });

  it('JSON line numbers hides the gutter in an expanded payload', () => {
    feedWith({ numbers: true });
    fireEvent.click(screen.getByTestId('transcript-more'));
    expect(screen.getAllByTestId('json-gutter').length).toBeGreaterThan(0);
    // The body keeps its own padding once the gutter that supplied it is gone.
    expect(screen.getAllByTestId('json-line')[0].style.padding).toBe('0px 11px 0px 0px');
    cleanup();

    feedWith({ numbers: false });
    fireEvent.click(screen.getByTestId('transcript-more'));
    expect(screen.queryAllByTestId('json-gutter')).toHaveLength(0);
    expect(screen.getAllByTestId('json-line')[0].style.padding).toBe('0px 11px');
  });
});

describe('persistence', () => {
  it('writes the choice to localStorage under the machine-wide key', () => {
    mount();
    open();
    fireEvent.click(screen.getByTestId('theme-ember'));
    fireEvent.click(screen.getByTestId('density-roomy'));
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!);
    expect(stored.theme).toBe('ember');
    expect(stored.density).toBe('roomy');
  });

  it('opens on the stored theme rather than the default', () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'phosphor' }));
    const console_ = mount();
    expect(console_.style.getPropertyValue('--term')).toBe(THEMES.phosphor.term);
  });

  it('reset puts everything back and clears the render with it', () => {
    const console_ = mount();
    open();
    fireEvent.click(screen.getByTestId('theme-frost'));
    fireEvent.click(screen.getByTestId('toggle-avatars'));
    expect(screen.queryAllByTestId('portrait')).toHaveLength(0);

    fireEvent.click(screen.getByTestId('config-reset'));
    expect(console_.style.getPropertyValue('--term')).toBe(THEMES.nocturne.term);
    expect(screen.getAllByTestId('portrait').length).toBeGreaterThan(0);
  });

  it('survives a store that throws on read', () => {
    const boom = () => {
      throw new Error('blocked origin');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, clear: () => {} });
    const console_ = mount();
    expect(console_.style.getPropertyValue('--term')).toBe(THEMES.nocturne.term);
  });
});

describe('the gear is chrome, not a metric', () => {
  it('sits in the bar as an unshrinkable child', () => {
    mount();
    const bar = screen.getByText('TEAM').parentElement!;
    const wrapper = screen.getByTestId('config-trigger').parentElement!;
    expect(wrapper.parentElement).toBe(bar);
    expect(wrapper.style.flex).toBe('0 0 auto');
  });

  it('is reachable in every view', () => {
    for (const view of ['wall', 'overview', 'comms', 'tasks', 'rail', 'grid']) {
      mount(view);
      expect(screen.getByTestId('config-trigger'), view).toBeTruthy();
      cleanup();
    }
  });
});
