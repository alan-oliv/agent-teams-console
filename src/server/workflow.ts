import type {
  ConsoleMode,
  WorkflowAgent,
  WorkflowAgentState,
  WorkflowPhase,
  WorkflowRun,
} from '../shared/domain';
import type { StoredEvent } from './store';

type Bag = Record<string, unknown>;

const bagOf = (v: unknown): Bag => (v !== null && typeof v === 'object' ? (v as Bag) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const RUN_STATUS = new Set(['completed', 'killed', 'failed', 'running']);

/**
 * The runtime's four states plus its flags, onto the design's five. `cached`
 * rides on a `done` record, so it has to be read before the state is.
 */
function agentStateOf(rec: Bag): WorkflowAgentState {
  if (rec.cached === true) return 'cache';
  switch (str(rec.state)) {
    case 'done':
      return 'done';
    case 'progress':
      return 'run';
    // One emitter covers both "queued for a concurrency slot" and "just
    // spawned"; `startedAt` is the only thing that separates them.
    case 'start':
      return num(rec.startedAt) === undefined ? 'wait' : 'run';
    default:
      return 'null';
  }
}

function agentOf(rec: Bag): WorkflowAgent | null {
  const agentId = str(rec.agentId);
  if (!agentId) return null;
  return {
    agentId,
    state: agentStateOf(rec),
    ...opt('label', str(rec.label)),
    ...opt('model', str(rec.model)),
    ...opt('queuedAt', num(rec.queuedAt)),
    ...opt('tokens', num(rec.tokens)),
    ...opt('toolCalls', num(rec.toolCalls)),
    ...opt('attempt', num(rec.attempt)),
    ...opt('prompt', str(rec.promptPreview)),
    ...opt('phaseIndex', num(rec.phaseIndex)),
    ...opt('phaseTitle', str(rec.phaseTitle)),
    ...opt('startedAt', num(rec.startedAt)),
    ...opt('durationMs', num(rec.durationMs)),
    ...opt('result', str(rec.resultPreview)),
    ...opt('lastTool', str(rec.lastToolName)),
    ...opt('error', str(rec.error)),
    ...opt('isolation', str(rec.isolation)),
    ...opt('agentType', str(rec.agentType)),
  };
}

/** Absent, not defaulted — the difference between "running" and "took 0 ms". */
function opt<K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/**
 * `meta.phases` is the declaration and `workflowProgress`'s phase records are
 * the same list with their indices attached, so the two are zipped by position
 * rather than either one being trusted alone: `detail` exists only in the
 * former and `index` only in the latter.
 */
function phasesOf(snapshot: Bag, progress: Bag[]): WorkflowPhase[] {
  const declared = arr(snapshot.phases).map(bagOf);
  return progress
    .filter((rec) => rec.type === 'workflow_phase')
    .map((rec, i) => {
      const title = str(rec.title) ?? str(declared[i]?.title) ?? '';
      return { index: num(rec.index) ?? i + 1, title, ...opt('detail', str(declared[i]?.detail)) };
    });
}

/**
 * `subagents/workflows/<runId>/journal.jsonl` — the only source that exists
 * WHILE a run is in flight, and the reason a live run degrades to a flat agent
 * list. Every line is `{type, key, agentId}` plus `result` on a return: no
 * timestamp, no phase, no label, no usage, so none of those are invented here.
 *
 * Two shapes of imprecision are inherent and are not worked around:
 *   - a `started` with no `result` is a running agent OR one that returned
 *     null, which the journal cannot separate. It reads as running, and the
 *     snapshot settles it at termination.
 *   - a RESUMED run's journal omits every agent served from cache, so the agent
 *     list is short until the snapshot lands.
 */
export function parseWorkflowJournal(runId: string, lines: readonly string[]): WorkflowRun {
  const byId = new Map<string, WorkflowAgent>();

  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: Bag;
    try {
      rec = bagOf(JSON.parse(line));
    } catch {
      continue; // the read landed mid-append; the line is not complete yet
    }
    const agentId = str(rec.agentId);
    if (!agentId) continue;
    // A retry re-spawns under the SAME id and appends a second `started`, so
    // this is keyed rather than pushed — and a `started` must never overwrite a
    // `result` already seen.
    const existing = byId.get(agentId);
    if (rec.type === 'result') {
      byId.set(agentId, { agentId, state: 'done', ...opt('result', str(rec.result)) });
    } else if (rec.type === 'started' && !existing) {
      byId.set(agentId, { agentId, state: 'run' });
    }
  }

  return {
    runId,
    status: 'running',
    live: true,
    agents: [...byId.values()],
    phases: [],
    logs: [],
  };
}

