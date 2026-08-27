import type { KeyboardEvent } from 'react';
import type { Agent } from '../../shared/domain';
import { ContextMeter } from '../components/ContextMeter';
import { Portrait } from '../components/Portrait';
import { StatusGlyph } from '../components/StatusGlyph';
import { TranscriptFeed } from '../components/TranscriptFeed';
import { elapsedLabel, pctLabel } from '../format';

const PANES = 6;

export function Grid({
  agents, focused, onFocus, now,
}: {
  agents: Agent[];
  focused: string | null;
  onFocus: (name: string) => void;
  now: number;
}) {
  const shown = agents.slice(0, PANES);
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
      {shown.map((agent) => {
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
            data-testid="grid-pane"
            role="button"
            tabIndex={0}
            aria-current={agent.name === focused}
            onClick={() => onFocus(agent.name)}
            onKeyDown={onKeyDown}
            style={{
              background: '#12141f',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              minWidth: 0,
              cursor: 'pointer',
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
                    {agent.name}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span
                    data-testid="grid-model"
                    style={{ color: 'var(--color-neutral-700)', fontSize: '10px' }}
                  >
                    {agent.model}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '7px', alignItems: 'baseline' }}>
                  <ContextMeter
                    contextTokens={agent.contextTokens}
                    contextLimit={agent.contextLimit}
                    compactAt={agent.compactAt}
                    barSize={10}
                    textSize={10}
                  />
                  <span
                    data-testid="grid-pct"
                    style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}
                  >
                    {pctLabel(agent.contextTokens, agent.contextLimit)}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span
                    data-testid="grid-elapsed"
                    style={{ color: 'var(--color-neutral-700)', fontSize: '10px' }}
                  >
                    {elapsedLabel(agent.startedAt, now)}
                  </span>
                </div>
              </div>
            </div>

            <TranscriptFeed lines={agent.transcript} size="grid" />

            <div
              data-testid="grid-tool"
              style={{
                borderTop: '1px solid var(--color-neutral-900)',
                padding: '6px 11px',
                color: 'var(--color-neutral-700)',
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
      })}

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
            color: 'var(--color-neutral-700)',
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
