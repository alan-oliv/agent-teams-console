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
