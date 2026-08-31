import type { CSSProperties } from 'react';
import type { TeamState } from '../../shared/domain';
import { formatCost, formatElapsed, formatPct, formatTokens } from '../format';
import {
  billedTokens,
  cacheHitRatio,
  costPerHour,
  costPerTask,
  dollarsAvoided,
  ledgerRowOf,
  spendBuckets,
  spendByModel,
  sumSplit,
  type SegmentKey,
  type SpendSample,
} from './usage-team';

// Fixed draw order, ramp -700 → -500 → -400 → -300 — never re-sorted by size.
const SEGMENT_COLOR: Record<SegmentKey, string> = {
  cacheRead: 'var(--color-accent-700)',
  cacheWrite: 'var(--color-accent-500)',
  in: 'var(--color-accent-400)',
  out: 'var(--color-accent-300)',
};

const PANEL: CSSProperties = {
  background: 'var(--color-bg)',
  border: '1px solid var(--color-neutral-900)',
  borderRadius: 'var(--radius-md)',
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  minWidth: 0,
};

const PANEL_HEAD: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '12px',
};

const PANEL_TITLE: CSSProperties = {
  fontWeight: 500,
  fontSize: '12.5px',
  color: 'var(--color-text)',
  whiteSpace: 'nowrap',
};

const PANEL_CAPTION: CSSProperties = {
  fontSize: '10.5px',
  color: 'var(--color-neutral-600)',
  whiteSpace: 'nowrap',
};

const TILE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'var(--color-bg)',
  border: '1px solid var(--color-neutral-900)',
  borderRadius: 'var(--radius-md)',
  padding: '12px 14px 13px',
  display: 'flex',
  flexDirection: 'column',
  gap: '7px',
};

const TILE_LABEL: CSSProperties = {
  fontSize: '9.5px',
  letterSpacing: '.09em',
  textTransform: 'uppercase',
  color: 'var(--color-neutral-600)',
};

const TILE_VALUE: CSSProperties = {
  fontWeight: 500,
  fontSize: '23px',
  color: 'var(--color-text)',
};

const TILE_NOTE: CSSProperties = {
  fontSize: '11px',
  color: 'var(--color-neutral-500)',
};

const EM_DASH = '—';

function Tile({
  testId, label, value, valueColor, note,
}: {
  testId: string;
  label: string;
  value: string;
  valueColor?: string;
  note: string;
}) {
  return (
    <div data-testid="usage-tile" style={TILE}>
      <span style={TILE_LABEL}>{label}</span>
      <span data-testid={`${testId}-value`} style={{ ...TILE_VALUE, color: valueColor ?? TILE_VALUE.color }}>
        {value}
      </span>
      <span data-testid={`${testId}-note`} style={TILE_NOTE}>{note}</span>
    </div>
  );
}

export interface UsageTeamProps {
  state: TeamState;
  now: number;
  focused: string | null;
  onFocus: (name: string) => void;
  spendSamples: readonly SpendSample[];
}

/**
 * Team mode's body of the usage view. Every dollar figure the tiles and the
 * ledger draw is `agent.costUsd` (or a sum of it) — the exact field the status
 * bar's own spend chip already ticks — so the two can never disagree; the
 * shared `usdCost` module is reserved for figures that have no source on the
 * wire yet (dollars avoided, the rate card).
 */
