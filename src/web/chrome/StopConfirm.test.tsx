// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WatchConfirm } from './StopConfirm';

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
