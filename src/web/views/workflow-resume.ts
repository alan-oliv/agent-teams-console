import type { WorkflowAgent } from '../../shared/domain';

export interface ResumeSplit {
  /** The replayed prefix: the leading run of cache hits. */
  cached: WorkflowAgent[];
  /** Everything from the first call that actually ran. */
  fresh: WorkflowAgent[];
  resumed: boolean;
  /**
   * Cache hits sitting AFTER the prefix. Should always be 0 — resume replays
   * the longest unchanged prefix and everything after the first changed call
   * runs live — but they are counted where they sit rather than folded in, so
   * the legend's number can never disagree with what is drawn.
   */
  strayCacheHits: number;
}

/**
 * The resume model, over the agent SEQUENCE rather than over source lines.
 *
 * The design draws this on the script, one of two tints per line. Nothing on
 * disk maps an agent back to the line that spawned it — a `workflow_agent`
 * record carries an index, a label and a prompt preview, and no call site — so
 * per-line tinting is not derivable and is not attempted. What IS recorded is
 * which agents came back from cache, and the runtime's own contract is that
 * those form a prefix, so the resume model is drawn over the calls themselves.
 */
export function resumeSplit(agents: readonly WorkflowAgent[]): ResumeSplit {
  let boundary = 0;
  while (boundary < agents.length && agents[boundary].state === 'cache') boundary++;

  const cached = agents.slice(0, boundary);
  const fresh = agents.slice(boundary);
  return {
    cached,
    fresh,
    resumed: cached.length > 0,
    strayCacheHits: fresh.filter((a) => a.state === 'cache').length,
  };
}
