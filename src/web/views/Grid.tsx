import { memo, type KeyboardEvent } from 'react';
import type { Agent, Subagent, SubagentTree } from '../../shared/domain';
import { ContextMeter } from '../components/ContextMeter';
import { Elapsed, NowContext } from '../components/Elapsed';
import { Portrait } from '../components/Portrait';
import { StatusGlyph } from '../components/StatusGlyph';
import { StopControlButton } from '../components/StopButton';
import { TranscriptFeed } from '../components/TranscriptFeed';
import { wallOrder } from '../../shared/roster';
import { DORMANT_OPACITY, isDormant } from '../../shared/status';
import { useCast } from '../state/useCast';

const PANES = 6;

// Memoised so an SSE frame only re-renders the panes whose agent actually moved.
const Pane = memo(function Pane({
  agent, isFocused, onFocus, subagents,
}: {
  agent: Agent;
  isFocused: boolean;
  onFocus: (name: string) => void;
  /** This agent's own Task/Agent dispatches, in spawn order. */
  subagents?: Subagent[];
}) {
  // Display only — focus still carries the real name.
  const display = useCast().asChar(agent.name).display;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onFocus(agent.name);
    }
  }

  return (
    <div
      data-testid="grid-pane"
      role="button"
      tabIndex={0}
      aria-current={isFocused}
      onClick={() => onFocus(agent.name)}
      onKeyDown={onKeyDown}
      style={{
        background: 'var(--term)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        minWidth: 0,
        cursor: 'pointer',
        opacity: isDormant(agent.status) ? DORMANT_OPACITY : 1,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: '9px',
          alignItems: 'center',
          padding: '8px 11px',
          background: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-neutral-900)',
        }}
      >
        <Portrait agent={agent} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline' }}>
            <StatusGlyph status={agent.status} size={10} />
            <span
              data-testid="grid-name"
              style={{ color: 'var(--color-text)', fontWeight: 500, fontSize: '12.5px' }}
            >
              {display}
            </span>
            <span style={{ flex: 1 }} />
            <span
              data-testid="grid-model"
              style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}
            >
              {agent.model}
            </span>
            <StopControlButton agent={agent} />
          </div>
          <div style={{ display: 'flex', gap: '7px', alignItems: 'baseline' }}>
            <ContextMeter
              contextTokens={agent.contextTokens}
              contextLimit={agent.contextLimit}
              compactAt={agent.compactAt}
              barSize={10}
              textSize={10}
            />
            <span style={{ flex: 1 }} />
            <span
              data-testid="grid-elapsed"
              style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}
            >
              <Elapsed startedAt={agent.startedAt} />
            </span>
          </div>
        </div>
      </div>

      <TranscriptFeed
        lines={agent.transcript}
        size="grid"
        working={agent.status === 'working'}
        subagents={subagents}
      />

      <div
        data-testid="grid-tool"
        style={{
          borderTop: '1px solid var(--color-neutral-900)',
          padding: '6px 11px',
          color: 'var(--color-neutral-600)',
          fontSize: '10px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {agent.currentTool ?? ''}
      </div>
    </div>
  );
});

export function Grid({
  agents, focused, onFocus, now, subagents,
}: {
  agents: Agent[];
  focused: string | null;
  onFocus: (name: string) => void;
  now: number;
  /** Every roster agent's Task/Agent dispatches, keyed by dispatcher name. */
  subagents?: SubagentTree;
}) {
  // Lead first, then live, then departed — a stale departed agent must not
  // hoard a pane while a live teammate is pushed into the '+N more' chip.
  const shown = wallOrder(agents).slice(0, PANES);
  const overflow = agents.length - shown.length;

  return (
    <div
      data-testid="grid"
      style={{
        flex: 1,
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: 'repeat(3,1fr)',
        gridTemplateRows: 'repeat(2,1fr)',
        gap: '1px',
        background: 'var(--color-neutral-900)',
        minHeight: 0,
      }}
    >
      <NowContext value={now}>
        {shown.map((agent) => (
          <Pane
            key={agent.name}
            agent={agent}
            isFocused={agent.name === focused}
            onFocus={onFocus}
            subagents={subagents?.[agent.name]}
          />
        ))}
      </NowContext>

      {overflow > 0 && (
        <span
          data-testid="grid-overflow"
          style={{
            position: 'absolute',
            right: '10px',
            bottom: '8px',
            border: '1px dashed var(--color-neutral-800)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 7px',
            color: 'var(--color-neutral-600)',
            fontSize: '10.5px',
            background: 'var(--color-bg)',
          }}
        >
          {`+${overflow} more`}
        </span>
      )}
    </div>
  );
}
