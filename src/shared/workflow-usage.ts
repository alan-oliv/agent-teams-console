import type { WorkflowAgent, WorkflowBurn, WorkflowUsage } from './domain';
import { WORKFLOW_BURN_SAMPLES } from './domain';
import { splitTok, type TokenSplit } from './cost';
import type { TranscriptRecord } from './transcript';
import type { Usage, UsageRecord } from './usage';

/**
 * What a workflow run actually spent, read from its agents' own transcripts at
 * `subagents/workflows/wf_<runId>/agent-<agentId>.jsonl`.
 *
 * These files are the reason this module exists. The snapshot's `totalTokens`
 * is final context occupancy and understates real traffic by 8-60x — measured
 * across 19 runs and 139 agent transcripts on the capture machine, with cache
 * reads at 62-98% of the total and the snapshot carrying none of them. The
 * transcripts carry a per-line `timestamp`, a per-line `model` and the full
 * `message.usage`, and they are appended WHILE THE RUN IS GOING, so this is a
 * live source rather than a terminal one. See CONSOLE-NOTES.md §24.
 *
 * The scope rule is untouched: a workflow agent is still not a team member and
 * still never enters `members[]` or the roster. Reading what it spent is a
 * different question from whether it is a teammate — the same separation
 * `subagents.ts` makes.
 *
 * No dollars here. The four classes and the model are what a price is computed
 * FROM; `cost.ts` owns the one cost model and applies it where the figure is
 * drawn, exactly as the team ledger does.
 */

/**
 * One billed turn. `UsageRecord` carries no timestamp and the burn line is
 * nothing without one, so the fold keeps its own row rather than widening a
 * type four other call sites depend on.
 */
interface Turn {
  ts: number;
  model: string;
  usage: Usage;
}

/**
 * Per RUN, kept by the ingest across drains. Its agent transcripts arrive in
 * chunks and in any order, so the turns are keyed by message id — the rule
 * `dedupeUsage` applies — and the burn is re-derived from them rather than
 * accumulated, which is what makes a re-read of a file cost nothing.
 */
export interface WorkflowUsageFold {
  /** agentId -> its billed turns, by message id. */
  agents: Map<string, Map<string, Turn>>;
}

export function emptyWorkflowUsageFold(): WorkflowUsageFold {
  return { agents: new Map() };
}

/** The agentId a workflow agent transcript is named for: `agent-<agentId>.jsonl`. */
const WORKFLOW_AGENT_FILE = /^agent-(a[0-9a-f]{16})\.jsonl$/;

export function workflowAgentIdOf(basename: string): string | null {
  return WORKFLOW_AGENT_FILE.exec(basename)?.[1] ?? null;
}

/**
 * Folds one drain of one agent's transcript into its run.
 *
 * Chunk-order independent: every turn is keyed by its message id and the
 * highest `output_tokens` wins, so reading a file whole and reading it a record
 * at a time agree, and the 5s sweep re-reading a file bills nothing twice.
 */
export function foldWorkflowAgentRecords(
  fold: WorkflowUsageFold,
  agentId: string,
  records: readonly TranscriptRecord[],
): void {
  let turns = fold.agents.get(agentId);
  if (!turns) {
    turns = new Map<string, Turn>();
    fold.agents.set(agentId, turns);
  }
  for (const rec of records) {
    if (rec.type !== 'assistant' || rec.isApiErrorMessage === true) continue;
    const usage = rec.message?.usage;
    if (!usage) continue;
    const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
    if (Number.isNaN(ts)) continue;
    const messageId = rec.message?.id ?? rec.uuid ?? '';
    if (!messageId) continue;
    const best = turns.get(messageId);
    // A streamed message is written several times with a growing output count.
    if (best && best.usage.output_tokens >= (usage.output_tokens ?? 0)) continue;
    turns.set(messageId, { ts, model: rec.message?.model ?? '', usage });
  }
}

const recordsOf = (turns: Map<string, Turn>): UsageRecord[] =>
  [...turns].map(([messageId, t]) => ({ messageId, model: t.model, usage: t.usage }));

const TOTAL = (split: TokenSplit): number =>
  split.in + split.out + split.cacheWrite + split.cacheRead;

function addSplit(into: TokenSplit, from: TokenSplit): void {
  into.in += from.in;
  into.out += from.out;
  into.cacheWrite += from.cacheWrite;
  into.cacheWrite1h += from.cacheWrite1h;
  into.cacheRead += from.cacheRead;
}

export const emptySplit = (): TokenSplit => ({
  in: 0,
  out: 0,
  cacheWrite: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
});

/**
 * The run's turns as an evenly spaced cumulative series.
 *
 * `stepMs` is chosen so the whole span fits in {@link WORKFLOW_BURN_SAMPLES}
 * buckets, which is what keeps a frame's cost independent of how long a run
 * ran. A run whose turns all land in one instant still gets one bucket rather
 * than a divide by zero.
 */
