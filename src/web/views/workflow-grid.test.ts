import { describe, expect, it } from 'vitest';
import type { WorkflowAgent, WorkflowRun } from '../../shared/domain';
import { itemKeyOf, phaseTally, workflowGrid, WORK_ITEM_WIDTH } from './workflow-grid';

const agent = (over: Partial<WorkflowAgent> & { agentId: string }): WorkflowAgent => ({
  state: 'done',
  ...over,
});

const run = (over: Partial<WorkflowRun> = {}): WorkflowRun => ({
  runId: 'wf_x',
  status: 'completed',
  live: false,
  agents: [],
  phases: [],
  logs: [],
  ...over,
});

describe('itemKeyOf', () => {
  it('takes the label after the verb, which is what makes a row', () => {
    expect(itemKeyOf('impl:task-9')).toBe('task-9');
  });

  it('keeps the whole label when the script used no verb prefix', () => {
    expect(itemKeyOf('critic')).toBe('critic');
  });

  it('splits on the FIRST colon only, so a key may contain one', () => {
    expect(itemKeyOf('verify:a:b')).toBe('a:b');
  });

  it('falls back to the agent id when the label is missing, as on a live run', () => {
    expect(itemKeyOf(undefined, 'a1234')).toBe('a1234');
  });
});

describe('workflowGrid', () => {
  const threePhase = run({
    phases: [
      { index: 1, title: 'Investigate' },
      { index: 2, title: 'Implement' },
      { index: 3, title: 'Verify' },
    ],
    agents: [
      agent({ agentId: 'a1', label: 'probe:D1-frame', phaseIndex: 1 }),
      agent({ agentId: 'a2', label: 'probe:D2-latency', phaseIndex: 1 }),
      agent({ agentId: 'a3', label: 'impl:D1-frame', phaseIndex: 2 }),
      agent({ agentId: 'a4', label: 'verify:correctness', phaseIndex: 3 }),
    ],
  });

  it('draws every declared phase as a column, including one that never ran', () => {
    const grid = workflowGrid(run({ phases: threePhase.phases, agents: [] }));
    expect(grid.columns.map((c) => c.title)).toEqual(['Investigate', 'Implement', 'Verify']);
  });

  it('makes one row per work item, in the order they first appear', () => {
    expect(workflowGrid(threePhase).rows.map((r) => r.key)).toEqual([
      'D1-frame',
      'D2-latency',
      'correctness',
    ]);
  });

  it('puts an agent in the cell for its item and its phase', () => {
    const rows = workflowGrid(threePhase).rows;
    expect(rows[0].cells.map((c) => c?.agentId)).toEqual(['a1', 'a3', undefined]);
  });

  // The `verify:` agents in a real run use a different key namespace from the
  // `probe:`/`impl:` ones, so the grid genuinely does not close. A blank is the
  // honest cell — it is not the design's `·` waiting, which means an agent
  // exists and has not started.
  it('leaves a cell blank where no agent exists, distinct from waiting', () => {
    const rows = workflowGrid(threePhase).rows;
    expect(rows[2].cells[0]).toBeUndefined();
    expect(rows[2].cells[2]?.agentId).toBe('a4');
  });

  it('keeps an agent with no phase in a column of its own rather than dropping it', () => {
    const grid = workflowGrid(
      run({ phases: [{ index: 1, title: 'Only' }], agents: [agent({ agentId: 'a9', label: 'loose' })] }),
    );
    expect(grid.rows.map((r) => r.key)).toEqual(['loose']);
    expect(grid.unphased.map((a) => a.agentId)).toEqual(['a9']);
  });
});

describe('phaseTally', () => {
  const withStates = (...states: WorkflowAgent['state'][]) =>
    states.map((state, i) => agent({ agentId: `a${i}`, state, phaseIndex: 1 }));

  it('counts each state it actually has, and never a zero', () => {
    expect(phaseTally(withStates('done', 'done', 'run'), 1)).toBe('2 returned · 1 running');
  });

  it('says queued for a phase no agent has reached', () => {
    expect(phaseTally([], 1)).toBe('queued');
  });

  it('names a cache replay and a null return in the reader\'s words', () => {
    expect(phaseTally(withStates('cache', 'null'), 1)).toBe('1 cached · 1 returned null');
  });

  it('counts only the phase asked for', () => {
    const mixed = [
      agent({ agentId: 'a1', state: 'done', phaseIndex: 1 }),
      agent({ agentId: 'a2', state: 'done', phaseIndex: 2 }),
    ];
    expect(phaseTally(mixed, 2)).toBe('1 returned');
  });
});

describe('WORK_ITEM_WIDTH', () => {
  // Measured, not estimated: the widest work-item key across all 107 labels in
  // the 16 real runs is `consistency-audit` at 122.4px (17 chars, 12px
  // JetBrains Mono, 0.6em advance), plus the design's 28px padding.
  it('is the measured widest key plus padding', () => {
    expect(WORK_ITEM_WIDTH).toBe(151);
  });
});
