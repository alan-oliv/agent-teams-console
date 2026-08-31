import { memo, useState, type KeyboardEvent } from 'react';
import type { Agent } from '../../shared/domain';
import { wallOrder } from '../../shared/roster';
import { AGENT_STATUS, DORMANT_OPACITY, isDormant } from '../../shared/status';
import { Composer } from '../components/Composer';
import { Elapsed, NowContext } from '../components/Elapsed';
import { Portrait } from '../components/Portrait';
import { StatusGlyph } from '../components/StatusGlyph';
import { StopControlButton } from '../components/StopButton';
import { TranscriptFeed } from '../components/TranscriptFeed';
import { contextBar, costLabel, ctxLabel, pctLabel } from '../format';
import { useCast } from '../state/useCast';

// Memoised so an SSE frame only re-renders the rows whose agent actually moved.
// The click handler is built here rather than passed down as an inline arrow, which
// would make memo miss with no visible symptom.
const Row = memo(function Row({
  agent, isSelected, onFocus,
}: {
  agent: Agent;
  isSelected: boolean;
  onFocus: (name: string) => void;
}) {
  // Display only: the row id, the focus call and the URL keep the real name.
  const display = useCast().asChar(agent.name).display;

  return (
    <div
      id={`rail-option-${agent.name}`}
      role="option"
      aria-selected={isSelected}
      onClick={() => onFocus(agent.name)}
      style={{
        padding: '8px 10px',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        display: 'flex',
        gap: '10px',
        alignItems: 'flex-start',
        background: isSelected ? 'var(--color-bg)' : 'transparent',
        borderLeft: `2px solid ${isSelected ? 'var(--color-accent-600)' : 'transparent'}`,
        opacity: isDormant(agent.status) ? DORMANT_OPACITY : 1,
      }}
    >
      <Portrait agent={agent} slot="rail-row" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px' }}>
          <StatusGlyph status={agent.status} size={10} />
          <span data-testid="rail-name" style={{ color: 'var(--color-text)', fontWeight: 500 }}>
            {display}
          </span>
          {agent.agentType && (
            <span
              data-testid="rail-type"
              style={{
                color: 'var(--color-neutral-600)',
                fontSize: '10.5px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {agent.agentType}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <span
            data-testid="rail-model"
            style={{ color: 'var(--color-neutral-600)', fontSize: '10.5px' }}
          >
            {agent.model}
          </span>
          <span
            data-testid="rail-elapsed"
            style={{ color: 'var(--color-neutral-600)', fontSize: '10.5px' }}
          >
            <Elapsed startedAt={agent.startedAt} />
          </span>
          <StopControlButton agent={agent} />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span
            data-testid="rail-bar"
            style={{ letterSpacing: '-.5px', color: 'var(--color-accent-600)', fontSize: '11px' }}
          >
            {contextBar(agent.contextTokens, agent.contextLimit)}
          </span>
          <span
            data-testid="rail-pct"
            style={{ color: 'var(--color-neutral-500)', fontSize: '10.5px' }}
          >
            {pctLabel(agent.contextTokens, agent.contextLimit)}
          </span>
          <span style={{ flex: 1 }} />
          <span
            data-testid="rail-cost"
            style={{ color: 'var(--color-neutral-600)', fontSize: '10.5px' }}
          >
            {costLabel(agent.costUsd)}
          </span>
        </div>
      </div>
    </div>
  );
});

// Memoised for the same reason as the row: the attached pane drags a 60-line transcript
// feed and a composer behind it, so a frame in which its agent did not move must not
// reconcile any of it.
const Attached = memo(function Attached(
  { agent, readOnly, teamLive }: { agent: Agent; readOnly: boolean; teamLive: boolean },
) {
  const status = AGENT_STATUS[agent.status];
  const display = useCast().asChar(agent.name).display;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      <div
        data-testid="rail-detail-header"
        style={{
          padding: '10px 18px',
          borderBottom: '1px solid var(--color-neutral-900)',
          background: 'var(--color-bg)',
          display: 'flex',
          gap: '11px',
          alignItems: 'center',
          // One line, always — the status bar's rule. Once the role has
          // ellipsised there is nothing left to give, so the metrics clip at
          // the right edge rather than widening the page behind them.
          overflow: 'hidden',
        }}
      >
        <Portrait agent={agent} />
        <span
          data-testid="rail-detail-name"
          style={{ color: 'var(--color-text)', fontWeight: 500, fontSize: '13px' }}
        >
          {display}
        </span>
        {agent.agentType && (
          <span
            data-testid="rail-detail-type"
            style={{
              border: '1px solid var(--color-neutral-800)',
              color: 'var(--color-neutral-500)',
              borderRadius: 'var(--radius-sm)',
              padding: '0 5px',
              fontSize: '9.5px',
            }}
          >
            {agent.agentType}
          </span>
        )}
        <span style={{ fontSize: '11px', color: status.color }}>{status.label}</span>
        <span
          data-testid="rail-detail-role"
          style={{
            color: 'var(--color-neutral-600)',
            fontSize: '11px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {agent.role}
        </span>
        <span style={{ flex: 1 }} />
        <span
          data-testid="rail-detail-model"
          style={{ color: 'var(--color-neutral-600)', fontSize: '10.5px' }}
        >
          {agent.model}
        </span>
        <span
          data-testid="rail-detail-bar"
          style={{ letterSpacing: '-.5px', color: 'var(--color-accent-600)', fontSize: '11.5px' }}
        >
          {contextBar(agent.contextTokens, agent.contextLimit)}
        </span>
        <span
          data-testid="rail-detail-ctx"
          style={{ color: 'var(--color-neutral-500)', fontSize: '11px' }}
        >
          {ctxLabel(agent.contextTokens, agent.contextLimit)}
        </span>
        <span
          data-testid="rail-detail-cost"
          style={{ color: 'var(--color-neutral-600)', fontSize: '11px' }}
        >
          {costLabel(agent.costUsd)}
        </span>
      </div>

      <TranscriptFeed
        lines={agent.transcript}
        size="rail"
        agent={agent.name}
        working={agent.status === 'working'}
      />

      {/* One composer, and it is the lead's. A composer under a teammate's
          transcript implies a channel this model does not have — every send is
          a direct inbox write, and a message to any agent enters the run
          through the lead. */}
      {agent.isLead ? (
        <Composer agent={agent} variant="rail" readOnly={readOnly} teamLive={teamLive} />
      ) : (
        <div
          data-testid="rail-read-only"
          style={{
            borderTop: '1px solid var(--color-neutral-900)',
            background: 'var(--color-bg)',
            padding: '11px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
            color: 'var(--color-neutral-600)',
            fontSize: '11px',
            overflow: 'hidden',
          }}
        >
          <span style={{ flex: 'none' }}>read-only · the composer lives in the lead&apos;s column</span>
          <span style={{ flex: 1 }} />
          <span
            data-testid="rail-current-tool"
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {agent.currentTool ?? ''}
          </span>
        </div>
      )}
    </div>
  );
});

export function Rail({
  agents, focused, onFocus, now, readOnly = false,
}: {
  agents: Agent[];
  focused: string | null;
  onFocus: (name: string) => void;
  now: number;
  readOnly?: boolean;
}) {
  const ordered = wallOrder(agents);
  const startAt = Math.max(0, ordered.findIndex((a) => a.name === focused));
  const [cursor, setCursor] = useState(startAt);

  if (ordered.length === 0) return null;

  const attached = ordered.find((a) => a.name === focused) ?? ordered[0];
  // See Composer: the lead's inbox is drained by the team loop, not by the lead.
  const teamLive = ordered.some((a) => !a.isLead && a.status !== 'departed');
  const cursorAgent = ordered[Math.min(cursor, ordered.length - 1)];

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(ordered.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onFocus(cursorAgent.name);
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div
        data-testid="rail-left"
        style={{
          width: '348px',
          borderRight: '1px solid var(--color-neutral-900)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '10px 14px 8px',
            color: 'var(--color-neutral-600)',
            fontSize: '10.5px',
            letterSpacing: '.12em',
          }}
        >
          <span>{`TEAM · ${ordered.length}`}</span>
          <span>click to attach</span>
        </div>

        <div
          className="tscroll"
          role="listbox"
          tabIndex={0}
          aria-activedescendant={`rail-option-${cursorAgent.name}`}
          onKeyDown={onListKeyDown}
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            padding: '0 8px 8px',
            outline: 'none',
          }}
        >
          <NowContext value={now}>
            {ordered.map((agent) => (
              <Row
                key={agent.name}
                agent={agent}
                isSelected={agent.name === focused}
                onFocus={onFocus}
              />
            ))}
          </NowContext>
        </div>

        <div
          data-testid="rail-footer"
          style={{
            padding: '9px 16px',
            borderTop: '1px solid var(--color-neutral-900)',
            color: 'var(--color-neutral-600)',
            fontSize: '10.5px',
            display: 'flex',
            gap: '12px',
          }}
        >
          <span>↑↓ select</span>
          <span>⏎ attach</span>
          <span>esc interrupt</span>
        </div>
      </div>

      <Attached agent={attached} readOnly={readOnly} teamLive={teamLive} />
    </div>
  );
}