export function burnOf(turns: readonly Turn[]): WorkflowBurn {
  const sorted = [...turns].sort((a, b) => a.ts - b.ts);
  // No turns is not a run that spent nothing — it is a run nothing has been
  // measured for yet, and a single `[0]` point draws as the first of those.
  if (sorted.length === 0) return { startedAt: 0, stepMs: 1, cumulative: [] };
  const startedAt = sorted[0]?.ts ?? 0;
  const endedAt = sorted[sorted.length - 1]?.ts ?? startedAt;
  const span = endedAt - startedAt;
  // Ceil, so the last turn lands inside the last bucket rather than one past it.
  const stepMs = span <= 0 ? 1 : Math.ceil(span / WORKFLOW_BURN_SAMPLES);
  const buckets = span <= 0 ? 1 : Math.min(WORKFLOW_BURN_SAMPLES, Math.floor(span / stepMs) + 1);
  const perBucket = new Array<number>(buckets).fill(0);
  for (const turn of sorted) {
    const at = Math.min(buckets - 1, Math.floor((turn.ts - startedAt) / stepMs));
    perBucket[at] += TOTAL(splitTok([{ messageId: '', model: turn.model, usage: turn.usage }]));
  }
  const cumulative: number[] = [];
  let running = 0;
  for (const tokens of perBucket) {
    running += tokens;
    cumulative.push(running);
  }
  return { startedAt, stepMs, cumulative };
}

/** One agent's own spend, as the ingest publishes it. */
export interface WorkflowAgentUsage {
  agentId: string;
  split: TokenSplit;
  /**
   * The model its own transcript reports. The snapshot names one too, but a
   * LIVE run has no snapshot — so on the only occasion the figure is not
   * already known, this is the sole source.
   */
  model?: string;
}

/** What the ingest publishes for one run: per-agent totals, plus the run's burn. */
export interface WorkflowUsagePayload {
  runId: string;
  agents: WorkflowAgentUsage[];
  split: TokenSplit;
  burn: WorkflowBurn;
}

export function workflowUsageOf(runId: string, fold: WorkflowUsageFold): WorkflowUsagePayload {
  const agents: WorkflowAgentUsage[] = [];
  const split = emptySplit();
  const turns: Turn[] = [];
  for (const [agentId, byMessage] of fold.agents) {
    const rows = recordsOf(byMessage);
    const own = splitTok(rows);
    addSplit(split, own);
    for (const turn of byMessage.values()) turns.push(turn);
    // Last turn's model, not the first: an agent that fell back to another
    // model reports what it ended on, which is what its later turns were
    // billed at. Empty means the transcript never named one.
    const model = [...byMessage.values()].sort((a, b) => a.ts - b.ts).at(-1)?.model;
    agents.push({ agentId, split: own, ...(model ? { model } : {}) });
  }
  return { runId, agents, split, burn: burnOf(turns) };
}

/**
 * Attaches a run's measured usage to the run model, rolling it up per phase.
 *
 * The rollup happens HERE rather than in the ingest because it needs both
 * halves and neither side has both: the ingest knows which file belongs to
 * which agent, and only the run model knows which phase an agent ran in.
 *
 * `byPhase` is empty on a live run, and that is the honest answer rather than a
 * gap — `phaseIndex` reaches the console only with the snapshot, so before it
 * lands there is nothing to group by.
 */
export function attachWorkflowUsage(
  agents: readonly WorkflowAgent[],
  payload: WorkflowUsagePayload,
): { usage: WorkflowUsage; agents: WorkflowAgent[] } {
  const byId = new Map(payload.agents.map((a) => [a.agentId, a]));

  const merged = agents.map((agent) => {
    const own = byId.get(agent.agentId);
    if (!own) return agent;
    return {
      ...agent,
      tokenSplit: own.split,
      // The snapshot's model wins when there is one: it is what the runtime
      // resolved, where the transcript reports what a given turn ran on.
      ...(agent.model || !own.model ? {} : { model: own.model }),
    };
  });

  const perPhase = new Map<number, TokenSplit>();
  for (const agent of agents) {
    const own = byId.get(agent.agentId);
    if (!own || agent.phaseIndex === undefined) continue;
    const into = perPhase.get(agent.phaseIndex) ?? emptySplit();
    addSplit(into, own.split);
    perPhase.set(agent.phaseIndex, into);
  }

  return {
    usage: {
      split: payload.split,
      byPhase: [...perPhase]
        .sort((a, b) => a[0] - b[0])
        .map(([phaseIndex, split]) => ({ phaseIndex, split })),
      burn: payload.burn,
      agentsMeasured: payload.agents.length,
    },
    agents: merged,
  };
}
