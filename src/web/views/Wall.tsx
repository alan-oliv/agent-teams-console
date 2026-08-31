import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { Agent, Subagent, SubagentTree } from '../../shared/domain';
import { wallOrder } from '../../shared/roster';
import { AGENT_STATUS, DORMANT_OPACITY, isDormant } from '../../shared/status';
import { Composer, RosterContext } from '../components/Composer';
import { Elapsed, NowContext } from '../components/Elapsed';
import { Portrait } from '../components/Portrait';
import { StatusGlyph } from '../components/StatusGlyph';
import { StopControlButton } from '../components/StopButton';
import { TranscriptFeed } from '../components/TranscriptFeed';
import { compactionNote, contextBar, costLabel, ctxLabel, pctLabel, warnMark } from '../format';
import { useCast } from '../state/useCast';
import { COLUMN_WIDTH } from '../state/useTeamState';

// Matches the --terminal-ground token (theme.css); kept literal so the tint
// toggle below reads back as a resolved rgb() in jsdom, not a var() string.
const GROUND = 'var(--term)';

const HEADER: CSSProperties = {
  padding: '9px 12px 8px',
  background: 'var(--color-bg)',
  borderBottom: '1px solid var(--color-neutral-900)',
  display: 'flex',
  gap: '11px',
  alignItems: 'flex-start',
};

const LINE: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: '7px' };

// Memoised so an SSE frame only re-renders the columns whose agent actually moved.
// Every prop must be stable across frames for that to hold: `isTinted` is passed
// precomputed rather than the hovered name, and the handlers are hoisted callbacks.
/**
 * Messages written into this agent's inbox that it has not pulled into its
 * context window yet. Not a notification count: the agent takes them at its
 * next turn boundary, so a non-zero badge on a busy agent is normal and only
 * means "sent, not yet seen".
 *
 * There is no external way to force that boundary, so this does not offer to
 * drain — a "drain now" control would be a lie about what the runtime exposes.
 * It DOES open the messages, which is a different thing: the count was
 * previously the only evidence they existed, so the operator could see that
 * four things were queued and had no way to find out what they were. Comms
 * already renders them, including protocol frames like a shutdown request.
 */
function InFlight({ agent, onOpen }: { agent: Agent; onOpen?: (name: string) => void }) {
  if (agent.unread === 0) return null;
  return (
    <button
      type="button"
      data-testid="in-flight"
      title="written to this inbox · read at its next turn boundary"
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.(agent.name);
      }}
      style={{
        background: 'transparent',
        cursor: onOpen ? 'pointer' : 'default',
        display: 'flex',
        alignItems: 'baseline',
        gap: '4px',
        padding: '0 5px',
        borderRadius: '8px',
        border: '1px solid var(--warn-edge)',
        color: 'var(--warn)',
        fontSize: '9.5px',
        whiteSpace: 'nowrap',
        flex: 'none',
      }}
    >
      {`${agent.unread} in flight`}
    </button>
  );
}

