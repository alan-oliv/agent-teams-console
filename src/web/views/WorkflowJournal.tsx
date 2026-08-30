import type { CSSProperties } from 'react';
import type { WorkflowAgent } from '../../shared/domain';

const FOOTER: CSSProperties = {
  flex: 'none',
  borderTop: '1px solid var(--color-neutral-900)',
  padding: '9px 16px',
  color: 'var(--color-neutral-600)',
  fontSize: '10px',
};

/**
 * What the journal actually recorded, kept distinct in three ways that a
 * blank cell would collapse into one:
 *   - a returned value, shown verbatim;
 *   - `null`, which is what a skipped or dead agent hands the script;
 *   - an EMPTY string, which is a real return value and the reason the
 *     runtime's own warning exists.
 */
function resultOf(agent: WorkflowAgent): { text: string; muted: boolean } {
  if (agent.state === 'null') return { text: 'null', muted: true };
  if (agent.result === undefined) return { text: '—', muted: true };
  if (agent.result === '') return { text: '(empty)', muted: true };
  return { text: agent.result, muted: false };
}

export function WorkflowJournal({ agents }: { agents: WorkflowAgent[] }) {
  return (
    <div data-testid="workflow-journal" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {agents.map((agent) => {
          const result = resultOf(agent);
          return (
            <div
              key={agent.agentId}
              data-testid="wf-journal-entry"
              style={{
                padding: '9px 16px',
                borderBottom: '1px solid var(--color-neutral-900)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline' }}>
                <span style={{ color: 'var(--color-neutral-400)', fontSize: '11.5px' }}>
                  {agent.label ?? agent.agentId}
                </span>
                <span style={{ color: 'var(--color-neutral-700)', fontSize: '10px' }}>{agent.agentId}</span>
                {agent.error !== undefined && (
                  <span data-testid="wf-journal-why" style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}>
                    {agent.error}
                  </span>
                )}
              </div>
              <div
                data-testid="wf-journal-result"
                style={{
                  color: result.muted ? 'var(--color-neutral-600)' : 'var(--color-neutral-300)',
                  fontSize: '11.5px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '128px',
                  overflow: 'auto',
                }}
              >
                {result.text}
              </div>
            </div>
          );
        })}

        {agents.length === 0 && (
          <div style={{ padding: '14px 16px', color: 'var(--color-neutral-700)', fontSize: '11px' }}>
            no entries — this run returned nothing yet
          </div>
        )}
      </div>

      <div data-testid="wf-journal-footer" style={FOOTER}>
        journal.jsonl · each agent&apos;s actual return value — a cached result is
        not automatically a non-empty one
      </div>
    </div>
  );
}
