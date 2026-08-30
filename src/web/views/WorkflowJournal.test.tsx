// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { WorkflowAgent } from '../../shared/domain';
import { WorkflowJournal } from './WorkflowJournal';

afterEach(cleanup);

const AGENTS: WorkflowAgent[] = [
  { agentId: 'a1', label: 'impl:task-9', state: 'done', result: '**Status:** Complete.' },
  { agentId: 'a2', label: 'skipped:one', state: 'null', error: 'skipped by user' },
  { agentId: 'a3', label: 'cached:one', state: 'cache', result: '' },
];

describe('WorkflowJournal', () => {
  it('shows each agent\'s actual return value', () => {
    render(<WorkflowJournal agents={AGENTS} />);
    const entries = screen.getAllByTestId('wf-journal-entry');
    expect(within(entries[0]).getByTestId('wf-journal-result').textContent).toContain('Complete');
  });

  it('draws a null return as null rather than as blank', () => {
    render(<WorkflowJournal agents={AGENTS} />);
    const entries = screen.getAllByTestId('wf-journal-entry');
    expect(within(entries[1]).getByTestId('wf-journal-result').textContent).toBe('null');
  });

  it('keeps the reason a null return happened', () => {
    render(<WorkflowJournal agents={AGENTS} />);
    const entries = screen.getAllByTestId('wf-journal-entry');
    expect(within(entries[1]).getByTestId('wf-journal-why').textContent).toBe('skipped by user');
  });

  // The whole point of the footer: a cached agent can return an empty string,
  // and that is a real result, not a missing one.
  it('shows an empty cached result as empty, not as null', () => {
    render(<WorkflowJournal agents={AGENTS} />);
    const entries = screen.getAllByTestId('wf-journal-entry');
    expect(within(entries[2]).getByTestId('wf-journal-result').textContent).toBe('(empty)');
  });

  it('foots with the warning the runtime itself gives', () => {
    render(<WorkflowJournal agents={AGENTS} />);
    expect(screen.getByTestId('wf-journal-footer').textContent).toMatch(
      /cached result is not automatically a non-empty one/i,
    );
  });
});
