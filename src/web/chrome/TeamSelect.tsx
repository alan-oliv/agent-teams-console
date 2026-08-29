import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { TeamSummary, TeamsResponse } from '../../shared/domain';
import { postJson } from '../api';
import { formatElapsed } from '../format';

// Derived, not chosen: 2 border + 12 padding + 120.03 ("session-" + 8 hex at the
// bar's 12.5px) + 6 gap + 6 caret. Fixed so a longer team name ellipsizes instead
// of shoving the view switcher sideways on the operator's own click.
const TRIGGER_WIDTH = '146px';

const PANEL_WIDTH = '432px';

// `●` live / `○` idle / `✓` ended, per the handoff.
const STATE_GLYPH = { live: '\u25cf', idle: '\u25cb', done: '\u2713' } as const;
const STATE_COLOR = {
  live: 'var(--color-accent-400)',
  idle: 'var(--color-neutral-600)',
  done: 'var(--color-neutral-700)',
} as const;

type Mark =
  | { kind: 'switching'; team: string }
  | { kind: 'failed'; team: string }
  | { kind: 'gone'; team: string };

const MARK_TEXT = { switching: 'switching…', failed: 'switch failed', gone: 'gone' };
const MARK_COLOR = {
  switching: 'var(--color-accent-300)',
  failed: 'var(--fail)',
  gone: 'var(--fail)',
};

// The age only earns its place on a finished team: on a live one it would tick
// every second and say nothing the word `live` has not.
function stateText(team: TeamSummary, now: number): string {
  const state = team.state ?? (team.live ? 'live' : 'done');
  if (state === 'live') return 'live';
  if (state === 'idle') return 'idle';
  return `ended ${formatElapsed(now - team.lastActivityAt)} ago`;
}

function agentCount(team: TeamSummary): string {
  return `${team.members} agent${team.members === 1 ? '' : 's'}`;
}

export interface TeamSelectProps {
  /** The team the snapshot says is on screen — the only honest `current`. */
  current: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  now: number;
}

