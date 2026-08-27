import { useState } from 'react';
import type { Agent } from '../../shared/domain';
import { StatusGlyph } from '../components/StatusGlyph';
import { formatPct } from '../format';

const IDLE_COLLAPSE_AT = 3;
const LEGEND = '↑↓ select · ⏎ open · esc interrupt · x stop · ⌃T tasks';

export interface PanelProps {
  agents: Agent[];
  focusedAgent: string | null;
  onFocusAgent(name: string): void;
}

export function Panel({ agents, focusedAgent, onFocusAgent }: PanelProps) {
  const [expanded, setExpanded] = useState(false);
  const idle = agents.filter((a) => a.status === 'idle');
  const collapsed = idle.length > IDLE_COLLAPSE_AT && !expanded;
  const shown = collapsed ? agents.filter((a) => a.status !== 'idle') : agents;

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
          <button
            key={a.name}
            type="button"
            className="chip"
            data-testid="agent-chip"
            aria-pressed={a.name === focusedAgent}
            onClick={() => onFocusAgent(a.name)}
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
            <StatusGlyph status={a.status} size={10} />
            <span style={{ color: 'var(--color-neutral-400)' }}>{a.name}</span>
            <span style={{ color: 'var(--color-neutral-700)' }}>
              {formatPct(a.contextTokens / a.contextLimit)}
            </span>
          </button>
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
      </div>
      <span style={{ color: 'var(--color-neutral-700)', whiteSpace: 'nowrap' }}>{LEGEND}</span>
    </div>
  );
}
