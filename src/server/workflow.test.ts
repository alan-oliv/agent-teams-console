import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseWorkflowRun,
  parseWorkflowJournal,
  foldWorkflows,
  modeOf,
  leanRun,
} from './workflow';
import type { StoredEvent } from './store';
import type { WorkflowRun } from '../shared/domain';

const FIXTURES = path.resolve(process.cwd(), 'fixtures');

function snapshot(): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, 'workflow-run.json'), 'utf8'));
}

describe('parseWorkflowRun', () => {
  it('reads a snapshot into a run carrying its phases and its agents', () => {
    const run = parseWorkflowRun(snapshot());

    expect(run?.runId).toBe('wf_d36b25c0-f96');
    expect(run?.name).toBe('team-selector');
    expect(run?.phases.map((p) => p.title)).toEqual(['Design', 'Build', 'Verify']);
    expect(run?.agents.map((a) => a.label)).toEqual([
      'design:S1-server',
      'design:S2-client',
      'build:S1-server',
      'build:S2-client',
    ]);
  });

  it('keeps a declared phase that never ran, holding no agents', () => {
    const run = parseWorkflowRun(snapshot());

    expect(run?.phases.map((p) => p.title)).toContain('Verify');
    expect(run?.agents.filter((a) => a.phaseTitle === 'Verify')).toEqual([]);
  });

  it('leaves duration and result absent on an agent that never finished', () => {
    const run = parseWorkflowRun(snapshot());
    const running = run?.agents.find((a) => a.label === 'build:S2-client');

    expect(running?.state).toBe('run');
    expect(running).not.toHaveProperty('durationMs');
    expect(running).not.toHaveProperty('result');
  });

  it('rejects a JSON file that is not a run snapshot', () => {
    expect(parseWorkflowRun({ agentType: 'workflow-subagent', spawnDepth: 1 })).toBeNull();
    expect(parseWorkflowRun(null)).toBeNull();
  });

  describe('agent state', () => {
    const withAgent = (rec: Record<string, unknown>) =>
      parseWorkflowRun({
        runId: 'wf_x',
        workflowName: 'n',
        workflowProgress: [{ type: 'workflow_agent', agentId: 'a1', label: 'l', ...rec }],
      })?.agents[0];

    it('reads a cache hit as cache, not as done', () => {
      expect(withAgent({ state: 'done', cached: true })?.state).toBe('cache');
    });

    it('separates an agent queued for a slot from one that has started', () => {
      expect(withAgent({ state: 'start' })?.state).toBe('wait');
      expect(withAgent({ state: 'start', startedAt: 5 })?.state).toBe('run');
    });

    // One rule across both sources: absent means the file did not carry it.
    // A zero here would render as a real measurement of nothing.
    it('leaves usage absent rather than zero when a record omits it', () => {
      const bare = withAgent({ state: 'done' });
      expect(bare).not.toHaveProperty('tokens');
      expect(bare).not.toHaveProperty('toolCalls');
      expect(bare).not.toHaveProperty('model');
    });

    it('reads an errored agent as null, keeping why', () => {
      const skipped = withAgent({ state: 'error', error: 'skipped by user' });
      expect(skipped?.state).toBe('null');
      expect(skipped?.error).toBe('skipped by user');
    });
  });
});

// The journal is the ONLY source while a run is in flight: the snapshot does
// not exist until the run ends. These tests pin what a live run can honestly
// show, which is an agent list and nothing else.
describe('parseWorkflowJournal', () => {
  const line = (o: unknown) => JSON.stringify(o);
  const STARTED = line({ type: 'started', key: 'v2:aaa', agentId: 'a111' });
  const RESULT = line({ type: 'result', key: 'v2:aaa', agentId: 'a111', result: 'the text' });

  it('reports an agent that has started but not returned as running', () => {
    const run = parseWorkflowJournal('wf_live', [STARTED]);

    expect(run.live).toBe(true);
    expect(run.status).toBe('running');
    expect(run.agents).toEqual([{ agentId: 'a111', state: 'run' }]);
  });

  it('carries the full result text a returned agent wrote', () => {
    const run = parseWorkflowJournal('wf_live', [STARTED, RESULT]);

    expect(run.agents[0].state).toBe('done');
    expect(run.agents[0].result).toBe('the text');
  });

  it('invents no phase, label or usage for a live agent', () => {
    const run = parseWorkflowJournal('wf_live', [STARTED, RESULT]);

    expect(run.phases).toEqual([]);
    expect(run.agents[0]).not.toHaveProperty('label');
    expect(run.agents[0]).not.toHaveProperty('phaseTitle');
    expect(run.agents[0]).not.toHaveProperty('tokens');
  });

  it('keeps one entry per agent when the journal repeats an id', () => {
    const retried = line({ type: 'started', key: 'v2:bbb', agentId: 'a111' });
    const run = parseWorkflowJournal('wf_live', [STARTED, retried, RESULT]);

    expect(run.agents).toHaveLength(1);
    expect(run.agents[0].state).toBe('done');
  });

  it('skips a line torn by a read landing mid-append', () => {
    const run = parseWorkflowJournal('wf_live', [STARTED, '{"type":"resu', '']);

    expect(run.agents).toHaveLength(1);
  });
});

