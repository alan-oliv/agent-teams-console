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

const OLDER: WorkflowRun = {
  runId: 'wf_older-002',
  name: 'first-pass',
  status: 'failed',
  live: false,
  startedAt: 500_000,
  durationMs: 30_000,
  logs: [],
  phases: [],
  agents: [],
};

const now = 1_060_000;

const APPEARANCE = {
  settings: DEFAULT_SETTINGS,
  set: vi.fn(),
  reset: vi.fn(),
  vars: cssVarsFor(DEFAULT_SETTINGS.theme, DEFAULT_SETTINGS.scheme),
  gap: DENSITY[DEFAULT_SETTINGS.density],
};

function renderWorkflow(
  run: WorkflowRun = FINISHED,
  extra: { runs?: WorkflowRun[]; backToTeam?: string } = {},
) {
  const onTeamsOpenChange = vi.fn();
  const onSelectRun = vi.fn();
  const result = render(
    <Workflow
      run={run}
      runs={extra.runs ?? [run]}
      onSelectRun={onSelectRun}
      backToTeam={extra.backToTeam}
      now={now}
      teamName="session-98b0b4a7"
      sessionName="session-98b0b4a7"
      teamsOpen={false}
      onTeamsOpenChange={onTeamsOpenChange}
      appearance={APPEARANCE}
    />,
  );
  return { ...result, onTeamsOpenChange, onSelectRun };
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

  // The design gives the right side the task id, the run totals and elapsed —
  // and no status word. The run picker beside the wordmark already carries the
  // state, so the word was a second readout of one fact.
  it('carries the run totals, and no status word', () => {
    renderWorkflow();
    const totals = screen.getByTestId('wf-run-totals').textContent ?? '';

    expect(totals).toContain('219 tools');
    expect(totals).toMatch(/699k|698/);
    expect(screen.queryByTestId('wf-status')).toBeNull();
  });

  // Tokens and tool calls arrive with the snapshot. Started/returned is the
  // only total a run in flight actually has.
  it('totals a live run by what its journal counted', () => {
    renderWorkflow(LIVE);
    expect(screen.getByTestId('wf-run-totals').textContent).toBe('1 started · 0 returned');
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

  it('offers exactly the five views the design specifies', () => {
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

  it('routes the usage pill to the workflow usage view', () => {
    renderWorkflow();
    fireEvent.click(screen.getByRole('tab', { name: 'usage' }));
    expect(screen.getByTestId('workflow-usage')).toBeTruthy();
    expect(screen.queryByTestId('workflow-run')).toBeNull();
  });

  // Workflow mode used to short-circuit past the chrome entirely, which left the
  // URL as the only way out of a run and no way at all to reach the theme.
  it('carries the session picker, so a run is not a dead end', () => {
    const { onTeamsOpenChange } = renderWorkflow();
    fireEvent.click(screen.getByTestId('team-trigger'));
    expect(onTeamsOpenChange).toHaveBeenCalledWith(true);
  });

  // Only the newest run was ever drawable, though every run the session has ran
  // rides the same frame.
  it('lists every run on the session, live first and newest first', () => {
    renderWorkflow(FINISHED, { runs: [FINISHED, OLDER, LIVE] });
    fireEvent.click(screen.getByTestId('run-trigger'));
    const rows = screen.getAllByTestId('run-option');
    expect(rows.map((r) => r.getAttribute('data-run'))).toEqual([
      'wf_live-001',
      'wf_d36b25c0-f96',
      'wf_older-002',
    ]);
    expect(rows[2].textContent).toContain('first-pass');
    // A live run reaches the name only in the snapshot it does not have yet.
    expect(rows[0].textContent).toContain('unnamed run');
  });

  it('selects the run the operator picks out of the list', () => {
    const { onSelectRun } = renderWorkflow(FINISHED, { runs: [FINISHED, OLDER] });
    fireEvent.click(screen.getByTestId('run-trigger'));
    fireEvent.click(screen.getAllByTestId('run-option')[1]);
    expect(onSelectRun).toHaveBeenCalledWith('wf_older-002');
    expect(screen.queryByTestId('run-list')).toBeNull();
  });

  it('marks the run on screen as the selected one', () => {
    renderWorkflow(FINISHED, { runs: [FINISHED, OLDER] });
    fireEvent.click(screen.getByTestId('run-trigger'));
    const rows = screen.getAllByTestId('run-option');
    expect(rows.map((r) => r.getAttribute('aria-selected'))).toEqual(['true', 'false']);
  });

  // A run selected while a team is running is the client overriding the server's
  // mode, and the override has to be reversible from the same control.
  it('offers the way back when a team is running behind the run', () => {
    const { onSelectRun } = renderWorkflow(FINISHED, { backToTeam: 'session-98b0b4a7' });
    fireEvent.click(screen.getByTestId('run-trigger'));
    fireEvent.click(screen.getByTestId('run-back-to-team'));
    expect(onSelectRun).toHaveBeenCalledWith(null);
  });

  it('offers no way back when the run is all the session is', () => {
    renderWorkflow();
    fireEvent.click(screen.getByTestId('run-trigger'));
    expect(screen.queryByTestId('run-back-to-team')).toBeNull();
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
    // The run view owns the live/finished split now, so it is mounted either
    // way — what a live run must not have is the grid or the phase groups.
    expect(screen.queryByTestId('wf-row')).toBeNull();
    expect(screen.queryByTestId('wf-phase-group')).toBeNull();
    expect(screen.getByTestId('workflow-agents')).toBeTruthy();
    expect(screen.getByTestId('wf-live-note').textContent).toMatch(/until the run ends/i);
    // The sidebar was never restricted to a finished run, and the shell used to
    // drop it for a live one by branching around the run view entirely.
    expect(screen.getByTestId('wf-limits')).toBeTruthy();
    expect(screen.getByTestId('wf-totals').textContent).toContain('1 started');
  });

  it('shows a live run no elapsed it cannot source', () => {
    renderWorkflow(LIVE);
    expect(screen.getByTestId('wf-elapsed').textContent).toBe('—');
  });

  it('draws no run control, because none can exist', () => {
    const { container } = renderWorkflow();
    // `skip agent` and `stop run` are refused, not pending: both are an
    // in-process abort inside the session, reachable only from its own terminal
    // UI. See the README, "A workflow run has no controls, and cannot have
    // any". The chrome's own controls — the picker and the gear — are not run
    // controls and are exempt.
    expect(container.textContent ?? '').not.toMatch(/skip agent|stop run/i);
    expect(screen.queryByRole('button', { name: /skip|stop/i })).toBeNull();
  });
});