const Column = memo(function Column({
  agent, isFocused, isTinted, isDragging, width, readOnly, teamLive, routed,
  onFocus, onHoverEnter, onHoverLeave, onGrip, onGripReset, onOpenMail, subagents,
}: {
  agent: Agent;
  isFocused: boolean;
  isTinted: boolean;
  isDragging: boolean;
  /**
   * The operator's width, and only the operator's: focus never touches it.
   *
   * The design README asks for "a click-to-focus that widens a column", but the
   * design's own prototype resolved that in favour of the grip — its column is
   * `widths[name] || 366` and its click handler only sets the selection, with
   * the same 7px grip, the same 232..720 clamp and the same 366 reset this wall
   * has. Widening on focus would put two mechanisms on one property: focus is
   * shared state, set by h/l and ↑/↓ as well as by `?agent=` and by clicking
   * through from another view, so a keyboard scan would resize every column it
   * passed and overwrite a width that is persisted per agent. Focus already
   * reads three ways — the accent inset, the tint, and aria-current.
   */
  width: number;
  readOnly: boolean;
  teamLive: boolean;
  /**
   * Present on the LEAD's column only, which is the one that carries the
   * console's single composer. Every other column is read-only: a composer per
   * column implied a channel this model does not have, since every send is a
   * direct inbox write addressed by the chip rather than by where you typed.
   */
  routed: boolean;
  onFocus: (name: string) => void;
  onHoverEnter: (name: string) => void;
  onHoverLeave: (name: string) => void;
  onGrip: (name: string, e: ReactMouseEvent) => void;
  onGripReset: (name: string) => void;
  /** Opens this agent's queued messages in comms. Absent leaves the badge inert. */
  onOpenMail?: (name: string) => void;
  /** This agent's own Task/Agent dispatches, in spawn order. */
  subagents?: Subagent[];
}) {
  const status = AGENT_STATUS[agent.status];
  const isLeadColumn = agent.isLead;
  const compaction = compactionNote(agent.contextTokens, agent.contextLimit, agent.compactAt);

  // Display only: focus, drag, mail and every route below still carry the real
  // name, which is the join key across the frame, the URL and the API.
  const display = useCast().asChar(agent.name).display;

  const shadows: string[] = [];
  if (isLeadColumn) shadows.push('1px 0 0 var(--color-neutral-800)', '8px 0 18px rgba(0,0,0,.5)');
  if (isFocused) shadows.push('inset 0 2px 0 var(--color-accent-600)');

  const column: CSSProperties = {
    flex: 'none',
    width: `${width}px`,
    position: 'relative',
    background: isTinted ? 'var(--color-bg)' : GROUND,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    cursor: 'pointer',
    opacity: isDormant(agent.status) ? DORMANT_OPACITY : 1,
    ...(shadows.length ? { boxShadow: shadows.join(',') } : {}),
    ...(isLeadColumn ? { position: 'sticky' as const, left: 0, zIndex: 2 } : {}),
  };

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onFocus(agent.name);
    }
  }

  return (
    <div
      data-testid="wall-column"
      data-agent={agent.name}
      role="button"
      tabIndex={0}
      aria-current={isFocused}
      style={column}
      onClick={() => onFocus(agent.name)}
      onKeyDown={onKeyDown}
      onMouseEnter={() => onHoverEnter(agent.name)}
      onMouseLeave={() => onHoverLeave(agent.name)}
    >
      <div style={HEADER}>
        <Portrait agent={agent} slot="wall" />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <div style={LINE}>
            <StatusGlyph status={agent.status} size={11} />
            <span
              data-testid="wall-name"
              // Hyphenated content wraps at the hyphen by default, and at the
              // 232px floor that balloons this line to several physical ones
              // and misaligns the header against its neighbours. The name is
              // what gives — identity truncating reads better than the type
              // or model vanishing — so it alone gets ellipsis; minWidth 0 is
              // what lets a flex child shrink past its own content at all.
              style={{
                color: 'var(--color-text)',
                fontWeight: 500,
                fontSize: '13px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                minWidth: 0,
              }}
            >
              {display}
            </span>
            {agent.agentType && (
              <span
                data-testid="wall-type"
                style={{
                  border: '1px solid var(--color-neutral-800)',
                  color: 'var(--color-neutral-500)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0 5px',
                  fontSize: '9.5px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {agent.agentType}
              </span>
            )}
            <span style={{ flex: 1 }} />
            <span
              data-testid="wall-model"
              style={{
                color: 'var(--color-neutral-600)',
                fontSize: '10.5px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {agent.model}
            </span>
          </div>

          <div style={LINE}>
            <span style={{ fontSize: '11px', color: status.color }}>{status.label}</span>
            <span
              data-testid="wall-role"
              style={{
                color: 'var(--color-neutral-600)',
                fontSize: '11px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {agent.role}
            </span>
            <span style={{ flex: 1 }} />
            <span
              data-testid="wall-elapsed"
              style={{
                color: 'var(--color-neutral-600)',
                fontSize: '10.5px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <Elapsed startedAt={agent.startedAt} />
            </span>
            <InFlight agent={agent} onOpen={onOpenMail} />
            <StopControlButton agent={agent} />
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span
              data-testid="wall-bar"
              style={{ letterSpacing: '-.5px', color: 'var(--color-accent-600)', fontSize: '11.5px' }}
            >
              {contextBar(agent.contextTokens, agent.contextLimit)}
            </span>
            <span
              data-testid="wall-pct"
              style={{ color: 'var(--color-neutral-500)', fontSize: '10.5px' }}
            >
              {pctLabel(agent.contextTokens, agent.contextLimit)}
            </span>
            <span
              data-testid="wall-warn"
              style={{ color: 'var(--warn)', fontSize: '10.5px', width: '7px' }}
            >
              {warnMark(agent.contextTokens, agent.contextLimit)}
            </span>
            <span
              data-testid="wall-ctx"
              style={{ color: 'var(--color-neutral-600)', fontSize: '10.5px' }}
            >
              {ctxLabel(agent.contextTokens, agent.contextLimit)}
            </span>
            <span style={{ flex: 1 }} />
            <span
              data-testid="wall-cost"
              style={{ color: 'var(--color-neutral-600)', fontSize: '10.5px' }}
            >
              {costLabel(agent.costUsd)}
            </span>
          </div>

          {/*
            The other half of the design's context warning, and the only header
            row that is conditional. It cannot join the meter above it: the bar,
            percent, token pair and cost already leave barely 30px spare in a
            default 366px column, so the note would wrap that row onto a second
            line — and the column drags down to COLUMN_MIN. On its own row it
            fits at every width, and ellipsises rather than wrapping if it ever
            does not.
          */}
          {compaction && (
            <div
              data-testid="wall-compaction"
              title={compaction}
              style={{
                color: 'var(--warn)',
                fontSize: '10.5px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {compaction}
            </div>
          )}
        </div>
      </div>

      <TranscriptFeed
        lines={agent.transcript}
        size="wall"
        agent={agent.name}
        working={agent.status === 'working'}
        subagents={subagents}
      />

      <div
        data-testid="wall-current-tool"
        style={{
          borderTop: '1px solid var(--color-neutral-900)',
          padding: '7px 12px',
          color: 'var(--color-neutral-600)',
          fontSize: '10.5px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {agent.currentTool ?? ''}
      </div>

      {/* The console has one composer and it is the lead's, so every other
          column says so — an absent composer on its own reads as a column that
          somehow carries less, rather than as the routing rule it is. */}
      {routed ? (
        <Composer
          agent={agent}
          routed
          variant="wall"
          readOnly={readOnly}
          teamLive={teamLive}
        />
      ) : (
        <div
          data-testid="wall-read-only"
          title="one composer, in the lead's column · @ addresses any teammate"
          style={{
            borderTop: '1px solid var(--color-neutral-900)',
            padding: '8px 12px',
            color: 'var(--color-neutral-600)',
            fontSize: '10.5px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          read-only
        </div>
      )}

      <div
        data-testid="wall-grip"
        data-agent={agent.name}
        title="drag to resize · double-click to reset"
        onMouseDown={(e) => onGrip(agent.name, e)}
        onDoubleClick={() => onGripReset(agent.name)}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 0,
          right: -3,
          width: 7,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 4,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            width: 1,
            height: '100%',
            background: isDragging ? 'var(--color-accent-500)' : 'transparent',
          }}
        />
      </div>
    </div>
  );
});

export function Wall({
  agents, focused, revealAlso = null, onFocus, now, readOnly = false, widths = {}, onWidthChange,
  onOpenMail, subagents,
}: {
  agents: Agent[];
  focused: string | null;
  /** A second column (e.g. a comms pair's other half) to bring into view alongside `focused`. */
  revealAlso?: string | null;
  onFocus: (name: string) => void;
  /** Jumps to this agent's queued messages. The badge is a readout otherwise. */
  onOpenMail?: (name: string) => void;
  now: number;
  readOnly?: boolean;
  widths?: Readonly<Record<string, number>>;
  onWidthChange?: (name: string, px: number | null) => void;
  /** Every roster agent's Task/Agent dispatches, keyed by dispatcher name. */
  subagents?: SubagentTree;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  // Read through a ref so the mousemove listener never needs rebinding mid-drag.
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  const onGrip = useCallback(
    (name: string, e: ReactMouseEvent) => {
      if (!onWidthChange) return;
      // The grip sits inside the column, which focuses the agent on click.
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = widthsRef.current[name] ?? COLUMN_WIDTH;
      const move = (ev: MouseEvent) => onWidthChange(name, startWidth + ev.clientX - startX);
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
        setDragging(null);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      // Held on the body so the cursor survives the pointer leaving the 7px strip.
      document.body.style.cursor = 'col-resize';
      setDragging(name);
    },
    [onWidthChange],
  );

  const onGripReset = useCallback(
    (name: string) => onWidthChange?.(name, null),
    [onWidthChange],
  );

  const onHoverEnter = useCallback((name: string) => setHovered(name), []);
  const onHoverLeave = useCallback(
    (name: string) => setHovered((h) => (h === name ? null : h)),
    [],
  );
  // Live first: the columns are ~366px in a scroller that runs past 5000px on a
  // real team, so anything ordered after a finished teammate is off-screen.
  //
  // Ordered, never dropped. The design README asks for idle rows to collapse 30s
  // after the whole team goes idle, but its prototype has no such timer — the
  // only trace is a line of copy inside a mocked transcript — and the rule as
  // written empties the wall exactly when the team is idle, taking the lead
  // column's composer, the console's only send control, off screen at the moment
  // the operator wants to wake someone. The wall is also where a finished run is
  // read back. Dimming is the reversible form of the same idea and the one this
  // console took (DORMANT_OPACITY). The `N idle agents` chip from the same
  // paragraph IS built — in the footer panel, where the prototype puts it too.
  const ordered = wallOrder(agents);

  // A teammate drains its own inbox; the LEAD's is drained by the team loop,
  // which stops with the last teammate. The composer says so rather than
  // queueing in silence.
  const teamLive = agents.some((a) => !a.isLead && a.status !== 'departed');

  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focused) return;
    // Matched by dataset rather than a selector: an agent name is an arbitrary
    // string, so building one would need escaping to stay correct.
    const children = [...(scroller.current?.children ?? [])] as HTMLElement[];
    const column = children.find((el) => el.dataset.agent === focused);
    const alsoColumn = revealAlso ? children.find((el) => el.dataset.agent === revealAlso) : undefined;
    // The other pair member first, `nearest`: if both columns already fit the
    // viewport, `focused`'s own nearest-scroll below then finds it already
    // visible and does nothing, leaving both on screen. If they don't fit,
    // `focused` wins — the deliberate fallback.
    alsoColumn?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    // `?agent=` and ↑↓ both set focus on a column the viewport may be thousands
    // of pixels away from; without this the deep link looks like it did nothing.
    column?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [focused, revealAlso]);

  return (
    <div
      ref={scroller}
      className="hscroll"
      data-testid="wall"
      style={{
        flex: 1,
        display: 'flex',
        minHeight: 0,
        gap: '1px',
        background: 'var(--color-neutral-900)',
      }}
    >
      <RosterContext value={agents}>
      <NowContext value={now}>
        {ordered.map((agent) => (
          <Column
            key={agent.name}
            agent={agent}
            isFocused={agent.name === focused}
            isTinted={agent.name === focused || hovered === agent.name}
            isDragging={dragging === agent.name}
            width={widths[agent.name] ?? COLUMN_WIDTH}
            readOnly={readOnly}
            teamLive={teamLive}
            routed={agent.isLead}
            onFocus={onFocus}
            onOpenMail={onOpenMail}
            onHoverEnter={onHoverEnter}
            onHoverLeave={onHoverLeave}
            onGrip={onGrip}
            onGripReset={onGripReset}
            subagents={subagents?.[agent.name]}
          />
        ))}
      </NowContext>
      </RosterContext>
    </div>
  );
}
