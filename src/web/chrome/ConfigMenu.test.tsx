// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { MockEventSource, installMockEventSource } from '../test/mockEventSource';
import { sampleTeamState } from '../test/state-fixture';
import { SETTINGS_KEY, SettingsContext, DEFAULT_SETTINGS, type Settings } from '../state/useSettings';
import { themeFor } from '../../shared/cast';
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

/** Both pickers are dropdowns now: a closed row, then the menu it opens. */
const pickTheme = (id: string) => {
  fireEvent.click(screen.getByTestId('theme-trigger'));
  fireEvent.click(screen.getByTestId(`theme-${id}`));
};
const pickMovie = (key: string) => {
  fireEvent.click(screen.getByTestId('theme-trigger'));
  fireEvent.click(screen.getByTestId(`theme-film-${key}`));
};

// jsdom normalises a hex background to rgb(), so compare through the DOM.
const asRendered = (hex: string) => {
  const probe = document.createElement('span');
  probe.style.background = hex;
  return probe.style.background;
};
const bandsOf = (row: HTMLElement) =>
  ([...row.querySelectorAll('span > span')] as HTMLElement[]).map((b) => b.style.background);

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

  it('shows the theme as a closed row carrying its own swatch', () => {
    mount();
    open();
    expect(screen.queryByTestId('theme-menu')).toBeNull();
    const row = screen.getByTestId('theme-trigger');
    expect(row.textContent).toContain(THEMES.nocturne.label);
    // Ground / accent / text, painted in the theme's OWN colours so the
    // choice is visible before it is applied.
    expect(bandsOf(row)).toEqual([
      asRendered(THEMES.nocturne.term),
      asRendered(THEMES.nocturne.accents.a.steps[0]),
      asRendered(THEMES.nocturne.text),
    ]);
  });

  it('offers all six themes in the menu, each previewing itself', () => {
    mount();
    open();
    fireEvent.click(screen.getByTestId('theme-trigger'));
    for (const id of ['nocturne', 'organic', 'ember', 'frost', 'slate', 'phosphor'] as const) {
      const option = screen.getByTestId(`theme-${id}`);
      expect(option.title).toBe(THEMES[id].note);
      expect(bandsOf(option)).toEqual([
        asRendered(THEMES[id].term),
        asRendered(THEMES[id].accents.a.steps[0]),
        asRendered(THEMES[id].text),
      ]);
    }
  });

  it('offers the ten films inside the theme menu, each named by its lead', () => {
    mount();
    open();
    fireEvent.click(screen.getByTestId('theme-trigger'));
    const menu = screen.getByTestId('theme-menu');
    // No "off" row any more: a SYSTEM row is what real agent names look like.
    expect(menu.querySelectorAll('[data-testid^="theme-film-"]')).toHaveLength(10);
    const inception = screen.getByTestId('theme-film-inception');
    expect(inception.textContent).toContain('Inception');
    expect(inception.textContent).toContain('Cobb');
  });

  it('keeps the list off the panel height: the menu is absolutely positioned', () => {
    // An inline list once grew the panel to 859px inside a 716px console, and
    // the merge made the list longer, not shorter.
    mount();
    open();
    fireEvent.click(screen.getByTestId('theme-trigger'));
    const menu = screen.getByTestId('theme-menu');
    expect(menu.style.position).toBe('absolute');
    expect(menu.style.top).toBe('calc(100% + 4px)');
    expect(menu.style.maxHeight).toBe('186px');
    fireEvent.click(screen.getByTestId('theme-trigger'));
    expect(screen.queryByTestId('theme-menu')).toBeNull();
  });

  // The inline list had grown the panel past the console it hangs in, and a
  // percentage cap resolves against a positioned wrapper of no height — 1px.
  it('bounds the panel in px, never as a percentage', () => {
    mount();
    open();
    const menu = screen.getByTestId('config-menu');
    expect(menu.style.maxHeight).toBe('600px');
    expect(menu.style.height).not.toContain('%');
  });

  it('states the reach under the dropdown, which is names only by default', () => {
    mount();
    open();
    expect(screen.getByTestId('theme-note').textContent).toBe('Agents keep their real names.');
  });

  it('carries one appearance list, and it is labelled theme', () => {
    mount();
    open();
    const labels = [...screen.getByTestId('config-menu').querySelectorAll('span')]
      .map((s) => s.textContent)
      .filter((t) => t === 'movie theme' || t === 'theme');
    expect(labels).toEqual(['theme']);
  });

  it('names the four accents by the picked theme own names', () => {
    mount();
    open();
    expect(screen.getByTestId('scheme-a').getAttribute('aria-label')).toBe('blurple');
    pickTheme('organic');
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
    pickTheme('organic');
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

  // The one mapping, seen end to end: the setting reaches the views through the
  // cast context, and stops at the names.
  it('movie theme recasts the wall, and leaves the type badge alone', () => {
    mount();
    expect(screen.getAllByTestId('wall-name')[0].textContent).toBe('team-lead');

    open();
    pickMovie('inception');
    expect(screen.getAllByTestId('wall-name')[0].textContent).toBe('Cobb');
    expect(screen.getAllByTestId('wall-type')[0].textContent).toBe('team-lead');

    // The panel stays open through a pick, so going back to real names is one
    // more pick — of a SYSTEM row — not a reopen.
    pickSystem('nocturne');
    expect(screen.getAllByTestId('wall-name')[0].textContent).toBe('team-lead');
  });

  // A character has to survive TIME as well as the view switch. The cast is
  // seeded from the roster's JOIN order, which is append-only: seeding it from
  // the wall's order instead would re-sort on status, and one teammate leaving
  // would deal every spare-drawn character one seat along.
  it('does not recast the team when a teammate departs', () => {
    mount();
    open();
    pickMovie('inception');

    const shownFor = (name: string) =>
      within(document.querySelector(`[data-agent="${name}"]`) as HTMLElement)
        .getByTestId('wall-name').textContent;
    const before = ['team-lead', 'probe-alpha', 'probe-bravo', 'probe-charlie'].map(shownFor);
    expect(before).toEqual(['Cobb', 'Saito', 'Mal', 'Miles']);

    const departed = sampleTeamState();
    departed.agents = departed.agents.map((a) =>
      a.name === 'probe-alpha' ? { ...a, status: 'departed' as const } : a,
    );
    act(() => MockEventSource.last().emit('snapshot', departed));

    expect(['team-lead', 'probe-alpha', 'probe-bravo', 'probe-charlie'].map(shownFor)).toEqual(
      before,
    );
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
    pickTheme('ember');
    fireEvent.click(screen.getByTestId('density-roomy'));
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!);
    expect(stored.theme).toBe('ember');
    expect(stored.density).toBe('roomy');
  });

  it('reads the system default until a film is picked, then the film', () => {
    mount();
    open();
    expect(screen.getByTestId('theme-trigger').textContent).toContain('System default');

    pickMovie('lotr');
    expect(screen.queryByTestId('theme-menu')).toBeNull();
    expect(screen.getByTestId('theme-trigger').textContent).toContain('The Lord of the Rings');
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!).movieTheme).toBe('lotr');

    pickSystem('nocturne');
    expect(screen.getByTestId('theme-trigger').textContent).toContain('System default · Nocturne');
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!).movieTheme).toBeNull();
  });

  it('opens on the stored theme rather than the default', () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'phosphor' }));
    const console_ = mount();
    expect(console_.style.getPropertyValue('--term')).toBe(THEMES.phosphor.term);
  });

  it('reset puts everything back and clears the render with it', () => {
    const console_ = mount();
    open();
    pickTheme('frost');
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

// Rev 4b: there is no separate movie picker. Films are entries in the one theme
// dropdown, because two lists that both change the console's appearance is one
// list. These replace the movie-picker suite above.
const openTheme = () => fireEvent.click(screen.getByTestId('theme-trigger'));
const pickFilm = (key: string) => {
  openTheme();
  fireEvent.click(screen.getByTestId(`theme-film-${key}`));
};
const pickSystem = (id: string) => {
  openTheme();
  fireEvent.click(screen.getByTestId(`theme-${id}`));
};

describe('one dropdown, system themes and films together', () => {
  it('has no separate movie picker at all', () => {
    mount();
    open();
    expect(screen.queryByTestId('movie-trigger')).toBeNull();
    expect(screen.queryByTestId('movie-menu')).toBeNull();
  });

  it('shows the system default and its name on the closed row', () => {
    mount();
    open();
    expect(screen.getByTestId('theme-trigger').textContent).toContain('System default · Nocturne');
  });

  it('groups the six system themes above the ten films', () => {
    mount();
    open();
    openTheme();
    const menu = screen.getByTestId('theme-menu');
    expect(within(menu).getByText('SYSTEM')).toBeTruthy();
    expect(within(menu).getByText('FILM · names, portraits and palette')).toBeTruthy();
    expect(menu.querySelectorAll('[data-testid^="theme-film-"]')).toHaveLength(10);
    for (const id of ['nocturne', 'organic', 'ember', 'frost', 'slate', 'phosphor']) {
      expect(within(menu).getByTestId(`theme-${id}`).textContent).toContain('System default');
    }
  });

  it('previews each film in its own three bands, from the film data', () => {
    mount();
    open();
    openTheme();
    const row = screen.getByTestId('theme-film-inception');
    const palette = themeFor('inception').palette!;
    expect(bandsOf(row)).toEqual([
      asRendered(palette.bg),
      asRendered(palette.accent.base),
      asRendered(palette.text),
    ]);
  });

  it('paints the console from the film once one is picked', () => {
    const console_ = mount();
    open();
    pickFilm('inception');
    const palette = themeFor('inception').palette!;
    expect(console_.style.getPropertyValue('--color-bg')).toBe(palette.bg);
    expect(console_.style.getPropertyValue('--color-accent')).toBe(palette.accent.base);
    expect(screen.getByTestId('theme-trigger').textContent).toContain('Inception · steel & kick');
  });

  it('puts the console back on a system theme, and drops the film with it', () => {
    const console_ = mount();
    open();
    pickFilm('inception');
    pickSystem('ember');
    expect(console_.style.getPropertyValue('--color-bg')).toBe(THEMES.ember.bg);
    expect(screen.getByTestId('theme-trigger').textContent).toContain('System default · Ember');
    expect(screen.getAllByTestId('wall-name')[0].textContent).toBe('team-lead');
  });
});

describe('the film palette switch in the panel', () => {
  it('is absent until a film is picked', () => {
    mount();
    open();
    expect(screen.queryByTestId('toggle-filmPalette')).toBeNull();
    pickFilm('inception');
    expect(screen.getByTestId('toggle-filmPalette')).toBeTruthy();
  });

  it('returns the ground to the system theme while the film keeps casting', () => {
    const console_ = mount();
    open();
    pickFilm('inception');
    expect(screen.getAllByTestId('wall-name')[0].textContent).toBe('Cobb');

    fireEvent.click(screen.getByTestId('toggle-filmPalette'));
    expect(console_.style.getPropertyValue('--color-bg')).toBe(THEMES.nocturne.bg);
    expect(screen.getAllByTestId('wall-name')[0].textContent).toBe('Cobb');
    expect(screen.getByTestId('theme-trigger').textContent).toContain('Inception · names only');
  });

  it('replaces the four accent swatches with the film own, named', () => {
    mount();
    open();
    expect(screen.getByTestId('scheme-a')).toBeTruthy();
    pickFilm('inception');
    expect(screen.queryByTestId('scheme-a')).toBeNull();
    const section = screen.getByTestId('film-accent');
    expect(section.textContent).toContain('kick amber');
    expect(section.textContent).toContain('overridden by the film');
  });

  it('gives the four schemes back when the palette stops driving', () => {
    mount();
    open();
    pickFilm('inception');
    fireEvent.click(screen.getByTestId('toggle-filmPalette'));
    expect(screen.getByTestId('scheme-a')).toBeTruthy();
    expect(screen.queryByTestId('film-accent')).toBeNull();
  });
});

describe('the note states the current reach exactly', () => {
  it('says agents keep their real names with no film', () => {
    mount();
    open();
    expect(screen.getByTestId('theme-note').textContent).toBe('Agents keep their real names.');
  });

  it('names the system theme the ground stays on with the palette off', () => {
    mount();
    open();
    pickSystem('frost');
    pickFilm('lotr');
    fireEvent.click(screen.getByTestId('toggle-filmPalette'));
    expect(screen.getByTestId('theme-note').textContent).toBe(
      'Names and portrait colours only; the ground stays on Frost.',
    );
  });

  it('names the film everything comes from with the palette on', () => {
    mount();
    open();
    pickFilm('lotr');
    expect(screen.getByTestId('theme-note').textContent).toBe(
      'Names, portrait colours and the ground all come from The Lord of the Rings.',
    );
  });
});

describe('the rate-card toggle the usage view reads', () => {
  it('is on by default and hides on demand', () => {
    mount();
    open();
    const toggle = screen.getByTestId('toggle-showRateCard');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(screen.getByTestId('toggle-showRateCard').getAttribute('aria-checked')).toBe('false');
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!).showRateCard).toBe(false);
  });
});
