// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Agent } from '../../shared/domain';
import { buildCast } from '../../shared/cast';
import { CastContext } from '../state/useCast';
import { StopConfirm, WatchConfirm } from './StopConfirm';

afterEach(cleanup);

it('renders nothing while not shown', () => {
  render(<WatchConfirm show={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.queryByTestId('watch-confirm')).toBeNull();
});

it('asks the instant, nothing-asserted question — never the destructive one', () => {
  render(<WatchConfirm show onConfirm={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByText('stop watching this session?')).toBeTruthy();
  expect(screen.getByTestId('watch-confirm-why').textContent).toContain('instantly, with no grace period');
  expect(screen.getByTestId('watch-confirm-go').textContent).toBe('stop watching');
});

it('confirms only on the go button, not the cancel', () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<WatchConfirm show onConfirm={onConfirm} onCancel={onCancel} />);
  fireEvent.click(screen.getByTestId('watch-confirm-cancel'));
  expect(onConfirm).not.toHaveBeenCalled();
  expect(onCancel).toHaveBeenCalled();

  fireEvent.click(screen.getByTestId('watch-confirm-go'));
  expect(onConfirm).toHaveBeenCalled();
});

// The strip names the agent to the operator, so it names the character. The
// stop itself is posted on the real name by App, which never sees this string.
it('asks about the character, not the slot', () => {
  const target = {
    name: 'probe-alpha', agentId: 'probe-alpha@t', isLead: false, agentType: 'general-purpose',
    model: 'claude-opus-5', role: '', status: 'working', contextTokens: 1, contextLimit: 2,
    compactAt: 2, costUsd: 0, startedAt: 0, transcript: [], unread: 0,
  } satisfies Agent;
  render(
    <CastContext.Provider value={buildCast([target], 'inception')}>
      <StopConfirm target={target} onConfirm={vi.fn()} onCancel={vi.fn()} />
    </CastContext.Provider>,
  );
  // probe-alpha fills no role slot, so it takes the film's first spare.
  expect(screen.getByTestId('stop-confirm-go').textContent).toBe('stop Saito');
});
