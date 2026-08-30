import { memo, useCallback, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Agent } from '../../shared/domain';
import { AGENT_STATUS, DORMANT_OPACITY, isDormant } from '../../shared/status';
import { Elapsed, NowContext } from '../components/Elapsed';
import { Portrait } from '../components/Portrait';
import { StatusGlyph } from '../components/StatusGlyph';
import { StopControlButton } from '../components/StopButton';
import { TranscriptFeed } from '../components/TranscriptFeed';
import { costLabel, pctLabel } from '../format';

// Matches the --terminal-ground token (theme.css); kept literal so the tint
// toggle below reads back as a resolved rgb() in jsdom, not a var() string.
const GROUND = 'var(--term)';

// Memoised so an SSE frame only re-renders the tiles whose agent actually moved.
// Every prop must be stable across frames for that to hold: `isTinted` is passed
// precomputed rather than the hovered name, and the handlers are hoisted callbacks.
const Tile = memo(function Tile({
  agent, isFocused, isTinted, onFocus, onHoverEnter, onHoverLeave,
}: {
  agent: Agent;
  isFocused: boolean;
  isTinted: boolean;
  onFocus: (name: string) => void;
  onHoverEnter: (name: string) => void;
  onHoverLeave: (name: string) => void;
}) {
  const status = AGENT_STATUS[agent.status];
  const pct = pctLabel(agent.contextTokens, agent.contextLimit);

  const tile: CSSProperties = {
    flex: 1,
    minWidth: '0px',
    background: isTinted ? 'var(--color-bg)' : GROUND,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    cursor: 'pointer',
    opacity: isDormant(agent.status) ? DORMANT_OPACITY : 1,
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
      data-testid="overview-tile"
      role="button"
      tabIndex={0}
      aria-current={isFocused}
      style={tile}
      onClick={() => onFocus(agent.name)}
      onKeyDown={onKeyDown}
      onMouseEnter={() => onHoverEnter(agent.name)}
      onMouseLeave={() => onHoverLeave(agent.name)}
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
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              <span
                data-testid="overview-type"
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: 'var(--color-neutral-600)',
                  fontSize: '9.5px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {agent.agentType}
              </span>
              <span
                data-testid="overview-model"
                style={{
                  flex: 'none',
                  color: 'var(--color-neutral-700)',
                  fontSize: '10.5px',
                  whiteSpace: 'nowrap',
                }}
              >
                {agent.model}
              </span>
            </div>
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

      <TranscriptFeed
        lines={agent.transcript}
        size="overview"
        working={agent.status === 'working'}
      />

      <div
        data-testid="overview-footer"
        style={{
          borderTop: '1px solid var(--color-neutral-900)',
          padding: '6px 10px',
          display: 'flex',
          gap: '6px',
          // Not 9.5px at neutral-700 (2.69-2.80:1): that register is
          // neutral-600 at 10px everywhere in the console.
          color: 'var(--color-neutral-600)',
          fontSize: '10px',
        }}
      >
        <span data-testid="overview-elapsed">
          <Elapsed startedAt={agent.startedAt} />
        </span>
        <span style={{ flex: 1 }} />
        <span data-testid="overview-cost">{costLabel(agent.costUsd)}</span>
        <StopControlButton agent={agent} />
      </div>
    </div>
  );
});

export function Overview({
  agents, focused, onFocus, now,
}: {
  agents: Agent[];
  focused: string | null;
  onFocus: (name: string) => void;
  now: number;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const onHoverEnter = useCallback((name: string) => setHovered(name), []);
  const onHoverLeave = useCallback(
    (name: string) => setHovered((h) => (h === name ? null : h)),
    [],
  );

  return (
    <div
      data-testid="overview"
      style={{ flex: 1, display: 'flex', gap: '1px', background: 'var(--color-neutral-900)', minHeight: 0 }}
    >
      <NowContext value={now}>
        {agents.map((agent) => (
          <Tile
            key={agent.name}
            agent={agent}
            isFocused={agent.name === focused}
            isTinted={agent.name === focused || hovered === agent.name}
            onFocus={onFocus}
            onHoverEnter={onHoverEnter}
            onHoverLeave={onHoverLeave}
          />
        ))}
      </NowContext>
    </div>
  );
}
