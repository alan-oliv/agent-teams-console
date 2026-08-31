import type { CSSProperties } from 'react';
import type { TeamState, TeamSummary } from '../../shared/domain';
import { TerminalSprite } from '../components/Portrait';
import { formatCost, formatElapsed } from '../format';

const ELLIPSIS: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

// Same three states the picker draws, for the sessions listed below the card.
const DOT = { live: '●', idle: '○', done: '✓' } as const;
const DOT_COLOR = {
  live: 'var(--color-accent-400)',
  idle: 'var(--color-neutral-600)',
  done: 'var(--color-neutral-700)',
} as const;

export interface LeftSessionProps {
  /** The session the operator dismissed — still the one this tab's SSE stream carries. */
  state: TeamState;
  now: number;
  /** Set the moment "stop watching" was confirmed, so the card can show what changed since. */
  awaySince: { at: number; cost: number } | null;
  /** Other sessions on the machine, one click away. */
  elsewhere: TeamSummary[];
  onWatchAgain(): void;
  onEndForReal(): void;
  onSwitchTo(name: string): void;
}

/**
 * Screen 7a: chrome stays, body empties into this. The card below stays
 * "ticking" — it reads live off `state`/`now`, never a snapshot taken at
 * dismissal — because a frozen card would claim the session had stopped,
 * exactly the lie this screen exists to avoid.
 */
export function LeftSession({ state, now, awaySince, elsewhere, onWatchAgain, onEndForReal, onSwitchTo }: LeftSessionProps) {
  const title = state.sessionName ?? state.teamName;
  // The card's own name stays the stable team id even once the sentence above
  // and picker rows have switched to the nicer `/branch` name — the goal line
  // right next to it already carries that name, so this would otherwise repeat it.
  const goal = state.sessionName;
  const working = state.agents.filter((a) => a.status === 'working').length;
  const tasksDone = state.tasks.filter((t) => t.state === 'completed').length;
  const since = awaySince ? now - awaySince.at : 0;
  const spentAway = awaySince ? state.totalCostUsd - awaySince.cost : 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 28,
          minHeight: 0,
        }}
      >
        <div style={{ width: 560, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', gap: 26, alignItems: 'center' }}>
            <TerminalSprite />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <span data-testid="left-session-heading" style={{ color: 'var(--color-text)', fontSize: 16, lineHeight: 1.4 }}>
                You stopped watching {title}.
              </span>
              <span style={{ color: 'var(--color-neutral-400)', fontSize: 12, lineHeight: 1.65 }}>
                It is still running. Nothing was interrupted — the console just stopped following it, and this
                browser will not show it again until you pick it.
              </span>
            </div>
          </div>

          <div
            style={{
              border: '1px solid var(--color-neutral-800)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-bg)',
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
              <span aria-hidden="true" style={{ color: 'var(--color-accent-400)', fontSize: 10 }}>
                ●
              </span>
              <span data-testid="left-session-name" style={{ color: 'var(--color-text)', fontSize: 12.5 }}>
                {state.teamName}
              </span>
              {goal && (
                <span data-testid="left-session-goal" style={{ color: 'var(--color-neutral-600)', fontSize: 11, ...ELLIPSIS }}>
                  {goal}
                </span>
              )}
              <span style={{ flex: 1 }} />
              <span data-testid="left-session-away" style={{ color: 'var(--color-neutral-600)', fontSize: 10.5, whiteSpace: 'nowrap' }}>
                away {formatElapsed(since)}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 19 }}>
              <span data-testid="left-session-agents" style={{ color: 'var(--color-neutral-500)', fontSize: 11 }}>
                {working} of {state.agents.length} agents still working
              </span>
              <span data-testid="left-session-tasks" style={{ color: 'var(--color-neutral-500)', fontSize: 11 }}>
                {tasksDone} of {state.tasks.length} tasks done
              </span>
              <span data-testid="left-session-spend" style={{ color: 'var(--color-neutral-500)', fontSize: 11 }}>
                {formatCost(spentAway)} spent since you looked away
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, paddingLeft: 19, paddingTop: 2 }}>
              <button
                type="button"
                data-testid="watch-again"
                onClick={onWatchAgain}
                style={{
                  border: '1px solid var(--color-accent-700)',
                  color: 'var(--color-accent-300)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '3px 11px',
                  fontSize: 11,
                  cursor: 'pointer',
                  background: 'transparent',
                }}
              >
                watch again
              </button>
              <button
                type="button"
                data-testid="end-for-real"
                onClick={onEndForReal}
                style={{
                  border: '1px solid var(--warn-edge)',
                  color: 'var(--warn)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '3px 11px',
                  fontSize: 11,
                  cursor: 'pointer',
                  background: 'transparent',
                }}
              >
                end it for real
              </button>
            </div>
          </div>

          {elsewhere.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ color: 'var(--color-neutral-600)', fontSize: 10, letterSpacing: '.12em' }}>
                ELSEWHERE ON THIS MACHINE
              </span>
              {elsewhere.map((s) => {
                const dotState = s.state ?? (s.live ? 'live' : 'done');
                return (
                  <div
                    key={s.name}
                    data-testid="left-session-elsewhere-row"
                    onClick={() => onSwitchTo(s.name)}
                    style={{
                      display: 'flex',
                      gap: 9,
                      alignItems: 'baseline',
                      padding: '7px 9px',
                      margin: '0 -9px',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                    }}
                  >
                    <span aria-hidden="true" style={{ fontSize: 10, color: DOT_COLOR[dotState] }}>
                      {DOT[dotState]}
                    </span>
                    <span style={{ color: 'var(--color-neutral-300)', fontSize: 11.5, whiteSpace: 'nowrap' }}>
                      {s.goal ?? s.name}
                    </span>
                    <span style={{ color: 'var(--color-neutral-600)', fontSize: 11, ...ELLIPSIS }}>{s.branch}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ color: 'var(--color-neutral-600)', fontSize: 10, whiteSpace: 'nowrap' }}>
                      {s.members} agent{s.members === 1 ? '' : 's'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div
        data-testid="left-session-footer"
        style={{
          borderTop: '1px solid var(--color-neutral-900)',
          padding: '9px 14px',
          display: 'flex',
          flexWrap: 'nowrap',
          gap: 14,
          alignItems: 'center',
          color: 'var(--color-neutral-600)',
          fontSize: '10.5px',
        }}
      >
        <span style={{ flex: 'none', whiteSpace: 'nowrap' }}>
          the server stays up to serve this screen — it no longer exits when nothing is selected
        </span>
        <span style={{ flex: 1, minWidth: 8 }} />
        <span style={{ flex: 'none', whiteSpace: 'nowrap' }}>
          dismissed in this browser only · another tab still follows it
        </span>
      </div>
    </div>
  );
}
