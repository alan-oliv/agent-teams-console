import type { CSSProperties } from 'react';
import type { Agent, TeamState } from '../../shared/domain';
import { RATES, rateOf } from '../../shared/cost';
import { formatCost, formatElapsed, formatPct, formatTokens } from '../format';
import { useAppearance, type Settings } from '../state/useSettings';
import {
  billedTokens,
  cacheHitRatio,
  costPerHour,
  costPerTask,
  dollarsAvoided,
  idleMsOf,
  ledgerRowOf,
  messageBuckets,
  moneyLadder,
  serialEstimate,
  spendBuckets,
  spendByModel,
  stackedSpend,
  sumSplit,
  type ModelSpend,
  type SegmentKey,
  type SpendSample,
  type StackedSpend,
} from './usage-team';

// Series colour is the accent ramp in order, never a categorical palette. More
// series than steps wraps rather than inventing a hue.
const RAMP = [
  'var(--color-accent-300)',
  'var(--color-accent-400)',
  'var(--color-accent-500)',
  'var(--color-accent-600)',
  'var(--color-accent-700)',
];

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

const PROSE: CSSProperties = {
  fontSize: '10.5px',
  lineHeight: 1.5,
  color: 'var(--color-neutral-600)',
};

// The design names `--color-surface` for chart grounds and the donut track.
// This console's theme has never defined it, and an undefined custom property
// resolves to nothing rather than erroring — so the shape draws invisible.
// CONSOLE-NOTES §22 substitutes the accent's darkest step.
const SURFACE = 'var(--color-accent-900)';

const CHART_W = 746;
const CHART_H = 176;

/**
 * Cumulative spend, stacked by agent, over the samples this console took for
 * itself. There is no spend history on the wire — `UsageRecord` carries no
 * timestamp — so the series starts when the console opened and the caption says
 * so. It is never backfilled from `spawnedAt`: a teammate's area is flat at
 * zero until the first sample that saw it spend, because the staircase of
 * spawns IS the measurement (USAGE-STATE.md §6).
 */
