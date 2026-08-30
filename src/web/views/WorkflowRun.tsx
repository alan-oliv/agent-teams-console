import type { CSSProperties } from 'react';
import type { WorkflowAgent, WorkflowAgentState, WorkflowRun as Run } from '../../shared/domain';
import { formatTokens } from '../format';
import { phaseTally, workflowGrid, WORK_ITEM_WIDTH } from './workflow-grid';

/**
 * The design's cell vocabulary. `∅` is a returned null — an agent the operator
 * skipped — and is a STATE, not an error row: the script saw `null` and carried
 * on, which is what `.filter(Boolean)` is for. A thrown agent is a different
 * cell and borrows the console's own failed treatment, because a decision and a
 * failure drawn identically is the one thing this cell cannot do.
 */
const GLYPH: Record<WorkflowAgentState, string> = {
  done: '✓',
  run: '●',
  cache: '⤿',
  null: '∅',
  wait: '·',
  fail: '✗',
  block: '⊘',
};

const GLYPH_COLOR: Record<WorkflowAgentState, string> = {
  done: 'var(--color-accent-400)',
  run: 'var(--color-accent-500)',
  cache: 'var(--color-neutral-500)',
  null: 'var(--color-neutral-600)',
  wait: 'var(--color-neutral-700)',
  fail: 'var(--fail)',
  block: 'var(--color-neutral-600)',
};

const PHASE_MIN = 132;

// The header is `flex: none` above a scrolling body, which is what lets the
// detail wrap to two lines without stealing height from the grid.
const HEAD: CSSProperties = {
  flex: 'none',
  display: 'flex',
  gap: '10px',
  padding: '10px 16px 8px',
  borderBottom: '1px solid var(--color-neutral-900)',
};

const DETAIL: CSSProperties = {
  color: 'var(--color-neutral-600)',
  fontSize: '10px',
  lineHeight: 1.35,
  // Two lines, wrapped — never ellipsised. A phase detail is the one place the
  // design insists prose is worth the height.
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
};

const SIDE_LABEL: CSSProperties = {
  color: 'var(--color-neutral-600)',
  fontSize: '10px',
  letterSpacing: '.12em',
  marginBottom: '6px',
};

const SIDE_BODY: CSSProperties = { color: 'var(--color-neutral-500)', fontSize: '11px', lineHeight: 1.5 };

const SIDE_PANEL: CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--color-neutral-900)' };

function Cell({ agent }: { agent: WorkflowAgent | undefined }) {
  return (
    <span
      data-testid="wf-cell"
      title={agent ? `${agent.label ?? agent.agentId} · ${agent.state}` : undefined}
      style={{
        flex: 1,
        minWidth: `${PHASE_MIN}px`,
        color: agent ? GLYPH_COLOR[agent.state] : 'transparent',
      }}
    >
      {agent ? GLYPH[agent.state] : ''}
    </span>
  );
}

