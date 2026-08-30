// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { WorkflowRun } from '../../shared/domain';
import { Workflow, WORKFLOW_VIEW_IDS } from './Workflow';

afterEach(cleanup);

const FINISHED: WorkflowRun = {
  runId: 'wf_d36b25c0-f96',
  name: 'team-selector',
  taskId: 'w04rzzvc3',
  status: 'completed',
  live: false,
  startedAt: 1_000_000,
  durationMs: 60_000,
  totalTokens: 698551,
  totalToolCalls: 219,
  logs: [],
  phases: [{ index: 1, title: 'Build', detail: 'one implementer per task' }],
  agents: [{ agentId: 'a1', label: 'impl:task-9', phaseIndex: 1, state: 'done', result: 'ok' }],
};

const LIVE: WorkflowRun = {
  runId: 'wf_live-001',
  status: 'running',
  live: true,
  logs: [],
  phases: [],
  agents: [{ agentId: 'a1', state: 'run' }],
};

const now = 1_060_000;

describe('Workflow', () => {
  it('says RUN, not TEAM — a workflow is not a team', () => {
    render(<Workflow run={FINISHED} now={now} />);
    expect(screen.getByTestId('wf-wordmark').textContent).toBe('RUN');
  });

  it('names the workflow and its run id in the picker slot', () => {
    render(<Workflow run={FINISHED} now={now} />);
    const slot = screen.getByTestId('wf-identity').textContent ?? '';
    expect(slot).toContain('team-selector');
    expect(slot).toContain('wf_d36b25c0-f96');
  });

  it('carries the task id and the elapsed on the right', () => {
    render(<Workflow run={FINISHED} now={now} />);
    expect(screen.getByTestId('wf-task-id').textContent).toContain('w04rzzvc3');
    expect(screen.getByTestId('wf-elapsed').textContent).toBe('1m 00s');
  });

  // The bar is one 40px line, and a child that can shrink or wrap doubles its
  // height. Four pills is not the team bar's six, but the discipline is the same.
  it('lets nothing in the bar shrink or wrap', () => {
    render(<Workflow run={FINISHED} now={now} />);
    const bar = screen.getByTestId('wf-bar');
    // Every child but the spacer, which is a flexible GAP rather than content:
    // it carries no text, so it can neither wrap nor add height.
    const content = (Array.from(bar.children) as HTMLElement[]).filter(
      (c) => c.dataset.testid !== 'wf-spacer',
    );
    expect(content.length).toBeGreaterThan(0);
    for (const child of content) {
      expect(child.style.flexGrow).toBe('0');
      expect(child.style.flexShrink).toBe('0');
      expect(child.style.whiteSpace).toBe('nowrap');
    }
  });

  it('offers exactly the four views the design specifies', () => {
    render(<Workflow run={FINISHED} now={now} />);
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([...WORKFLOW_VIEW_IDS]);
  });

  it('opens on the run view and switches when a pill is clicked', () => {
    render(<Workflow run={FINISHED} now={now} />);
    expect(screen.getByTestId('workflow-run')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'journal' }));
    expect(screen.getByTestId('workflow-journal')).toBeTruthy();
    expect(screen.queryByTestId('workflow-run')).toBeNull();
  });

  // The snapshot lands once, at termination. Mid-flight there is no phase and
  // no label on disk, so the grid is not merely empty — it is not derivable.
  it('draws a live run as a flat agent list, not as an empty grid', () => {
    render(<Workflow run={LIVE} now={now} />);
    expect(screen.queryByTestId('workflow-run')).toBeNull();
    expect(screen.getByTestId('workflow-agents')).toBeTruthy();
    expect(screen.getByTestId('wf-live-note').textContent).toMatch(/until the run ends/i);
  });

  it('shows a live run no elapsed it cannot source', () => {
    render(<Workflow run={LIVE} now={now} />);
    expect(screen.getByTestId('wf-elapsed').textContent).toBe('—');
  });

  it('draws no control, because no route backs one', () => {
    const { container } = render(<Workflow run={FINISHED} now={now} />);
    // The only interactive elements are the four view pills; `skip agent` and
    // `stop run` wait on a server route, per the console's own precedent.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.textContent ?? '').not.toMatch(/skip agent|stop run/i);
  });
});
