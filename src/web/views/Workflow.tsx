import { useState } from 'react';
import type { WorkflowRun as Run } from '../../shared/domain';
import { Bar, METRIC } from '../chrome/Bar';
import { TeamSelect } from '../chrome/TeamSelect';
import { formatElapsed } from '../format';
import type { SettingsStore } from '../state/useSettings';
import { WorkflowAgents } from './WorkflowAgents';
import { WorkflowJournal } from './WorkflowJournal';
import { WorkflowRun } from './WorkflowRun';
import { WorkflowScript } from './WorkflowScript';

export const WORKFLOW_VIEW_IDS = ['run', 'agents', 'script', 'journal'] as const;
export type WorkflowViewId = (typeof WORKFLOW_VIEW_IDS)[number];

const STATUS_COLOR: Record<Run['status'], string> = {
  completed: 'var(--color-accent-400)',
  running: 'var(--color-accent-500)',
  killed: 'var(--color-neutral-600)',
  failed: 'var(--color-neutral-500)',
};

export interface WorkflowProps {
  run: Run;
  now: number;
  /** The session the run belongs to — what the picker switches away from. */
  teamName: string;
  sessionName?: string;
  teamsOpen: boolean;
  onTeamsOpenChange(open: boolean): void;
  appearance: SettingsStore;
}

/**
 * Workflow mode is a different shell, not a different view: no roster, no task
 * list, no inboxes, no composer. What it keeps is the chrome — the same one-line
 * bar, the same picker, the same gear — because a run the operator cannot leave,
 * and a theme they cannot reach from it, is a mode with no way out.
 */
export function Workflow({
  run, now, teamName, sessionName, teamsOpen, onTeamsOpenChange, appearance,
}: WorkflowProps) {
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
    <>
      <Bar
        wordmark="RUN"
        picker={
          <>
            <TeamSelect
              current={teamName}
              sessionName={sessionName}
              open={teamsOpen}
              onOpenChange={onTeamsOpenChange}
              now={now}
            />
            <span
              data-testid="wf-identity"
              style={{ display: 'flex', gap: 8, alignItems: 'baseline', ...METRIC }}
            >
              <span style={{ color: 'var(--color-text)' }}>{run.name ?? 'unnamed run'}</span>
              <span style={{ color: 'var(--color-neutral-600)', fontSize: 11 }}>{run.runId}</span>
            </span>
          </>
        }
        views={WORKFLOW_VIEW_IDS}
        view={view}
        // Wrapped rather than passed bare: a setState function widens the bar's
        // view type to `string`, which loses the pills their union.
        onViewChange={(next) => setView(next)}
        metrics={
          <>
            <span data-testid="wf-status" style={{ color: STATUS_COLOR[run.status], ...METRIC }}>
              {run.status}
            </span>
            {run.taskId !== undefined && (
              <span
                data-testid="wf-task-id"
                style={{ color: 'var(--color-neutral-600)', ...METRIC }}
              >
                {`task ${run.taskId}`}
              </span>
            )}
            <span data-testid="wf-elapsed" style={{ color: 'var(--color-neutral-500)', ...METRIC }}>
              {elapsed}
            </span>
          </>
        }
        appearance={appearance}
      />

      <main className="console-body">
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
      </main>
    </>
  );
}