export function WorkflowRun({ run }: { run: Run }) {
  const { columns, rows, unphased } = workflowGrid(run);

  return (
    <div data-testid="workflow-run" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={HEAD}>
          <span
            style={{
              width: `${WORK_ITEM_WIDTH}px`,
              flex: 'none',
              color: 'var(--color-neutral-600)',
              fontSize: '10px',
              letterSpacing: '.12em',
            }}
          >
            WORK ITEM
          </span>
          {columns.map((phase) => (
            <span
              key={phase.index}
              data-testid="wf-phase"
              style={{ flex: 1, minWidth: `${PHASE_MIN}px`, display: 'flex', flexDirection: 'column', gap: '3px' }}
            >
              <span style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                <span data-testid="wf-phase-title" style={{ color: 'var(--color-text)', fontSize: '11.5px' }}>
                  {phase.title}
                </span>
                <span data-testid="wf-phase-count" style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}>
                  {phaseTally(run.agents, phase.index)}
                </span>
              </span>
              {phase.detail !== undefined && (
                <span data-testid="wf-phase-detail" style={DETAIL}>
                  {phase.detail}
                </span>
              )}
            </span>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {rows.map((row) => (
            <div
              key={row.key}
              data-testid="wf-row"
              style={{
                display: 'flex',
                gap: '10px',
                padding: '7px 16px',
                borderBottom: '1px solid var(--color-neutral-900)',
                alignItems: 'baseline',
              }}
            >
              <span
                data-testid="wf-item"
                style={{
                  width: `${WORK_ITEM_WIDTH}px`,
                  flex: 'none',
                  color: 'var(--color-neutral-300)',
                  // A key longer than the column wraps under the same clamp the
                  // phase detail uses. `label` defaults to the prompt's first
                  // 60 characters, so this is reachable, not theoretical.
                  display: '-webkit-box',
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: 2,
                  overflow: 'hidden',
                  wordBreak: 'break-word',
                }}
              >
                {row.key}
              </span>
              {row.cells.map((agent, i) => (
                <Cell key={columns[i].index} agent={agent} />
              ))}
            </div>
          ))}

          {rows.length === 0 && (
            <div style={{ padding: '14px 16px', color: 'var(--color-neutral-700)', fontSize: '11px' }}>
              no agents — this run spawned none
            </div>
          )}
        </div>

        {unphased.length > 0 && (
          <div
            data-testid="wf-unphased"
            style={{
              flex: 'none',
              borderTop: '1px solid var(--color-neutral-900)',
              padding: '9px 16px',
              color: 'var(--color-neutral-600)',
              fontSize: '10px',
            }}
          >
            {`${unphased.length} agent${unphased.length === 1 ? '' : 's'} outside every phase — the script called agent() without phase()`}
          </div>
        )}
      </div>

      <div
        style={{
          width: '268px',
          flex: 'none',
          borderLeft: '1px solid var(--color-neutral-900)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div style={SIDE_PANEL}>
          <div style={SIDE_LABEL}>RUN TOTALS</div>
          <div data-testid="wf-totals" style={SIDE_BODY}>
            {`${formatTokens(run.totalTokens ?? 0)} · ${run.totalToolCalls ?? 0} tool calls · ${run.agentCount ?? run.agents.length} agents`}
            {/* Budget is deliberately absent: it exists nowhere on disk, and
                totalTokens counts this run's agents while budget.spent() is a
                session-level counter — showing one as the other under-reports. */}
            <div style={{ color: 'var(--color-neutral-700)', fontSize: '10px', marginTop: '4px' }}>
              no budget on disk · this is the run&apos;s own spend, not the session&apos;s
            </div>
          </div>
        </div>

        <div style={SIDE_PANEL}>
          <div style={SIDE_LABEL}>LIMITS</div>
          <div data-testid="wf-limits" style={SIDE_BODY}>
            concurrency is min(16, CPUs − 2) agents at once
            <div style={{ color: 'var(--color-neutral-600)', marginTop: '4px' }}>
              1000 agents is the lifetime cap for the whole run
            </div>
          </div>
        </div>

        <div style={{ ...SIDE_PANEL, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={SIDE_LABEL}>NARRATION</div>
          <div data-testid="wf-log" style={{ ...SIDE_BODY, flex: 1, minHeight: 0, overflow: 'auto' }}>
            {run.logs.length === 0
              ? 'the script called log() nowhere'
              : run.logs.map((line, i) => (
                  <div key={`${i}-${line}`} style={{ marginBottom: '3px' }}>
                    {line}
                  </div>
                ))}
          </div>
        </div>

        <div style={{ ...SIDE_PANEL, borderBottom: 'none', borderTop: '1px solid var(--color-neutral-900)' }}>
          <div data-testid="wf-not-in-loop" style={{ color: 'var(--color-neutral-600)', fontSize: '10px', lineHeight: 1.5 }}>
            you are not in the loop — a workflow opts in at launch and reports at
            the end. Nothing here steers it.
          </div>
        </div>
      </div>
    </div>
  );
}
