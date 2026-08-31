import { useState, type CSSProperties } from 'react';
import type { WorkflowAgent, WorkflowAgentState, WorkflowPhase, WorkflowRun } from '../../shared/domain';
import { formatElapsed, formatTokens } from '../format';
import { liveCounts, phaseTally } from './workflow-grid';
import { resumeSplit } from './workflow-resume';

/**
 * Workflow mode's body of the usage view.
 *
 * The design asks this page for run cost, projected cost, per-phase cost and a
 * cost-scaled scatter. None of them are drawn, and the reason is one finding
 * rather than four: `workflowProgress[].tokens` is not a billed-token count. It
 * matched each agent's FINAL CONTEXT SIZE — the last assistant turn's input +
 * cache_creation + cache_read — in 135 of the 135 agent records on the capture
 * machine, and matched a billed sum in none of them. `totalTokens` is therefore
 * the sum of N end-of-run context sizes: it double-counts every prefix siblings
 * share, drops every token of output before the last turn, and omits cache
 * reads, which are the overwhelming majority of what a session actually buys.
 * Multiplying it by a rate does not produce an inaccurate bill, it produces a
 * different quantity wearing a currency symbol. See USAGE-STATE.md.
 *
 * The four-class split those figures would need does exist, live, in each
 * agent's own transcript under `subagents/workflows/wf_<runId>/agent-*.jsonl` —
 * appended WHILE the run is going, with a per-line timestamp and model. The
 * ingest refuses those files by two separate rules, because a workflow fan-out
 * is not a team member. Lifting that is a scope decision, not a view's to make.
 *
 * So the accurate sentence is not "there is no source" — CONSOLE-NOTES §24
 * re-measured it at 8 runs and 76 agents and found the snapshot understates real
 * traffic by 15x to 75x, because cache reads are 94.8% of it and the snapshot
 * holds none. The source exists, it is live, and this console does not read it.
 * The mode draws what is ingested, and says exactly that where the money would
 * have been.
 */

export const AGENT_WARN_THRESHOLD = 25;

/** Never a zero: a zero reads as measured, and none of these were measured. */
const EM_DASH = '—';

interface Span {
  from: number;
  to: number;
}

/**
 * An agent killed in flight keeps its tokens and loses its `durationMs`, so it
 * was running right up to the kill. Holding it open to the last time anything
 * else finished counts it; dropping it would under-report the peak of exactly
 * the runs an operator is looking at.
 */
function spansOf(agents: readonly WorkflowAgent[]): Span[] {
  const started = agents.filter((a) => a.startedAt !== undefined);
  if (started.length === 0) return [];
  const horizon = Math.max(
    ...started.map((a) => (a.durationMs === undefined ? a.startedAt! : a.startedAt! + a.durationMs)),
  );
  return started.map((a) => ({
    from: a.startedAt!,
    to: a.durationMs === undefined ? horizon : a.startedAt! + a.durationMs,
  }));
}

const activeAt = (spans: readonly Span[], at: number): number =>
  spans.filter((s) => s.from <= at && s.to > at).length;

/**
 * How many agents the run actually had in flight at once, and how long it held
 * there. A sweep over the interval edges rather than a sample, so a brief spike
 * between two samples cannot be missed.
 */
export function concurrency(agents: readonly WorkflowAgent[]): { peak: number; msAtPeak: number } {
  const spans = spansOf(agents);
  const edges = [...new Set(spans.flatMap((s) => [s.from, s.to]))].sort((a, b) => a - b);
  let peak = 0;
  let msAtPeak = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const active = activeAt(spans, edges[i]);
    if (active === 0) continue;
    const width = edges[i + 1] - edges[i];
    if (active > peak) {
      peak = active;
      msAtPeak = width;
    } else if (active === peak) {
      msAtPeak += width;
    }
  }
  return { peak, msAtPeak };
}

const BUCKETS = 30;

/** The concurrency strip, as one bar per equal slice of the run's own span. */
function concurrencySeries(agents: readonly WorkflowAgent[]): number[] {
  const spans = spansOf(agents);
  if (spans.length === 0) return [];
  const from = Math.min(...spans.map((s) => s.from));
  const to = Math.max(...spans.map((s) => s.to));
  if (to <= from) return [];
  const step = (to - from) / BUCKETS;
  return Array.from({ length: BUCKETS }, (_, i) => activeAt(spans, from + i * step));
}

