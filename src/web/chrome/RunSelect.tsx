import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { WorkflowRun } from '../../shared/domain';

const PANEL_WIDTH = '360px';

/**
 * Measured, not chosen — and unlike the team trigger's fixed 146px it is
 * derived from the BAR's budget rather than from the name, because run names
 * have no shape to derive from: the runtime defaults an unlabelled one to the
 * prompt's first 60 characters, and a run named after its own task is longer.
 *
 * Unbounded, a 65-character name measured 610px: 87% of a 700px bar, with the
 * view pills, the task id and every total pushed off the frame, so the operator
 * could not reach a single workflow view.
 *
 * Two terms, because one number cannot serve both ends of the range:
 *
 * - `236px` is what the bar can spare at its 1180px design width, and the point
 *   at which the identity stops growing. Below it a typical run name — the
 *   13-char `team-selector` — still renders whole.
 * - `26vw` is the narrow end. With every metric shed the rest of the bar still
 *   costs 741.48px (padding, wordmark, the 146px team trigger, the four pills,
 *   the spacer, and the gear, which is chrome and never sheds), so at 700px the
 *   trigger may take at most 194.52px — 27.79% of the frame. 26vw keeps a
 *   margin for a scrollbar counted inside `vw`, and holds the bar whole down to
 *   ~684px.
 *
 * A max-width and never a flex-shrink: every child of this bar is `flex: none`,
 * and one that could shrink would wrap and double the bar's height.
 */
const TRIGGER_MAX_WIDTH = 'min(236px, 26vw)';

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
          maxWidth: TRIGGER_MAX_WIDTH,
          whiteSpace: 'nowrap',
          padding: '3px 8px',
          margin: '-3px 0',
          border: '1px solid var(--color-neutral-800)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        {/* `min-width: 0` is what lets the name give: a flex item floors at its
            own content width otherwise, and the trigger would blow past its cap
            rather than ellipsise. */}
        <span
          data-testid="wf-identity"
          style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}
        >
          <span
            data-testid="run-name"
            style={{
              color: 'var(--color-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {runLabel(run)}
          </span>
          {/* The identity survives the squeeze whole — a half-drawn runId
              identifies nothing, so the name is what gives. */}
          <span
            data-testid="run-runid"
            style={{ color: 'var(--color-neutral-600)', fontSize: 11, flex: 'none' }}
          >
            {run.runId}
          </span>
        </span>
        <span
          data-testid="run-caret"
          aria-hidden="true"
          style={{ color: 'var(--color-accent-400)', fontSize: 10, flex: 'none' }}
        >
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
