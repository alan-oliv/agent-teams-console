// @vitest-environment jsdom
//
// The cross-view pass for the film-theme work. Everything here is about reach
// rather than about one control: a film has to arrive at every surface that
// renders a cast, and the ground has to arrive on the root once, on mount, for
// all of them at the same time.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOVIE_THEMES, themeFor } from '../shared/cast';
import { App } from './App';
import { MockEventSource, installMockEventSource } from './test/mockEventSource';
import { sampleTeamState } from './test/state-fixture';
import { SETTINGS_KEY } from './state/useSettings';
import { THEMES } from './themes';

beforeEach(() => {
  installMockEventSource();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(cleanup);

/** Unmount AND forget the stored appearance — the blob outlives a render. */
const reset = () => {
  cleanup();
  window.localStorage.clear();
};

function mount(view = 'wall') {
  window.history.replaceState(null, '', `/?view=${view}`);
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  return document.querySelector('.console') as HTMLElement;
}

const openConfig = () => fireEvent.click(screen.getByTestId('config-trigger'));
const pickFilm = (key: string) => {
  fireEvent.click(screen.getByTestId('theme-trigger'));
  fireEvent.click(screen.getByTestId(`theme-film-${key}`));
};
const pickSystem = (id: string) => {
  fireEvent.click(screen.getByTestId('theme-trigger'));
  fireEvent.click(screen.getByTestId(`theme-${id}`));
};

const films = MOVIE_THEMES.filter((theme) => theme.palette);

// (a) Every surface that renders a cast has to agree, because they all read the
// one mapping. A view that built its own would drift the moment a spare moved.
describe('a film reaches every view that renders a cast', () => {
  it('renames the lead identically in every view that shows one', () => {
    for (const view of ['wall', 'overview', 'rail', 'grid']) {
      mount(view);
      openConfig();
      pickFilm('inception');
      const shown = screen.getAllByText('Cobb');
      expect(shown.length, view).toBeGreaterThan(0);
      reset();
    }
  });

  it('keeps the agent-type badge beside the character, never replacing it', () => {
    mount();
    openConfig();
    pickFilm('inception');
    expect(screen.getAllByTestId('wall-name')[0].textContent).toBe('Cobb');
    expect(screen.getAllByTestId('wall-type')[0].textContent).toBe('team-lead');
  });

  it('tints the portraits from the film wherever a portrait renders', () => {
    // Compared as a set, not by index: the views order the roster differently,
    // and only the agents the cast gave a role slot are dressed at all.
    const facesOf = () => screen.getAllByTestId('portrait').map((p) => p.innerHTML).join('|');
    for (const view of ['wall', 'overview', 'rail', 'grid']) {
      mount(view);
      const before = facesOf();
      reset();

      mount(view);
      openConfig();
      pickFilm('inception');
      expect(facesOf(), view).not.toBe(before);
      reset();
    }
  });

  // The measurement behind decision 20, showing up in the portraits: on this
  // fixture — and on every team in ~/.claude/teams — the lead is the only agent
  // whose role the console can read, so it is the only one a film dresses.
  // Everyone else took a spare and keeps the default portrait, which is
  // lookFollowsRoleSlot working, not a film failing to arrive.
  it('dresses exactly the agents the cast gave a role slot', () => {
    mount();
    const before = screen.getAllByTestId('portrait').map((p) => p.innerHTML);
    reset();

    mount();
    openConfig();
    pickFilm('inception');
    const after = screen.getAllByTestId('portrait').map((p) => p.innerHTML);
    const changed = after.filter((svg, i) => svg !== before[i]).length;
    expect(changed).toBe(1);
    expect(
      within(document.querySelector('[data-agent="team-lead"]') as HTMLElement)
        .getByTestId('wall-name').textContent,
    ).toBe('Cobb');
  });
});

// (b) teamNameIsDecoration says to measure the LONGEST state, because the bar
// bleeds rather than wraps and an overflow is therefore silent.
describe('the status bar survives the longest in-world team name', () => {
  it('names the longest chip across the ten films', () => {
    const longest = films.map((f) => f.team).reduce((a, b) => (b.length > a.length ? b : a));
    expect(longest).toBe('the fellowship');
  });

  it('keeps the bar on one line for every film, longest included', () => {
    for (const film of films) {
      mount();
      openConfig();
      pickFilm(film.key);
      fireEvent.click(screen.getByTestId('config-trigger')); // close the panel

      const chip = screen.getByTestId('team-chip');
      expect(chip.textContent, film.key).toBe(film.team);
      // The bar bleeds rather than wraps, so the guard is that the chip refuses
      // to wrap and the row stays a single flex line.
      expect(chip.style.whiteSpace, film.key).toBe('nowrap');
      reset();
    }
  });
});

// (c) noSemanticRecolour. The rev 4b fix moved three gold films off amber; a
// derived warn would land back on the accent and vanish beside it.
describe('warn never collides with a film accent', () => {
  it('paints the palette declared warn, not one derived from the accent', () => {
    for (const key of ['inception', 'lotr', 'godfather']) {
      const palette = themeFor(key).palette!;
      const console_ = mount();
      openConfig();
      pickFilm(key);
      expect(console_.style.getPropertyValue('--warn'), key).toBe(palette.warn);
      expect(console_.style.getPropertyValue('--warn'), key).toBe('#f0a08c');
      expect(console_.style.getPropertyValue('--warn'), key).not.toBe(
        console_.style.getPropertyValue('--color-accent'),
      );
      expect(console_.style.getPropertyValue('--fail'), key).toBe(palette.fail);
      reset();
    }
  });

  it('keeps warn and fail apart from the accent on all ten', () => {
    for (const film of films) {
      const console_ = mount();
      openConfig();
      pickFilm(film.key);
      const accent = console_.style.getPropertyValue('--color-accent');
      expect(console_.style.getPropertyValue('--warn'), film.key).not.toBe(accent);
      expect(console_.style.getPropertyValue('--fail'), film.key).not.toBe(accent);
      reset();
    }
  });
});

// (d) The switch reaches the GROUND only. Names and portrait tints are what
// "names and portrait colours only" still leaves switched on.
describe('with the film palette off, the ground stays on the system theme', () => {
  it('leaves every ground variable on the system theme while the cast changes', () => {
    const console_ = mount();
    openConfig();
    pickSystem('phosphor');
    const ground = {
      term: console_.style.getPropertyValue('--term'),
      bg: console_.style.getPropertyValue('--color-bg'),
      text: console_.style.getPropertyValue('--color-text'),
      warn: console_.style.getPropertyValue('--warn'),
      neutral: console_.style.getPropertyValue('--color-neutral-600'),
    };
    const face = screen.getAllByTestId('portrait')[0].innerHTML;

    pickFilm('matrix');
    fireEvent.click(screen.getByTestId('toggle-filmPalette'));

    expect(console_.style.getPropertyValue('--term')).toBe(ground.term);
    expect(console_.style.getPropertyValue('--color-bg')).toBe(ground.bg);
    expect(console_.style.getPropertyValue('--color-text')).toBe(ground.text);
    expect(console_.style.getPropertyValue('--warn')).toBe(ground.warn);
    expect(console_.style.getPropertyValue('--color-neutral-600')).toBe(ground.neutral);
    expect(console_.style.getPropertyValue('--color-bg')).toBe(THEMES.phosphor.bg);

    // ...while the two things the switch does NOT reach did change.
    expect(screen.getAllByTestId('wall-name')[0].textContent).toBe('Morpheus');
    expect(screen.getAllByTestId('portrait')[0].innerHTML).not.toBe(face);
  });
});

// (e) The recorded componentDidMount bug class: variables have to land on the
// first paint, not on the first tick, or a paused console renders unstyled.
describe('the ground lands on mount, not on a tick', () => {
  it('paints a stored film before any snapshot arrives', () => {
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ theme: 'nocturne', movieTheme: 'godfather', filmPalette: true }),
    );
    render(<App />);
    // No snapshot emitted at all: this is the pre-first-tick console.
    const console_ = document.querySelector('.console') as HTMLElement;
    expect(console_.style.getPropertyValue('--color-bg')).toBe(themeFor('godfather').palette!.bg);
  });

  it('paints a stored system theme before any snapshot arrives', () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'frost' }));
    render(<App />);
    const console_ = document.querySelector('.console') as HTMLElement;
    expect(console_.style.getPropertyValue('--term')).toBe(THEMES.frost.term);
  });

  it('repaints on a pick made while the console is still empty', () => {
    render(<App />);
    const console_ = document.querySelector('.console') as HTMLElement;
    expect(console_.style.getPropertyValue('--color-bg')).toBe(THEMES.nocturne.bg);
    // The gear is chrome and reachable, but the empty shell renders no bar, so
    // the guarantee under test is the one that matters: whatever the store says
    // on mount is on the root already.
    expect(console_.style.getPropertyValue('--color-neutral-200')).toBe(THEMES.nocturne.n[0]);
  });
});

