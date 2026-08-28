import { memo, useState } from 'react';
import type { Agent } from '../../shared/domain';
import { StatusGlyph } from '../components/StatusGlyph';
import { formatPct } from '../format';

const IDLE_COLLAPSE_AT = 3;
const LEGEND = '↑↓ select · ⏎ open · esc interrupt · x stop · ⌃T tasks · t teams';

// The dock is mounted in every view, so it renders on every SSE frame and every clock
// tick. Memoised so only the chips whose agent actually moved re-render; the click
// handler is built here rather than passed down as an inline arrow, which would make
// memo miss with no visible symptom.
const Chip = memo(function Chip({
  agent, isFocused, onFocus,
}: {
  agent: Agent;
  isFocused: boolean;
  onFocus: (name: string) => void;
}) {
  return (
    <button
      type="button"
      className="chip"
      data-testid="agent-chip"
      aria-pressed={isFocused}
      onClick={() => onFocus(agent.name)}
      style={{
        border: '1px solid var(--color-neutral-900)',
        borderRadius: 'var(--radius-sm)',
        padding: '2px 7px',
        display: 'flex',
        gap: 5,
        alignItems: 'baseline',
        whiteSpace: 'nowrap',
      }}
    >
      <StatusGlyph status={agent.status} size={10} />
      <span style={{ color: 'var(--color-neutral-400)' }}>{agent.name}</span>
      <span style={{ color: 'var(--color-neutral-700)' }}>
        {formatPct(agent.contextTokens / agent.contextLimit)}
      </span>
    </button>
  );
});

export interface PanelProps {
  agents: Agent[];
  focusedAgent: string | null;
  onFocusAgent(name: string): void;
}

export function Panel({ agents, focusedAgent, onFocusAgent }: PanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [departedExpanded, setDepartedExpanded] = useState(false);

  // Departed agents are gone for good, so they never occupy an addressable
  // chip — they only ever appear collapsed, unlike idle which needs >3 first.
  const live = agents.filter((a) => a.status !== 'departed');
  const departed = agents.filter((a) => a.status === 'departed');

  const idle = live.filter((a) => a.status === 'idle');
  const collapsed = idle.length > IDLE_COLLAPSE_AT && !expanded;
  const shown = collapsed ? live.filter((a) => a.status !== 'idle') : live;

  return (
    <div
      style={{
        borderTop: '1px solid var(--color-neutral-900)',
        background: 'var(--terminal-ground)',
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 10.5,
      }}
    >
      <span style={{ color: 'var(--color-neutral-700)', letterSpacing: '.12em' }}>PANEL</span>
      <div style={{ display: 'flex', gap: 6, flex: 1, overflow: 'hidden' }}>
        {shown.map((a) => (
          <Chip
            key={a.name}
            agent={a}
            isFocused={a.name === focusedAgent}
            onFocus={onFocusAgent}
          />
        ))}
        {collapsed && (
          <button
            type="button"
            className="chip"
            data-testid="idle-chip"
            onClick={() => setExpanded(true)}
            style={{
              border: '1px dashed var(--color-neutral-800)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 7px',
              color: 'var(--color-neutral-700)',
              whiteSpace: 'nowrap',
            }}
          >
            {`${idle.length} idle agents`}
          </button>
        )}
        {departed.length > 0 && (
          <button
            type="button"
            className="chip"
            data-testid="departed-chip"
            onClick={() => setDepartedExpanded((e) => !e)}
            style={{
              border: '1px dashed var(--color-neutral-800)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 7px',
              color: 'var(--color-neutral-700)',
              whiteSpace: 'nowrap',
            }}
          >
            {`${departed.length} departed`}
          </button>
        )}
        {departedExpanded &&
          departed.map((a) => (
            <span
              key={a.name}
              data-testid="departed-name"
              style={{ color: 'var(--color-neutral-800)', whiteSpace: 'nowrap' }}
            >
              {a.name}
            </span>
          ))}
      </div>
      <span style={{ color: 'var(--color-neutral-700)', whiteSpace: 'nowrap' }}>{LEGEND}</span>
    </div>
  );
}
