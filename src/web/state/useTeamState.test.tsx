// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TeamState } from '../../shared/domain';
import { MockEventSource, installMockEventSource } from '../test/mockEventSource';
import { sampleTeamState } from '../test/state-fixture';
import { isAnnouncedTeam, useTeamState } from './useTeamState';

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

function changedValue(value: unknown): unknown {
  if (typeof value === 'string') return `${value}-changed`;
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'boolean') return !value;
  if (Array.isArray(value)) return [...value, { id: 'extra#0', marker: '⏺', text: 'extra', ts: 1 }];
  return 'changed';
}

function grown(state: TeamState, name: string): TeamState {
  return {
    ...state,
    agents: state.agents.map((a) =>
      a.name === name
        ? { ...a, transcript: [...a.transcript, { id: 'new#0', marker: '⏺' as const, text: 'new', ts: 1 }] }
        : a,
    ),
  };
}

it('reuses the agent objects of agents whose data did not change', () => {
  const { result } = renderHook(() => useTeamState());
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  const first = result.current.state!.agents;

  act(() => MockEventSource.last().emit('state', sampleTeamState()));
  const second = result.current.state!.agents;

  expect(second[0]).toBe(first[0]);
  expect(second.map((a) => a.name)).toEqual(first.map((a) => a.name));
});

it('reuses the agents array itself when no agent changed', () => {
  const { result } = renderHook(() => useTeamState());
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  const first = result.current.state!.agents;

  act(() => MockEventSource.last().emit('state', sampleTeamState()));
  expect(result.current.state!.agents).toBe(first);
});

it('gives a new identity to an agent that gained a transcript line', () => {
  const { result } = renderHook(() => useTeamState());
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  const first = result.current.state!.agents;

  act(() => MockEventSource.last().emit('state', grown(sampleTeamState(), 'probe-bravo')));
  const second = result.current.state!.agents;

  const i = first.findIndex((a) => a.name === 'probe-bravo');
  expect(second[i]).not.toBe(first[i]);
  expect(second[i].transcript.map((l) => l.id)).toEqual(['new#0']);
  for (const j of first.keys()) if (j !== i) expect(second[j]).toBe(first[j]);
});

it('still applies scalar top-level changes', () => {
  const { result } = renderHook(() => useTeamState());
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  act(() => MockEventSource.last().emit('state', { ...sampleTeamState(), totalCostUsd: 7.77 }));
  expect(result.current.state?.totalCostUsd).toBe(7.77);
});

it('treats a change to any single agent field as a change', () => {
  const { result } = renderHook(() => useTeamState());
  const base = sampleTeamState();
  act(() => MockEventSource.last().emit('snapshot', base));

  const keys = Object.keys(result.current.state!.agents[0]);
  expect(keys.length).toBeGreaterThan(5);

  for (const key of keys) {
    act(() => MockEventSource.last().emit('state', base));
    const before = result.current.state!.agents;

    const value = changedValue((before[0] as unknown as Record<string, unknown>)[key]);
    const mutated: TeamState = {
      ...base,
      agents: base.agents.map((a, i) => (i === 0 ? ({ ...a, [key]: value } as typeof a) : a)),
    };
    act(() => MockEventSource.last().emit('state', mutated));

    const after = result.current.state!.agents;
    expect(`${key}: ${after[0] === before[0] ? 'reused' : 'fresh'}`).toBe(`${key}: fresh`);
    expect(after[1]).toBe(before[1]);
  }
});

it('keeps the launcher announcement in the address bar instead of erasing it', () => {
  // writeUrlState used to build a fresh URLSearchParams, so the mount effect
  // wiped the ?team= the launcher had just announced.
  window.history.replaceState(null, '', '/?team=session-98b0b4a7');
  renderHook(() => useTeamState());
  expect(window.location.search).toBe('?view=wall&team=session-98b0b4a7');
});

it('writes the team the server says is on screen, not a client copy', () => {
  const { result } = renderHook(() => useTeamState());
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  expect(window.location.search).toBe('?view=wall&team=session-98b0b4a7');
  expect(result.current.announcedTeam).toBeNull();
});

it('treats a team with no view as an announcement and a team beside one as our own bookkeeping', () => {
  expect(isAnnouncedTeam('?team=session-b5129c7b')).toBe(true);
  expect(isAnnouncedTeam('?view=wall&team=session-b5129c7b')).toBe(false);
  expect(isAnnouncedTeam('?view=wall')).toBe(false);
  expect(isAnnouncedTeam('')).toBe(false);
});

it('exposes an announced team so App can act on it once', () => {
  window.history.replaceState(null, '', '/?team=session-b5129c7b');
  const { result } = renderHook(() => useTeamState());
  expect(result.current.announcedTeam).toBe('session-b5129c7b');
});

it('drops a selected agent the new team does not have', () => {
  window.history.replaceState(null, '', '/?view=wall&agent=probe-bravo');
  const { result } = renderHook(() => useTeamState());
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  expect(result.current.agent).toBe('probe-bravo');

  const other = sampleTeamState();
  other.teamName = 'session-b5129c7b';
  other.agents = other.agents.slice(0, 1).map((a) => ({ ...a, name: 'solo', agentId: 'solo@session-b5129c7b' }));
  act(() => MockEventSource.last().emit('state', other));

  expect(result.current.agent).toBeNull();
  expect(window.location.search).toBe('?view=wall&team=session-b5129c7b');
});

it('keeps a valid selection across an ordinary frame', () => {
  window.history.replaceState(null, '', '/?view=wall&agent=probe-bravo');
  const { result } = renderHook(() => useTeamState());
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  act(() => MockEventSource.last().emit('state', sampleTeamState()));
  expect(result.current.agent).toBe('probe-bravo');
});
