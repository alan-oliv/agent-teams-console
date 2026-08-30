import type { CSSProperties } from 'react';
import type { Agent } from '../../shared/domain';
import { useCast } from '../state/useCast';

/**
 * What stopping an agent actually costs the operator, in the two shapes it
 * takes. Kept beside the strip that shows it so the wording and the action it
 * guards cannot drift apart.
 *
 * Stopping the lead is not a bigger version of stopping a teammate: teammates
 * run inside the lead's session, so ending it ends them. The strip says so
 * rather than letting `⏻` read as "stop one more agent".
 */
export function stopPrompt(
  target: Agent,
  /** What the operator calls it — the character under a movie theme. */
  shown: string = target.name,
): { q: string; why: string; verb: string } {
  return target.isLead
    ? {
        q: 'end the session?',
        why: 'the lead cannot be stopped on its own — every teammate is asked to stop with it',
        verb: 'end session',
      }
    : {
        q: `stop ${shown}?`,
        why: 'it stops at its next turn boundary · its context goes with it',
        verb: `stop ${shown}`,
      };
}

const BAR: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  borderTop: '1px solid var(--color-neutral-800)',
  background: 'var(--color-neutral-900)',
  padding: '9px 14px',
  flexWrap: 'nowrap',
};

const BUTTON: CSSProperties = {
  borderRadius: 'var(--radius-sm)',
  padding: '2px 9px',
  fontSize: '10.5px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flex: 'none',
  background: 'transparent',
};

/**
 * One confirmation, in the shared chrome, so every view is served by it — a
 * per-view copy would let the wall and the grid disagree about what stopping
 * means, and would ask twice when a click in one view is confirmed in another.
 */
export function StopConfirm({
  target,
  onConfirm,
  onCancel,
}: {
  target: Agent | null;
  onConfirm(): void;
  onCancel(): void;
}) {
  // Above the early return: a hook cannot run behind a condition.
  const { asChar } = useCast();
  if (!target) return null;
  const { q, why, verb } = stopPrompt(target, asChar(target.name).display);
  return (
    <div data-testid="stop-confirm" style={BAR} role="alertdialog" aria-label={q}>
      <span style={{ color: 'var(--fail)', fontSize: '11px', whiteSpace: 'nowrap', flex: 'none' }}>{q}</span>
      <span
        data-testid="stop-confirm-why"
        style={{
          color: 'var(--color-neutral-400)',
          fontSize: '11px',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {why}
      </span>
      <span style={{ flex: 1 }} />
      <button
        data-testid="stop-confirm-go"
        onClick={onConfirm}
        style={{ ...BUTTON, border: '1px solid var(--warn-edge)', color: 'var(--warn)' }}
      >
        {verb}
      </button>
      <button
        data-testid="stop-confirm-cancel"
        onClick={onCancel}
        style={{ ...BUTTON, border: '1px solid var(--color-neutral-800)', color: 'var(--color-neutral-500)' }}
      >
        cancel
      </button>
    </div>
  );
}

/**
 * The other verb, never merged with the one above: dismissing a session
 * claims nothing about it, so it gets the accent treatment `StopConfirm`
 * reserves for the destructive lead case, not the warn one.
 */
export function WatchConfirm({
  show,
  onConfirm,
  onCancel,
}: {
  show: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  if (!show) return null;
  return (
    <div data-testid="watch-confirm" style={BAR} role="alertdialog" aria-label="stop watching this session?">
      <span style={{ color: 'var(--color-text)', fontSize: '11px', whiteSpace: 'nowrap', flex: 'none' }}>
        stop watching this session?
      </span>
      <span
        data-testid="watch-confirm-why"
        style={{
          color: 'var(--color-neutral-400)',
          fontSize: '11px',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        The team keeps running. The console stops following it and returns to the picker — instantly, with no
        grace period, because nothing is being asserted about the team.
      </span>
      <span style={{ flex: 1 }} />
      <button
        data-testid="watch-confirm-go"
        onClick={onConfirm}
        style={{ ...BUTTON, border: '1px solid var(--color-accent-700)', color: 'var(--color-accent-300)' }}
      >
        stop watching
      </button>
      <button
        data-testid="watch-confirm-cancel"
        onClick={onCancel}
        style={{ ...BUTTON, border: '1px solid var(--color-neutral-800)', color: 'var(--color-neutral-500)' }}
      >
        cancel
      </button>
    </div>
  );
}
