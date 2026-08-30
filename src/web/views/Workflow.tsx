import { useState, type CSSProperties } from 'react';
import type { WorkflowRun as Run } from '../../shared/domain';
import { formatElapsed } from '../format';
import { WorkflowAgents } from './WorkflowAgents';
import { WorkflowJournal } from './WorkflowJournal';
import { WorkflowRun } from './WorkflowRun';
import { WorkflowScript } from './WorkflowScript';

export const WORKFLOW_VIEW_IDS = ['run', 'agents', 'script', 'journal'] as const;
export type WorkflowViewId = (typeof WORKFLOW_VIEW_IDS)[number];

/**
 * The bar is one line, and a child that can shrink or wrap doubles its height.
 * The team bar sheds metrics to hold that; this one does not need to — four
 * pills and three metrics against six pills and seven — but every child still
 * carries the rule, so adding one later cannot quietly break the line.
 */
const METRIC: CSSProperties = { flex: 'none', whiteSpace: 'nowrap' };

const BAR: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'nowrap',
  gap: 10,
  padding: '9px 14px',
  borderBottom: '1px solid var(--color-neutral-900)',
  background: 'var(--color-bg)',
  fontSize: 12.5,
};

const STATUS_COLOR: Record<Run['status'], string> = {
  completed: 'var(--color-accent-400)',
  running: 'var(--color-accent-500)',
  killed: 'var(--color-neutral-600)',
  failed: 'var(--color-neutral-500)',
};

export function Workflow({ run, now }: { run: Run; now: number }) {
  const [view, setView] = useState<WorkflowViewId>('run');

  // A live run has no startedAt on disk — the snapshot that carries it does not
  // exist yet — so there is nothing to measure elapsed against.
  const elapsed =
    run.durationMs !== undefined
      ? formatElapsed(run.durationMs)
      : run.startedAt !== undefined
        ? formatElapsed(now - run.startedAt)
        : '—';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div data-testid="wf-bar" style={BAR}>
        <span
          data-testid="wf-wordmark"
          style={{
            color: 'var(--color-accent)',
            letterSpacing: '.14em',
            fontWeight: 700,
            fontSize: 11,
            ...METRIC,
          }}
        >
          RUN
        </span>

        <span data-testid="wf-identity" style={{ display: 'flex', gap: 8, alignItems: 'baseline', ...METRIC }}>
          <span style={{ color: 'var(--color-text)' }}>{run.name ?? 'unnamed run'}</span>
          <span style={{ color: 'var(--color-neutral-600)', fontSize: 11 }}>{run.runId}</span>
        </span>

        <div
          role="tablist"
          aria-label="view"
          style={{ display: 'flex', gap: 2, marginLeft: 2, ...METRIC }}
        >
          {WORKFLOW_VIEW_IDS.map((id) => (
            <button
              key={id}
              className="tab"
              type="button"
              role="tab"
              aria-selected={id === view}
              onClick={() => setView(id)}
            >
              {id}
            </button>
          ))}
        </div>

        <span data-testid="wf-spacer" style={{ flex: 1 }} />

        <span data-testid="wf-status" style={{ color: STATUS_COLOR[run.status], ...METRIC }}>
          {run.status}
        </span>
        {run.taskId !== undefined && (
          <span data-testid="wf-task-id" style={{ color: 'var(--color-neutral-600)', ...METRIC }}>
            {`task ${run.taskId}`}
          </span>
        )}
        <span data-testid="wf-elapsed" style={{ color: 'var(--color-neutral-500)', ...METRIC }}>
          {elapsed}
        </span>
      </div>

      {view === 'run' &&
        (run.live ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div
              data-testid="wf-live-note"
              style={{
                flex: 'none',
                padding: '10px 16px',
                borderBottom: '1px solid var(--color-neutral-900)',
                color: 'var(--color-neutral-600)',
                fontSize: '11px',
                lineHeight: 1.5,
              }}
            >
              this run is still going, so there is no grid to draw — the phases
              and labels reach disk only in the snapshot, which is written once,
              at termination. Until the run ends the journal knows which agents
              started and which came back, and nothing else.
            </div>
            <WorkflowAgents agents={run.agents} />
          </div>
        ) : (
          <WorkflowRun run={run} />
        ))}
      {view === 'agents' && <WorkflowAgents agents={run.agents} />}
      {view === 'script' && <WorkflowScript run={run} />}
      {view === 'journal' && <WorkflowJournal agents={run.agents} />}
    </div>
  );
}
