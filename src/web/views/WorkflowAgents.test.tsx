// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { WorkflowAgent } from '../../shared/domain';
import { WorkflowAgents } from './WorkflowAgents';

afterEach(cleanup);

const AGENTS: WorkflowAgent[] = [
  {
    agentId: 'a40ec3f05b60d3e87',
    label: 'impl:task-9',
    phaseTitle: 'Build',
    state: 'done',
    model: 'claude-sonnet-5',
    tokens: 53066,
    toolCalls: 21,
    durationMs: 130902,
    prompt: 'You are implementing Task 9 of a 31-task plan',
  },
  {
    agentId: 'abccf03033c084f9e',
    label: 'iso:worktree',
    state: 'run',
    isolation: 'worktree',
    tokens: 1200,
  },
];

describe('WorkflowAgents', () => {
  it('lists every agent by its own id, which is all it has', () => {
    render(<WorkflowAgents agents={AGENTS} />);
    const rows = screen.getAllByTestId('wf-agent');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId('wf-agent-id').textContent).toBe('a40ec3f05b60d3e87');
  });

  it('shows the phase, model, state and tokens the record carries', () => {
    render(<WorkflowAgents agents={AGENTS} />);
    const row = screen.getAllByTestId('wf-agent')[0];
    expect(within(row).getByTestId('wf-agent-phase').textContent).toBe('Build');
    expect(within(row).getByTestId('wf-agent-model').textContent).toBe('claude-sonnet-5');
    expect(within(row).getByTestId('wf-agent-tokens').textContent).toBe('53.1k');
  });

  it('marks a worktree-isolated agent, and leaves the rest unmarked', () => {
    render(<WorkflowAgents agents={AGENTS} />);
    const rows = screen.getAllByTestId('wf-agent');
    expect(within(rows[1]).getByTestId('wf-agent-isolation').textContent).toBe('worktree');
    expect(within(rows[0]).getByTestId('wf-agent-isolation').textContent).toBe('—');
  });

  // A live agent has only an id and a state; every other column is genuinely
  // empty rather than zero, and an em dash says so.
  it('draws an em dash where a field is absent rather than a zero', () => {
    render(<WorkflowAgents agents={[{ agentId: 'a1', state: 'run' }]} />);
    const row = screen.getAllByTestId('wf-agent')[0];
    expect(within(row).getByTestId('wf-agent-tokens').textContent).toBe('—');
    expect(within(row).getByTestId('wf-agent-model').textContent).toBe('—');
  });

  it('says nothing here is addressable by name', () => {
    render(<WorkflowAgents agents={AGENTS} />);
    expect(screen.getByTestId('wf-agents-footer').textContent).toMatch(/not addressable/i);
  });

  // `schema` is script text only — the snapshot never records it — so the
  // column the design asks for cannot exist.
  it('offers no schema column, which is not on disk', () => {
    render(<WorkflowAgents agents={AGENTS} />);
    expect(screen.getByTestId('wf-agents-head').textContent).not.toMatch(/schema/i);
  });

  it('says so when the run spawned nothing', () => {
    render(<WorkflowAgents agents={[]} />);
    expect(screen.getByTestId('wf-agents-empty')).toBeTruthy();
  });
});