describe('foldWorkflows', () => {
  const ev = (payload: unknown, seq: number): StoredEvent =>
    ({ seq, ts: seq, kind: 'workflow', payload }) as StoredEvent;
  const run = (runId: string, over: Partial<WorkflowRun> = {}): WorkflowRun => ({
    runId, status: 'completed', agents: [], phases: [], logs: [], live: false, ...over,
  });

  it('lets the terminal snapshot replace the live run it supersedes', () => {
    const runs = foldWorkflows([
      ev(run('wf_a', { status: 'running', live: true }), 1),
      ev(run('wf_a', { status: 'completed', startedAt: 10 }), 2),
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0].live).toBe(false);
    expect(runs[0].status).toBe('completed');
  });

  it('never lets a late journal read overwrite a snapshot already folded', () => {
    const runs = foldWorkflows([
      ev(run('wf_a', { status: 'completed' }), 1),
      ev(run('wf_a', { status: 'running', live: true }), 2),
    ]);

    expect(runs[0].status).toBe('completed');
  });

  it('orders runs newest first, and a run with no start time last', () => {
    const runs = foldWorkflows([
      ev(run('wf_old', { startedAt: 100 }), 1),
      ev(run('wf_new', { startedAt: 900 }), 2),
      ev(run('wf_live', { live: true }), 3),
    ]);

    expect(runs.map((r) => r.runId)).toEqual(['wf_new', 'wf_old', 'wf_live']);
  });

  it('ignores events of every other kind', () => {
    expect(foldWorkflows([{ seq: 1, ts: 1, kind: 'task', payload: { id: '1' } } as StoredEvent]))
      .toEqual([]);
  });
});

describe('modeOf', () => {
  const run = (runId: string): WorkflowRun =>
    ({ runId, status: 'completed', agents: [], phases: [], logs: [], live: false });

  it('stays in team mode whenever a REAL team is there, runs or not', () => {
    expect(modeOf(2, [run('wf_a')])).toBe('team');
    expect(modeOf(2, [])).toBe('team');
    expect(modeOf(4, [run('wf_a')])).toBe('team');
  });

  // One agent is a session's own lead, not a team: Claude Code writes a team
  // directory for every session. Keyed on zero this never fired on a real
  // machine — the console ingested the runs and drew the empty wall anyway.
  it('switches to workflow mode for a lead-only session with runs', () => {
    expect(modeOf(1, [run('wf_a')])).toBe('workflow');
    expect(modeOf(0, [run('wf_a')])).toBe('workflow');
  });

  it('stays in team mode when there are no runs, so an empty console is unchanged', () => {
    expect(modeOf(0, [])).toBe('team');
    expect(modeOf(1, [])).toBe('team');
  });
});

describe('leanRun', () => {
  it('drops the script, which is 65% of a run\'s bytes and nothing reads', () => {
    const full = parseWorkflowRun(snapshot());
    expect(full).toHaveProperty('script');

    const lean = leanRun(full!);
    expect(lean).not.toHaveProperty('script');
    expect(lean.scriptPath).toBe(full!.scriptPath);
  });

  it('keeps everything a view does read', () => {
    const full = parseWorkflowRun(snapshot())!;
    const lean = leanRun(full);

    expect(lean.agents).toEqual(full.agents);
    expect(lean.phases).toEqual(full.phases);
    expect(lean.logs).toEqual(full.logs);
    expect(lean.totalTokens).toBe(full.totalTokens);
  });
});
