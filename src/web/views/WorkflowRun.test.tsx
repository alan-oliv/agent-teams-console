// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { WorkflowAgent, WorkflowRun as Run } from '../../shared/domain';
import { WorkflowRun } from './WorkflowRun';

afterEach(cleanup);

const agent = (over: Partial<WorkflowAgent> & { agentId: string }): WorkflowAgent => ({
  state: 'done',
  ...over,
});

const RUN: Run = {
  runId: 'wf_d36b25c0-f96',
  name: 'team-selector',
  status: 'killed',
  live: false,
  startedAt: 1787921982823,
  durationMs: 2930000,
  totalTokens: 698551,
  totalToolCalls: 219,
  agentCount: 4,
  logs: ['S1-server: building', 'S2-client: building'],
  phases: [
    { index: 1, title: 'Design', detail: 'server retarget lifecycle and client selector, read-only' },
    { index: 2, title: 'Build', detail: 'server routes then client control, sequential' },
    { index: 3, title: 'Verify', detail: 'scope-leak proof, correctness, UI' },
  ],
  agents: [
    agent({ agentId: 'a1', label: 'design:S1-server', phaseIndex: 1, phaseTitle: 'Design', tokens: 100 }),
    agent({ agentId: 'a2', label: 'design:S2-client', phaseIndex: 1, phaseTitle: 'Design' }),
    agent({ agentId: 'a3', label: 'build:S1-server', phaseIndex: 2, phaseTitle: 'Build' }),
    agent({ agentId: 'a4', label: 'build:S2-client', phaseIndex: 2, state: 'run' }),
  ],
};

describe('WorkflowRun', () => {
  it('draws every declared phase as a column, including one that never ran', () => {
    render(<WorkflowRun run={RUN} />);
    const heads = screen.getAllByTestId('wf-phase');
    expect(heads.map((h) => within(h).getByTestId('wf-phase-title').textContent)).toEqual([
      'Design',
      'Build',
      'Verify',
    ]);
  });

  it('counts a phase by what it has, and says queued for one never reached', () => {
    render(<WorkflowRun run={RUN} />);
    const counts = screen.getAllByTestId('wf-phase-count').map((n) => n.textContent);
    expect(counts).toEqual(['2 returned', '1 returned · 1 running', 'queued']);
  });

  it('clamps a phase detail to two lines instead of ellipsising it', () => {
    render(<WorkflowRun run={RUN} />);
    const detail = screen.getAllByTestId('wf-phase-detail')[0];
    expect(detail.style.webkitLineClamp).toBe('2');
    expect(detail.style.textOverflow).not.toBe('ellipsis');
  });

  it('gives each work item a row, sized from the measured longest key', () => {
    render(<WorkflowRun run={RUN} />);
    const rows = screen.getAllByTestId('wf-row');
    expect(rows.map((r) => within(r).getByTestId('wf-item').textContent)).toEqual([
      'S1-server',
      'S2-client',
    ]);
    expect(within(rows[0]).getByTestId('wf-item').style.width).toBe('151px');
  });

  it('draws a cell glyph per state, and nothing where no agent exists', () => {
    render(<WorkflowRun run={RUN} />);
    const cells = within(screen.getAllByTestId('wf-row')[0]).getAllByTestId('wf-cell');
    expect(cells[0].textContent).toBe('✓');
    expect(cells[1].textContent).toBe('✓');
    expect(cells[2].textContent).toBe('');
  });

  it('marks a running agent with its own glyph', () => {
    render(<WorkflowRun run={RUN} />);
    const second = within(screen.getAllByTestId('wf-row')[1]).getAllByTestId('wf-cell');
    expect(second[1].textContent).toBe('●');
  });

  it('shows the run totals that exist, and says why there is no budget', () => {
    render(<WorkflowRun run={RUN} />);
    const totals = screen.getByTestId('wf-totals').textContent ?? '';
    expect(totals).toContain('219 tool calls');
    expect(totals).toContain('4 agents');
    // Absent by fact, not by omission — and the panel has to say so, or the
    // missing meter reads as a console that failed to read one.
    expect(totals).toMatch(/no budget on disk/i);
  });

  it('states the concurrency and lifetime limits the runtime imposes', () => {
    render(<WorkflowRun run={RUN} />);
    const limits = screen.getByTestId('wf-limits').textContent ?? '';
    expect(limits).toContain('min(16, CPUs − 2)');
    expect(limits).toContain('1000');
  });

  it('shows the log() narration the script emitted', () => {
    render(<WorkflowRun run={RUN} />);
    const log = screen.getByTestId('wf-log').textContent ?? '';
    expect(log).toContain('S1-server: building');
  });

  it('says the operator is not in the loop', () => {
    render(<WorkflowRun run={RUN} />);
    expect(screen.getByTestId('wf-not-in-loop').textContent).toMatch(/not in the loop/i);
  });

  // The design calls the parallel/pipeline tag the reason this view exists, and
  // it cannot be drawn: a phase is {title, detail} and one phase can hold
  // several parallel()/pipeline() calls. Drawing a per-phase kind would be an
  // invention, so the header carries none.
  it('draws no parallel/pipeline tag, which is not a per-phase fact', () => {
    render(<WorkflowRun run={RUN} />);
    const head = screen.getAllByTestId('wf-phase')[0].textContent ?? '';
    expect(head).not.toMatch(/parallel|pipeline|barrier/i);
  });

  it('renders a run whose script never called phase() without inventing a column', () => {
    render(
      <WorkflowRun
        run={{ ...RUN, phases: [], agents: [agent({ agentId: 'a9', label: 'solo' })] }}
      />,
    );
    expect(screen.getByTestId('wf-unphased').textContent).toContain('1');
  });
});
