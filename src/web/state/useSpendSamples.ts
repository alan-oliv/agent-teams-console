import { useEffect, useRef, useState } from 'react';
import type { Agent } from '../../shared/domain';
import type { SpendSample } from '../views/usage-team';

// The panel this feeds shows at most MAX_BUCKETS 2-minute windows (see
// usage-team.ts), so this only has to outlive that — generous headroom for a
// long-lived tab without growing forever, the same shape as the console's
// other client-side history caps (mail, wall column widths).
const MAX_SAMPLES = 500;

/**
 * A client-side spend series for the usage view's "spend per 2 min" panel.
 * The server carries no history for this — UsageRecord has no timestamp, so
 * there is nothing to read one off of — the only honest series is one sampled
 * from here on, which is why the caller must caption it with its own start
 * time rather than presenting it as the session's whole history
 * (USAGE-STATE.md §6). Same precedent as App.tsx's `{at, cost}` spend-while-
 * away sample, generalised to a running series instead of one snapshot.
 *
 * Lives above the view so switching away from `usage` and back does not
 * restart the sampler.
 */
export function useSpendSamples(
  totalCostUsd: number | undefined,
  agents?: readonly Agent[],
): readonly SpendSample[] {
  const [samples, setSamples] = useState<SpendSample[]>([]);
  const last = useRef<number | undefined>(undefined);
  // Read at sample time rather than depended on: an agent's cost only moves
  // when the team total does, so the total is the whole trigger. Depending on
  // the array as well would sample on every frame that touched any other field.
  const roster = useRef<readonly Agent[] | undefined>(agents);
  roster.current = agents;

  useEffect(() => {
    if (totalCostUsd === undefined || totalCostUsd === last.current) return;
    last.current = totalCostUsd;
    setSamples((prev) => {
      const byAgent = roster.current
        ? Object.fromEntries(roster.current.map((a) => [a.name, a.costUsd]))
        : undefined;
      const next = [...prev, { at: Date.now(), cost: totalCostUsd, byAgent }];
      return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
    });
  }, [totalCostUsd]);

  return samples;
}
