// @vitest-environment jsdom
import { expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { keptMetrics } from './Bar';
import { METRIC_RANK } from './StatusBar';
import { WORKFLOW_METRIC_RANK } from '../views/Workflow';

// jsdom measures every width as 0, so the fitting itself cannot run here and
// the shed order would otherwise be unverifiable. `keptMetrics` is the pure half
// — given how many fit, which ones — and it is the half that carries the rule.
const metric = (key: string): ReactElement => <span key={key} />;
const keys = (els: ReactElement[]) => els.map((e) => String(e.key));

const shedOrder = (rank: Record<string, number>) =>
  Object.entries(rank)
    .sort(([, a], [, b]) => b - a)
    .map(([key]) => key);

// The design never specified a shed order for the workflow bar — this is the
// order chosen against the team bar's precedent, recorded in
// CONSOLE-DECISIONS.md. The task id is the run's identity, the way `branch` is
// the team's, so it outlives the figures; the totals are the pure readout, so
// they go first.
it('sheds the workflow bar totals first and its task id last', () => {
  expect(shedOrder(WORKFLOW_METRIC_RANK)).toEqual(['totals', 'elapsed', 'taskId']);
});

it('drops the highest-ranked metrics and leaves the rest in reading order', () => {
  const team = ['branch', 'tasks', 'windows', 'tokens', 'meter', 'limits', 'spend'].map(metric);
  // Five of seven fit: `limits` and `tokens` are the two that go.
  expect(keys(keptMetrics(team, METRIC_RANK, 5))).toEqual([
    'branch',
    'tasks',
    'windows',
    'meter',
    'spend',
  ]);
});

// Two of the three workflow metrics are conditional — a run launched outside a
// task has no task id, and a finished snapshot that carried neither token nor
// tool-call count has no totals. So the slot renders one, two or three children,
// and a shed keyed off POSITION would drop whichever metric happened to sit
// there rather than the one the order names.
it('sheds by key, so a missing metric cannot shift the decision', () => {
  const noTaskId = [metric('totals'), metric('elapsed')];
  // `totals` is first in reading order and still the first to go.
  expect(keys(keptMetrics(noTaskId, WORKFLOW_METRIC_RANK, 1))).toEqual(['elapsed']);

  const noTotals = [metric('taskId'), metric('elapsed')];
  expect(keys(keptMetrics(noTotals, WORKFLOW_METRIC_RANK, 1))).toEqual(['taskId']);
});

it('keeps everything when everything fits, and nothing when nothing does', () => {
  const all = [metric('taskId'), metric('totals'), metric('elapsed')];
  expect(keys(keptMetrics(all, WORKFLOW_METRIC_RANK, 3))).toEqual(['taskId', 'totals', 'elapsed']);
  expect(keptMetrics(all, WORKFLOW_METRIC_RANK, 0)).toEqual([]);
});