function StackedSpendPanel({
  series, agents, now,
}: {
  series: StackedSpend | undefined;
  agents: readonly Agent[];
  now: number;
}) {
  const enough = series !== undefined && series.at.length >= 2;
  const ladder = moneyLadder(enough ? series.max : 0);
  const top = ladder[ladder.length - 1];
  const from = enough ? series.at[0] : now;
  const to = enough ? series.at[series.at.length - 1] : now;
  const span = Math.max(1, to - from);
  const x = (at: number) => ((at - from) / span) * CHART_W;
  const y = (v: number) => CHART_H - (v / top) * CHART_H;

  // Bottom-to-top: each band's area is its own cumulative top line, closed back
  // along the line beneath it, so the fills stack instead of overlapping.
  const areas = enough
    ? series.bands.map((band, k) => {
        const upper = series.at.map((at, i) => {
          const stacked = series.bands.slice(0, k + 1).reduce((s, b) => s + b.values[i], 0);
          return `${x(at).toFixed(2)},${y(stacked).toFixed(2)}`;
        });
        const lower = [...series.at].reverse().map((at, ri) => {
          const i = series.at.length - 1 - ri;
          const beneath = series.bands.slice(0, k).reduce((s, b) => s + b.values[i], 0);
          return `${x(at).toFixed(2)},${y(beneath).toFixed(2)}`;
        });
        return { name: band.name, color: band.color, d: `M${upper.join('L')}L${lower.join('L')}Z` };
      })
    : [];

  const spawns = enough
    ? agents.filter((a) => a.startedAt > from && a.startedAt <= to)
    : [];

  return (
    <div data-testid="usage-stacked" style={PANEL}>
      <div style={PANEL_HEAD}>
        <span style={PANEL_TITLE}>Cumulative spend, stacked by agent</span>
        <span data-testid="usage-stacked-caption" style={PANEL_CAPTION}>
          {enough ? `${formatElapsed(now - from)} sampled, not the whole session` : 'not sampled yet'}
        </span>
      </div>
      {!enough ? (
        <div data-testid="usage-stacked-empty" style={PROSE}>
          the console has no spend history to plot yet — this chart builds from
          samples taken while it stays open, and is never backfilled from each
          agent&apos;s spawn time, which would invent a staircase rather than
          measure one
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '10px' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 0, height: `${CHART_H}px` }}>
              <svg
                viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                preserveAspectRatio="none"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: 'var(--term)', borderRadius: '3px' }}
              >
                {ladder.map((tick) => (
                  <line
                    key={tick}
                    x1={0}
                    x2={CHART_W}
                    y1={y(tick)}
                    y2={y(tick)}
                    stroke="var(--color-neutral-900)"
                    strokeWidth={1}
                  />
                ))}
                {areas.map((area) => (
                  <path key={area.name} data-testid="usage-stacked-area" d={area.d} fill={area.color} />
                ))}
                {spawns.map((a) => (
                  <line
                    key={a.name}
                    data-testid="usage-stacked-spawn"
                    x1={x(a.startedAt)}
                    x2={x(a.startedAt)}
                    y1={0}
                    y2={CHART_H}
                    stroke="var(--color-neutral-600)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                ))}
              </svg>
              {/* HTML labels over the geometry — the SVG holds path/line/circle
                  only, per the design's rendering constraint. */}
              {spawns.map((a) => (
                <span
                  key={a.name}
                  style={{
                    position: 'absolute',
                    left: `${(x(a.startedAt) / CHART_W) * 100}%`,
                    top: 0,
                    transform: 'translateX(3px)',
                    fontSize: '9.5px',
                    color: 'var(--color-neutral-600)',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                  }}
                >
                  {`${a.name} spawned`}
                </span>
              ))}
            </div>
            <div style={{ width: '46px', flex: 'none', position: 'relative', height: `${CHART_H}px` }}>
              {ladder.map((tick) => (
                <span
                  key={tick}
                  data-testid="usage-stacked-tick"
                  style={{
                    position: 'absolute',
                    top: `${(y(tick) / CHART_H) * 100}%`,
                    left: 0,
                    transform: 'translateY(-50%)',
                    fontSize: '9.5px',
                    color: 'var(--color-neutral-600)',
                  }}
                >
                  {formatCost(tick)}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
            {series.bands.map((band) => (
              <span key={band.name} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', color: 'var(--color-neutral-500)' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: band.color, flex: 'none' }} />
                {band.name}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const DONUT_R = 40;
const DONUT_C = 2 * Math.PI * DONUT_R;

/** Spend by model as the study's donut. One ramp step per model, in cost order. */
function DonutPanel({ models }: { models: readonly ModelSpend[] }) {
  let offset = 0;
  const arcs = models.map((m, i) => {
    const arc = { model: m.model, share: m.share, at: offset, color: RAMP[i % RAMP.length] };
    offset += m.share;
    return arc;
  });

  return (
    <div data-testid="usage-spend-by-model" style={PANEL}>
      <span style={PANEL_TITLE}>Spend by model</span>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <svg viewBox="0 0 100 100" style={{ width: '104px', height: '104px' }}>
          <circle cx={50} cy={50} r={DONUT_R} fill="none" stroke={SURFACE} strokeWidth={14} />
          {arcs.map((arc) => (
            <circle
              key={arc.model}
              data-testid="usage-donut-arc"
              cx={50}
              cy={50}
              r={DONUT_R}
              fill="none"
              stroke={arc.color}
              strokeWidth={14}
              strokeDasharray={`${(arc.share * DONUT_C).toFixed(3)} ${DONUT_C.toFixed(3)}`}
              strokeDashoffset={`${(-arc.at * DONUT_C).toFixed(3)}`}
              transform="rotate(-90 50 50)"
            />
          ))}
        </svg>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {models.map((m, i) => (
          <div key={m.model} data-testid="usage-model-row" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0, fontSize: '11.5px', color: 'var(--color-text)' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', flex: 'none', background: RAMP[i % RAMP.length] }} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.model}</span>
                {m.rate.approximate && (
                  <span data-testid="usage-model-approx" title="not in catalog.json — priced from the fallback tier" style={{ color: 'var(--color-accent-400)', fontSize: '10px', flex: 'none' }}>
                    approx
                  </span>
                )}
              </span>
              <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-text)', flex: 'none' }}>{formatCost(m.cost)}</span>
            </div>
            <div style={{ fontSize: '10.5px', color: 'var(--color-neutral-500)' }}>
              {`${formatPct(m.share)} · ${m.count} agent${m.count === 1 ? '' : 's'} · `}
              <span
                data-testid="usage-model-permtok"
                title="blended: this model's cost over its own billed tokens, not a listed rate"
              >
                {m.tokens !== undefined && m.tokens > 0
                  ? `${formatCost(m.cost / (m.tokens / 1e6))}/Mtok`
                  : `${EM_DASH}/Mtok`}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The rate card. Drawn from `catalog.json` through `RATES()` — the console's one
 * rate source — never from the design's own published figures, which overstate
 * this catalog's Opus rate 3x (CONSOLE-NOTES §18). A second copy is how a card
 * goes stale without anyone noticing.
 */
function RateCardPanel({ models }: { models: readonly ModelSpend[] }) {
  // Catalog rows first, then any model this team is actually running that the
  // catalog has never heard of — priced from the fallback tier and said so.
  const catalog = RATES();
  const unknown = models
    .filter((m) => m.rate.approximate)
    .map((m) => rateOf(m.model))
    .filter((r, i, all) => all.findIndex((o) => o.model === r.model) === i);
  const rows = [...catalog, ...unknown];

  const CELL: CSSProperties = { width: '52px', flex: 'none', textAlign: 'right' };
  return (
    <div data-testid="usage-rate-card" style={PANEL}>
      <div style={PANEL_HEAD}>
        <span style={PANEL_TITLE}>Rate card</span>
        <span style={PANEL_CAPTION}>$ per Mtok, live from config</span>
      </div>
      <div style={{ display: 'flex', gap: '8px', fontSize: '9.5px', letterSpacing: '.06em', color: 'var(--color-neutral-700)', textTransform: 'uppercase' }}>
        <span style={{ flex: 1, minWidth: 0 }}>model</span>
        <span style={CELL}>in</span>
        <span style={CELL}>out</span>
        <span style={CELL}>write</span>
        <span style={CELL}>read</span>
      </div>
      {rows.map((rate) => (
        <div key={rate.model} data-testid="usage-rate-row" style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--color-neutral-400)' }}>
          <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--color-text)' }}>
            {rate.model}
            {rate.approximate && (
              <span data-testid="usage-rate-approx" title="not in catalog.json — priced from the fallback tier" style={{ marginLeft: '5px', color: 'var(--color-accent-400)', fontSize: '10px' }}>
                approx
              </span>
            )}
          </span>
          <span style={CELL}>{rate.input.toFixed(2)}</span>
          <span style={CELL}>{rate.output.toFixed(2)}</span>
          <span style={CELL}>{rate.cacheWrite.toFixed(2)}</span>
          <span style={{ ...CELL, color: 'var(--color-accent-500)' }}>{rate.cacheRead.toFixed(2)}</span>
        </div>
      ))}
      <div data-testid="usage-rate-note" style={PROSE}>
        {'Cache writes bill at 1.25× the input rate and reads at 0.1×, which is why the total is not roughly 2.6× larger. '}
        {"A teammate's cache TTL is 5 minutes by default, separate from the main conversation's — a teammate idle longer than that pays the write again on its next turn. "}
        <code style={{ color: 'var(--color-accent-400)' }}>subagentPromptCacheTtl: 1h</code>
        {' extends it and bills writes higher.'}
      </div>
    </div>
  );
}

// >70% and >50% of the agent's OWN window. The design bands at absolute 140k
// and 100k against a fixed 200k; this console meters every agent against its
// own `contextLimit` (USAGE-STATE.md §6 — Opus-5's window is 1,000,000 here, so
// a fixed 200k would read every lead as permanently over its limit). The bands
// are the design's proportions, which is what its numbers meant.
const PRESSURE_HIGH = 0.7;
const PRESSURE_MID = 0.5;

function pressureColor(ratio: number): string {
  if (ratio > PRESSURE_HIGH) return 'var(--color-accent-300)';
  if (ratio > PRESSURE_MID) return 'var(--color-accent-500)';
  return 'var(--color-accent-700)';
}

function ContextPressurePanel({ agents }: { agents: readonly Agent[] }) {
  return (
    <div data-testid="usage-pressure" style={{ ...PANEL, flex: 1, minWidth: 0 }}>
      <div style={PANEL_HEAD}>
        <span style={PANEL_TITLE}>Context window pressure</span>
        <span style={PANEL_CAPTION}>each against its own window</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
        {agents.map((a) => {
          const known = a.contextLimit > 0;
          const ratio = known ? a.contextTokens / a.contextLimit : 0;
          return (
            <div key={a.name} data-testid="usage-pressure-row" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ width: '74px', flex: 'none', textAlign: 'right', fontSize: '11px', color: 'var(--color-neutral-400)' }}>
                {a.name}
              </span>
              <span style={{ flex: 1, minWidth: 0, height: '6px', borderRadius: '3px', background: 'var(--term)', overflow: 'hidden' }}>
                {known && (
                  <span
                    data-testid="usage-pressure-bar"
                    style={{
                      display: 'block',
                      width: `${Math.min(100, ratio * 100)}%`,
                      height: '100%',
                      background: pressureColor(ratio),
                    }}
                  />
                )}
              </span>
              <span style={{ width: '104px', flex: 'none', textAlign: 'right', fontSize: '10.5px', color: 'var(--color-neutral-500)' }}>
                {known
                  ? `${formatTokens(a.contextTokens)} / ${formatTokens(a.contextLimit)}`
                  : EM_DASH}
              </span>
            </div>
          );
        })}
      </div>
      <div data-testid="usage-pressure-note" style={PROSE}>
        The lead holds every teammate summary, and compaction there rewrites the
        cached prefix — a full cache write across the whole team, not just the
        lead. Each bar is measured against that agent&apos;s own context limit,
        which differs by model.
      </div>
    </div>
  );
}

function CoordinationPanel({
  mail, agents, now,
}: {
  mail: TeamState['mail'];
  agents: readonly Agent[];
  now: number;
}) {
  const bars = messageBuckets(mail, now);
  const peak = Math.max(1, ...bars);
  const delivered = mail.filter((m) => m.read).length;
  const idles = agents
    .map((a) => ({ name: a.name, ms: idleMsOf(a, now) }))
    .filter((i): i is { name: string; ms: number } => i.ms !== undefined)
    .sort((a, b) => b.ms - a.ms);
  const longest = idles[0];

  return (
    <div data-testid="usage-coordination" style={{ ...PANEL, flex: 1, minWidth: 0 }}>
      <div style={PANEL_HEAD}>
        <span style={PANEL_TITLE}>Coordination overhead</span>
        <span style={PANEL_CAPTION}>messages per 2 min</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '78px' }}>
        {bars.map((count, i) => (
          <span
            key={i}
            data-testid="usage-coord-bar"
            style={{
              flex: 1,
              minHeight: '2px',
              height: `${Math.max(2, (count / peak) * 100)}%`,
              borderRadius: '2px 2px 0 0',
              background: i === bars.length - 1 ? 'var(--color-accent-400)' : 'var(--color-accent-600)',
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: '18px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={TILE_LABEL}>delivered</span>
          <span data-testid="usage-coord-delivered" style={{ fontSize: '15px', color: 'var(--color-text)' }}>
            {`${delivered} of ${mail.length}`}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={TILE_LABEL}>longest idle</span>
          <span data-testid="usage-coord-idle" style={{ fontSize: '15px', color: 'var(--color-text)' }}>
            {longest === undefined ? EM_DASH : `${longest.name} ${formatElapsed(longest.ms)}`}
          </span>
        </div>
      </div>
      <div data-testid="usage-coord-note" style={PROSE}>
        Delivered counts the messages a recipient has actually drained at a turn
        boundary; idle time is measured from an agent&apos;s last transcript
        line. The design asks for a third figure here — the spend attributable to
        re-reading inboxes — and it is absent on purpose: no token is
        attributable to a message read. The usage ledger reports per-turn totals
        and never per-content-block attribution, so nothing on disk says which
        tokens of a turn were the inbox. Deriving it would mean approximating the
        message text&apos;s length, guessing how many turns it stayed in context
        and applying the cache-read rate — three estimates chained and served
        with a currency symbol. The serial estimate below survives where this
        does not because it is an explicit counterfactual: a caption can mark a
        thing that never happened, but it cannot turn an unmeasured actual into a
        measured one.
      </div>
    </div>
  );
}

function WorthItPanel({
  actual, serial, model,
}: {
  actual: number;
  serial: number | undefined;
  model: string;
}) {
  const scale = Math.max(actual, serial ?? 0, 1e-9);
  const ratio = serial !== undefined && serial > 0 ? actual / serial : undefined;

  const Bar = ({ testId, label, value, color }: { testId: string; label: string; value: number | undefined; color: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <span style={{ width: '150px', flex: 'none', textAlign: 'right', fontSize: '11px', color: 'var(--color-neutral-400)' }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, height: '16px', borderRadius: '3px', background: 'var(--term)', overflow: 'hidden' }}>
        {value !== undefined && (
          <span style={{ display: 'block', width: `${(value / scale) * 100}%`, height: '100%', background: color }} />
        )}
      </span>
      <span data-testid={testId} style={{ width: '72px', flex: 'none', textAlign: 'right', fontSize: '11.5px', fontWeight: 500, color: 'var(--color-text)' }}>
        {value === undefined ? EM_DASH : formatCost(value)}
      </span>
    </div>
  );

  return (
    <div data-testid="usage-worth-it" style={PANEL}>
      <div style={PANEL_HEAD}>
        <span style={PANEL_TITLE}>Was the team worth it</span>
        <span data-testid="usage-worth-it-caption" style={PANEL_CAPTION}>estimate — the serial run never happened</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
        <Bar testId="usage-worth-actual" label="this team, measured" value={actual} color="var(--color-accent-400)" />
        <Bar testId="usage-worth-serial" label="same work run serially" value={serial} color="var(--color-accent-700)" />
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ width: '150px', flex: 'none', textAlign: 'right', fontSize: '11px', color: 'var(--color-neutral-400)' }}>
            cost of parallelism
          </span>
          <span style={{ flex: 1, minWidth: 0 }} />
          <span data-testid="usage-worth-ratio" style={{ width: '72px', flex: 'none', textAlign: 'right', fontSize: '11.5px', fontWeight: 500, color: 'var(--color-accent-400)' }}>
            {ratio === undefined ? EM_DASH : `${ratio.toFixed(2)}×`}
          </span>
        </div>
      </div>
      <div data-testid="usage-worth-note" style={PROSE}>
        {`Only the first bar is measured. The second assumes one agent on ${model} doing the same work: the same input and output tokens, but one cached context to write and re-read instead of one per teammate. That assumption is the whole estimate, and it cannot be checked — there is no serial run to compare against. What the premium buys is wall-clock time and independent review, not fewer tokens.`}
      </div>
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
  // The toggle itself belongs to the appearance store, which another owner is
  // adding it to. Absent reads as visible, which is the setting's default.
  // TODO(film): drop the cast once `showRateCard` lands on Settings.
  const showRateCard = (useAppearance() as Settings & { showRateCard?: boolean }).showRateCard !== false;
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
  const series = stackedSpend(spendSamples, agents);
  // A lone agent runs on one model, so the serial estimate is priced at the
  // lead's — the model that would have carried the work.
  const serialModel = (agents.find((a) => a.isLead) ?? agents[0])?.model ?? '';
  const serial = serialEstimate(agents, serialModel);

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

      <StackedSpendPanel series={series} agents={agents} now={now} />

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
          <DonutPanel models={models} />

          {showRateCard && <RateCardPanel models={models} />}

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

      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
        <ContextPressurePanel agents={agents} />
        <CoordinationPanel mail={state.mail} agents={agents} now={now} />
      </div>

      <WorthItPanel actual={totalCost} serial={serial} model={serialModel} />
    </div>
  );
}
