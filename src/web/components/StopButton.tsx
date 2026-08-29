import { createContext, useContext, useState, type CSSProperties } from 'react';
import type { Agent } from '../../shared/domain';

export interface StopControl {
  /** Agents this operator has already asked to stop, by name. */
  requested: ReadonlySet<string>;
  /** Opens the confirmation. Nothing is sent until it is confirmed. */
  ask(agent: Agent): void;
  /** A read-only console shows the control disabled rather than hiding it. */
  readOnly: boolean;
}

// Every view puts this control on its agent rows, and the panel carries it in
// the chrome. Threading `requested` and `ask` through four view components as
// props would touch every one of them for a control none of them own — the
// same reason NowContext exists.
export const StopContext = createContext<StopControl | null>(null);

/**
 * The glyph and tooltip for one agent's stop affordance.
 *
 * Deliberately NOT the prototype's third state. The prototype flips a row to
 * "stopped by you" the moment you confirm, because its `stopped` map is local
 * state with nothing behind it. The real control POSTs a `shutdown_request`
 * into the agent's inbox, which it reads at its next turn boundary and MAY
 * decline — the same delivery semantics the comms view goes out of its way to
 * show as `delivered · unread 34s`. Claiming the agent is stopped while it is
 * still working would be the one thing that view exists to prevent, so a
 * requested stop reads as requested until the agent is actually gone.
 */
export function stopAffordance(
  agent: Agent,
  requested: boolean,
): { glyph: string; title: string; color: string } {
  if (agent.status === 'departed') {
    return {
      glyph: '↻',
      // There is no external respawn path — the server asks the lead to do it.
      title: agent.isLead ? 'the session has ended' : 'ask the lead to respawn this teammate',
      color: 'var(--color-neutral-700)',
    };
  }
  if (requested) {
    return {
      glyph: agent.isLead ? '⏻' : '✕',
      title: 'stop requested — it stops at its next turn boundary',
      color: 'var(--warn)',
    };
  }
  return agent.isLead
    ? {
        glyph: '⏻',
        title: 'end the session — the lead cannot be stopped on its own',
        color: 'var(--color-neutral-600)',
      }
    : { glyph: '✕', title: 'stop this teammate', color: 'var(--color-neutral-600)' };
}

/**
 * The control as a view renders it: reads the shared stop state, and draws
 * nothing at all where no provider supplies one (a view rendered in isolation
 * by a test, or a future surface that has no business stopping anything).
 */
export function StopControlButton({ agent }: { agent: Agent }) {
  const ctx = useContext(StopContext);
  if (!ctx) return null;
  return (
    <StopButton
      agent={agent}
      requested={ctx.requested.has(agent.name)}
      disabled={ctx.readOnly || agent.status === 'departed'}
      onClick={() => ctx.ask(agent)}
    />
  );
}

export function StopButton({
  agent,
  requested,
  onClick,
  disabled,
}: {
  agent: Agent;
  requested: boolean;
  onClick(): void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const { glyph, title, color } = stopAffordance(agent, requested);
  const style: CSSProperties = {
    color: disabled ? 'var(--color-neutral-800)' : hover ? 'var(--fail)' : color,
    fontSize: '10.5px',
    cursor: disabled ? 'default' : 'pointer',
    padding: '0 2px',
    borderRadius: '3px',
    border: 'none',
    background: 'transparent',
    flex: 'none',
  };
  return (
    <button
      data-testid="stop-button"
      title={title}
      aria-label={title}
      disabled={disabled}
      style={style}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => {
        // The whole column is a click target that focuses the agent; stopping
        // it is not that.
        e.stopPropagation();
        if (!disabled) onClick();
      }}
    >
      {glyph}
    </button>
  );
}