export interface PhaseUsageRow {
  phase: WorkflowPhase;
  tally: string;
  /** Undefined, never zero, for a phase the run never reached. */
  contextTokens?: number;
  elapsedMs?: number;
  /**
   * First start and last return under this phase — the Gantt's bar. Absent
   * together with the phase's other figures when the run never reached it: a
   * phase reaches disk with its agents or with nothing.
   */
  startMs?: number;
  endMs?: number;
  pending: boolean;
}

/**
 * One row per DECLARED phase. Every phase a script declares is recorded whether
 * or not it ran, so a phase with no agents under it is one the run never
 * reached — which is why its figures are absent rather than zero.
 */
export function phaseRows(run: WorkflowRun): PhaseUsageRow[] {
  return run.phases.map((phase) => {
    const mine = run.agents.filter((a) => a.phaseIndex === phase.index);
    const withTokens = mine.filter((a) => a.tokens !== undefined);
    const spans = spansOf(mine);
    const startMs = spans.length > 0 ? Math.min(...spans.map((s) => s.from)) : undefined;
    const endMs = spans.length > 0 ? Math.max(...spans.map((s) => s.to)) : undefined;
    return {
      phase,
      tally: phaseTally(run.agents, phase.index),
      contextTokens:
        withTokens.length > 0 ? withTokens.reduce((sum, a) => sum + a.tokens!, 0) : undefined,
      elapsedMs: startMs !== undefined && endMs !== undefined ? endMs - startMs : undefined,
      startMs,
      endMs,
      pending: mine.length === 0,
    };
  });
}

/**
 * The window the Gantt positions bars against: the run's own first start to its
 * last return, rather than `startedAt`/`durationMs`, so a bar cannot land
 * outside the track when the snapshot's run-level timings disagree with the
 * agents' own.
 */
export function runSpan(rows: readonly PhaseUsageRow[]): { from: number; to: number } | undefined {
  const starts = rows.map((r) => r.startMs).filter((v): v is number => v !== undefined);
  const ends = rows.map((r) => r.endMs).filter((v): v is number => v !== undefined);
  if (starts.length === 0 || ends.length === 0) return undefined;
  const from = Math.min(...starts);
  const to = Math.max(...ends);
  return to > from ? { from, to } : undefined;
}

/**
 * The design fires this past `agentWarnThreshold` scheduled agents OR 1.5M
 * projected tokens. Only the first half has a source: nothing on disk records a
 * SCHEDULED count, and the token half would have to project from a figure that
 * is not a token count at all. A live run is excluded because its agent list is
 * only what has started so far, which would make the banner appear and vanish
 * as the journal grew.
 */
export function bannerFires(run: WorkflowRun, threshold = AGENT_WARN_THRESHOLD): boolean {
  return !run.live && run.agents.length > threshold;
}

const PANEL: CSSProperties = {
  border: '1px solid var(--color-neutral-900)',
  borderRadius: 'var(--radius-md)',
  padding: '12px 14px',
  background: 'var(--color-bg)',
};

const PANEL_TITLE: CSSProperties = {
  color: 'var(--color-text)',
  fontSize: '11.5px',
  marginBottom: '7px',
  whiteSpace: 'nowrap',
};

const PROSE: CSSProperties = {
  color: 'var(--color-neutral-600)',
  fontSize: '10.5px',
  lineHeight: 1.5,
};

const TILE_LABEL: CSSProperties = {
  color: 'var(--color-neutral-600)',
  fontSize: '9.5px',
  letterSpacing: '.09em',
};

const TILE_VALUE: CSSProperties = { color: 'var(--color-text)', fontSize: '19px' };

/** The words the agents view already uses, so two views cannot disagree. */
const STATE_WORD: Record<WorkflowAgentState, string> = {
  done: 'returned',
  run: 'running',
  cache: 'cached',
  null: 'returned null',
  // `queued`, not `waiting` — CONSOLE-DECISIONS ruling 11.
  wait: 'queued',
  fail: 'failed',
  block: 'blocked',
};

const CELL: CSSProperties = {
  flex: 'none',
  textAlign: 'right',
  color: 'var(--color-neutral-500)',
  fontSize: '11px',
};

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div style={{ ...PANEL, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <div style={TILE_LABEL}>{label}</div>
      <div style={TILE_VALUE}>{value}</div>
      <div style={{ ...PROSE, fontSize: '10px' }}>{note}</div>
    </div>
  );
}

