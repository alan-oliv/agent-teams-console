import { useState } from 'react';
import type { SubagentTree, WorkflowRun as Run } from '../../shared/domain';
import { Bar, METRIC } from '../chrome/Bar';
import { RunSelect } from '../chrome/RunSelect';
import { TeamSelect } from '../chrome/TeamSelect';
import { formatElapsed, formatTokens } from '../format';
import type { SettingsStore } from '../state/useSettings';
import { flattenSubagents } from '../../shared/subagents';
import { Usage } from './Usage';
import { WorkflowAgents } from './WorkflowAgents';
import { WorkflowJournal } from './WorkflowJournal';
import { WorkflowRun } from './WorkflowRun';
import { WorkflowScript } from './WorkflowScript';
import { runTotalsText } from './workflow-grid';

export const WORKFLOW_VIEW_IDS = ['run', 'agents', 'script', 'journal', 'usage'] as const;
export type WorkflowViewId = (typeof WORKFLOW_VIEW_IDS)[number];

/**
 * The order this bar's metrics are SHED in when it runs out of room. Lower
 * survives longer, as on the team bar.
 *
 * The design never specified one for workflow mode, so this follows the team
 * bar's precedent rather than inventing a principle: identity outlives figures.
 * The task id is what says which piece of work this run belongs to — `branch`'s
 * counterpart, and the one thing here that is not re-derivable from the run
 * view below — so it goes last. Elapsed sits where the team bar puts its
 * elapsed-and-spend chip. The totals are the pure readout, and the agents view
 * carries them in full, so they go first. Recorded in CONSOLE-DECISIONS.md.
 */
export const WORKFLOW_METRIC_RANK: Record<string, number> = {
  taskId: 0,
  elapsed: 1,
  totals: 2,
  // Newest addition here too — sheds before the run's own figures.
  subagents: 3,
};

export interface WorkflowProps {
  run: Run;
  /** Every run this session has — the run picker's list. */
  runs: readonly Run[];
  onSelectRun(runId: string | null): void;
  /** The session's name when a team is running behind the run. See RunSelect. */
  backToTeam?: string;
  now: number;
  /** The session the run belongs to — what the picker switches away from. */
  teamName: string;
  sessionName?: string;
  teamsOpen: boolean;
  onTeamsOpenChange(open: boolean): void;
  appearance: SettingsStore;
  /** The session's Task-subagent tree — the bar carries it in both modes. */
  subagents?: SubagentTree;
}

/**
 * Workflow mode is a different shell, not a different view: no roster, no task
 * list, no inboxes, no composer. What it keeps is the chrome — the same one-line
 * bar, the same picker, the same gear — because a run the operator cannot leave,
 * and a theme they cannot reach from it, is a mode with no way out.
 */
export function Workflow({
  run, runs, onSelectRun, backToTeam, now, teamName, sessionName, teamsOpen, onTeamsOpenChange,
  appearance, subagents,
}: WorkflowProps) {
  const allSubagents = Object.values(subagents ?? {}).flatMap(flattenSubagents);
  const subagentTokens = allSubagents.reduce((n, s) => n + (s.tokens ?? 0), 0);
  const [view, setView] = useState<WorkflowViewId>('run');
  const totals = runTotalsText(run);

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
            <RunSelect
              run={run}
              runs={runs}
              onSelect={onSelectRun}
              backToTeam={backToTeam}
            />
          </>
        }
        views={WORKFLOW_VIEW_IDS}
        view={view}
        // Wrapped rather than passed bare: a setState function widens the bar's
        // view type to `string`, which loses the pills their union.
        onViewChange={(next) => setView(next)}
        // An array rather than a fragment, and every entry keyed: the bar sheds
        // by key, and two of these three are conditional, so a positional rule
        // would drop whichever metric happened to sit at that index.
        metrics={[
          // No status word: the design asks the right side for the task id,
          // the run totals and elapsed, and the run picker beside the wordmark
          // already carries this run's state in its own colour.
          ...(run.taskId !== undefined
            ? [
                <span
                  key="taskId"
                  data-testid="wf-task-id"
                  style={{ color: 'var(--color-neutral-600)', ...METRIC }}
                >
                  {`task ${run.taskId}`}
                </span>,
              ]
            : []),
          ...(allSubagents.length > 0
            ? [
                <span
                  key="subagents"
                  data-testid="wf-subagents"
                  style={{ color: 'var(--color-neutral-600)', ...METRIC }}
                >
                  {`${allSubagents.length} subagents · ${formatTokens(subagentTokens)}`}
                </span>,
              ]
            : []),
          ...(totals !== undefined
            ? [
                <span
                  key="totals"
                  data-testid="wf-run-totals"
                  style={{ color: 'var(--color-neutral-600)', ...METRIC }}
                >
                  {totals}
                </span>,
              ]
            : []),
          <span
            key="elapsed"
            data-testid="wf-elapsed"
            style={{ color: 'var(--color-neutral-500)', ...METRIC }}
          >
            {elapsed}
          </span>,
        ]}
        metricRank={WORKFLOW_METRIC_RANK}
        appearance={appearance}
      />

      <main className="console-body">
        {/* Live or finished is the run view's own business: it draws the flat
            list and the live note mid-flight, the phases once they land, and
            the sidebar either way — which the spec never restricted to a
            finished run. */}
        {view === 'run' && <WorkflowRun run={run} />}
        {view === 'agents' && <WorkflowAgents agents={run.agents} />}
        {view === 'script' && <WorkflowScript run={run} />}
        {view === 'journal' && <WorkflowJournal agents={run.agents} />}
        {view === 'usage' && <Usage mode="workflow" run={run} now={now} />}
      </main>
    </>
  );
}