/**
 * One `workflows/wf_<runId>.json`. Returns null rather than a half-built run
 * when the file is not one — the sweep hands us every JSON file under the
 * projects root, so "not a snapshot" is the common case, not an error.
 */
export function parseWorkflowRun(raw: unknown): WorkflowRun | null {
  const snapshot = bagOf(raw);
  const runId = str(snapshot.runId);
  const name = str(snapshot.workflowName);
  if (!runId || !name) return null;

  const progress = arr(snapshot.workflowProgress).map(bagOf);
  const rawStatus = str(snapshot.status);
  return {
    runId,
    name,
    status: (rawStatus && RUN_STATUS.has(rawStatus) ? rawStatus : 'completed') as WorkflowRun['status'],
    startedAt: num(snapshot.startTime) ?? 0,
    phases: phasesOf(snapshot, progress),
    agents: progress
      .filter((rec) => rec.type === 'workflow_agent')
      .map(agentOf)
      .filter((a): a is WorkflowAgent => a !== null),
    logs: arr(snapshot.logs).filter((l): l is string => typeof l === 'string'),
    live: false,
    ...opt('taskId', str(snapshot.taskId)),
    ...opt('description', str(snapshot.summary)),
    ...opt('scriptPath', str(snapshot.scriptPath)),
    ...opt('script', str(snapshot.script)),
    ...opt('durationMs', num(snapshot.durationMs)),
    ...opt('agentCount', num(snapshot.agentCount)),
    ...opt('totalTokens', num(snapshot.totalTokens)),
    ...opt('totalToolCalls', num(snapshot.totalToolCalls)),
    ...opt('defaultModel', str(snapshot.defaultModel)),
    ...opt('result', str(snapshot.result)),
    ...opt('error', str(snapshot.error)),
  };
}

/**
 * Last-write-wins per `runId`, with one asymmetry: a LIVE run never replaces a
 * run already carrying its snapshot. The sweep re-reads `journal.jsonl` on an
 * mtime change, and a snapshot landing bumps nothing in that directory, so
 * without this guard an ordinary re-read after termination would throw away the
 * phases and usage that had just arrived and put the run back to "running".
 *
 * Newest first by `startedAt`, which a live run does not have — those sort last
 * rather than to the top, since "no start time" means "not known yet", not "the
 * beginning of time".
 */
export function foldWorkflows(events: readonly StoredEvent[]): WorkflowRun[] {
  const byRun = new Map<string, WorkflowRun>();

  for (const event of events) {
    if (event.kind !== 'workflow') continue;
    const run = event.payload as WorkflowRun | undefined;
    const runId = run?.runId;
    if (!runId) continue;
    if (run.live && byRun.get(runId)?.live === false) continue;
    byRun.set(runId, run);
  }

  return [...byRun.values()].sort((a, b) => (b.startedAt ?? -1) - (a.startedAt ?? -1));
}

/**
 * Which shell to draw. A team WINS whenever there is one, so nothing about
 * workflow mode can regress the console's existing behaviour: a session that
 * ran a workflow alongside a team still renders as the team it is.
 *
 * "A team" is the two-member bar, not "any agents at all" — the same bar the
 * launcher and the picker use. That distinction is the whole feature: Claude
 * Code writes a `teams/<session>/config.json` for EVERY session, holding just
 * that session's own lead, so a roster of one is what a session with no team
 * looks like, and it is never absent. Keyed on zero this returned `team` for
 * every real session on disk and workflow mode was unreachable — the console
 * ingested the runs, held them on the frame, and drew the empty wall anyway.
 */
export function modeOf(teamAgents: number, runs: readonly WorkflowRun[]): ConsoleMode {
  return teamAgents < 2 && runs.length > 0 ? 'workflow' : 'team';
}

/**
 * The run as it rides the SSE frame. `script` is stripped: measured across all
 * 16 runs on the capture machine it is 287 KB of the model's 438 KB — 65% of
 * the bytes — and no view reads it. What it is FOR is the `parallel`/`pipeline`
 * barrier note, which is recoverable only by parsing the source text; whatever
 * wants that should read the snapshot at `scriptPath` on demand rather than
 * make every frame carry it.
 */
export function leanRun(run: WorkflowRun): WorkflowRun {
  const { script: _script, ...lean } = run;
  return lean;
}