export function UsageTeam({ state, now, focused, onFocus, spendSamples }: UsageTeamProps) {
  const { agents, tasks } = state;
  // Undefined, not zero, when any agent's split is unrecorded — a pre-existing
  // log the split widening hasn't reached yet, or an agent mid-way through its
  // first drain. Partial data reads as "unknown", never as a smaller measurement.
  const split = sumSplit(agents);
  const tokens = split ? billedTokens(split) : undefined;
  const hit = split ? cacheHitRatio(split) : undefined;
  const avoided = dollarsAvoided(agents);
  const tasksDone = tasks.filter((t) => t.state === 'completed').length;
  const perTask = costPerTask(state.totalCostUsd, tasksDone);
  const perHour = costPerHour(state.totalCostUsd, state.startedAt, now);

  const pressured = [...agents].sort(
    (a, b) => b.contextTokens / b.contextLimit - a.contextTokens / a.contextLimit,
  )[0];

  const models = spendByModel(agents);
  const buckets = spendBuckets(spendSamples, now);
  const maxBucket = Math.max(1e-9, ...buckets.map((b) => b.cost));

  const totalCost = agents.reduce((s, a) => s + a.costUsd, 0);

  return (
    <div data-testid="usage" className="tscroll" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '12px', padding: '14px 16px' }}>
      <div style={{ display: 'flex', gap: '12px' }}>
        <Tile
          testId="usage-cost"
          label="session cost"
          value={formatCost(state.totalCostUsd)}
          note={perHour === undefined ? `${EM_DASH} per hour at the current burn` : `${formatCost(perHour)} per hour at the current burn`}
        />
        <Tile
          testId="usage-tokens"
          label="tokens"
          value={tokens === undefined ? EM_DASH : formatTokens(tokens)}
          note={
            split === undefined
              ? EM_DASH
              : `${formatTokens(split.in + split.cacheWrite)} in · ${formatTokens(split.out)} out · ${formatTokens(split.cacheRead)} cache read`
          }
        />
        <Tile
          testId="usage-cache"
          label="cache hit rate"
          value={hit === undefined ? EM_DASH : formatPct(hit)}
          valueColor="var(--color-accent-400)"
          note={`reads bill at 0.1× — ${avoided === undefined ? EM_DASH : formatCost(avoided)} avoided`}
        />
        <Tile
          testId="usage-context"
          label="context windows"
          value={String(agents.length)}
          note={
            pressured && pressured.contextLimit > 0
              ? `${pressured.name} at ${formatPct(pressured.contextTokens / pressured.contextLimit)} of its window`
              : `${EM_DASH} no agent has used its window yet`
          }
        />
        <Tile
          testId="usage-per-task"
          label="cost per task"
          value={perTask === undefined ? EM_DASH : formatCost(perTask)}
          note={`${tasksDone} tasks completed from the shared list`}
        />
      </div>

      <div style={{ display: 'flex', gap: '16px', alignItems: 'stretch', minHeight: 0 }}>
        <div style={{ ...PANEL, flex: 1, overflow: 'hidden', padding: 0 }}>
          <div style={{ ...PANEL_HEAD, padding: '13px 16px 11px', borderBottom: '1px solid var(--color-neutral-900)' }}>
            <span style={PANEL_TITLE}>Per-agent ledger</span>
            <span data-testid="usage-ledger-caption" style={PANEL_CAPTION}>
              click a row to open that agent in the wall
            </span>
          </div>
          <div className="tscroll" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {agents.map((agent) => {
              const row = ledgerRowOf(agent);
              return (
                <div
                  key={agent.name}
                  data-testid="usage-ledger-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onFocus(agent.name)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFocus(agent.name); }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '9px 12px',
                    borderBottom: '1px solid var(--color-neutral-900)',
                    background: agent.name === focused ? 'var(--color-accent-900)' : 'transparent',
                    cursor: 'pointer',
                    fontSize: '11.5px',
                  }}
                >
                  <span
                    data-testid="usage-row-name"
                    style={{ width: '74px', flex: 'none', textAlign: 'right', color: 'var(--color-neutral-400)' }}
                  >
                    {agent.name}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, height: '16px', borderRadius: '3px', overflow: 'hidden', display: 'flex', background: 'var(--term)' }}>
                    {row.segments.map((seg) => (
                      <span
                        key={seg.key}
                        data-testid="usage-row-segment"
                        data-segment={seg.key}
                        style={{ width: `${seg.pct}%`, height: '100%', background: SEGMENT_COLOR[seg.key] }}
                      />
                    ))}
                  </span>
                  <span data-testid="usage-row-cache" style={{ width: '52px', flex: 'none', textAlign: 'right', color: 'var(--color-accent-500)' }}>
                    {row.cacheHit === undefined ? EM_DASH : formatPct(row.cacheHit)}
                  </span>
                  <span
                    data-testid="usage-row-permtok"
                    style={{ width: '64px', flex: 'none', textAlign: 'right', color: 'var(--color-neutral-500)' }}
                    title="blended: cost over this agent's billed tokens, not a listed rate"
                  >
                    {row.perMtok === undefined ? EM_DASH : formatCost(row.perMtok)}
                  </span>
                  <span style={{ width: '64px', flex: 'none', textAlign: 'right', fontWeight: 500, color: 'var(--color-text)' }}>
                    {formatCost(row.cost)}
                  </span>
                </div>
              );
            })}
          </div>
          <div
            data-testid="usage-ledger-footer"
            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--term)', fontSize: '11px' }}
          >
            <span style={{ width: '74px', flex: 'none', textAlign: 'right', color: 'var(--color-neutral-600)' }}>
              {`${agents.length} agents`}
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ width: '52px', flex: 'none', textAlign: 'right', color: 'var(--color-accent-500)' }}>
              {hit === undefined ? EM_DASH : formatPct(hit)}
            </span>
            <span
              style={{ width: '64px', flex: 'none', textAlign: 'right', color: 'var(--color-neutral-500)' }}
              title="blended: cost over total billed tokens, not a listed rate"
            >
              {tokens !== undefined && tokens > 0 ? formatCost(totalCost / (tokens / 1e6)) : EM_DASH}
            </span>
            <span data-testid="usage-foot-cost" style={{ width: '64px', flex: 'none', textAlign: 'right', fontWeight: 500, color: 'var(--color-text)' }}>
              {formatCost(totalCost)}
            </span>
          </div>
        </div>

        <div style={{ width: '300px', flex: 'none', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div data-testid="usage-spend-by-model" style={PANEL}>
            <span style={PANEL_TITLE}>Spend by model</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {models.map((m) => (
                <div key={m.model} data-testid="usage-model-row" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ fontSize: '11.5px', color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {m.model}
                      {m.rate.approximate && (
                        <span data-testid="usage-model-approx" title="not in catalog.json — priced from the fallback tier" style={{ marginLeft: '6px', color: 'var(--color-accent-400)', fontSize: '10px' }}>
                          approx
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-text)', flex: 'none' }}>{formatCost(m.cost)}</span>
                  </div>
                  <div style={{ fontSize: '10.5px', color: 'var(--color-neutral-500)' }}>
                    {`${formatPct(m.share)} · ${m.count} agent${m.count === 1 ? '' : 's'} · $${m.rate.input.toFixed(2)}/$${m.rate.output.toFixed(2)} per Mtok`}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={PANEL}>
            <div style={PANEL_HEAD}>
              <span style={PANEL_TITLE}>Spend per 2 min</span>
              <span data-testid="usage-buckets-caption" style={PANEL_CAPTION}>
                {spendSamples.length > 0
                  ? `${formatElapsed(now - spendSamples[0].at)} sampled`
                  : 'not sampled yet'}
              </span>
            </div>
            {buckets.length === 0 ? (
              <div data-testid="usage-buckets-empty" style={{ fontSize: '11px', color: 'var(--color-neutral-600)' }}>
                no samples yet — this chart builds while the console stays open
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '48px' }}>
                {buckets.map((b) => (
                  <span
                    key={b.at}
                    data-testid="usage-bucket-bar"
                    style={{
                      flex: 1,
                      minHeight: '2px',
                      height: `${Math.max(2, (b.cost / maxBucket) * 100)}%`,
                      background: 'var(--color-accent-600)',
                      borderRadius: '2px 2px 0 0',
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <div data-testid="usage-notes" style={{ ...PANEL, fontSize: '10.5px', lineHeight: 1.5, color: 'var(--color-neutral-600)' }}>
            <p style={{ margin: 0 }}>
              {"A teammate's cache TTL is 5 minutes by default, separate from the main conversation's — a teammate idle longer than that pays the write again on its next turn. "}
              <code style={{ color: 'var(--color-accent-400)' }}>subagentPromptCacheTtl: 1h</code>
              {' extends it and bills writes higher.'}
            </p>
            <p style={{ margin: 0 }}>
              Compaction on the lead rewrites the cached prefix and costs a full cache write across the whole team, not just the lead.
            </p>
            <p style={{ margin: 0 }}>
              Rates come from config (<code style={{ color: 'var(--color-accent-400)' }}>src/shared/catalog.json</code>) — an edit there takes effect on the next drain.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
