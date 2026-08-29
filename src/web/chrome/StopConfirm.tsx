import type { CSSProperties } from 'react';
import type { Agent } from '../../shared/domain';

/**
 * What stopping an agent actually costs the operator, in the two shapes it
 * takes. Kept beside the strip that shows it so the wording and the action it
 * guards cannot drift apart.
 *
 * Stopping the lead is not a bigger version of stopping a teammate: teammates
 * run inside the lead's session, so ending it ends them. The strip says so
 * rather than letting `⏻` read as "stop one more agent".
 */
export function stopPrompt(target: Agent): { q: string; why: string; verb: string } {
  return target.isLead
    ? {
        q: 'end the session?',
        why: 'the lead cannot be stopped on its own — every teammate is asked to stop with it',
        verb: 'end session',
      }
    : {
        q: `stop ${target.name}?`,
        why: 'it stops at its next turn boundary · its context goes with it',
        verb: `stop ${target.name}`,
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
  if (!target) return null;
  const { q, why, verb } = stopPrompt(target);
  return (
    <div data-testid="stop-confirm" style={BAR} role="alertdialog" aria-label={q}>
      <span style={{ color: '#c98d8d', fontSize: '11px', whiteSpace: 'nowrap', flex: 'none' }}>{q}</span>
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
        style={{ ...BUTTON, border: '1px solid #6b4f2c', color: '#d99e5c' }}
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
