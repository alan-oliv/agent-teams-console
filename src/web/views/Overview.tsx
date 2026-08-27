import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Agent } from '../../shared/domain';
import { AGENT_STATUS } from '../../shared/status';
import { Portrait } from '../components/Portrait';
import { StatusGlyph } from '../components/StatusGlyph';
import { TranscriptFeed } from '../components/TranscriptFeed';
import { costLabel, elapsedLabel, pctLabel } from '../format';

// Matches the --terminal-ground token (theme.css); kept literal so the tint
// toggle below reads back as a resolved rgb() in jsdom, not a var() string.
const GROUND = '#12141f';

export function Overview({
  agents, focused, onFocus, now,
}: {
  agents: Agent[];
  focused: string | null;
  onFocus: (name: string) => void;
  now: number;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div
      data-testid="overview"
      style={{ flex: 1, display: 'flex', gap: '1px', background: 'var(--color-neutral-900)', minHeight: 0 }}
    >
      {agents.map((agent) => {
        const status = AGENT_STATUS[agent.status];
        const pct = pctLabel(agent.contextTokens, agent.contextLimit);
        const isTinted = agent.name === focused || hovered === agent.name;

        const tile: CSSProperties = {
          flex: 1,
          minWidth: '0px',
          background: isTinted ? 'var(--color-bg)' : GROUND,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          cursor: 'pointer',
          opacity: agent.status === 'departed' ? 0.55 : 1,
        };

        function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onFocus(agent.name);
          }
        }

        return (
          <div
            key={agent.name}
            data-testid="overview-tile"
            role="button"
            tabIndex={0}
            aria-current={agent.name === focused}
            style={tile}
            onClick={() => onFocus(agent.name)}
            onKeyDown={onKeyDown}
            onMouseEnter={() => setHovered(agent.name)}
            onMouseLeave={() => setHovered((h) => (h === agent.name ? null : h))}
          >
            <div
              style={{
                padding: '9px 10px 8px',
                borderBottom: '1px solid var(--color-neutral-900)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <Portrait agent={agent} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', gap: '5px', alignItems: 'baseline' }}>
                    <StatusGlyph status={agent.status} size={10} />
                    <span
                      data-testid="overview-name"
                      style={{ color: 'var(--color-text)', fontWeight: 500, fontSize: '12px' }}
                    >
                      {agent.name}
                    </span>
                  </div>
                  <span
                    data-testid="overview-type"
                    style={{
                      color: 'var(--color-neutral-600)',
                      fontSize: '9.5px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {agent.agentType}
                  </span>
                </div>
              </div>

              <div
                data-testid="overview-status-row"
                style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}
              >
                <span data-testid="overview-status" style={{ color: status.color }}>{status.label}</span>
                <span data-testid="overview-pct" style={{ color: 'var(--color-neutral-600)' }}>{pct}</span>
              </div>

              <div
                data-testid="overview-track"
                style={{
                  height: '4px',
                  borderRadius: '2px',
                  background: 'var(--color-neutral-900)',
                  overflow: 'hidden',
                }}
              >
                <div
                  data-testid="overview-fill"
                  style={{ height: '100%', background: 'var(--color-accent-600)', width: pct }}
                />
              </div>
            </div>

            <TranscriptFeed lines={agent.transcript} size="overview" />

            <div
              data-testid="overview-footer"
              style={{
                borderTop: '1px solid var(--color-neutral-900)',
                padding: '6px 10px',
                display: 'flex',
                gap: '6px',
                color: 'var(--color-neutral-700)',
                fontSize: '9.5px',
              }}
            >
              <span data-testid="overview-elapsed">{elapsedLabel(agent.startedAt, now)}</span>
              <span style={{ flex: 1 }} />
              <span data-testid="overview-cost">{costLabel(agent.costUsd)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
