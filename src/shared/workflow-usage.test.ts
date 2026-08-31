import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORKFLOW_BURN_SAMPLES, type WorkflowAgent } from './domain';
import type { TranscriptRecord } from './transcript';
import {
  attachWorkflowUsage,
  emptyWorkflowUsageFold,
  foldWorkflowAgentRecords,
  workflowAgentIdOf,
  workflowUsageOf,
} from './workflow-usage';

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/workflow-agent-usage.json', import.meta.url), 'utf8'),
) as { runId: string; agents: Record<string, TranscriptRecord[]> };

const RUN = fixture.runId;

/** The whole fixture folded, as the ingest would after reading every file. */
function folded(only?: string[]) {
  const fold = emptyWorkflowUsageFold();
  for (const [agentId, records] of Object.entries(fixture.agents)) {
    if (only && !only.includes(agentId)) continue;
    foldWorkflowAgentRecords(fold, agentId, records);
  }
  return workflowUsageOf(RUN, fold);
}

const agentSplit = (agentId: string) =>
  folded().agents.find((a) => a.agentId === agentId)!.split;

describe('workflowAgentIdOf', () => {
  it('reads the agentId a workflow transcript is named for', () => {
    expect(workflowAgentIdOf('agent-a2a07e2a8ef27d692.jsonl')).toBe('a2a07e2a8ef27d692');
  });

  it('ignores the run journal beside it', () => {
    expect(workflowAgentIdOf('journal.jsonl')).toBeNull();
  });

  it('ignores a NAMED subagent transcript, which is a team-side file', () => {
    expect(workflowAgentIdOf('agent-aprobe-charlie-12ee4cb1ed35cf7c.jsonl')).toBeNull();
  });
});

describe('folding one agent', () => {
  it('bills the four classes off its own transcript', () => {
    // Hand-summed from the fixture: two turns of 100/200/1000/10000 and
    // 100/300/2000/20000.
    expect(agentSplit('a06eeee08bb883b02')).toEqual({
      in: 200,
      out: 500,
      cacheWrite: 3000,
      cacheWrite1h: 400,
      cacheRead: 30000,
    });
  });

  it('bills a streamed message once, at its largest output count', () => {
    // a2a07e2a's first message is written twice, out=100 then out=500.
    expect(agentSplit('a2a07e2a8ef27d692')).toEqual({
      in: 50,
      out: 700,
      cacheWrite: 1300,
      cacheWrite1h: 0,
      cacheRead: 20000,
    });
  });

  it('reads a file whole the same way as one record at a time', () => {
    const chunked = emptyWorkflowUsageFold();
    for (const [agentId, records] of Object.entries(fixture.agents)) {
      for (const rec of records) foldWorkflowAgentRecords(chunked, agentId, [rec]);
    }
    expect(workflowUsageOf(RUN, chunked)).toEqual(folded());
  });

  it('costs nothing to re-read a file the sweep has already seen', () => {
    const twice = emptyWorkflowUsageFold();
    for (const pass of [0, 1]) {
      void pass;
      for (const [agentId, records] of Object.entries(fixture.agents)) {
        foldWorkflowAgentRecords(twice, agentId, records);
      }
    }
    expect(workflowUsageOf(RUN, twice).split).toEqual(folded().split);
  });

  it('takes the model from the agent’s last turn', () => {
    // a2a07e2a's turns run opus then sonnet; the later one is what its later
    // turns were billed at.
    expect(folded().agents.find((a) => a.agentId === 'a2a07e2a8ef27d692')?.model).toBe(
      'claude-sonnet-5',
    );
  });

  it('ignores a record with no usage, and an api error', () => {
    const fold = emptyWorkflowUsageFold();
    const records: TranscriptRecord[] = [
      { type: 'assistant', uuid: 'a', timestamp: '2026-08-30T03:00:00.000Z', message: {} },
      {
        type: 'assistant',
        uuid: 'b',
        timestamp: '2026-08-30T03:00:01.000Z',
        isApiErrorMessage: true,
        message: { id: 'm', usage: { input_tokens: 9, output_tokens: 9 } },
      },
      { type: 'user', uuid: 'c', timestamp: '2026-08-30T03:00:02.000Z' },
    ];
    foldWorkflowAgentRecords(fold, 'a1111111111111111', records);
    expect(workflowUsageOf(RUN, fold).split).toEqual({
      in: 0,
      out: 0,
      cacheWrite: 0,
      cacheWrite1h: 0,
      cacheRead: 0,
    });
  });
});

