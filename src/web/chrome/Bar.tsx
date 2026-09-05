import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import type { SettingsStore } from '../state/useSettings';
import { ConfigMenu } from './ConfigMenu';

// The bar is one 40px line. A child that can shrink or wrap doubles its height,
// which is the one way this layout breaks — so nothing in it is allowed to.
export const METRIC: CSSProperties = { flex: 'none', whiteSpace: 'nowrap' };

/**
 * How many metrics the bar can draw without overflowing.
 *
 * Nothing in the bar may shrink or wrap, so at a narrow viewport the surplus
 * metrics would silently run off the edge. Which ones go is not this hook's
 * business — see {@link keptMetrics}; this only answers how many fit.
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
 * Which metrics survive when only `fitted` of them do, in READING order.
 *
 * Keyed off each element's key and never off its position: both bars build
 * their metric list conditionally — a team with no branch, a run launched
 * outside a task — so the same metric sits at a different index run to run, and
 * a positional rule would shed whichever one happened to land there.
 */
export function keptMetrics(
  metrics: readonly ReactElement[],
  rank: Record<string, number>,
  fitted: number,
): ReactElement[] {
  const kept = new Set(
    [...metrics]
      .sort((a, b) => rank[String(a.key)] - rank[String(b.key)])
      .slice(0, fitted)
      .map((m) => m.key),
  );
  return metrics.filter((m) => kept.has(m.key));
}

export interface BarProps<T extends string> {
  /** `TEAM` or `RUN` — which shell the operator is looking at. */
  wordmark: string;
  /** The picker slot, between the wordmark and the pills: what is on screen, and how to change it. */
  picker: ReactNode;
  views: readonly T[];
  view: T;
  onViewChange(view: T): void;
  /**
   * What a pill READS, when that differs from its id. Decision 24's one case:
   * a solo session's `wall` labels itself `stream` — the single column already
   * is the parent's stream, so only the word changes, never the route.
   */
  labelOf?(view: T): string;
  /** The right-hand readouts, in READING order. Each one carries {@link METRIC} and a key. */
  metrics: ReactElement[];
  /** The order those keys are SHED in when the bar runs out of room. Lower survives longer. */
  metricRank: Record<string, number>;
  appearance: SettingsStore;
}

/**
 * The console's one-line chrome, shared by both modes. Team mode fills it with
 * six views and the session's figures, workflow mode with four and the run's —
 * the shell itself only owns the line, which is why it is one component: the
 * discipline that keeps the bar 40px tall cannot be enforced twice.
 *
 * Shedding lives here for the same reason. "Never let them bleed past the
 * frame" is one rule, and it was implemented only for the team bar, so the
 * workflow bar quietly ran its figures off the edge at any width under 1094px.
 * Each mode still chooses its own order — that is the part that differs — but
 * the mechanism is not written twice.
 */
export function Bar<T extends string>({
  wordmark, picker, views, view, onViewChange, labelOf, metrics, metricRank, appearance,
}: BarProps<T>) {
  const [configOpen, setConfigOpen] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const fitted = useFittedCount(metrics.length, bar);

  return (
    <div
      ref={bar}
      data-testid="bar"
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
      {/* The id is half of the picker trigger's accessible name — SessionPicker
          names itself `team-wordmark team-trigger-name`. */}
      <span
        id="team-wordmark"
        data-testid="bar-wordmark"
        style={{
          color: 'var(--color-accent)',
          letterSpacing: '.14em',
          fontWeight: 700,
          fontSize: 11,
          ...METRIC,
        }}
      >
        {wordmark}
      </span>
      {picker}

      <div
        role="tablist"
        aria-label="view"
        style={{ display: 'flex', gap: 2, marginLeft: 2, ...METRIC }}
      >
        {views.map((id) => (
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
            {labelOf?.(id) ?? id}
          </button>
        ))}
      </div>

      <span style={{ flex: 1, minWidth: 8 }} />

      {keptMetrics(metrics, metricRank, fitted)}

      {/* Chrome, not a metric: it is never shed, so the operator can always
          reach the theme even on a bar too narrow for a single figure. */}
      <ConfigMenu appearance={appearance} open={configOpen} onOpenChange={setConfigOpen} />
    </div>
  );
}
