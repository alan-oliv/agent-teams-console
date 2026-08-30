import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MOVIE_THEMES, themeFor } from '../../shared/cast';
import {
  ACCENT_KEYS,
  DENSITY_IDS,
  THEMES,
  THEME_IDS,
  type AccentKey,
  type Density,
  type ThemeId,
} from '../themes';
import type { Settings, SettingsStore } from '../state/useSettings';

const SECTION: CSSProperties = {
  padding: '11px 13px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  borderBottom: '1px solid var(--color-neutral-900)',
};

const LABEL: CSSProperties = { color: 'var(--color-neutral-500)', fontSize: '10.5px' };

/** Picked-or-not, for the tiles and the density segments. */
function pickStyle(on: boolean): CSSProperties {
  return {
    background: on ? 'var(--color-accent-900)' : 'transparent',
    border: `1px solid ${on ? 'var(--color-accent-600)' : 'var(--color-neutral-800)'}`,
    color: on ? 'var(--color-accent-300)' : 'var(--color-neutral-500)',
  };
}

/** The closed row of either picker. `team-trigger` carries the same hover. */
const ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 9px',
  cursor: 'pointer',
  border: '1px solid var(--color-neutral-800)',
  borderRadius: 'var(--radius-sm)',
};

/**
 * The list each row opens. Absolute, so the panel's height is the height of two
 * closed rows however long the lists grow — the whole point of the dropdowns.
 */
const MENU: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  right: 0,
  zIndex: 40,
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '186px',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-neutral-800)',
  borderRadius: 'var(--radius-sm)',
  boxShadow: '0 14px 32px rgba(0, 0, 0, 0.55)',
};

/** One option. `cfg-tile` carries the row hover. */
function optionStyle(on: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 9px',
    cursor: 'pointer',
    background: on ? 'var(--color-accent-900)' : 'transparent',
    borderBottom: '1px solid var(--color-neutral-900)',
  };
}

const optionColor = (on: boolean) => (on ? 'var(--color-accent-300)' : 'var(--color-neutral-400)');

/** Ground, accent and text of a theme, so a name is not the only preview. */
function Swatch({ id }: { id: ThemeId }) {
  const theme = THEMES[id];
  return (
    <span
      style={{
        display: 'flex',
        width: '34px',
        flex: 'none',
        borderRadius: '3px',
        overflow: 'hidden',
        boxShadow: '0 0 0 1px var(--color-neutral-800)',
      }}
    >
      <span style={{ flex: 2, height: '13px', background: theme.term }} />
      <span style={{ flex: 1, height: '13px', background: theme.accents.a.steps[0] }} />
      <span style={{ flex: 1, height: '13px', background: theme.text }} />
    </span>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <span style={{ color: 'var(--color-accent-400)', fontSize: '9.5px', width: '8px' }}>
      {on ? '✓' : ''}
    </span>
  );
}

function Toggle({
  id, label, note, value, onChange,
}: {
  id: keyof Settings;
  label: string;
  note: string;
  value: boolean;
  onChange(next: boolean): void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '9px',
        padding: '7px 0',
        borderTop: '1px solid var(--color-neutral-900)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' }}>
        <span style={{ color: 'var(--color-neutral-400)', fontSize: '11px' }}>{label}</span>
        <span style={{ color: 'var(--color-neutral-600)', fontSize: '9.5px' }}>{note}</span>
      </div>
      <span
        style={{
          color: value ? 'var(--color-accent-300)' : 'var(--color-neutral-600)',
          fontSize: '9.5px',
          width: '18px',
          textAlign: 'right',
        }}
      >
        {value ? 'on' : 'off'}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        data-testid={`toggle-${id}`}
        onClick={() => onChange(!value)}
        style={{
          position: 'relative',
          width: '26px',
          height: '14px',
          borderRadius: '8px',
          cursor: 'pointer',
          flex: 'none',
          background: value ? 'var(--color-accent-600)' : 'var(--color-neutral-800)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: '1px',
            left: value ? '11px' : '1px',
            width: '12px',
            height: '12px',
            borderRadius: '6px',
            background: 'var(--color-bg)',
            transition: 'left .12s ease',
          }}
        />
      </button>
    </div>
  );
}