/**
 * The whole run's tally, borrowed from the phase header's so the two can never
 * describe the same states in different words. Every agent is folded into one
 * pseudo-phase to reach it; the empty case is handled here rather than there,
 * because `phaseTally`'s "queued" means a phase whose agents have not started
 * and a run with no agents has nothing waiting.
 */
function stateTally(agents: readonly WorkflowAgent[]): string {
  if (agents.length === 0) return 'none spawned';
  return phaseTally(
    agents.map((a) => ({ ...a, phaseIndex: 0 })),
    0,
  );
}

/** Which of a phase's rows the Gantt paints, from the states under it. */
function phaseTone(row: PhaseUsageRow, agents: readonly WorkflowAgent[]): string {
  const mine = agents.filter((a) => a.phaseIndex === row.phase.index);
  return mine.some((a) => a.state === 'run')
    ? 'var(--color-accent-600)'
    : 'var(--color-accent-700)';
}

const SCATTER_W = 620;
const SCATTER_H = 150;
// The design scales radius by cost, which has no source here. Decision 21
// substitutes `toolCalls` rather than leaving the channel empty — a real
// per-agent measure beats an unused dimension, and substitution over omission
// is this console's established pattern. An agent with no count recorded draws
// the minimum radius, never a zero-area point.
const POINT_R_MIN = 3;
const POINT_R_MAX = 7;

const SCATTER_FILL: Partial<Record<WorkflowAgentState, string>> = {
  done: 'var(--color-accent-600)',
  run: 'var(--color-accent-300)',
  null: 'var(--color-neutral-800)',
  cache: 'var(--color-accent-700)',
  block: 'var(--color-neutral-800)',
  wait: 'var(--color-neutral-800)',
};

/** Missing draws the minimum, never a zero — an invisible point is not a datum. */
export function radiusOf(toolCalls: number | undefined, maxCalls: number): number {
  if (toolCalls === undefined || maxCalls <= 0) return POINT_R_MIN;
  return POINT_R_MIN + (Math.min(toolCalls, maxCalls) / maxCalls) * (POINT_R_MAX - POINT_R_MIN);
}

const CHIPS: Array<{ id: string; word: string; match: (a: WorkflowAgent) => boolean }> = [
  { id: 'all', word: 'all', match: () => true },
  { id: 'done', word: 'done', match: (a) => a.state === 'done' || a.state === 'cache' },
  { id: 'running', word: 'running', match: (a) => a.state === 'run' },
  { id: 'failed', word: 'failed', match: (a) => a.state === 'fail' },
  { id: 'stopped', word: 'stopped', match: (a) => a.state === 'null' || a.state === 'block' },
];

