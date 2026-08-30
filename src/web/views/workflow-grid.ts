import type { WorkflowAgent, WorkflowAgentState, WorkflowPhase, WorkflowRun } from '../../shared/domain';

/**
 * The identity column, MEASURED rather than estimated — the design says an
 * estimate was wrong twice, and it was wrong here too: its own 190px came from
 * `spec/middleware.spec.ts`, a filename, and this console's labels are not
 * filenames. Across all 107 distinct labels in the 16 real runs the widest work
 * item key is `consistency-audit`, 17 characters, measured at 122.4px in a
 * headless Chromium at the pane's own 12px JetBrains Mono (0.6em advance), plus
 * the design's 28px of padding.
 *
 * It cannot fit every possible key: `label` defaults to the prompt's first 60
 * characters when a script passes none, which is ~432px. Those wrap under the
 * same 2-line clamp the phase detail uses rather than widening the column or
 * ellipsising.
 */
export const WORK_ITEM_WIDTH = 151;

/**
 * The row a label belongs to. The runtime has no concept of a work item — this
 * is a CONVENTION the scripts follow, `verb:key`, and it is why the grid is
 * derived rather than read. 112 of the 114 real agent labels carry the colon;
 * the two that do not are whole keys in their own right.
 */
export function itemKeyOf(label: string | undefined, agentId = ''): string {
  if (!label) return agentId;
  const colon = label.indexOf(':');
  return colon === -1 ? label : label.slice(colon + 1);
}

export interface GridRow {
  key: string;
  /** One per column, index-aligned with `columns`. Undefined = no such agent. */
  cells: (WorkflowAgent | undefined)[];
}

export interface WorkflowGrid {
  columns: WorkflowPhase[];
  rows: GridRow[];
  /**
   * Agents carrying no `phaseIndex` — a script that called `agent()` without
   * ever calling `phase()`. They have a row but no column to sit in, so they
   * are handed back separately rather than silently dropped into column 1.
   */
  unphased: WorkflowAgent[];
}

export function workflowGrid(run: WorkflowRun): WorkflowGrid {
  const columns = [...run.phases].sort((a, b) => a.index - b.index);
  const at = new Map(columns.map((phase, i) => [phase.index, i]));

  const rows: GridRow[] = [];
  const rowAt = new Map<string, GridRow>();
  const unphased: WorkflowAgent[] = [];

  for (const agent of run.agents) {
    const key = itemKeyOf(agent.label, agent.agentId);
    let row = rowAt.get(key);
    if (!row) {
      row = { key, cells: columns.map(() => undefined) };
      rowAt.set(key, row);
      rows.push(row);
    }
    const column = agent.phaseIndex === undefined ? undefined : at.get(agent.phaseIndex);
    if (column === undefined) unphased.push(agent);
    else row.cells[column] = agent;
  }

  return { columns, rows, unphased };
}

/**
 * Whether to OFFER the grid. The runtime has no work-item concept — the grid is
 * derived from a `verb:key` naming convention the scripts follow — so a grid
 * built unconditionally is right most of the time and wrong visibly. Each
 * refusal below is one of the ways the design says it breaks, and the bias is
 * deliberately toward refusing: the phase list is never wrong, only plainer.
 */
export function gridCooperates(run: WorkflowRun): boolean {
  const { rows, unphased } = workflowGrid(run);
  if (unphased.length > 0) return false; // a row with no column to sit in
  if (rows.length < 2) return false;

  const keysByPhase = new Map<number, Set<string>>();
  for (const agent of run.agents) {
    const colon = agent.label?.indexOf(':') ?? -1;
    // Both halves, not just the separator: a label is a verb AND a key, and
    // either half missing leaves the row or the column unnamed.
    if (colon < 1 || colon === (agent.label?.length ?? 0) - 1) return false;
    const key = itemKeyOf(agent.label);
    const phase = agent.phaseIndex as number; // no unphased agents by now
    const seen = keysByPhase.get(phase) ?? new Set<string>();
    seen.add(key);
    keysByPhase.set(phase, seen);
  }

  const ran = [...keysByPhase.values()];
  if (ran.length < 2) return false;
  // One namespace, not several. A phase whose keys NEST inside the widest one
  // did fewer items, which the grid draws as a blank; a phase whose keys only
  // partly overlap is a different vocabulary, and that grid closes nowhere.
  const widest = ran.reduce((a, b) => (b.size > a.size ? b : a));
  return ran.every((keys) => [...keys].every((key) => widest.has(key)));
}

