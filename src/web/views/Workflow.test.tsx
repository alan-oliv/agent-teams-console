// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { WorkflowRun } from '../../shared/domain';
import { DEFAULT_SETTINGS } from '../state/useSettings';
import { cssVarsFor, DENSITY } from '../themes';
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

const APPEARANCE = {
  settings: DEFAULT_SETTINGS,
  set: vi.fn(),
  reset: vi.fn(),
  vars: cssVarsFor(DEFAULT_SETTINGS.theme, DEFAULT_SETTINGS.scheme),
  gap: DENSITY[DEFAULT_SETTINGS.density],
};

function renderWorkflow(run: WorkflowRun = FINISHED, onTeamsOpenChange = vi.fn()) {
  const result = render(
    <Workflow
      run={run}
      now={now}
      teamName="session-98b0b4a7"
      sessionName="session-98b0b4a7"
      teamsOpen={false}
      onTeamsOpenChange={onTeamsOpenChange}
      appearance={APPEARANCE}
    />,
  );
  return { ...result, onTeamsOpenChange };
}

describe('Workflow', () => {
  it('says RUN, not TEAM — a workflow is not a team', () => {
    renderWorkflow();
    expect(screen.getByTestId('bar-wordmark').textContent).toBe('RUN');
  });

  it('names the workflow and its run id in the picker slot', () => {
    renderWorkflow();
    const slot = screen.getByTestId('wf-identity').textContent ?? '';
    expect(slot).toContain('team-selector');
    expect(slot).toContain('wf_d36b25c0-f96');
  });

  it('carries the task id and the elapsed on the right', () => {
    renderWorkflow();
    expect(screen.getByTestId('wf-task-id').textContent).toContain('w04rzzvc3');
    expect(screen.getByTestId('wf-elapsed').textContent).toBe('1m 00s');
  });

  // The bar is one 40px line, and a child that can shrink or wrap doubles its
  // height. Four pills is not the team bar's six, but the discipline is the same
  // — and it is the same bar, so the rule is pinned the same way here.
  it('lets nothing in the bar shrink or wrap', () => {
    renderWorkflow();
    const bar = screen.getByTestId('bar');
    expect(bar.style.flexWrap).toBe('nowrap');

    // jsdom normalises the shorthand: `flex: 1` -> `1 1 0%`, `flex: none` -> `0 0 auto`.
    const spacers = [...bar.children].filter((c) => (c as HTMLElement).style.flex === '1 1 0%');
    expect(spacers).toHaveLength(1);

    for (const child of bar.children) {
      const el = child as HTMLElement;
      if (el === spacers[0]) continue;
      expect([el.textContent, el.style.flex]).toEqual([el.textContent, '0 0 auto']);
    }
  });

  it('offers exactly the four views the design specifies', () => {
    renderWorkflow();
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([...WORKFLOW_VIEW_IDS]);
  });

  it('opens on the run view and switches when a pill is clicked', () => {
    renderWorkflow();
    expect(screen.getByTestId('workflow-run')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'journal' }));
    expect(screen.getByTestId('workflow-journal')).toBeTruthy();
    expect(screen.queryByTestId('workflow-run')).toBeNull();
  });

  // Workflow mode used to short-circuit past the chrome entirely, which left the
  // URL as the only way out of a run and no way at all to reach the theme.
  it('carries the session picker, so a run is not a dead end', () => {
    const { onTeamsOpenChange } = renderWorkflow();
    fireEvent.click(screen.getByTestId('team-trigger'));
    expect(onTeamsOpenChange).toHaveBeenCalledWith(true);
  });

  it('carries the config gear', () => {
    renderWorkflow();
    fireEvent.click(screen.getByTestId('config-trigger'));
    expect(screen.getByTestId('config-menu')).toBeTruthy();
  });

  // The snapshot lands once, at termination. Mid-flight there is no phase and
  // no label on disk, so the grid is not merely empty — it is not derivable.
  it('draws a live run as a flat agent list, not as an empty grid', () => {
    renderWorkflow(LIVE);
    expect(screen.queryByTestId('workflow-run')).toBeNull();
    expect(screen.getByTestId('workflow-agents')).toBeTruthy();
    expect(screen.getByTestId('wf-live-note').textContent).toMatch(/until the run ends/i);
  });

  it('shows a live run no elapsed it cannot source', () => {
    renderWorkflow(LIVE);
    expect(screen.getByTestId('wf-elapsed').textContent).toBe('—');
  });

  it('draws no run control, because no route backs one', () => {
    const { container } = renderWorkflow();
    // `skip agent` and `stop run` wait on a server route, per the console's own
    // precedent. The chrome's own controls — the picker and the gear — are not
    // run controls and are exempt.
    expect(container.textContent ?? '').not.toMatch(/skip agent|stop run/i);
    expect(screen.queryByRole('button', { name: /skip|stop/i })).toBeNull();
  });
});
