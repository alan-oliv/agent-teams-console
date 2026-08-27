import { useState, type KeyboardEvent } from 'react';
import type { Agent } from '../../shared/domain';
import { AGENT_STATUS } from '../../shared/status';
import { Composer } from '../components/Composer';
import { ContextMeter } from '../components/ContextMeter';
import { Portrait } from '../components/Portrait';
import { StatusGlyph } from '../components/StatusGlyph';
import { TranscriptFeed } from '../components/TranscriptFeed';
import { costLabel, ctxLabel, elapsedLabel, pctLabel } from '../format';

export function Rail({
  agents, focused, onFocus, now,
}: {
  agents: Agent[];
  focused: string | null;
  onFocus: (name: string) => void;
  now: number;
}) {
  const startAt = Math.max(0, agents.findIndex((a) => a.name === focused));
  const [cursor, setCursor] = useState(startAt);

  if (agents.length === 0) return null;

  const attached = agents.find((a) => a.name === focused) ?? agents[0];
  const attachedStatus = AGENT_STATUS[attached.status];
  const cursorAgent = agents[Math.min(cursor, agents.length - 1)];

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(agents.length - 1, c + 1));
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
          <span>{`TEAM · ${agents.length}`}</span>
          <span>click to attach</span>
        </div>

        <div
          role="listbox"
          tabIndex={0}
          aria-activedescendant={`rail-option-${cursorAgent.name}`}
          onKeyDown={onListKeyDown}
          style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            padding: '0 8px 8px',
            outline: 'none',
          }}
        >
          {agents.map((agent) => {
            const selected = agent.name === focused;
            return (
              <div
                key={agent.name}
                id={`rail-option-${agent.name}`}
                role="option"
                aria-selected={selected}
                onClick={() => onFocus(agent.name)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'flex-start',
                  background: selected ? 'var(--color-bg)' : 'transparent',
                  borderLeft: `2px solid ${selected ? 'var(--color-accent-600)' : 'transparent'}`,
                }}
              >
                <Portrait agent={agent} slot="rail-row" />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px' }}>
                    <StatusGlyph status={agent.status} size={10} />
                    <span data-testid="rail-name" style={{ color: 'var(--color-text)', fontWeight: 500 }}>
                      {agent.name}
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
                      data-testid="rail-elapsed"
                      style={{ color: 'var(--color-neutral-700)', fontSize: '10.5px' }}
                    >
                      {elapsedLabel(agent.startedAt, now)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                    <ContextMeter
                      contextTokens={agent.contextTokens}
                      contextLimit={agent.contextLimit}
                      compactAt={agent.compactAt}
                      barSize={11}
                      textSize={10.5}
                    />
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
          })}
        </div>

        <div
          data-testid="rail-footer"
          style={{
            padding: '9px 16px',
            borderTop: '1px solid var(--color-neutral-900)',
            color: 'var(--color-neutral-700)',
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
          }}
        >
          <Portrait agent={attached} />
          <span
            data-testid="rail-detail-name"
            style={{ color: 'var(--color-text)', fontWeight: 500, fontSize: '13px' }}
          >
            {attached.name}
          </span>
          {attached.agentType && (
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
              {attached.agentType}
            </span>
          )}
          <span style={{ fontSize: '11px', color: attachedStatus.color }}>{attachedStatus.label}</span>
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
            {attached.role}
          </span>
          <span style={{ flex: 1 }} />
          <ContextMeter
            contextTokens={attached.contextTokens}
            contextLimit={attached.contextLimit}
            compactAt={attached.compactAt}
            barSize={11.5}
            textSize={11}
          />
          <span
            data-testid="rail-detail-ctx"
            style={{ color: 'var(--color-neutral-500)', fontSize: '11px' }}
          >
            {ctxLabel(attached.contextTokens, attached.contextLimit)}
          </span>
          <span
            data-testid="rail-detail-cost"
            style={{ color: 'var(--color-neutral-600)', fontSize: '11px' }}
          >
            {costLabel(attached.costUsd)}
          </span>
        </div>

        <TranscriptFeed lines={attached.transcript} size="rail" />

        <Composer agent={attached} variant="rail" />
      </div>
    </div>
  );
}