/**
 * A live run's only totals. `totalTokens`, `totalToolCalls` and `durationMs`
 * reach disk in the snapshot and the snapshot is written once, at termination —
 * so mid-flight these two counts are the entire budget, and drawing the absent
 * ones as `0` would report a measurement where there is none.
 *
 * `started` counts the journal's `started` lines. A resumed run's journal omits
 * every agent served from cache, so this is what the journal SAW, which is not
 * always what the run dispatched.
 */
export function liveCounts(run: WorkflowRun): { started: number; returned: number } {
  return {
    started: run.agents.length,
    returned: run.agents.filter((a) => a.state === 'done').length,
  };
}

/**
 * Agents a single `parallel()` call fanned out, identified by a byte-identical
 * `queuedAt`. `together` says the cluster PROVES concurrency; false says only
 * that nothing proved it — a run killed before its `parallel()` fanned out
 * leaves singletons, so the absence of a cluster is never evidence of
 * sequential dispatch.
 */
export interface DispatchCluster {
  agents: WorkflowAgent[];
  together: boolean;
}

export interface PhaseGroup {
  phase: WorkflowPhase;
  /** Empty for a declared phase the run never reached — not missing data. */
  clusters: DispatchCluster[];
}

export interface PhaseList {
  groups: PhaseGroup[];
  /** As `workflowGrid`: handed back rather than filed under phase 1. */
  unphased: WorkflowAgent[];
}

/** The default shape of the run view: phases in order, agents under them. */
export function phaseList(run: WorkflowRun): PhaseList {
  const declared = [...run.phases].sort((a, b) => a.index - b.index);
  const mine = new Map<number, WorkflowAgent[]>(declared.map((p) => [p.index, []]));
  const unphased: WorkflowAgent[] = [];

  for (const agent of run.agents) {
    const bucket = agent.phaseIndex === undefined ? undefined : mine.get(agent.phaseIndex);
    if (bucket) bucket.push(agent);
    else unphased.push(agent);
  }

  return {
    groups: declared.map((phase) => ({ phase, clusters: clustersOf(mine.get(phase.index) ?? []) })),
    unphased,
  };
}

function clustersOf(agents: readonly WorkflowAgent[]): DispatchCluster[] {
  const clusters: DispatchCluster[] = [];
  const byQueuedAt = new Map<number, DispatchCluster>();

  for (const agent of agents) {
    const at = agent.queuedAt;
    const open = at === undefined ? undefined : byQueuedAt.get(at);
    if (open) {
      open.agents.push(agent);
      open.together = true;
      continue;
    }
    const cluster: DispatchCluster = { agents: [agent], together: false };
    // An agent with no recorded queuedAt — every agent on a live run — can
    // never join a cluster, so it is not keyed.
    if (at !== undefined) byQueuedAt.set(at, cluster);
    clusters.push(cluster);
  }

  return clusters;
}

/**
 * The reader's word for each state. `null` is spelled out because "returned
 * null" is a RESULT — the operator skipped it and the script saw null — and the
 * design is explicit that it is a state and not an error row. A count of
 * `failed` is an error row, so it is read out before it.
 */
const TALLY_ORDER: Array<[WorkflowAgentState, string]> = [
  ['done', 'returned'],
  ['run', 'running'],
  ['cache', 'cached'],
  ['fail', 'failed'],
  ['block', 'blocked'],
  ['null', 'returned null'],
  ['wait', 'waiting'],
];

/**
 * A phase header's count, state-aware: only what the phase actually has. The
 * design's rule is that `0 running` is worse than nothing, because it reads as
 * a measurement rather than as an absence.
 */
export function phaseTally(agents: readonly WorkflowAgent[], phaseIndex: number): string {
  const mine = agents.filter((a) => a.phaseIndex === phaseIndex);
  if (mine.length === 0) return 'queued';
  return TALLY_ORDER.flatMap(([state, word]) => {
    const n = mine.filter((a) => a.state === state).length;
    return n === 0 ? [] : [`${n} ${word}`];
  }).join(' · ');
}
