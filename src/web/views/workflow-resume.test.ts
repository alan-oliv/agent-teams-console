import { describe, expect, it } from 'vitest';
import type { WorkflowAgent } from '../../shared/domain';
import { resumeSplit } from './workflow-resume';

const agents = (...states: WorkflowAgent['state'][]): WorkflowAgent[] =>
  states.map((state, i) => ({ agentId: `a${i}`, state }));

describe('resumeSplit', () => {
  it('reads the leading run of cache hits as the replayed prefix', () => {
    const split = resumeSplit(agents('cache', 'cache', 'done', 'done'));
    expect(split.cached.map((a) => a.agentId)).toEqual(['a0', 'a1']);
    expect(split.fresh.map((a) => a.agentId)).toEqual(['a2', 'a3']);
  });

  it('reports a run that resumed nothing as entirely fresh', () => {
    const split = resumeSplit(agents('done', 'done'));
    expect(split.cached).toEqual([]);
    expect(split.fresh).toHaveLength(2);
    expect(split.resumed).toBe(false);
  });

  it('reports a full cache hit, which is what an unchanged re-run is', () => {
    const split = resumeSplit(agents('cache', 'cache'));
    expect(split.fresh).toEqual([]);
    expect(split.resumed).toBe(true);
  });

  // The runtime replays the LONGEST UNCHANGED PREFIX and everything after the
  // first changed call runs live, so a cache hit after a fresh call should be
  // impossible. If one ever appears the count still has to match the drawing,
  // so it is counted where it sits rather than folded into the prefix.
  it('does not fold a stray later cache hit back into the prefix', () => {
    const split = resumeSplit(agents('cache', 'done', 'cache'));
    expect(split.cached.map((a) => a.agentId)).toEqual(['a0']);
    expect(split.fresh.map((a) => a.agentId)).toEqual(['a1', 'a2']);
    expect(split.strayCacheHits).toBe(1);
  });

  it('handles a run with no agents at all', () => {
    expect(resumeSplit([])).toEqual({ cached: [], fresh: [], resumed: false, strayCacheHits: 0 });
  });
});