describe('the run rollup', () => {
  it('sums every agent of the run', () => {
    expect(folded().split).toEqual({
      in: 310,
      out: 1440,
      cacheWrite: 5200,
      cacheWrite1h: 400,
      cacheRead: 63000,
    });
  });

  it('is dominated by cache reads, which is why the snapshot understates it', () => {
    const { split } = folded();
    const total = split.in + split.out + split.cacheWrite + split.cacheRead;
    expect(total).toBe(69950);
    // The snapshot for this same run reports 698,551 as `totalTokens` — a
    // different quantity (final context occupancy), never this one.
    expect(split.cacheRead / total).toBeGreaterThan(0.9);
  });

  it('counts the agents it actually covers, not the ones the run declared', () => {
    expect(folded(['a06eeee08bb883b02']).agents).toHaveLength(1);
  });

  it('leaves out an agent whose transcript holds no billed turn yet', () => {
    // A workflow agent writes its transcript before it has had a turn. A zero
    // split for it would say it spent nothing, which is a different claim from
    // "nothing measured yet" — and would count it as covered.
    const fold = emptyWorkflowUsageFold();
    foldWorkflowAgentRecords(fold, 'a1111111111111111', [
      { type: 'user', uuid: 'u', timestamp: '2026-08-30T03:00:00.000Z' },
    ]);
    expect(workflowUsageOf(RUN, fold).agents).toEqual([]);
  });
});

describe('the burn series', () => {
  it('is cumulative and ends at the run total', () => {
    const { burn, split } = folded();
    const total = split.in + split.out + split.cacheWrite + split.cacheRead;
    expect(burn.cumulative.at(-1)).toBe(total);
    // Cumulative means never decreasing.
    for (let i = 1; i < burn.cumulative.length; i++) {
      expect(burn.cumulative[i]).toBeGreaterThanOrEqual(burn.cumulative[i - 1]);
    }
  });

  it('starts at the run’s first billed turn', () => {
    expect(folded().burn.startedAt).toBe(
      Date.parse(fixture.agents.a06eeee08bb883b02[0].timestamp!),
    );
  });

  it('never carries more than the sample cap, however long the run ran', () => {
    const fold = emptyWorkflowUsageFold();
    // One turn a minute for eight hours — 480 billed turns.
    const records: TranscriptRecord[] = [];
    for (let i = 0; i < 480; i++) {
      records.push({
        type: 'assistant',
        uuid: `u${i}`,
        timestamp: new Date(1787921982000 + i * 60_000).toISOString(),
        message: { id: `m${i}`, model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 1 } },
      });
    }
    foldWorkflowAgentRecords(fold, 'a1111111111111111', records);
    const { burn } = workflowUsageOf(RUN, fold);
    expect(burn.cumulative.length).toBeLessThanOrEqual(WORKFLOW_BURN_SAMPLES);
    expect(burn.cumulative.at(-1)).toBe(960);
  });

  it('gives a run whose turns all landed at once one bucket, not a divide by zero', () => {
    const fold = emptyWorkflowUsageFold();
    foldWorkflowAgentRecords(fold, 'a1111111111111111', [
      {
        type: 'assistant',
        uuid: 'u1',
        timestamp: '2026-08-30T03:00:00.000Z',
        message: { id: 'm1', usage: { input_tokens: 5, output_tokens: 5 } },
      },
      {
        type: 'assistant',
        uuid: 'u2',
        timestamp: '2026-08-30T03:00:00.000Z',
        message: { id: 'm2', usage: { input_tokens: 5, output_tokens: 5 } },
      },
    ]);
    const { burn } = workflowUsageOf(RUN, fold);
    expect(burn.cumulative).toEqual([20]);
    expect(burn.stepMs).toBeGreaterThan(0);
  });

  it('is empty rather than fabricated when no agent has had a turn', () => {
    const { burn, split } = workflowUsageOf(RUN, emptyWorkflowUsageFold());
    expect(burn.cumulative).toEqual([]);
    expect(split.in).toBe(0);
  });
});

