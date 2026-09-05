import { memo, useState } from 'react';
import type { Agent, SubagentTree, ViewId } from '../../shared/domain';
import { flattenSubagents } from '../../shared/subagents';
import { StatusGlyph } from '../components/StatusGlyph';
import { formatPct, formatTokens } from '../format';
import { useCast } from '../state/useCast';
import { soloViews } from '../state/useTeamState';

const IDLE_COLLAPSE_AT = 3;
const LEGEND = '↑↓ select · ⏎ open · esc interrupt · x stop · ⌃T tasks · t teams';

// The dock is mounted in every view, so it renders on every SSE frame and every clock
// tick. Memoised so only the chips whose agent actually moved re-render; the click
// handler is built here rather than passed down as an inline arrow, which would make
// memo miss with no visible symptom.
const Chip = memo(function Chip({
  agent, isFocused, onFocus,
}: {
  agent: Agent;
  isFocused: boolean;
  onFocus: (name: string) => void;
}) {
  // Display only — the chip focuses on the real name, which is what the URL
  // and the rail both key on.
  const display = useCast().asChar(agent.name).display;

  return (
    <button
      type="button"
      className="chip"
      data-testid="agent-chip"
      aria-pressed={isFocused}
      onClick={() => onFocus(agent.name)}
      style={{
        border: '1px solid var(--color-neutral-900)',
        borderRadius: 'var(--radius-sm)',
        padding: '2px 7px',
        display: 'flex',
        gap: 5,
        alignItems: 'baseline',
        whiteSpace: 'nowrap',
        // The row this sits in is overflow:hidden with no wrap, so a chip that
        // does not fit is at the row's mercy, not its own — without a real
        // minWidth a flex item never shrinks past its own content, and the
        // row slices whatever is left mid-glyph instead. 56px keeps the glyph
        // and a percent legible even once the name has nothing left to give.
        minWidth: 56,
      }}
    >
      <StatusGlyph status={agent.status} size={10} />
      <span
        style={{
          color: 'var(--color-neutral-400)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {display}
      </span>
      <span style={{ color: 'var(--color-neutral-600)', flexShrink: 0 }}>
        {formatPct(agent.contextTokens / agent.contextLimit)}
      </span>
    </button>
  );
});

export interface PanelProps {
  agents: Agent[];
  focusedAgent: string | null;
  onFocusAgent(name: string): void;
}

export function Panel({ agents, focusedAgent, onFocusAgent }: PanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [departedExpanded, setDepartedExpanded] = useState(false);

  // Departed agents are gone for good, so they never occupy an addressable
  // chip — they only ever appear collapsed, unlike idle which needs >3 first.
  const live = agents.filter((a) => a.status !== 'departed');
  const departed = agents.filter((a) => a.status === 'departed');

  const idle = live.filter((a) => a.status === 'idle');
  // Only the surplus past the first three collapses — those three stay
  // addressable as chips like any other agent.
  const idleSurplus = expanded ? [] : idle.slice(IDLE_COLLAPSE_AT);
  const collapsed = idleSurplus.length > 0;
  const { asChar } = useCast();
  const shown = collapsed ? live.filter((a) => !idleSurplus.includes(a)) : live;

  return (
    <div
      style={{
        borderTop: '1px solid var(--color-neutral-900)',
        background: 'var(--term)',
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 10.5,
      }}
    >
      <span style={{ color: 'var(--color-neutral-600)', letterSpacing: '.12em' }}>PANEL</span>
      <div style={{ display: 'flex', gap: 6, flex: 1, overflow: 'hidden' }}>
        {shown.map((a) => (
          <Chip
            key={a.name}
            agent={a}
            isFocused={a.name === focusedAgent}
            onFocus={onFocusAgent}
          />
        ))}
        {collapsed && (
          <button
            type="button"
            className="chip"
            data-testid="idle-chip"
            onClick={() => setExpanded(true)}
            style={{
              border: '1px dashed var(--color-neutral-800)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 7px',
              color: 'var(--color-neutral-600)',
              whiteSpace: 'nowrap',
            }}
          >
            {idleSurplus.length === 1 ? '1 idle agent' : `${idleSurplus.length} idle agents`}
          </button>
        )}
        {departed.length > 0 && (
          <button
            type="button"
            className="chip"
            data-testid="departed-chip"
            onClick={() => setDepartedExpanded((e) => !e)}
            style={{
              border: '1px dashed var(--color-neutral-800)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 7px',
              color: 'var(--color-neutral-600)',
              whiteSpace: 'nowrap',
            }}
          >
            {`${departed.length} departed`}
          </button>
        )}
        {departedExpanded &&
          departed.map((a) => (
            <span
              key={a.name}
              data-testid="departed-name"
              style={{ color: 'var(--color-neutral-800)', whiteSpace: 'nowrap' }}
            >
              {asChar(a.name).display}
            </span>
          ))}
      </div>
      <span style={{ color: 'var(--color-neutral-600)', whiteSpace: 'nowrap' }}>{LEGEND}</span>
    </div>
  );
}

/**
 * The solo session's footer, off the canvas's stream mock (§8): the view
 * switcher again on the left — `view  stream · trace` — and the tree's whole
 * figure on the right. It replaces PANEL, whose chips list a roster this
 * session does not have. The mock's key legend is cropped at `esc interrupts
 * th…`; `the turn` is the reconstruction, marked as such in the decisions file.
 */
export function SoloFooter({ view, onViewChange, hasSubagents, subagents }: {
  view: ViewId;
  onViewChange(view: ViewId): void;
  hasSubagents: boolean;
  subagents: SubagentTree;
}) {
  const all = Object.values(subagents).flatMap(flattenSubagents);
  // Absent means not-yet-landed, not zero — the same rule the status bar sums by.
  const tokens = all.reduce((n, s) => n + (s.tokens ?? 0), 0);

  return (
    <div
      style={{
        borderTop: '1px solid var(--color-neutral-900)',
        background: 'var(--term)',
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 10.5,
      }}
    >
      <span style={{ color: 'var(--color-neutral-600)' }}>view</span>
      <div role="tablist" style={{ display: 'flex', gap: 2 }}>
        {soloViews(hasSubagents).map((id) => (
          <button
            key={id}
            className="tab"
            type="button"
            role="tab"
            aria-selected={id === view}
            onClick={() => onViewChange(id)}
            style={{
              padding: '1px 9px',
              fontSize: 11.5,
              whiteSpace: 'nowrap',
              borderRadius: 'var(--radius-sm)',
              color: id === view ? 'var(--color-text)' : 'var(--color-neutral-600)',
              background: id === view ? 'var(--color-accent-900)' : 'transparent',
              boxShadow: id === view ? 'inset 0 0 0 1px var(--color-accent-700)' : 'none',
            }}
          >
            {id === 'wall' ? 'stream' : id}
          </button>
        ))}
      </div>
      <span style={{ flex: 1 }} />
      {all.length > 0 && (
        <span data-testid="solo-footer-subagents" style={{ color: 'var(--color-neutral-500)', whiteSpace: 'nowrap' }}>
          {`${all.length} subagent${all.length === 1 ? '' : 's'} · ${formatTokens(tokens)}`}
        </span>
      )}
      <span style={{ color: 'var(--color-neutral-600)', whiteSpace: 'nowrap' }}>esc interrupts the turn</span>
    </div>
  );
}