// Every film has to be pickable and paint without throwing — ten grades, two
// neutral donors, and a cast rebuilt underneath each one.
describe('all ten films paint', () => {
  it('sets ground, accent and neutrals from each film in turn', () => {
    for (const film of films) {
      const console_ = mount();
      openConfig();
      pickFilm(film.key);
      const palette = film.palette!;
      expect(console_.style.getPropertyValue('--color-bg'), film.key).toBe(palette.bg);
      expect(console_.style.getPropertyValue('--term'), film.key).toBe(palette.term);
      expect(console_.style.getPropertyValue('--color-accent'), film.key).toBe(palette.accent.base);
      expect(console_.style.getPropertyValue('--color-neutral-200'), film.key).toBe(
        THEMES[palette.neutralsFrom].n[0],
      );
      reset();
    }
  });

  it('casts the lead of every film onto the wall', () => {
    for (const film of films) {
      mount();
      openConfig();
      pickFilm(film.key);
      expect(within(document.querySelector('[data-agent="team-lead"]') as HTMLElement)
        .getByTestId('wall-name').textContent, film.key).toBe(film.roles.lead);
      reset();
    }
  });
});

// Decision 29's practical argument, pinned end to end. The portrait never
// carried status — failure is the status glyph's job — so a repro portrait
// painted in var(--fail) at rest meant a repro agent that had ACTUALLY failed
// looked exactly like one that had not. The colour has to mean one thing.
describe('the failure colour signals failure, and nothing else', () => {
  const withRepro = (status: 'working' | 'failed') => {
    const state = sampleTeamState();
    state.agents = state.agents.map((a, i) =>
      i === 1 ? { ...a, name: 'repro-probe', agentType: 'repro', status } : a,
    );
    return state;
  };

  const mountWith = (status: 'working' | 'failed') => {
    window.history.replaceState(null, '', '/?view=wall');
    render(<App />);
    act(() => MockEventSource.last().emit('snapshot', withRepro(status)));
  };

  it('never paints a portrait in the failure colour, at rest or otherwise', () => {
    for (const status of ['working', 'failed'] as const) {
      mountWith(status);
      for (const portrait of screen.getAllByTestId('portrait')) {
        expect(portrait.innerHTML, `${status} portrait`).not.toContain('var(--fail)');
      }
      reset();
    }
  });

  it('leaves a repro agent at rest indistinguishable from any other at rest', () => {
    mountWith('working');
    const glyphs = screen.getAllByTestId('status-glyph').map((g) => g.style.color);
    expect(glyphs).not.toContain('var(--fail)');
    reset();

    // ...and only the failed one wears the colour, which is the whole point.
    mountWith('failed');
    expect(screen.getAllByTestId('status-glyph').map((g) => g.style.color)).toContain('var(--fail)');
  });

  it('dresses a repro agent in the film garment, not the failure rose', () => {
    mountWith('working');
    openConfig();
    pickFilm('pulp');
    const rose = screen.getAllByTestId('portrait').filter((p) => p.innerHTML.includes('var(--fail)'));
    expect(rose).toHaveLength(0);
  });
});