describe('attaching usage to the run model', () => {
  const agents: WorkflowAgent[] = [
    { agentId: 'a06eeee08bb883b02', state: 'done', phaseIndex: 1, model: 'claude-opus-5[1m]' },
    { agentId: 'ad5320caf6d71b0e3', state: 'done', phaseIndex: 1, model: 'claude-opus-5[1m]' },
    { agentId: 'a6db0927d6cf282b1', state: 'done', phaseIndex: 2, model: 'claude-opus-5[1m]' },
    { agentId: 'a2a07e2a8ef27d692', state: 'done', phaseIndex: 2, model: 'claude-opus-5[1m]' },
  ];

  it('puts each agent’s own split on its row', () => {
    const { agents: merged } = attachWorkflowUsage(agents, folded());
    expect(merged[0].tokenSplit).toEqual(agentSplit('a06eeee08bb883b02'));
  });

  it('rolls up per declared phase', () => {
    const { usage } = attachWorkflowUsage(agents, folded());
    expect(usage.byPhase).toEqual([
      // phase 1: a06eeee08 + ad5320ca
      { phaseIndex: 1, split: { in: 250, out: 650, cacheWrite: 3500, cacheWrite1h: 400, cacheRead: 35000 } },
      // phase 2: a6db0927 + a2a07e2a
      { phaseIndex: 2, split: { in: 60, out: 790, cacheWrite: 1700, cacheWrite1h: 0, cacheRead: 28000 } },
    ]);
  });

  it('leaves a live run’s phase rollup EMPTY rather than zeroed', () => {
    // A journal-only run has agents with no phaseIndex — the snapshot is the
    // only thing that carries one, and it does not exist yet.
    const live: WorkflowAgent[] = agents.map((a) => ({ agentId: a.agentId, state: 'run' }));
    const { usage } = attachWorkflowUsage(live, folded());
    expect(usage.byPhase).toEqual([]);
    // The run total is still real: it never needed the phases.
    expect(usage.split).toEqual(folded().split);
  });

  it('names a live agent’s model from its transcript, and never overwrites the snapshot’s', () => {
    const live: WorkflowAgent[] = [{ agentId: 'a2a07e2a8ef27d692', state: 'run' }];
    expect(attachWorkflowUsage(live, folded()).agents[0].model).toBe('claude-sonnet-5');
    // With a snapshot present, the runtime's resolved model wins.
    const settled: WorkflowAgent[] = [
      { agentId: 'a2a07e2a8ef27d692', state: 'done', model: 'claude-opus-5[1m]' },
    ];
    expect(attachWorkflowUsage(settled, folded()).agents[0].model).toBe('claude-opus-5[1m]');
  });

  it('leaves an agent with no transcript yet untouched', () => {
    const partial: WorkflowAgent[] = [
      ...agents,
      { agentId: 'a9999999999999999', state: 'wait' },
    ];
    const { agents: merged, usage } = attachWorkflowUsage(partial, folded());
    expect(merged.at(-1)!.tokenSplit).toBeUndefined();
    // …and the coverage count says so, rather than implying the run is fully read.
    expect(usage.agentsMeasured).toBe(4);
    expect(partial).toHaveLength(5);
  });
});
