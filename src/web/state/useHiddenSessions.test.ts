import { describe, expect, it } from 'vitest';
import type { TeamSummary } from '../../shared/domain';
import { isEmptySession, isNotShown, parseHidden } from './useHiddenSessions';

describe('parseHidden', () => {
  it('reads back the names it stored', () => {
    expect([...parseHidden('["session-a","session-b"]')]).toEqual(['session-a', 'session-b']);
  });

  it('hides nothing when there is no stored value', () => {
    expect(parseHidden(null).size).toBe(0);
  });

  it('hides nothing rather than throwing on a blob that is not JSON', () => {
    expect(parseHidden('{{{').size).toBe(0);
  });

  // Failing toward "show too much" is deliberate: a picker that silently
  // swallowed a live session is far worse than one that forgot a dismissal.
  it('hides nothing when the stored value is not an array', () => {
    expect(parseHidden('{"session-a":true}').size).toBe(0);
  });

  it('drops non-string and empty entries rather than hiding a blank name', () => {
    expect([...parseHidden('["session-a",7,null,"",{"a":1},"session-b"]')]).toEqual([
      'session-a',
      'session-b',
    ]);
  });
});

describe('the one rule for what a screen may offer', () => {
  const summary = (over: Partial<TeamSummary>): TeamSummary => ({
    name: 'session-a',
    members: 3,
    createdAt: 0,
    leadSessionId: '',
    leadAlive: true,
    lastActivityAt: 0,
    live: true,
    current: false,
    state: 'live',
    ...over,
  });

  it('calls a lead-only session with nothing running in it an empty one', () => {
    expect(isEmptySession(summary({ members: 1 }))).toBe(true);
    expect(isEmptySession(summary({ members: 3 }))).toBe(false);
  });

  // A workflow's agents never enter members[], so the roster is one and the run
  // is the only thing saying the session is somewhere to go.
  it('does not call a session running a workflow empty', () => {
    expect(isEmptySession(summary({ members: 1, workflow: { runId: 'wf_a', live: true } }))).toBe(
      false,
    );
  });

  it('counts a hidden session as not shown however many members it has', () => {
    expect(isNotShown(summary({}), new Set(['session-a']), true)).toBe(true);
  });

  it('stops counting a lead-only session as not shown once it is revealed', () => {
    const solo = summary({ members: 1 });
    expect(isNotShown(solo, new Set(), false)).toBe(true);
    expect(isNotShown(solo, new Set(), true)).toBe(false);
  });
});
