import type { CSSProperties } from 'react';
import type { Subagent } from '../../shared/domain';
import { resolveModel } from '../../shared/catalog';
import { subagentSpendUsd } from './usage-team';
import { contextBar, formatCost, formatElapsed, formatTokens } from '../format';

const TYPE_BADGE: CSSProperties = {
  border: '1px solid var(--color-neutral-800)',
  color: 'var(--color-neutral-600)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 5px',
  fontSize: '9.5px',
  flex: 'none',
};

const CALL_CELL_WIDTH = 340;
const TOKENS_CELL_WIDTH = 66;
const LANE_INDENT = 24;

// depth 1 / 2 / 3+ — bar height and opacity step down so nesting reads
// without colour coding.
function barStyle(depth: number): { height: string; opacity: number } {
  if (depth <= 1) return { height: '8px', opacity: 0.72 };
  if (depth === 2) return { height: '6px', opacity: 0.45 };
  return { height: '4px', opacity: 0.3 };
}

interface FlatRow {
  subagent: Subagent;
  depth: number;
}

function flatten(list: Subagent[]): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (items: Subagent[]) => {
    for (const s of items) {
      out.push({ subagent: s, depth: s.depth });
      walk(s.children);
    }
  };
  walk(list);
  return out;
}

// The contract carries only the summary text, not a token split for it — this
// is the standard ~4-chars-per-token estimate, the only figure available for
// what a subagent's result actually cost the parent's context.
function estimatedTokens(text: string | undefined): number {
  return text ? Math.ceil(text.length / 4) : 0;
}

export interface TraceProps {
  /** The roster agent whose subtree this draws — a solo session's own lead. */
  agent: string;
  subagents: Subagent[];
  now: number;
  selected: string | null;
  onSelect(toolUseId: string): void;
}

/**
 * One shared time axis, the parent turn as the top lane, one lane per
 * subagent underneath — nested at any depth, since the contract allows it,
 * even though nothing on a real machine nests past depth 1
 * (CONSOLE-NOTES.md §25). Every header-strip number is derived from the same
 * flattened list the lanes render from, so they cannot read differently.
 */
