// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { WorkflowRun } from '../../shared/domain';
import { RunSelect } from './RunSelect';

afterEach(cleanup);

// The corpus name the visual smoke-check found the failure with: 65 characters,
// which is what a run named after its own task looks like.
const RUN: WorkflowRun = {
  runId: 'wf_d36b25c0-f96',
  name: 'normalize-workflow-view-chrome-onto-the-team-mode-table-pattern',
  status: 'completed',
  live: false,
  startedAt: 1_000_000,
  phases: [],
  logs: [],
  agents: [],
};

function renderTrigger(): HTMLElement {
  render(<RunSelect run={RUN} runs={[RUN]} onSelect={vi.fn()} />);
  return screen.getByTestId('run-trigger');
}

/**
 * Unbounded, that 65-char name measured 610px — 87% of a 700px bar — and put
 * the four view pills, the task id and every total off the frame, so no
 * workflow view could be reached at all.
 *
 * Both terms are measured. 236px is the design-width ceiling; 26vw is the
 * narrow end, where the bar's un-sheddable rest costs 741.48px and leaves the
 * trigger at most 27.79% of a 700px frame. See RunSelect.tsx for the arithmetic.
 */
it('bounds the trigger so the view pills stay on the frame', () => {
  expect(renderTrigger().style.maxWidth).toBe('min(236px, 26vw)');
});

// The bar is one 40px line and every child of it is flex:none — a trigger that
// shrank would wrap and double the bar's height, which is the one way this
// layout breaks. So the bound is a max-width, never a flex-shrink.
it('bounds it without making it shrinkable', () => {
  expect(renderTrigger().style.flex).toBe('0 0 auto');
});

it('spends the squeeze on the name, and never on the identity', () => {
  renderTrigger();
  const name = screen.getByTestId('run-name');
  expect(name.style.overflow).toBe('hidden');
  expect(name.style.textOverflow).toBe('ellipsis');
  expect(name.style.whiteSpace).toBe('nowrap');
  // A half-drawn runId identifies nothing, so it is the name that gives — and
  // the caret has to survive or the control stops looking like one.
  expect(screen.getByTestId('run-runid').style.flex).toBe('0 0 auto');
  expect(screen.getByTestId('run-caret').style.flex).toBe('0 0 auto');
});

// Without this the name cannot give at all: a flex item's `min-width: auto`
// floors it at its own content width, so the trigger would blow past its cap
// rather than ellipsise.
it('lets the name actually give', () => {
  renderTrigger();
  expect(screen.getByTestId('wf-identity').style.minWidth).toBe('0');
});
