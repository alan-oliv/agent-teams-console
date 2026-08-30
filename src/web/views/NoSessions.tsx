import type { CSSProperties } from 'react';
import type { TeamSummary } from '../../shared/domain';
import { TerminalSprite } from '../components/Portrait';

const ELLIPSIS: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const DOT = { live: '●', idle: '○', done: '✓' } as const;
const DOT_COLOR = {
  live: 'var(--color-accent-400)',
  idle: 'var(--color-neutral-600)',
  done: 'var(--color-neutral-700)',
} as const;

export interface NoSessionsProps {
  /** Sessions still in the picker — empty when every one has been hidden. */
  remaining: TeamSummary[];
  /** How many the operator has hidden, so the way back is always countable. */
  hiddenCount: number;
  onShowHidden(): void;
  onSwitchTo(name: string): void;
}

/**
 * The body when the session on screen has been hidden. Sibling to
 * `LeftSession` rather than a mode of it: that screen is about ONE session you
 * deliberately left and can still see ticking, and every part of it — the live
 * card, `watch again`, `end it for real` — needs a session to point at. This
 * one has none.
 *
 * The load-bearing part is the way out. Hiding the last session would otherwise
 * be a one-way door: an empty picker, an empty body, and no control anywhere
 * that puts them back. So the hidden count and `show them` are stated whenever
 * anything is hidden, not tucked behind a menu.
 */
export function NoSessions({ remaining, hiddenCount, onShowHidden, onSwitchTo }: NoSessionsProps) {
  return (
    <div
      data-testid="no-sessions"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        justifyContent: 'center',
        padding: '48px 24px',
      }}
    >
      <div style={{ width: '560px', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '26px' }}>
          <TerminalSprite size={144} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', minWidth: 0 }}>
            <h1 style={{ color: 'var(--color-text)', fontSize: '16px', fontWeight: 500, margin: 0 }}>
              {remaining.length > 0 ? 'Nothing selected.' : 'No sessions in the picker.'}
            </h1>
            <p
              style={{
                color: 'var(--color-neutral-500)',
                fontSize: '11.5px',
                lineHeight: 1.6,
                textWrap: 'pretty',
                margin: 0,
              }}
            >
              {/* Say what hiding did and did not do. A blank console is the
                  moment an operator most needs telling that nothing was
                  stopped — the same reason the stop glyph and the in-flight
                  badge refuse to overstate. */}
              Hiding a session only takes it out of this picker, in this browser.
              Nothing was stopped, nothing was deleted, and any team that was
              running still is.
            </p>
          </div>
        </div>

        {hiddenCount > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '10px',
              padding: '11px 14px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-neutral-800)',
              background: 'var(--color-bg)',
            }}
          >
            <span style={{ color: 'var(--color-neutral-500)', fontSize: '11.5px' }}>
              {`${hiddenCount} hidden`}
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="btn-approve"
              data-testid="show-hidden"
              onClick={onShowHidden}
              style={{
                fontSize: '10.5px',
                padding: '3px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-accent-700)',
                background: 'transparent',
                color: 'var(--color-accent-300)',
                cursor: 'pointer',
                flex: 'none',
              }}
            >
              show them
            </button>
          </div>
        )}

        {remaining.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            <span
              style={{
                color: 'var(--color-neutral-700)',
                fontSize: '10px',
                letterSpacing: '.12em',
              }}
            >
              ELSEWHERE ON THIS MACHINE
            </span>
            {remaining.map((t) => {
              const state = t.state ?? (t.live ? 'live' : 'done');
              return (
                <button
                  key={t.name}
                  type="button"
                  className="chip"
                  data-testid="no-sessions-other"
                  onClick={() => onSwitchTo(t.name)}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '9px',
                    padding: '7px 11px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-neutral-900)',
                    background: 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: '10px', color: DOT_COLOR[state] }}>
                    {DOT[state]}
                  </span>
                  <span style={{ color: 'var(--color-text)', fontSize: '11.5px', ...ELLIPSIS }}>
                    {t.goal ?? t.name}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span
                    style={{ color: 'var(--color-neutral-700)', fontSize: '10px', flex: 'none' }}
                  >
                    {`${t.members} agent${t.members === 1 ? '' : 's'}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
