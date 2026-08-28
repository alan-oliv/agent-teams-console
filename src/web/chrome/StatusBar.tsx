import type { TeamState, ViewId } from '../../shared/domain';
import { formatCost, formatElapsed, formatTokens, meterCells } from '../format';
import { VIEW_IDS } from '../state/useTeamState';

export interface StatusBarProps {
  state: TeamState;
  view: ViewId;
  onViewChange(view: ViewId): void;
  now: number;
}

export function StatusBar({ state, view, onViewChange, now }: StatusBarProps) {
  const done = state.tasks.filter((t) => t.state === 'completed').length;
  // Team context occupancy — what the meter has always looked like it meant.
  // It used to divide the CUMULATIVE token total by a capacity, which pins it
  // solid full on any real session and carries no information.
  const totalLimit = state.agents.reduce((n, a) => n + a.contextLimit, 0);
  const occupied = state.agents.reduce((n, a) => n + a.contextTokens, 0);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '9px 14px',
        borderBottom: '1px solid var(--color-neutral-900)',
        background: 'var(--color-bg)',
        fontSize: 12.5,
      }}
    >
      <span
        style={{
          color: 'var(--color-accent)',
          letterSpacing: '.14em',
          fontWeight: 700,
          fontSize: 11,
        }}
      >
        TEAM
      </span>
      <span style={{ color: 'var(--color-text)' }}>{state.teamName}</span>
      <span
        style={{
          border: '1px solid var(--color-accent-700)',
          color: 'var(--color-accent-300)',
          borderRadius: 'var(--radius-sm)',
          padding: '1px 6px',
          fontSize: 10,
        }}
      >
        experimental
      </span>

      <div role="tablist" aria-label="view" style={{ display: 'flex', gap: 2, marginLeft: 6 }}>
        {VIEW_IDS.map((id) => (
          <button
            key={id}
            className="tab"
            type="button"
            role="tab"
            aria-selected={id === view}
            onClick={() => onViewChange(id)}
            style={{
              padding: '3px 9px 4px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
            }}
          >
            <span
              style={{
                fontSize: 11.5,
                color: id === view ? 'var(--color-text)' : 'var(--color-neutral-600)',
              }}
            >
              {id}
            </span>
            <span
              style={{
                height: 2,
                borderRadius: 1,
                background: id === view ? 'var(--color-accent)' : 'transparent',
              }}
            />
          </button>
        ))}
      </div>

      <span style={{ flex: 1 }} />

      <span style={{ color: 'var(--color-neutral-600)' }}>{`tasks ${done}/${state.tasks.length}`}</span>
      <span style={{ color: 'var(--color-neutral-600)' }}>{`${state.agents.length} windows`}</span>
      <span style={{ color: 'var(--color-neutral-500)' }}>{formatTokens(state.totalTokens)}</span>
      <span
        data-testid="aggregate-meter"
        style={{ color: 'var(--color-accent-500)', letterSpacing: '-.5px' }}
      >
        {meterCells(totalLimit > 0 ? occupied / totalLimit : 0)}
      </span>
      <span style={{ color: 'var(--color-neutral-500)' }}>{formatElapsed(now - state.startedAt)}</span>
      <span style={{ color: 'var(--color-neutral-500)' }}>
        {`${formatCost(state.totalCostUsd)} api-equiv`}
      </span>
      {state.rateLimits && (
        <span style={{ color: 'var(--color-neutral-600)' }}>
          {`5h ${Math.round(state.rateLimits.fiveHourPct)}% · 7d ${Math.round(
            state.rateLimits.sevenDayPct,
          )}%`}
        </span>
      )}
    </div>
  );
}