export function TeamSelect({ current, open, onOpenChange, now }: TeamSelectProps) {
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [mark, setMark] = useState<Mark | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  // Fetched on open, never cached at mount: a team's member count changes under
  // the console, and a listed team can be gone by the time it is clicked.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setUnreadable(false);
    fetch('/api/teams')
      .then((res) => (res.ok ? (res.json() as Promise<TeamsResponse>) : Promise.reject(res.status)))
      .then((payload) => {
        if (!live) return;
        setTeams(payload.teams);
        setCursor(Math.max(0, payload.teams.findIndex((t) => t.name === current)));
        setLoading(false);
      })
      .catch(() => {
        if (!live) return;
        setUnreadable(true);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [open]);

  function close() {
    setMark(null);
    onOpenChange(false);
    trigger.current?.focus();
  }

  // The 200 is an ack, not a repaint: the switch has landed when the snapshot
  // says so, up to one coalescing window later.
  useEffect(() => {
    if (mark?.kind === 'switching' && mark.team === current) close();
  }, [current, mark]);

  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // pointerdown, not click, so dismissal beats the focus move.
    function onPointerDown(e: PointerEvent) {
      if (!wrapper.current?.contains(e.target as Node)) close();
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, onOpenChange]);

  function select(name: string) {
    if (mark?.kind === 'switching') return;
    if (name === current) {
      close();
      return;
    }
    setMark({ kind: 'switching', team: name });
    postJson(`/api/teams/${encodeURIComponent(name)}/select`)
      .then((res) => {
        if (res.ok) return;
        setMark({ kind: res.status === 404 ? 'gone' : 'failed', team: name });
      })
      .catch(() => setMark({ kind: 'failed', team: name }));
  }

  // A finished team is history, not a session on this machine: listing one kept
  // offering a conversation that had ended hours earlier under a heading that
  // claims otherwise. The team being VIEWED stays listed even once it ends —
  // dropping the row you are looking at would leave the picker contradicting
  // the wall behind it.
  const rows = (teams ?? []).filter((t) => t.state !== 'done' || t.current);
  const cursorTeam = rows[Math.min(cursor, rows.length - 1)];

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(rows.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cursorTeam) select(cursorTeam.name);
    } else if (e.key === 'Escape') {
      // preventDefault is what stops the global handler interrupting an agent.
      e.preventDefault();
      close();
    }
  }

  return (
    <div
      ref={wrapper}
      style={{
        position: 'relative',
        alignSelf: 'stretch',
        display: 'flex',
        alignItems: 'center',
        flex: 'none',
      }}
    >
      <button
        ref={trigger}
        className="team-trigger"
        data-testid="team-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="team-list"
        aria-labelledby="team-wordmark team-trigger-name"
        onClick={() => (open ? close() : onOpenChange(true))}
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 7,
          width: TRIGGER_WIDTH,
          flex: 'none',
          whiteSpace: 'nowrap',
          padding: '3px 8px',
          margin: '-3px 0',
          border: '1px solid var(--color-neutral-800)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <span
          id="team-trigger-name"
          style={{
            color: 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {current}
        </span>
        <span aria-hidden="true" style={{ color: 'var(--color-accent-400)', fontSize: 10 }}>
          ▾
        </span>
      </button>

      {open && (
        <div
          id="team-list"
          data-testid="team-list"
          ref={list}
          role="listbox"
          aria-label="teams"
          aria-busy={mark?.kind === 'switching'}
          aria-activedescendant={cursorTeam ? `team-option-${cursorTeam.name}` : undefined}
          tabIndex={0}
          onKeyDown={onListKeyDown}
          style={{
            position: 'absolute',
            // The bar's own 9px padding, so the panel lands on its bottom border.
            top: 'calc(100% + 9px)',
            left: 0,
            zIndex: 10,
            width: PANEL_WIDTH,
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            outline: 'none',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '10px 14px 8px',
              color: 'var(--color-neutral-600)',
              fontSize: '10.5px',
              letterSpacing: '.12em',
            }}
          >
            <span>{`SESSIONS ON THIS MACHINE \u00b7 ${rows.length}`}</span>
          </div>

          <div
            style={{
              maxHeight: '320px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              padding: '0 8px 8px',
            }}
          >
            {rows.map((team) => {
              const isCurrent = team.name === current;
              const rowMark = mark?.team === team.name ? mark.kind : isCurrent ? 'current' : null;
              const state = team.state ?? (team.live ? 'live' : 'done');
              return (
                <div
                  key={team.name}
                  id={`team-option-${team.name}`}
                  role="option"
                  aria-selected={isCurrent}
                  onClick={() => select(team.name)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '3px',
                    background: isCurrent ? 'var(--color-bg)' : 'transparent',
                    borderLeft: `2px solid ${isCurrent ? 'var(--color-accent-600)' : 'transparent'}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                    <span
                      aria-hidden="true"
                      style={{ fontSize: '10px', color: STATE_COLOR[state] }}
                    >
                      {STATE_GLYPH[state]}
                    </span>
                    <span style={{ color: 'var(--color-text)', flex: 'none' }}>{team.name}</span>
                    {team.branch && (
                      <span
                        data-testid="team-branch"
                        style={{
                          color: 'var(--color-neutral-700)',
                          fontSize: '10.5px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {team.branch}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    {rowMark && (
                      <span
                        data-testid="team-mark"
                        style={{
                          fontSize: '10.5px',
                          flex: 'none',
                          color:
                            rowMark === 'current'
                              ? 'var(--color-accent-400)'
                              : MARK_COLOR[rowMark],
                        }}
                      >
                        {rowMark === 'current' ? '\u2713' : MARK_TEXT[rowMark]}
                      </span>
                    )}
                  </div>
                  <div
                    data-testid="team-meta"
                    style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}
                  >
                    <span
                      style={{
                        color: 'var(--color-neutral-500)',
                        fontSize: '10.5px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {team.goal ?? ''}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span
                      style={{
                        color: 'var(--color-neutral-700)',
                        fontSize: '10px',
                        whiteSpace: 'nowrap',
                        flex: 'none',
                      }}
                    >
                      {agentCount(team)}
                    </span>
                    <span
                      style={{
                        color: 'var(--color-neutral-600)',
                        fontSize: '10px',
                        whiteSpace: 'nowrap',
                        flex: 'none',
                      }}
                    >
                      {stateText(team, now)}
                    </span>
                  </div>
                </div>
              );
            })}

            {rows.length === 0 && (
              <div
                style={{
                  padding: '6px 10px 4px',
                  fontSize: '11px',
                  color: unreadable && !loading ? 'var(--fail)' : 'var(--color-neutral-700)',
                }}
              >
                {loading
                  ? 'reading teams…'
                  : unreadable
                    ? 'could not read teams'
                    : 'no live teams'}
              </div>
            )}
          </div>

          <div
            style={{
              padding: '9px 16px',
              borderTop: '1px solid var(--color-neutral-900)',
              color: 'var(--color-neutral-700)',
              fontSize: '10.5px',
            }}
          >
            ↑↓ select · ⏎ switch · esc close
          </div>
        </div>
      )}
    </div>
  );
}
