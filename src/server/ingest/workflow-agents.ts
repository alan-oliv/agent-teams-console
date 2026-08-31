import path from 'node:path';
import type { Store } from '../store';
import { parseLine, type TranscriptRecord } from '../../shared/transcript';
import {
  emptyWorkflowUsageFold,
  workflowAgentIdOf,
  foldWorkflowAgentRecords,
  workflowUsageOf,
  type WorkflowUsageFold,
} from '../../shared/workflow-usage';

/**
 * The fourth kind of transcript under a project root, and the last one the
 * console was throwing away.
 *
 *   <slug>/<sessionId>.jsonl                                  the lead's own
 *   <slug>/<sessionId>/subagents/agent-<agentId>.jsonl        a teammate, or a
 *                                                             Task subagent
 *   <slug>/<sessionId>/subagents/workflows/<runId>/journal.jsonl   the run log
 *   <slug>/<sessionId>/subagents/workflows/<runId>/agent-<agentId>.jsonl   HERE
 *
 * These carry what a workflow run actually spent — the four token classes the
 * snapshot understates by 5.9x to 49x — and they are appended WHILE THE RUN IS
 * GOING, so they are the console's only live source for a run's real cost. See
 * CONSOLE-NOTES.md §24 and src/shared/workflow-usage.ts.
 *
 * Kept out of files.ts deliberately. That file already carries the whole team
 * scope rule, and this is not part of it: a workflow agent is not a team member
 * and never becomes one. Its records must never reach a roster name, an agent's
 * spend or `members[]` — only this module's own event kind.
 */

const RUN_ID = /^wf_.+$/;

export interface WorkflowAgentClaim {
  runId: string;
  /** The session owning the run, for the same scope check the journal gets. */
  sessionId: string;
  agentId: string;
}

/**
 * Routing only, and deliberately chain-free — the same split `isWorkflowPath`
 * makes. A path has to be recognised before the lead session is known, because
 * a watcher event can arrive first; applying scope is the caller's job, and
 * `createWorkflowUsageIngest` below defers rather than drops when it cannot
 * answer yet.
 *
 * Proved against every file under a real `~/.claude/projects`: 139 of 139
 * workflow agent transcripts claimed out of 888 files, no false positives, and
 * it refuses `journal.jsonl`, a team-side Task subagent and a teammate.
 */
export function workflowAgentClaimOf(file: string): WorkflowAgentClaim | null {
  const agentId = workflowAgentIdOf(path.basename(file));
  if (!agentId) return null;
  const dir = path.dirname(file);
  const runId = path.basename(dir);
  if (!RUN_ID.test(runId)) return null;
  const up = (n: number) => {
    let at = dir;
    for (let i = 0; i < n; i++) at = path.dirname(at);
    return path.basename(at);
  };
  if (up(1) !== 'workflows' || up(2) !== 'subagents') return null;
  return { runId, sessionId: up(3), agentId };
}

export interface WorkflowUsageIngest {
  /**
   * Folds a drain if the path is a workflow agent's. Returns whether it took
   * the file, so the caller's routing is one line and cannot fall through to
   * the team-side handlers by accident.
   */
  handle(file: string, lines: readonly string[], fromStart: boolean): boolean;
  /**
   * Publishes every run now in scope. Called when the lead session chain grows:
   * a run folded while the session was unknown has nothing left to trigger it —
   * a finished run's files never move again — so without this its usage would
   * sit in memory unpublished for the life of the process.
   */
  flush(): void;
}

export function createWorkflowUsageIngest(
  store: Store,
  inScope: (sessionId: string) => boolean,
): WorkflowUsageIngest {
  // runId -> what has been read for it, and the session that owns it. Folded
  // for every run we see and published only for our own: a drain consumes the
  // bytes whether or not the scope is known yet, so holding the FOLD is what
  // makes a late-resolving session cost nothing instead of losing a whole run.
  const runs = new Map<string, { sessionId: string; fold: WorkflowUsageFold }>();

  const publish = (runId: string): void => {
    const held = runs.get(runId);
    if (!held || !inScope(held.sessionId)) return;
    const payload = workflowUsageOf(runId, held.fold);
    // Nothing measured yet is not a run that spent nothing, and a zeroed row
    // would fold onto the run as though it were.
    if (payload.agents.length === 0) return;
    store.append('workflow-usage', payload);
  };

  return {
    handle(file, lines, fromStart) {
      const claim = workflowAgentClaimOf(file);
      if (!claim) return false;
      const records: TranscriptRecord[] = [];
      for (const line of lines) {
        const rec = parseLine(line);
        if (rec) records.push(rec);
      }
      if (records.length === 0) return true;

      let held = runs.get(claim.runId);
      if (!held) {
        held = { sessionId: claim.sessionId, fold: emptyWorkflowUsageFold() };
        runs.set(claim.runId, held);
      }
      // Per FILE, not per run: one agent's transcript being re-read from byte
      // zero says nothing about its siblings', and clearing the run would drop
      // every other agent's turns on any re-read.
      if (fromStart) held.fold.agents.delete(claim.agentId);
      foldWorkflowAgentRecords(held.fold, claim.agentId, records);
      publish(claim.runId);
      return true;
    },

    flush() {
      for (const runId of runs.keys()) publish(runId);
    },
  };
}
