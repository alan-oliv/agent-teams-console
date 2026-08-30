// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { WorkflowAgent, WorkflowRun } from '../../shared/domain';
import { WorkflowScript } from './WorkflowScript';

afterEach(cleanup);

const agent = (agentId: string, state: WorkflowAgent['state'], label: string): WorkflowAgent => ({
  agentId, state, label,
});

const run = (over: Partial<WorkflowRun> = {}): WorkflowRun => ({
  runId: 'wf_x',
  status: 'completed',
  live: false,
  phases: [],
  logs: [],
  agents: [
    agent('a1', 'cache', 'impl:one'),
    agent('a2', 'cache', 'impl:two'),
    agent('a3', 'done', 'impl:three'),
  ],
  ...over,
});

describe('WorkflowScript', () => {
  it('counts the replayed prefix and the re-run calls from the data', () => {
    render(<WorkflowScript run={run()} />);
    const legend = screen.getByTestId('wf-script-legend').textContent ?? '';
    expect(legend).toContain('2 replayed from cache');
    expect(legend).toContain('1 ran');
  });

  it('tints a cached call differently from one that ran', () => {
    render(<WorkflowScript run={run()} />);
    const calls = screen.getAllByTestId('wf-script-call');
    expect(calls[0].dataset.tint).toBe('cache');
    expect(calls[2].dataset.tint).toBe('fresh');
  });

  it('says a run that resumed nothing ran every call', () => {
    render(<WorkflowScript run={run({ agents: [agent('a1', 'done', 'x')] })} />);
    expect(screen.getByTestId('wf-script-legend').textContent).toContain('nothing was replayed');
  });

  // A resumed run's journal omits every agent served from cache, so live there
  // is no such thing as a zero cache count — only a count nobody can take yet.
  // Asserting "this run started clean" mid-flight is a claim, not a reading.
  it('refuses to call a live run clean, having no way to see a cache hit', () => {
    render(<WorkflowScript run={run({ live: true, agents: [agent('a1', 'run', 'x')] })} />);
    const legend = screen.getByTestId('wf-script-legend').textContent ?? '';

    expect(legend).not.toContain('nothing was replayed');
    expect(legend).not.toContain('0 replayed from cache');
    expect(legend).toMatch(/cache/i);
    expect(legend).toMatch(/snapshot|not.*yet|cannot/i);
  });

  it('still counts the calls a live journal did see', () => {
    render(<WorkflowScript run={run({
      live: true,
      agents: [agent('a1', 'done', 'x'), agent('a2', 'run', 'y')],
    })} />);
    expect(screen.getByTestId('wf-script-legend').textContent).toContain('2');
  });

  it('shows the source when the snapshot carried it', () => {
    render(<WorkflowScript run={run({ script: "export const meta = { name: 'x' }" })} />);
    expect(screen.getByTestId('wf-script-source').textContent).toContain('export const meta');
  });

  // The script is stripped before the run reaches the browser — it is 65% of a
  // run's bytes and every run would carry it. Saying so beats an empty pane.
  it('explains the absent source rather than drawing an empty pane', () => {
    render(<WorkflowScript run={run()} />);
    expect(screen.queryByTestId('wf-script-source')).toBeNull();
    expect(screen.getByTestId('wf-script-absent').textContent).toMatch(/scriptPath|not carried/i);
  });

  it('states the determinism rule a resume depends on', () => {
    render(<WorkflowScript run={run()} />);
    const note = screen.getByTestId('wf-script-note').textContent ?? '';
    expect(note).toContain('Date.now()');
    expect(note).toMatch(/longest unchanged prefix/i);
  });
});