export function WorkflowUsage({ run, now }: { run: WorkflowRun; now: number }) {
  const rows = phaseRows(run);
  const span = runSpan(rows);
  const [phase, setPhase] = useState<number | null>(null);
  const [chip, setChip] = useState('all');

  const selected = rows.find((r) => r.phase.index === phase) ?? rows.find((r) => !r.pending);
  const scoped = selected ? run.agents.filter((a) => a.phaseIndex === selected.phase.index) : [];

  const ran = run.agents.filter((a) => a.startedAt !== undefined);
  const matcher = CHIPS.find((c) => c.id === chip) ?? CHIPS[0];
  const points = ran.filter(matcher.match);
  const maxTok = Math.max(1, ...ran.map((a) => a.tokens ?? 0));
  const maxDur = Math.max(
    1,
    ...ran.map((a) => (a.durationMs === undefined ? now - a.startedAt! : a.durationMs)),
  );
  const maxCalls = Math.max(0, ...ran.map((a) => a.toolCalls ?? 0));
  const { peak, msAtPeak } = concurrency(run.agents);
  const series = concurrencySeries(run.agents);
  const counts = liveCounts(run);
  const { cached, fresh, resumed } = resumeSplit(run.agents);
  const elapsed =
    run.durationMs ?? (run.startedAt === undefined ? undefined : Math.max(0, now - run.startedAt));

  return (
    <div
      data-testid="workflow-usage"
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '14px 16px',
      }}
    >
      {bannerFires(run) && (
        <div
          data-testid="wfu-banner"
          style={{
            ...PANEL,
            display: 'flex',
            gap: '10px',
            alignItems: 'baseline',
            background: 'var(--color-accent-900)',
            borderColor: 'var(--color-accent-700)',
          }}
        >
          {/* Money is not a failure state, so this is the accent and never the
              warn colour. The badge is the first thing a narrow viewport
              crushes, and a wrapped "LARGE / WORKFLOW" reads as a rendering
              fault rather than as a warning. */}
          <span
            data-testid="wfu-banner-badge"
            style={{
              flex: 'none',
              whiteSpace: 'nowrap',
              color: 'var(--color-accent-300)',
              fontSize: '10px',
              letterSpacing: '.12em',
            }}
          >
            LARGE WORKFLOW
          </span>
          <span style={{ ...PROSE, color: 'var(--color-accent-300)' }}>
            {`${run.agents.length} agents ran in this workflow. The warning is advisory — nothing here paused the run, and nothing here can: a workflow opts in at launch and reports at the end. Stopping one means stopping the session that launched it.`}
          </span>
        </div>
      )}

      {run.live ? (
        <>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Tile
              label="AGENTS"
              value={String(counts.started)}
              note={`${counts.returned} returned so far`}
            />
            <Tile label="CONTEXT" value={EM_DASH} note="arrives with the snapshot" />
            <Tile label="TOOL CALLS" value={EM_DASH} note="arrives with the snapshot" />
            <Tile
              label="ELAPSED"
              value={elapsed === undefined ? EM_DASH : formatElapsed(elapsed)}
              note={run.startedAt === undefined ? 'no start time until the run ends' : 'since the run began'}
            />
            <Tile label="PEAK AT ONCE" value={EM_DASH} note="no timings until the run ends" />
          </div>

          <div data-testid="wfu-live-note" style={{ ...PANEL, ...PROSE }}>
            <div style={PANEL_TITLE}>while the run is going</div>
            {`This run has not written its snapshot yet — the runtime writes it once, at termination. Until then the journal is the only source, and a journal line is an agent id, a cache key and a return value: no phase, no label, no model, no timing and no token count of any kind. `}
            <span data-testid="wfu-live-counts" style={{ color: 'var(--color-neutral-500)' }}>
              {`${counts.started} started · ${counts.returned} returned`}
            </span>
            {` is the whole of what can honestly be said. Nothing is projected from it, because there is no measured figure here to project.`}
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Tile
              label="AGENTS"
              value={String(run.agentCount ?? run.agents.length)}
              note={stateTally(run.agents)}
            />
            <Tile
              label="FINAL CONTEXT"
              value={run.totalTokens === undefined ? EM_DASH : formatTokens(run.totalTokens)}
              note="each agent's last turn, summed — not a bill"
            />
            <Tile
              label="TOOL CALLS"
              value={run.totalToolCalls === undefined ? EM_DASH : String(run.totalToolCalls)}
              note="across every agent in the run"
            />
            <Tile
              label="ELAPSED"
              value={elapsed === undefined ? EM_DASH : formatElapsed(elapsed)}
              note="wall clock, first spawn to last return"
            />
            <Tile
              label="PEAK AT ONCE"
              value={peak === 0 ? EM_DASH : String(peak)}
              note={peak === 0 ? 'no agent timings recorded' : `${formatElapsed(msAtPeak)} held there`}
            />
          </div>

          <div style={PANEL}>
            <div style={PANEL_TITLE}>Phases</div>
            <div>
              {rows.map((row) => {
                const wide = span !== undefined && row.startMs !== undefined && row.endMs !== undefined;
                return (
                  <div
                    key={row.phase.index}
                    data-testid="wfu-gantt-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => setPhase(row.phase.index)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPhase(row.phase.index); }
                    }}
                    style={{
                      display: 'flex',
                      gap: '10px',
                      alignItems: 'center',
                      padding: '5px 0',
                      borderTop: '1px solid var(--color-neutral-900)',
                      background: selected?.phase.index === row.phase.index ? 'var(--color-accent-900)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ width: '180px', flex: 'none', display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          flex: 'none',
                          background: row.pending ? 'var(--color-neutral-800)' : phaseTone(row, run.agents),
                        }}
                      />
                      <span style={{ color: row.pending ? 'var(--color-neutral-600)' : 'var(--color-text)', fontSize: '11.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {row.phase.title}
                      </span>
                    </span>
                    {/* The track is the run's own first-start-to-last-return
                        window, so a bar is a percentage of measured time. */}
                    <span style={{ flex: 1, minWidth: 0, height: '22px', borderRadius: '3px', background: 'var(--term)', position: 'relative' }}>
                      {wide && (
                        <span
                          data-testid="wfu-gantt-bar"
                          style={{
                            position: 'absolute',
                            top: '4px',
                            bottom: '4px',
                            left: `${((row.startMs! - span!.from) / (span!.to - span!.from)) * 100}%`,
                            width: `${Math.max(0.5, ((row.endMs! - row.startMs!) / (span!.to - span!.from)) * 100)}%`,
                            borderRadius: '2px',
                            background: phaseTone(row, run.agents),
                          }}
                        />
                      )}
                    </span>
                    <span data-testid="wfu-phase-tally" style={{ ...CELL, width: '132px', textAlign: 'left' }}>
                      {row.tally}
                    </span>
                    <span data-testid="wfu-phase-elapsed" style={{ ...CELL, width: '72px' }}>
                      {row.elapsedMs === undefined ? EM_DASH : formatElapsed(row.elapsedMs)}
                    </span>
                  </div>
                );
              })}
              {rows.length === 0 && (
                <div style={PROSE}>this run declared no phases — the script called agent() without phase()</div>
              )}
            </div>
            <div data-testid="wfu-phase-note" style={{ ...PROSE, marginTop: '8px' }}>
              A pending phase shows em-dashes because a phase reaches disk with
              its agents or with nothing: the number waiting to run is not
              recorded anywhere, so the count the row would like to give cannot
              be filled in. The context column is the sum of each agent&apos;s last
              turn, so a fan-out phase whose siblings shared one cached prefix
              counts that prefix once per sibling. There is no cost column for
              the reason below.
            </div>
          </div>

          {selected && (
            <div style={PANEL}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' }}>
                <span data-testid="wfu-agent-table-title" style={PANEL_TITLE}>
                  {`Agents in "${selected.phase.title}"`}
                </span>
                <span style={{ ...PROSE, fontSize: '10.5px' }}>click a phase row to scope this table</span>
              </div>
              <div style={{ display: 'flex', gap: '10px', color: 'var(--color-neutral-700)', fontSize: '9.5px', letterSpacing: '.06em', textTransform: 'uppercase', paddingBottom: '4px' }}>
                <span style={{ width: '32px', flex: 'none' }}>#</span>
                <span style={{ flex: 1, minWidth: 0 }}>label</span>
                <span style={{ ...CELL, width: '132px' }}>model</span>
                <span style={{ ...CELL, width: '92px' }}>status</span>
                <span style={{ ...CELL, width: '72px' }}>time</span>
                <span style={{ ...CELL, width: '78px' }}>final context</span>
                <span style={{ ...CELL, width: '64px' }}>cache hit</span>
                <span style={{ ...CELL, width: '64px' }}>cost</span>
              </div>
              {scoped.map((a, i) => (
                <div
                  key={a.agentId}
                  data-testid="wfu-agent-row"
                  style={{ display: 'flex', gap: '10px', alignItems: 'baseline', padding: '4px 0', borderTop: '1px solid var(--color-neutral-900)', fontSize: '11px' }}
                >
                  <span style={{ width: '32px', flex: 'none', color: 'var(--color-neutral-600)' }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.label ?? a.agentId}
                  </span>
                  <span style={{ ...CELL, width: '132px' }}>{a.model ?? EM_DASH}</span>
                  <span style={{ ...CELL, width: '92px' }}>{STATE_WORD[a.state]}</span>
                  <span style={{ ...CELL, width: '72px' }}>
                    {a.durationMs !== undefined
                      ? formatElapsed(a.durationMs)
                      : a.startedAt !== undefined
                        ? formatElapsed(now - a.startedAt)
                        : EM_DASH}
                  </span>
                  <span style={{ ...CELL, width: '78px' }}>
                    {a.tokens === undefined ? EM_DASH : formatTokens(a.tokens)}
                  </span>
                  {/* Both are em-dashes rather than absent columns: the figures
                      exist on disk un-ingested, so the shape of the answer is
                      known even though the answer is not. */}
                  <span data-testid="wfu-agent-cachehit" style={{ ...CELL, width: '64px' }}>{EM_DASH}</span>
                  <span data-testid="wfu-agent-cost" style={{ ...CELL, width: '64px' }}>{EM_DASH}</span>
                </div>
              ))}
              {scoped.length === 0 && (
                <div style={PROSE}>
                  this phase has no agents on disk — the run never reached it, and
                  the number waiting to run is recorded nowhere
                </div>
              )}
            </div>
          )}

          <div style={PANEL}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' }}>
              <span style={PANEL_TITLE}>Every agent in the run</span>
              <span data-testid="wfu-scatter-ylabel" style={{ ...PROSE, fontSize: '10.5px' }}>
                y: final context · x: wall time · radius: tool calls
              </span>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {CHIPS.map((c) => (
                <span
                  key={c.id}
                  data-testid="wfu-scatter-chip"
                  role="button"
                  tabIndex={0}
                  onClick={() => setChip(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setChip(c.id); }
                  }}
                  style={{
                    padding: '2px 8px',
                    borderRadius: '999px',
                    border: '1px solid var(--color-accent-700)',
                    background: chip === c.id ? 'var(--color-accent-900)' : 'transparent',
                    color: chip === c.id ? 'var(--color-accent-300)' : 'var(--color-neutral-600)',
                    fontSize: '10.5px',
                    cursor: 'pointer',
                  }}
                >
                  {`${c.word} ${ran.filter(c.match).length}`}
                </span>
              ))}
            </div>
            {ran.length === 0 ? (
              <div style={PROSE}>
                no agent on this run recorded a start time, so there is nothing to
                place — timings arrive with the snapshot.
              </div>
            ) : (
              <svg
                viewBox={`0 0 ${SCATTER_W} ${SCATTER_H}`}
                preserveAspectRatio="none"
                style={{ width: '100%', height: `${SCATTER_H}px`, background: 'var(--term)', borderRadius: '3px' }}
              >
                {points.map((a) => {
                  const dur = a.durationMs === undefined ? now - a.startedAt! : a.durationMs;
                  const cx = (dur / maxDur) * (SCATTER_W - 2 * POINT_R_MAX) + POINT_R_MAX;
                  const cy = SCATTER_H - ((a.tokens ?? 0) / maxTok) * (SCATTER_H - 2 * POINT_R_MAX) - POINT_R_MAX;
                  const hollow = a.state === 'fail';
                  return (
                    <circle
                      key={a.agentId}
                      data-testid="wfu-scatter-point"
                      data-state={a.state}
                      data-tool-calls={a.toolCalls ?? ''}
                      cx={cx}
                      cy={cy}
                      r={radiusOf(a.toolCalls, maxCalls)}
                      fill={hollow ? 'none' : SCATTER_FILL[a.state] ?? 'var(--color-neutral-800)'}
                      stroke={hollow ? 'var(--color-text)' : undefined}
                      strokeWidth={hollow ? 1.5 : undefined}
                    />
                  );
                })}
              </svg>
            )}
            <div style={PROSE}>
              A failed agent is drawn as a hollow ring rather than a second hue,
              so it is findable on a page that carries no failure colour. The
              design scales radius by cost; there is none here, so radius carries
              tool calls instead, and an agent with no count recorded draws the
              smallest point rather than none at all.
            </div>
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        <div data-testid="wfu-no-cost" style={{ ...PANEL, flex: 1, minWidth: 0 }}>
          <div style={PANEL_TITLE}>Why there are no costs here</div>
          <div style={PROSE}>
            <p style={{ margin: '0 0 7px' }}>
              The run snapshot records one number per agent, and it is that
              agent&apos;s final context size — its last turn&apos;s input plus cache
              creation plus cache read. A rate applied to it would not be an
              approximate bill, it would be a different quantity with a currency
              symbol on it, so this mode reports the run in agents, tool calls
              and time instead.
            </p>
            <p style={{ margin: '0 0 7px' }}>
              The source that would price it is not missing. Each agent writes
              its own four-class usage to
              {' '}
              <code style={{ color: 'var(--color-accent-400)' }}>subagents/workflows/wf_&lt;runId&gt;/agent-*.jsonl</code>
              {' '}
              while the run is going, with a per-line timestamp and model.
              Re-measured across 8 runs and 76 agents, the snapshot understates
              real token traffic by 15× to 75× — cache reads are 94.8% of it and
              the snapshot carries none. So the honest sentence is not that there
              is no source: the source exists, it is live, and this console does
              not read it. A workflow fan-out is not a team member, and widening
              that rule is a scope decision rather than a view&apos;s to make.
            </p>
            <p style={{ margin: 0 }}>
              Two figures stay refused whatever is decided. The concurrency
              chart&apos;s <code style={{ color: 'var(--color-accent-400)' }}>cap 16</code> line
              asserts a ceiling this run may not have had — the cap is
              min(16, CPUs − 2), resolved on the launching host and never written
              down. And the 1.5M projected-token warning line is dead against the
              quantity on disk (0 of 8 runs reach it) and permanently tripped
              against the quantity actually spent (8 of 8, the smallest by 6×), so
              the constant has to be re-derived once the quantity is settled
              rather than carried across. A third figure needs the runtime, not
              this console: the count of agents scheduled but not yet started,
              which exists only inside the running process.
            </p>
          </div>
        </div>

        <div style={{ ...PANEL, width: '300px', flex: 'none' }}>
          <div style={PANEL_TITLE}>Concurrency</div>
          {series.length > 0 ? (
            <div
              data-testid="wfu-concurrency"
              style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '54px' }}
            >
              {series.map((active, i) => (
                <span
                  key={i}
                  title={`${active} at once`}
                  style={{
                    flex: 1,
                    height: `${peak === 0 ? 0 : Math.max(2, (active / peak) * 54)}px`,
                    background: active === peak ? 'var(--color-accent-400)' : 'var(--color-accent-700)',
                    borderRadius: '1px',
                  }}
                />
              ))}
            </div>
          ) : (
            <div style={PROSE}>
              no timings on this run — `startedAt` and `durationMs` arrive with
              the snapshot, so a live run has no shape to draw.
            </div>
          )}
          <div style={{ ...PROSE, marginTop: '7px' }}>
            {peak === 0
              ? 'The cap is min(16, CPUs − 2), resolved from the launching host and never written down, so the ceiling this run actually had is not recoverable.'
              : `Peak ${peak}, held ${formatElapsed(msAtPeak)}. The notch at each fan-out edge is the runtime holding matching siblings up to 5s so the first one's prefix lands in cache before the rest start. The cap is min(16, CPUs − 2) and is never written down, so the ceiling this run actually had is not recoverable.`}
          </div>
        </div>
      </div>

      <div data-testid="wfu-relaunch" style={PANEL}>
        <div style={PANEL_TITLE}>Relaunch economics</div>
        <div style={{ ...PROSE, marginBottom: '7px' }}>
          A relaunch replays in start order, so a mid-fan-out failure reruns the
          failed agent and every agent started after it — including the ones that
          had already finished. Editing the script before relaunching invalidates
          everything after the first changed prompt, which is why an operator
          stops a run early rather than letting it fail late.
        </div>
        <div style={{ ...PROSE, color: 'var(--color-neutral-500)' }}>
          {resumed
            ? `${cached.length} of ${run.agents.length} came back from cache on this run, and ${fresh.length} ran.`
            : 'Nothing on this run came back from cache, so it ran from the first call.'}
          {' What a rerun would cost cannot be priced here for the same reason nothing else on this page can — the tokens on disk are context, not spend.'}
        </div>
      </div>

      <div
        data-testid="wfu-footer"
        style={{ display: 'flex', gap: '24px', paddingTop: '2px' }}
      >
        <div style={{ ...PROSE, flex: 1, color: 'var(--color-neutral-700)' }}>
          The runtime caps are caps: 16 concurrent agents, and fewer on a machine
          with fewer CPUs; 4,096 items per parallel() or pipeline() call; 1,000
          agents for the whole run. The large-workflow warning is advisory and
          stops nothing.
        </div>
        <div style={{ ...PROSE, flex: 1, color: 'var(--color-neutral-700)' }}>
          Where this console does derive money it does so at API list price, from
          token counts, and a subscription plan meters the same usage against
          plan limits instead of billing it. This mode derives none: the run
          snapshot carries no billable token count, and a single-run comparison
          would be an estimate even if it did.
        </div>
      </div>
    </div>
  );
}
