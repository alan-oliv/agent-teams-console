import { useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import type { SettingsStore } from '../state/useSettings';
import { ConfigMenu } from './ConfigMenu';

// The bar is one 40px line. A child that can shrink or wrap doubles its height,
// which is the one way this layout breaks — so nothing in it is allowed to.
export const METRIC: CSSProperties = { flex: 'none', whiteSpace: 'nowrap' };

export interface BarProps<T extends string> {
  ref?: Ref<HTMLDivElement>;
  /** `TEAM` or `RUN` — which shell the operator is looking at. */
  wordmark: string;
  /** The picker slot, between the wordmark and the pills: what is on screen, and how to change it. */
  picker: ReactNode;
  views: readonly T[];
  view: T;
  onViewChange(view: T): void;
  /** The right-hand readouts, in reading order. Each one carries {@link METRIC}. */
  metrics: ReactNode;
  appearance: SettingsStore;
}

/**
 * The console's one-line chrome, shared by both modes. Team mode fills it with
 * six views and the session's figures, workflow mode with four and the run's —
 * the shell itself only owns the line, which is why it is one component: the
 * discipline that keeps the bar 40px tall cannot be enforced twice.
 */
export function Bar<T extends string>({
  ref, wordmark, picker, views, view, onViewChange, metrics, appearance,
}: BarProps<T>) {
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <div
      ref={ref}
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
      {/* The id is half of the picker trigger's accessible name — TeamSelect
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
            {id}
          </button>
        ))}
      </div>

      <span style={{ flex: 1, minWidth: 8 }} />

      {metrics}

      {/* Chrome, not a metric: it is never shed, so the operator can always
          reach the theme even on a bar too narrow for a single figure. */}
      <ConfigMenu appearance={appearance} open={configOpen} onOpenChange={setConfigOpen} />
    </div>
  );
}
