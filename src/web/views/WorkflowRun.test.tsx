// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { WorkflowAgent, WorkflowRun as Run } from '../../shared/domain';
import { WorkflowRun } from './WorkflowRun';

afterEach(cleanup);

/** The grid is opt-in, so a test about a cell has to take the offer first. */
const openGrid = () => fireEvent.click(screen.getByTestId('wf-layout-grid'));

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

  // Grouped by phase is what the view IS. The grid is a second reading of the
  // same agents, offered only where the label corpus supports it.
  it('lists agents under their phase before any grid is asked for', () => {
    render(<WorkflowRun run={RUN} />);
    const groups = screen.getAllByTestId('wf-phase-group');

    expect(screen.queryByTestId('wf-row')).toBeNull();
    expect(within(groups[0]).getAllByTestId('wf-name').map((n) => n.textContent))
      .toEqual(['S1-server', 'S2-client']);
    expect(within(groups[2]).queryAllByTestId('wf-name')).toEqual([]);
  });

  it('sizes the identity column from the measured longest key, clamped to two lines', () => {
    render(<WorkflowRun run={RUN} />);
    const name = screen.getAllByTestId('wf-name')[0];

    expect(name.style.width).toBe('151px');
    expect(name.style.webkitLineClamp).toBe('2');
    expect(name.style.textOverflow).not.toBe('ellipsis');
  });

  it('gives each work item a row, sized from the measured longest key', () => {
    render(<WorkflowRun run={RUN} />);
    openGrid();
    const rows = screen.getAllByTestId('wf-row');
    expect(rows.map((r) => within(r).getByTestId('wf-item').textContent)).toEqual([
      'S1-server',
      'S2-client',
    ]);
    expect(within(rows[0]).getByTestId('wf-item').style.width).toBe('151px');
  });

  it('draws a cell glyph per state, and nothing where no agent exists', () => {
    render(<WorkflowRun run={RUN} />);
    openGrid();
    const cells = within(screen.getAllByTestId('wf-row')[0]).getAllByTestId('wf-cell');
    expect(cells[0].textContent).toBe('✓');
    expect(cells[1].textContent).toBe('✓');
    expect(cells[2].textContent).toBe('');
  });

  it('marks a running agent with its own glyph', () => {
    render(<WorkflowRun run={RUN} />);
    openGrid();
    const second = within(screen.getAllByTestId('wf-row')[1]).getAllByTestId('wf-cell');
    expect(second[1].textContent).toBe('●');
  });

  // A decision and a failure drawn as the same ∅ is exactly the collapse the
  // design names: only one of the two wants the operator.
  it('separates a skipped agent from one that threw', () => {
    const run: Run = {
      ...RUN,
      phases: [{ index: 1, title: 'Design' }],
      agents: [
        agent({ agentId: 'a1', label: 'x:skipped', phaseIndex: 1, state: 'null' }),
        agent({ agentId: 'a2', label: 'x:threw', phaseIndex: 1, state: 'fail' }),
        agent({ agentId: 'a3', label: 'x:refused', phaseIndex: 1, state: 'block' }),
      ],
    };
    render(<WorkflowRun run={run} />);
    const glyphs = screen.getAllByTestId('wf-glyph');

    expect(glyphs.map((g) => g.textContent)).toEqual(['∅', '✗', '⊘']);
    expect(glyphs[1].style.color).toBe('var(--fail)');
    expect(glyphs[0].style.color).not.toBe(glyphs[1].style.color);
  });

  it('offers the grid only where the label corpus supports one', () => {
    render(<WorkflowRun run={RUN} />);
    expect(screen.getByTestId('wf-layout-grid')).toBeTruthy();

    cleanup();
    render(
      <WorkflowRun
        run={{
          ...RUN,
          phases: [{ index: 1, title: 'Investigate' }, { index: 2, title: 'Verify' }],
          agents: [
            agent({ agentId: 'a1', label: 'probe:D1-frame', phaseIndex: 1 }),
            agent({ agentId: 'a2', label: 'probe:D2-latency', phaseIndex: 1 }),
            agent({ agentId: 'a3', label: 'verify:correctness', phaseIndex: 2 }),
          ],
        }}
      />,
    );
    expect(screen.queryByTestId('wf-layout-grid')).toBeNull();
    expect(screen.getAllByTestId('wf-phase-group')).toHaveLength(2);
    // A missing control reads as one the console forgot, so the withheld grid
    // says why it is withheld.
    expect(screen.getByTestId('wf-no-grid').textContent).toMatch(/labels do not resolve/i);
  });

  // A cluster of ≥2 proves a parallel() fan-out. A cluster of 1 proves nothing,
  // so it says nothing — labelling it sequential would read the evidence
  // backwards.
  it('names a shared queuedAt as dispatched together, and is silent otherwise', () => {
    render(
      <WorkflowRun
        run={{
          ...RUN,
          phases: [{ index: 1, title: 'Design' }],
          agents: [
            agent({ agentId: 'a1', label: 'd:S1', phaseIndex: 1, queuedAt: 1000 }),
            agent({ agentId: 'a2', label: 'd:S2', phaseIndex: 1, queuedAt: 1000 }),
            agent({ agentId: 'a3', label: 'd:S3', phaseIndex: 1, queuedAt: 2400 }),
          ],
        }}
      />,
    );
    const notes = screen.getAllByTestId('wf-dispatch');

    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toContain('2 dispatched together');
    expect(screen.getByTestId('wf-phase-group').textContent).not.toMatch(/sequential/i);
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

  // The cap is computed from the HOST's cpu count at launch and never written
  // down. The browser's own core count is a different machine's number, so the
  // panel names the formula and says the value is not recorded.
  it('names the slot formula without inventing the slot count', () => {
    render(<WorkflowRun run={RUN} />);
    const limits = screen.getByTestId('wf-limits').textContent ?? '';
    expect(limits).toMatch(/not recorded|never written/i);
    expect(limits).not.toMatch(/\b(?:8|16) slots\b/);
  });

  describe('a live run', () => {
    const LIVE: Run = {
      runId: 'wf_live-001',
      status: 'running',
      live: true,
      phases: [],
      logs: [],
      agents: [
        agent({ agentId: 'a1', state: 'done' }),
        agent({ agentId: 'a2', state: 'done' }),
        agent({ agentId: 'a3', state: 'run' }),
      ],
    };

    // The snapshot lands once, at termination. Mid-flight there is no phase and
    // no label on disk, so a grid is not merely empty — it is not derivable.
    it('draws the flat agent list and says why there is no grid', () => {
      render(<WorkflowRun run={LIVE} />);

      expect(screen.getByTestId('wf-live-note').textContent).toMatch(/until the run ends/i);
      expect(screen.queryByTestId('wf-row')).toBeNull();
      expect(screen.queryByTestId('wf-phase-group')).toBeNull();
      expect(screen.queryByTestId('wf-layout')).toBeNull();
    });

    it('keeps the sidebar, which the spec never restricted to a finished run', () => {
      render(<WorkflowRun run={LIVE} />);

      expect(screen.getByTestId('wf-limits')).toBeTruthy();
      expect(screen.getByTestId('wf-not-in-loop')).toBeTruthy();
    });

    // Absent is not zero. Tokens and tool calls reach disk with the snapshot,
    // and drawing them as 0 mid-run reports a measurement nobody took.
    it('totals what the journal counted instead of a fabricated zero', () => {
      render(<WorkflowRun run={LIVE} />);
      const totals = screen.getByTestId('wf-totals').textContent ?? '';

      expect(totals).toContain('3 started');
      expect(totals).toContain('2 returned');
      expect(totals).not.toMatch(/0 tool calls/);
    });

    it('does not claim the script called log() nowhere before it could know', () => {
      render(<WorkflowRun run={LIVE} />);
      const log = screen.getByTestId('wf-log').textContent ?? '';

      expect(log).not.toMatch(/called log\(\) nowhere/i);
      expect(log).toMatch(/snapshot/i);
    });
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
