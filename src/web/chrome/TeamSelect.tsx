import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { TeamSummary, TeamsResponse } from '../../shared/domain';
import { AGENT_STATUS } from '../../shared/status';
import { postJson } from '../api';
import { formatElapsed } from '../format';

// Derived, not chosen: 2 border + 12 padding + 120.03 ("session-" + 8 hex at the
// bar's 12.5px) + 6 gap + 6 caret. Fixed so a longer team name ellipsizes instead
// of shoving the view switcher sideways on the operator's own click.
const TRIGGER_WIDTH = '146px';

// The Rail's own left-list width, which the two-line rows were measured against.
const PANEL_WIDTH = '348px';

type Mark =
  | { kind: 'switching'; team: string }
  | { kind: 'failed'; team: string }
  | { kind: 'gone'; team: string };

const MARK_TEXT = { switching: 'switching…', failed: 'switch failed', gone: 'gone' };
const MARK_COLOR = {
  switching: 'var(--color-accent-300)',
  failed: 'var(--failure-rose)',
  gone: 'var(--failure-rose)',
};

function metaLine(team: TeamSummary, now: number): string {
  const members = `${team.members} member${team.members === 1 ? '' : 's'}`;
  // The age only earns its place on a finished team: on a live one it would tick
  // every second and say nothing the word `live` has not.
  return team.live
    ? `live · ${members}`
    : `finished · ${members} · ${formatElapsed(now - team.lastActivityAt)} ago`;
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

  const rows = teams ?? [];
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
      style={{ position: 'relative', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}
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
          gap: 6,
          width: TRIGGER_WIDTH,
          flex: 'none',
          padding: '1px 6px',
          margin: '0 -6px',
          border: '1px solid transparent',
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
        <span aria-hidden="true" style={{ color: 'var(--color-neutral-600)', fontSize: 10 }}>
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
            background: 'var(--color-surface)',
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
            <span>{`TEAMS · ${rows.length}`}</span>
            <span>click to switch</span>
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
                      style={{
                        fontSize: '10px',
                        color: team.live ? 'var(--color-accent-400)' : 'var(--color-neutral-600)',
                      }}
                    >
                      {team.live ? AGENT_STATUS.working.glyph : AGENT_STATUS.departed.glyph}
                    </span>
                    <span style={{ color: 'var(--color-text)' }}>{team.name}</span>
                    <span style={{ flex: 1 }} />
                    {rowMark && (
                      <span
                        data-testid="team-mark"
                        style={{
                          fontSize: '10.5px',
                          color:
                            rowMark === 'current'
                              ? 'var(--color-neutral-700)'
                              : MARK_COLOR[rowMark],
                        }}
                      >
                        {rowMark === 'current' ? 'current' : MARK_TEXT[rowMark]}
                      </span>
                    )}
                  </div>
                  <div
                    data-testid="team-meta"
                    style={{ color: 'var(--color-neutral-600)', fontSize: '10.5px' }}
                  >
                    {metaLine(team, now)}
                  </div>
                </div>
              );
            })}

            {rows.length === 0 && (
              <div
                style={{
                  padding: '6px 10px 4px',
                  fontSize: '11px',
                  color: unreadable && !loading ? 'var(--failure-rose)' : 'var(--color-neutral-700)',
                }}
              >
                {loading ? 'reading teams…' : unreadable ? 'could not read teams' : 'no teams found'}
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
