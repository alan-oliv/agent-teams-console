import type { ReactElement } from 'react';
import type { Subagent, TeamState, ViewId } from '../../shared/domain';
import type { SettingsStore } from '../state/useSettings';
import { formatCost, formatElapsed, formatTokens, meterCells } from '../format';
import { SOLO_VIEW_IDS, VIEW_IDS } from '../state/useTeamState';
import { Bar, METRIC } from './Bar';
import { runOrder } from './RunSelect';
import { TeamSelect } from './TeamSelect';

/**
 * The order metrics are SHED in, which is not the order they are read in.
 * Lower survives longer.
 *
 * The design drops right-to-left from the list's own tail: the diffstat-class
 * extra first, then elapsed and spend merge into one chip, then the token
 * figure goes. Only two of those steps are live here — the diffstat left the
 * bar, and the merge is permanent rather than a step, so `limits` is the extra
 * that goes first and `tokens` follows it.
 *
 * `branch` outlives every one of them. It used to shed second, which is the one
 * ordering the design rules out: it is not a right-side figure, and dropping
 * whatever sits rightmost would shed exactly the figure the sixth switcher pill
 * was blamed for bleeding off-frame.
 */
export const METRIC_RANK: Record<string, number> = {
  branch: 0,
  tasks: 1,
  windows: 2,
  spend: 3,
  meter: 4,
  tokens: 5,
  limits: 6,
  // Newest addition, never part of the budget the rest of this order was
  // measured against — it sheds before everything above it.
  subagents: 7,
};

/** Every subagent in the tree, at every depth — a nested dispatch is still activity. */
function flattenSubagents(subagents: Subagent[]): Subagent[] {
  return subagents.flatMap((s) => [s, ...flattenSubagents(s.children)]);
}

export interface StatusBarProps {
  state: TeamState;
  view: ViewId;
  onViewChange(view: ViewId): void;
  now: number;
  teamsOpen: boolean;
  onTeamsOpenChange(open: boolean): void;
  /** Opens workflow mode for a run this session also has. */
  onSelectRun(runId: string): void;
  appearance: SettingsStore;
  /**
   * A lead-only session with a subagent tree (decision 24): the switcher
   * offers stream · trace · tasks · usage, where `stream` is the wall's own
   * pill wearing the word a single column deserves.
   */
  solo?: boolean;
}

export function StatusBar({
  state, view, onViewChange, now, teamsOpen, onTeamsOpenChange, onSelectRun, appearance, solo,
}: StatusBarProps) {
  const done = state.tasks.filter((t) => t.state === 'completed').length;
  // Team context occupancy — what the meter has always looked like it meant.
  // It used to divide the CUMULATIVE token total by a capacity, which pins it
  // solid full on any real session and carries no information.
  const totalLimit = state.agents.reduce((n, a) => n + a.contextLimit, 0);
  const occupied = state.agents.reduce((n, a) => n + a.contextTokens, 0);

  const allSubagents = Object.values(state.subagents ?? {}).flatMap(flattenSubagents);
  // Absent means not-yet-landed, not zero — summing only what has landed
  // avoids reporting a total lower than what the tree actually spent.
  const subagentTokens = allSubagents.reduce((n, s) => n + (s.tokens ?? 0), 0);

  // Reading order — the handoff's arrangement. What goes when the bar runs out
  // of room is METRIC_RANK's business, not this list's.
  const metrics: ReactElement[] = [
    ...(state.branch
      ? [
          <span
            key="branch"
            data-testid="status-branch"
            style={{ color: 'var(--color-accent-400)', ...METRIC }}
          >
            {state.branch}
          </span>,
        ]
      : []),
    <span key="tasks" style={{ color: 'var(--color-neutral-600)', ...METRIC }}>
      {`${done}/${state.tasks.length} tasks`}
    </span>,
    <span key="windows" style={{ color: 'var(--color-neutral-600)', ...METRIC }}>
      {`${state.agents.length} ctx`}
    </span>,
    ...(allSubagents.length > 0
      ? [
          <span key="subagents" style={{ color: 'var(--color-neutral-600)', ...METRIC }}>
            {`${allSubagents.length} subagents · ${formatTokens(subagentTokens)}`}
          </span>,
        ]
      : []),
    <span key="tokens" style={{ color: 'var(--color-neutral-500)', ...METRIC }}>
      {formatTokens(state.totalTokens)}
    </span>,
    <span
      key="meter"
      data-testid="aggregate-meter"
      style={{ color: 'var(--color-accent-500)', letterSpacing: '-.5px', ...METRIC }}
    >
      {meterCells(totalLimit > 0 ? occupied / totalLimit : 0)}
    </span>,
    ...(state.rateLimits
      ? [
          <span key="limits" style={{ color: 'var(--color-neutral-600)', ...METRIC }}>
            {`5h ${Math.round(state.rateLimits.fiveHourPct)}% · 7d ${Math.round(
              state.rateLimits.sevenDayPct,
            )}%`}
          </span>,
        ]
      : []),
    // One chip, not two: the sixth switcher pill costs ~65px, and splitting the
    // run of the session across two children spends a gap the bar no longer has.
    <span key="spend" style={{ color: 'var(--color-neutral-500)', ...METRIC }}>
      {`${formatElapsed(now - state.startedAt)} · ${formatCost(state.totalCostUsd)} api-equiv`}
    </span>,
  ];

  // A team wins the mode, so runs this session also has are drawable only by
  // asking for one. The chip is the ask — and it opens the live run rather than
  // the first on the frame, since a run still going is what it is for.
  const runs = runOrder(state.workflows ?? []);

  return (
    <Bar
      wordmark="TEAM"
      picker={
        <>
          <TeamSelect
            current={state.teamName}
            sessionName={state.sessionName}
            open={teamsOpen}
            onOpenChange={onTeamsOpenChange}
            now={now}
          />
          {runs.length > 0 && (
            <button
              className="chip"
              data-testid="runs-chip"
              type="button"
              onClick={() => onSelectRun(runs[0].runId)}
              style={{
                border: '1px solid var(--color-neutral-800)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 7px',
                color: 'var(--color-accent-400)',
                fontSize: 11.5,
                ...METRIC,
              }}
            >
              {`${runs.length} run${runs.length === 1 ? '' : 's'}`}
            </button>
          )}
        </>
      }
      views={solo ? SOLO_VIEW_IDS : VIEW_IDS}
      view={view}
      onViewChange={onViewChange}
      labelOf={solo ? (id) => (id === 'wall' ? 'stream' : id) : undefined}
      metrics={metrics}
      metricRank={METRIC_RANK}
      appearance={appearance}
    />
  );
}
