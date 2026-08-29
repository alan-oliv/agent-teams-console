import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type RefObject,
} from 'react';
import type { TeamState, ViewId } from '../../shared/domain';
import type { SettingsStore } from '../state/useSettings';
import { formatCost, formatElapsed, formatTokens, meterCells } from '../format';
import { VIEW_IDS } from '../state/useTeamState';
import { ConfigMenu } from './ConfigMenu';
import { TeamSelect } from './TeamSelect';

// The bar is one 40px line. A child that can shrink or wrap doubles its height,
// which is the one way this layout breaks — so nothing in it is allowed to.
const METRIC: CSSProperties = { flex: 'none', whiteSpace: 'nowrap' };

/**
 * How many metrics the bar can draw without overflowing.
 *
 * Nothing in the bar may shrink or wrap, so at a narrow viewport the surplus
 * metrics would silently run off the edge. Which ones go is not this hook's
 * business — see {@link METRIC_RANK}; this only answers how many fit.
 *
 * Shrink one per pass and let the layout effect re-run; widening resets to the
 * full set and lets it settle again. It terminates because a pass that changes
 * nothing renders nothing.
 */
function useFittedCount(total: number, bar: RefObject<HTMLDivElement | null>): number {
  const [shown, setShown] = useState(total);
  const lastWidth = useRef(0);

  useLayoutEffect(() => {
    const el = bar.current;
    // jsdom reports every width as 0, which would drop every metric; a bar with
    // no measurable box is one nothing can be decided about.
    if (!el || el.clientWidth === 0) return;
    const fit = () => {
      const grew = el.clientWidth > lastWidth.current;
      lastWidth.current = el.clientWidth;
      if (grew) setShown(total);
      // Absolute, not a functional decrement. This effect has no dep array, so
      // it re-observes on every pass and ResizeObserver fires again on observe —
      // fit() runs several times against ONE committed layout, and a functional
      // n - 1 per call shed three metrics off a 3px overflow, leaving the bar a
      // third empty. Every call in a commit now computes the same value and
      // React drops the repeats.
      else if (el.scrollWidth > el.clientWidth) setShown(Math.max(0, shown - 1));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  });

  return Math.min(shown, total);
}

/**
 * The order metrics are SHED in, which is not the order they are read in. The
 * bar reads left to right in the handoff's arrangement, and when it runs out of
 * room the handoff sheds the token figure and keeps the spend. Dropping
 * whatever sits rightmost would shed exactly the figure the sixth switcher pill
 * was blamed for bleeding off-frame. Lower survives longer.
 */
const METRIC_RANK: Record<string, number> = {
  tasks: 0,
  windows: 1,
  spend: 2,
  limits: 3,
  meter: 4,
  tokens: 5,
};

export interface StatusBarProps {
  state: TeamState;
  view: ViewId;
  onViewChange(view: ViewId): void;
  now: number;
  teamsOpen: boolean;
  onTeamsOpenChange(open: boolean): void;
  appearance: SettingsStore;
}

export function StatusBar({
  state, view, onViewChange, now, teamsOpen, onTeamsOpenChange, appearance,
}: StatusBarProps) {
  const [configOpen, setConfigOpen] = useState(false);
  const done = state.tasks.filter((t) => t.state === 'completed').length;
  // Team context occupancy — what the meter has always looked like it meant.
  // It used to divide the CUMULATIVE token total by a capacity, which pins it
  // solid full on any real session and carries no information.
  const totalLimit = state.agents.reduce((n, a) => n + a.contextLimit, 0);
  const occupied = state.agents.reduce((n, a) => n + a.contextTokens, 0);

  // Reading order — the handoff's arrangement. What goes when the bar runs out
  // of room is METRIC_RANK's business, not this list's.
  const metrics: ReactElement[] = [
    <span key="tasks" style={{ color: 'var(--color-neutral-600)', ...METRIC }}>
      {`tasks ${done}/${state.tasks.length}`}
    </span>,
    <span key="windows" style={{ color: 'var(--color-neutral-600)', ...METRIC }}>
      {`${state.agents.length} windows`}
    </span>,
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

  const bar = useRef<HTMLDivElement>(null);
  const fitted = useFittedCount(metrics.length, bar);
  const kept = new Set(
    [...metrics]
      .sort((a, b) => METRIC_RANK[String(a.key)] - METRIC_RANK[String(b.key)])
      .slice(0, fitted)
      .map((m) => m.key),
  );

  return (
    <div
      ref={bar}
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'nowrap',
        gap: 10,
        padding: '9px 14px',
        borderBottom: '1px solid var(--color-neutral-900)',
        background: 'var(--color-bg)',
        fontSize: 12.5,
      }}
    >
      <span
        id="team-wordmark"
        style={{
          color: 'var(--color-accent)',
          letterSpacing: '.14em',
          fontWeight: 700,
          fontSize: 11,
          ...METRIC,
        }}
      >
        TEAM
      </span>
      <TeamSelect
        current={state.teamName}
        sessionName={state.sessionName}
        open={teamsOpen}
        onOpenChange={onTeamsOpenChange}
        now={now}
      />

      <div
        role="tablist"
        aria-label="view"
        style={{ display: 'flex', gap: 2, marginLeft: 2, ...METRIC }}
      >
        {VIEW_IDS.map((id) => (
          <button
            key={id}
            className="tab"
            type="button"
            role="tab"
            aria-selected={id === view}
            onClick={() => onViewChange(id)}
            style={{
              padding: '1px 9px',
              fontSize: 11.5,
              whiteSpace: 'nowrap',
              borderRadius: 'var(--radius-sm)',
              color: id === view ? 'var(--color-text)' : 'var(--color-neutral-600)',
              background: id === view ? 'var(--color-accent-900)' : 'transparent',
              boxShadow: id === view ? 'inset 0 0 0 1px var(--color-accent-700)' : 'none',
            }}
          >
            {id}
          </button>
        ))}
      </div>

      <span style={{ flex: 1, minWidth: 8 }} />

      {metrics.filter((m) => kept.has(m.key))}

      {/* Chrome, not a metric: it is never shed, so the operator can always
          reach the theme even on a bar too narrow for a single figure. */}
      <ConfigMenu appearance={appearance} open={configOpen} onOpenChange={setConfigOpen} />
    </div>
  );
}