export interface ConfigMenuProps {
  appearance: SettingsStore;
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function ConfigMenu({ appearance, open, onOpenChange }: ConfigMenuProps) {
  const { settings, set, reset } = appearance;
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // One at a time: two open lists would overlap in a 302px panel.
  const [list, setList] = useState<'movie' | 'theme' | null>(null);
  const movieLabel = settings.movieTheme ? themeFor(settings.movieTheme).film : 'off';

  useEffect(() => {
    if (!open) {
      setList(null);
      return;
    }
    // pointerdown, not click, so dismissal beats the focus move — same rule the
    // team picker follows.
    function onPointerDown(e: PointerEvent) {
      if (!wrapper.current?.contains(e.target as Node)) onOpenChange(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // preventDefault is what stops the global handler interrupting an agent.
      e.preventDefault();
      onOpenChange(false);
      trigger.current?.focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={wrapper} style={{ position: 'relative', flex: 'none' }}>
      <button
        ref={trigger}
        type="button"
        className="cfg-trigger"
        data-testid="config-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="layout & appearance"
        onClick={() => onOpenChange(!open)}
        style={{
          display: 'block',
          color: 'var(--color-neutral-500)',
          cursor: 'pointer',
          padding: '0 5px',
          borderRadius: 'var(--radius-sm)',
          fontSize: '12px',
          lineHeight: '18px',
        }}
      >
        {open ? '✕' : '⚙'}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="appearance"
          data-testid="config-menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 30,
            display: 'flex',
            flexDirection: 'column',
            width: '302px',
            // In px against the console body, never `calc(100% - …)`: the
            // wrapper this hangs off is positioned but has no height, so a
            // percentage resolves against 0 and collapses the panel to 1px.
            maxHeight: '600px',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-neutral-800)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 18px 40px rgba(0, 0, 0, 0.6)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '9px 13px',
              borderBottom: '1px solid var(--color-neutral-900)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span
              style={{ color: 'var(--color-neutral-600)', fontSize: '10px', letterSpacing: '.12em' }}
            >
              APPEARANCE
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="cfg-reset"
              data-testid="config-reset"
              onClick={reset}
              style={{
                color: 'var(--color-neutral-600)',
                fontSize: '10px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--color-neutral-800)',
              }}
            >
              reset
            </button>
          </div>

          <div style={{ ...SECTION, paddingBottom: '12px' }}>
            <span style={LABEL}>movie theme</span>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="team-trigger"
                data-testid="movie-trigger"
                aria-haspopup="listbox"
                aria-expanded={list === 'movie'}
                onClick={() => setList(list === 'movie' ? null : 'movie')}
                style={{ ...ROW, width: '100%' }}
              >
                <span
                  style={{
                    color: 'var(--color-text)',
                    fontSize: '11px',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {movieLabel}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ color: 'var(--color-accent-400)', fontSize: '9px' }}>
                  {list === 'movie' ? '▴' : '▾'}
                </span>
              </button>
              {list === 'movie' && (
                <div className="tscroll" role="listbox" data-testid="movie-menu" style={MENU}>
                  {MOVIE_THEMES.map((film) => {
                    const off = film.key === 'off';
                    const on = off ? settings.movieTheme === null : settings.movieTheme === film.key;
                    return (
                      <button
                        key={film.key}
                        type="button"
                        className="cfg-tile"
                        data-testid={`movie-${film.key}`}
                        role="option"
                        aria-selected={on}
                        title={film.note}
                        onClick={() => {
                          set('movieTheme', off ? null : film.key);
                          setList(null);
                        }}
                        style={optionStyle(on)}
                      >
                        <span
                          style={{
                            color: optionColor(on),
                            fontSize: '10.5px',
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {off ? 'off' : film.film}
                        </span>
                        <span style={{ flex: 1 }} />
                        {/* The lead is the tone in one word — visible before committing. */}
                        <span
                          style={{
                            color: 'var(--color-neutral-600)',
                            fontSize: '9.5px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {off ? '—' : film.roles.lead}
                        </span>
                        <Check on={on} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <span
              style={{ color: 'var(--color-neutral-600)', fontSize: '9.5px', lineHeight: 1.5 }}
            >
              Names only. Types, states and metrics keep their real values.
            </span>
          </div>

          <div style={SECTION}>
            <span style={LABEL}>theme</span>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="team-trigger"
                data-testid="theme-trigger"
                aria-haspopup="listbox"
                aria-expanded={list === 'theme'}
                onClick={() => setList(list === 'theme' ? null : 'theme')}
                style={{ ...ROW, width: '100%' }}
              >
                <Swatch id={settings.theme} />
                <span
                  style={{ color: 'var(--color-text)', fontSize: '11px', whiteSpace: 'nowrap' }}
                >
                  {THEMES[settings.theme].label}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ color: 'var(--color-accent-400)', fontSize: '9px' }}>
                  {list === 'theme' ? '▴' : '▾'}
                </span>
              </button>
              {list === 'theme' && (
                <div className="tscroll" role="listbox" data-testid="theme-menu" style={MENU}>
                  {THEME_IDS.map((id) => {
                    const on = settings.theme === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        className="cfg-tile"
                        data-testid={`theme-${id}`}
                        role="option"
                        aria-selected={on}
                        title={THEMES[id].note}
                        onClick={() => {
                          set('theme', id as ThemeId);
                          setList(null);
                        }}
                        style={optionStyle(on)}
                      >
                        {/* Each option previews itself in its OWN colours, so
                            the choice is visible before it is applied. */}
                        <Swatch id={id as ThemeId} />
                        <span
                          style={{
                            color: optionColor(on),
                            fontSize: '10.5px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {THEMES[id].label}
                        </span>
                        <span style={{ flex: 1 }} />
                        <Check on={on} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div style={SECTION}>
            <span style={LABEL}>accent scheme</span>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {ACCENT_KEYS.map((key) => {
                const accent = THEMES[settings.theme].accents[key];
                const on = settings.scheme === key;
                return (
                  <button
                    key={key}
                    type="button"
                    data-testid={`scheme-${key}`}
                    aria-pressed={on}
                    aria-label={accent.name}
                    title={accent.name}
                    onClick={() => set('scheme', key as AccentKey)}
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      background: accent.steps[0],
                      // Ringed in the theme's own ground so the halo reads on
                      // paper as well as on carbon.
                      boxShadow: on
                        ? `0 0 0 2px var(--color-bg), 0 0 0 3px ${accent.steps[4]}`
                        : 'none',
                    }}
                  />
                );
              })}
              <span style={{ flex: 1 }} />
              <span style={{ color: 'var(--color-neutral-600)', fontSize: '9.5px' }}>
                four per theme
              </span>
            </div>
          </div>

          <div style={SECTION}>
            <span style={LABEL}>line density</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              {DENSITY_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="cfg-seg"
                  data-testid={`density-${id}`}
                  aria-pressed={settings.density === id}
                  onClick={() => set('density', id as Density)}
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    cursor: 'pointer',
                    fontSize: '10.5px',
                    padding: '3px 0',
                    borderRadius: 'var(--radius-sm)',
                    ...pickStyle(settings.density === id),
                  }}
                >
                  {id}
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding: '6px 13px 10px', display: 'flex', flexDirection: 'column' }}>
            <Toggle
              id="fade"
              label="fade older output"
              note="newest line reads brightest"
              value={settings.fade}
              onChange={(v) => set('fade', v)}
            />
            <Toggle
              id="avatars"
              label="agent portraits"
              note="8-bit faces per role"
              value={settings.avatars}
              onChange={(v) => set('avatars', v)}
            />
            <Toggle
              id="motion"
              label="motion"
              note="cursor blink, typing dots"
              value={settings.motion}
              onChange={(v) => set('motion', v)}
            />
            <Toggle
              id="numbers"
              label="JSON line numbers"
              note="gutter in expanded payloads"
              value={settings.numbers}
              onChange={(v) => set('numbers', v)}
            />
          </div>

          <div
            style={{
              padding: '8px 13px',
              borderTop: '1px solid var(--color-neutral-900)',
              color: 'var(--color-neutral-600)',
              fontSize: '9.5px',
            }}
          >
            saved per machine, not per session
          </div>
        </div>
      )}
    </div>
  );
}
