import type { CSSProperties } from 'react';
import type { WorkflowAgent } from '../../shared/domain';
import { GLYPH, GLYPH_COLOR } from './WorkflowRun';

const HEAD: CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'baseline',
  gap: '10px',
  padding: '10px 16px 8px',
  color: 'var(--color-neutral-600)',
  fontSize: '10px',
  borderBottom: '1px solid var(--color-neutral-900)',
};

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
  // A skip, a refusal and a throw all hand the script null — the runtime
  // appends no result line for any of the three — so the journal reads the same
  // for all three. Which one it was is on the entry's own `error`.
  if (agent.state === 'null' || agent.state === 'fail' || agent.state === 'block') {
    return { text: 'null', muted: true };
  }
  if (agent.result === undefined) return { text: '—', muted: true };
  if (agent.result === '') return { text: '(empty)', muted: true };
  return { text: agent.result, muted: false };
}

export function WorkflowJournal({ agents }: { agents: WorkflowAgent[] }) {
  return (
    <div data-testid="workflow-journal" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div data-testid="wf-journal-head" style={HEAD}>
        <span style={{ letterSpacing: '.12em' }}>JOURNAL</span>
        <span style={{ color: 'var(--color-neutral-700)' }}>&lt;transcriptDir&gt;/journal.jsonl</span>
        <span style={{ flex: 1 }} />
        <span>
          each agent&apos;s actual return value — read this before theorising about an empty run
        </span>
      </div>

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
                <span style={{ color: GLYPH_COLOR[agent.state], fontSize: '11.5px' }}>{GLYPH[agent.state]}</span>
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
        a cached result is not automatically a non-empty one
      </div>
    </div>
  );
}