export function Trace({ agent, subagents, now, selected, onSelect }: TraceProps) {
  const flat = flatten(subagents);
  const maxDepth = flat.reduce((m, r) => Math.max(m, r.depth), 0);
  const tokensIn = flat.reduce((n, r) => n + (r.subagent.tokens ?? 0), 0);
  const shownToParent = flat.reduce((n, r) => n + estimatedTokens(r.subagent.returnedSummary), 0);
  // No per-call token split exists to price accurately — cache reads are the
  // dominant class in real usage (USAGE-STATE.md), so that rate is the closer
  // approximation of the two blunt instruments available.
  const spend = flat.reduce((n, r) => n + subagentSpendUsd(r.subagent), 0);
  const ratio = shownToParent > 0 ? Math.round(tokensIn / shownToParent) : null;

  const starts = flat.map((r) => r.subagent.queuedAt);
  const ends = flat.map((r) => r.subagent.returnedAt ?? now);
  const axisStart = starts.length > 0 ? Math.min(...starts) : now;
  const axisEnd = Math.max(now, ...ends, axisStart + 1);
  const span = axisEnd - axisStart;

  const selectedRow = selected ? flat.find((r) => r.subagent.toolUseId === selected) : undefined;

  return (
    <div data-testid="trace-view" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        data-testid="trace-header"
        style={{
          display: 'flex',
          gap: '18px',
          alignItems: 'center',
          padding: '10px 14px',
          borderBottom: '1px solid var(--color-neutral-900)',
          flex: 'none',
        }}
      >
        <Stat testid="trace-subagents" label="SUBAGENTS" value={String(flat.length)} />
        <Stat testid="trace-max-depth" label="MAX DEPTH" value={String(maxDepth)} />
        <Stat testid="trace-tokens-in" label="TOKENS IN SUBAGENTS" value={formatTokens(tokensIn)} />
        <Stat testid="trace-shown-to-parent" label="SHOWN TO PARENT" value={formatTokens(shownToParent)} />
        <Stat testid="trace-spend" label="SPEND" value={formatCost(spend)} />
        <span style={{ flex: 1 }} />
        {ratio !== null && (
          <span data-testid="trace-ratio" style={{ color: 'var(--color-neutral-600)', fontSize: '10.5px' }}>
            {`${formatTokens(tokensIn)} spent inside subagents against ${formatTokens(shownToParent)} that reached the parent — ${ratio}:1`}
          </span>
        )}
      </div>

      <div
        data-testid="trace-lanes"
        className="tscroll"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 0' }}
      >
        <Lane style={{ background: 'var(--color-accent-900)' }}>
          <div
            style={{
              width: `${CALL_CELL_WIDTH}px`,
              flex: 'none',
              padding: '0 10px',
              color: 'var(--color-text)',
              fontSize: '11px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {agent}
          </div>
          <div style={{ flex: 1, position: 'relative', height: '8px' }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'var(--color-accent-600)',
                borderRadius: '2px',
              }}
            />
          </div>
          <div style={{ width: `${TOKENS_CELL_WIDTH}px`, flex: 'none' }} />
        </Lane>

        {flat.map(({ subagent, depth }) => {
          const bar = barStyle(depth);
          const left = ((subagent.queuedAt - axisStart) / span) * 100;
          const width = Math.max(0.5, ((( subagent.returnedAt ?? now) - subagent.queuedAt) / span) * 100);
          return (
            <Lane
              key={subagent.toolUseId}
              testid="trace-lane"
              depth={depth}
              selected={selected === subagent.toolUseId}
              onClick={() => onSelect(subagent.toolUseId)}
            >
              <div
                style={{
                  width: `${CALL_CELL_WIDTH}px`,
                  flex: 'none',
                  paddingLeft: `${10 + (depth - 1) * LANE_INDENT}px`,
                  paddingRight: '10px',
                  display: 'flex',
                  gap: '6px',
                  alignItems: 'center',
                  overflow: 'hidden',
                }}
              >
                {depth > 1 && (
                  <span aria-hidden style={{ color: 'var(--color-neutral-700)', flex: 'none' }}>
                    └
                  </span>
                )}
                <span
                  data-testid="trace-lane-name"
                  style={{
                    color: 'var(--color-neutral-300)',
                    fontSize: '11px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {subagent.name ?? subagent.description ?? subagent.toolUseId}
                </span>
                {subagent.agentType && <span style={TYPE_BADGE}>{subagent.agentType}</span>}
                {subagent.model && (
                  <span style={{ color: 'var(--color-neutral-600)', fontSize: '10px', flex: 'none' }}>
                    {subagent.model}
                  </span>
                )}
                <span style={{ color: 'var(--color-neutral-600)', fontSize: '10px', flex: 'none' }}>
                  {subagent.state}
                </span>
              </div>
              <div style={{ flex: 1, position: 'relative', height: bar.height }}>
                <div
                  data-testid="trace-bar"
                  style={{
                    position: 'absolute',
                    left: `${left}%`,
                    width: `${width}%`,
                    height: bar.height,
                    opacity: bar.opacity,
                    background: 'var(--color-accent-500)',
                    borderRadius: '2px',
                  }}
                />
              </div>
              <div
                style={{
                  width: `${TOKENS_CELL_WIDTH}px`,
                  flex: 'none',
                  textAlign: 'right',
                  paddingRight: '10px',
                  color: 'var(--color-neutral-500)',
                  fontSize: '10.5px',
                }}
              >
                {subagent.tokens !== undefined ? formatTokens(subagent.tokens) : '—'}
              </div>
            </Lane>
          );
        })}
      </div>

      {selectedRow && <TraceDetail row={selectedRow} />}
    </div>
  );
}

function Stat({ testid, label, value }: { testid: string; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <span style={{ color: 'var(--color-neutral-600)', fontSize: '9.5px', letterSpacing: '.08em' }}>
        {label}
      </span>
      <span data-testid={testid} style={{ color: 'var(--color-text)', fontSize: '12.5px' }}>
        {value}
      </span>
    </div>
  );
}

function Lane({
  testid, depth, selected, onClick, style, children,
}: {
  testid?: string;
  depth?: number;
  selected?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testid}
      data-depth={depth}
      aria-selected={selected}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: '22px',
        cursor: onClick ? 'pointer' : undefined,
        background: selected ? 'var(--color-bg)' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function TraceDetail({ row }: { row: FlatRow }) {
  const { subagent } = row;
  const resolved = resolveModel(subagent.model);
  const words = subagent.returnedSummary ? subagent.returnedSummary.trim().split(/\s+/).length : 0;

  return (
    <div
      data-testid="trace-detail"
      style={{
        borderTop: '1px solid var(--color-neutral-900)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        flex: 'none',
      }}
    >
      <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
        <span data-testid="trace-detail-name" style={{ color: 'var(--color-text)', fontSize: '12.5px' }}>
          {subagent.name ?? subagent.description ?? subagent.toolUseId}
        </span>
        {subagent.agentType && <span style={TYPE_BADGE}>{subagent.agentType}</span>}
      </div>
      <div data-testid="trace-detail-meta" style={{ color: 'var(--color-neutral-500)', fontSize: '11px' }}>
        {`${subagent.model ?? '—'} · ${subagent.durationMs !== undefined ? formatElapsed(subagent.durationMs) : '—'} · ${
          subagent.toolCalls !== undefined ? subagent.toolCalls : '—'
        } tool calls · ${subagent.children.length} subagents`}
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
        <span style={{ color: 'var(--color-accent-500)', letterSpacing: '-.5px' }}>
          {contextBar(subagent.contextTokens ?? 0, resolved.window)}
        </span>
        <span style={{ color: 'var(--color-neutral-500)', fontSize: '10.5px' }}>
          {`${formatTokens(subagent.contextTokens ?? 0)} / ${formatTokens(resolved.window)}`}
        </span>
        <span style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}>discarded on return</span>
      </div>
      {subagent.returnedSummary && (
        <>
          <div data-testid="trace-detail-result" style={{ display: 'flex', gap: '7px', alignItems: 'baseline' }}>
            <span style={{ color: 'var(--color-accent-500)' }}>⎿</span>
            <span style={{ color: 'var(--color-neutral-300)', fontSize: '11px' }}>{subagent.returnedSummary}</span>
          </div>
          <div data-testid="trace-detail-caption" style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}>
            {`${words} word${words === 1 ? '' : 's'} returned against ${
              subagent.tokens !== undefined ? formatTokens(subagent.tokens) : '—'
            } spent`}
          </div>
        </>
      )}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <button
          type="button"
          className="btn-neutral"
          data-testid="trace-open-transcript"
          style={{
            border: '1px solid var(--color-neutral-800)',
            color: 'var(--color-neutral-500)',
            borderRadius: 'var(--radius-sm)',
            padding: '1px 7px',
            fontSize: '10px',
          }}
        >
          open transcript
        </button>
        {subagent.agentId && (
          <span data-testid="trace-jsonl" style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}>
            {`agent-${subagent.agentId}.jsonl`}
          </span>
        )}
      </div>
    </div>
  );
}
