// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { WorkflowRun } from '../../shared/domain';
import { sampleTeamState } from '../test/state-fixture';
import { Usage } from './Usage';

afterEach(cleanup);

const RUN: WorkflowRun = {
  runId: 'wf_d36b25c0-f96',
  status: 'completed',
  live: false,
  logs: [],
  phases: [],
  agents: [],
};

it('renders the team-mode body for mode="team"', () => {
  render(<Usage mode="team" state={sampleTeamState()} now={0} />);
  expect(screen.getByTestId('usage')).toBeTruthy();
  expect(screen.queryByTestId('workflow-usage')).toBeNull();
});

it('renders the workflow-mode body for mode="workflow"', () => {
  render(<Usage mode="workflow" run={RUN} now={0} />);
  expect(screen.getByTestId('workflow-usage')).toBeTruthy();
  expect(screen.queryByTestId('usage')).toBeNull();
});
