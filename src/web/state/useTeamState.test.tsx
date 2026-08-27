// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MockEventSource, installMockEventSource } from '../test/mockEventSource';
import { sampleTeamState } from '../test/state-fixture';
import { useTeamState } from './useTeamState';

beforeEach(() => {
  installMockEventSource();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('opens /stream, lands the snapshot, then applies state updates', () => {
  const { result } = renderHook(() => useTeamState());
  expect(MockEventSource.last().url).toBe('/stream');
  expect(result.current.state).toBeNull();

  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  expect(result.current.connected).toBe(true);
  expect(result.current.state?.teamName).toBe('session-98b0b4a7');
  expect(result.current.state?.leadSessionId).toBe('98b0b4a7-3206-455b-aaf6-a5a81ad1e283');
  expect(result.current.state?.agents.map((a) => a.name)).toEqual([
    'team-lead',
    'probe-alpha',
    'probe-bravo',
    'probe-charlie',
  ]);

  act(() => MockEventSource.last().emit('state', { ...sampleTeamState(), totalCostUsd: 9.99 }));
  expect(result.current.state?.totalCostUsd).toBe(9.99);
});

it('reads view and focused agent out of the URL on mount', () => {
  window.history.replaceState(null, '', '/?view=tasks&agent=probe-bravo');
  const { result } = renderHook(() => useTeamState());
  expect(result.current.view).toBe('tasks');
  expect(result.current.agent).toBe('probe-bravo');
});

it('falls back to the wall view for an unknown ?view', () => {
  window.history.replaceState(null, '', '/?view=nonsense');
  const { result } = renderHook(() => useTeamState());
  expect(result.current.view).toBe('wall');
});

it('writes the view and focused agent back into the URL', () => {
  const { result } = renderHook(() => useTeamState());
  expect(window.location.search).toBe('?view=wall');

  act(() => result.current.setView('grid'));
  expect(result.current.view).toBe('grid');
  expect(window.location.search).toBe('?view=grid');

  act(() => result.current.setAgent('probe-alpha'));
  expect(window.location.search).toBe('?view=grid&agent=probe-alpha');

  act(() => result.current.setAgent(null));
  expect(window.location.search).toBe('?view=grid');
});

it('reconnects with exponential backoff after an error', () => {
  vi.useFakeTimers();
  renderHook(() => useTeamState());
  expect(MockEventSource.instances).toHaveLength(1);

  act(() => MockEventSource.last().emitError());
  expect(MockEventSource.instances).toHaveLength(1);
  act(() => void vi.advanceTimersByTime(499));
  expect(MockEventSource.instances).toHaveLength(1);
  act(() => void vi.advanceTimersByTime(1));
  expect(MockEventSource.instances).toHaveLength(2);

  act(() => MockEventSource.last().emitError());
  act(() => void vi.advanceTimersByTime(999));
  expect(MockEventSource.instances).toHaveLength(2);
  act(() => void vi.advanceTimersByTime(1));
  expect(MockEventSource.instances).toHaveLength(3);
});
