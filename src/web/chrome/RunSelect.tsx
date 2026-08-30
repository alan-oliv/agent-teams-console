import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { WorkflowRun } from '../../shared/domain';

const PANEL_WIDTH = '360px';

export const RUN_STATUS_COLOR: Record<WorkflowRun['status'], string> = {
  completed: 'var(--color-accent-400)',
  running: 'var(--color-accent-500)',
  killed: 'var(--color-neutral-600)',
  failed: 'var(--color-neutral-500)',
};

/**
 * Live first, then newest. The frame sorts by `startedAt`, which a live run does
 * not have — so it lands LAST there, and the run still going is the one the
 * operator opened the list for.
 */
export function runOrder(runs: readonly WorkflowRun[]): WorkflowRun[] {
  return [...runs].sort(
    (a, b) => Number(b.live) - Number(a.live) || (b.startedAt ?? -1) - (a.startedAt ?? -1),
  );
}

/** A live run's name reaches disk only in the snapshot, which does not exist yet. */
export const runLabel = (run: WorkflowRun): string => run.name ?? 'unnamed run';

const ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  width: '100%',
  padding: '6px 14px',
  textAlign: 'left',
};

export interface RunSelectProps {
  /** The run on screen. */
  run: WorkflowRun;
  /** Every run this session has, in frame order — {@link runOrder} re-sorts them. */
  runs: readonly WorkflowRun[];
  onSelect(runId: string | null): void;
  /**
   * The session's name, when a team is running behind this run. Present only
   * when there is a team to go back to: selecting a run while one exists is the
   * client overriding the server's mode, and the override has to be reversible.
   */
  backToTeam?: string;
}

export function RunSelect({ run, runs, onSelect, backToTeam }: RunSelectProps) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // pointerdown, not click, so dismissal beats the focus move — same rule the
    // team picker follows.
    function onPointerDown(e: PointerEvent) {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // preventDefault is what stops the global handler acting on the Escape.
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function pick(runId: string | null) {
    setOpen(false);
    onSelect(runId);
  }

  return (
    <div
      ref={wrapper}
      style={{
        position: 'relative',
        alignSelf: 'stretch',
        display: 'flex',
        alignItems: 'center',
        flex: 'none',
      }}
    >
      <button
        ref={trigger}
        className="team-trigger"
        data-testid="run-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="run-list"
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 7,
          flex: 'none',
          whiteSpace: 'nowrap',
          padding: '3px 8px',
          margin: '-3px 0',
          border: '1px solid var(--color-neutral-800)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <span
          data-testid="wf-identity"
          style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}
        >
          <span style={{ color: 'var(--color-text)' }}>{runLabel(run)}</span>
          <span style={{ color: 'var(--color-neutral-600)', fontSize: 11 }}>{run.runId}</span>
        </span>
        <span aria-hidden="true" style={{ color: 'var(--color-accent-400)', fontSize: 10 }}>
          ▾
        </span>
      </button>

      {open && (
        <div
          id="run-list"
          data-testid="run-list"
          role="listbox"
          aria-label="runs"
          style={{
            position: 'absolute',
            // The bar's own 9px padding, so the panel lands on its bottom border.
            top: 'calc(100% + 9px)',
            left: 0,
            zIndex: 10,
            width: PANEL_WIDTH,
            paddingBottom: 6,
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <div
            style={{
              padding: '10px 14px 8px',
              color: 'var(--color-neutral-600)',
              fontSize: '10.5px',
              letterSpacing: '.12em',
            }}
          >
            {`RUNS ON THIS SESSION · ${runs.length}`}
          </div>

          {backToTeam !== undefined && (
            <button
              className="thread-row"
              data-testid="run-back-to-team"
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => pick(null)}
              style={{ ...ROW, borderBottom: '1px solid var(--color-neutral-900)' }}
            >
              <span style={{ color: 'var(--color-accent-400)' }}>{'←'}</span>
              <span style={{ color: 'var(--color-text)' }}>{backToTeam}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--color-neutral-600)' }}>team</span>
            </button>
          )}

          {runOrder(runs).map((r) => (
            <button
              key={r.runId}
              className="thread-row"
              data-testid="run-option"
              data-run={r.runId}
              type="button"
              role="option"
              aria-selected={r.runId === run.runId}
              onClick={() => pick(r.runId)}
              style={ROW}
            >
              <span
                style={{
                  color: r.runId === run.runId ? 'var(--color-text)' : 'var(--color-neutral-400)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {runLabel(r)}
              </span>
              <span style={{ color: 'var(--color-neutral-600)', fontSize: 11 }}>{r.runId}</span>
              <span style={{ marginLeft: 'auto', color: RUN_STATUS_COLOR[r.status] }}>
                {r.status}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
