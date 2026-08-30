import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { TeamSummary, TeamsResponse } from '../../shared/domain';
import { postJson } from '../api';
import { formatElapsed } from '../format';
import { useWatch } from '../state/useWatch';

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

function matchesQuery(team: TeamSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [team.name, team.goal, team.branch].some((field) => field?.toLowerCase().includes(q));
}

export interface TeamSelectProps {
  /** The team the snapshot says is on screen — the only honest `current`. */
  current: string;
  /** What the operator called this session. Falls back to `current` when unnamed. */
  sessionName?: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  now: number;
}

export function TeamSelect({ current, sessionName, open, onOpenChange, now }: TeamSelectProps) {
  const watch = useWatch();
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [mark, setMark] = useState<Mark | null>(null);
  const [query, setQuery] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

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
    setQuery('');
    onOpenChange(false);
    trigger.current?.focus();
  }

  // The 200 is an ack, not a repaint: the switch has landed when the snapshot
  // says so, up to one coalescing window later.
  useEffect(() => {
    if (mark?.kind === 'switching' && mark.team === current) close();
  }, [current, mark]);

  useEffect(() => {
    if (open) search.current?.focus();
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

  // Global, not gated on `open`, so ⌘K can open the picker from anywhere — and
  // re-focus the search once it is already open, since a row click can have
  // moved focus off the input.
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (!e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      if (open) search.current?.focus();
      else onOpenChange(true);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  function select(name: string) {
    if (mark?.kind === 'switching') return;
    if (name === current) {
      // Reselecting the session you dismissed is how you resume watching it —
      // the picker's whole purpose is paging back in with one click.
      if (watch.dismissed) watch.watchAgain();
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
  // Hidden sessions come out before anything else counts them, so the header
  // total, the search results and the cursor all agree with what is drawn.
  const rows = (teams ?? []).filter(
    (t) => (t.state !== 'done' || t.current) && !watch.hidden.has(t.name),
  );
  const hiddenCount = (teams ?? []).filter((t) => watch.hidden.has(t.name)).length;
  const filteredRows = rows.filter((t) => matchesQuery(t, query));
  const cursorTeam = filteredRows[Math.min(cursor, filteredRows.length - 1)];

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(filteredRows.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cursorTeam) select(cursorTeam.name);
    } else if (e.key === 'Escape') {
      // preventDefault is what stops the global handler interrupting an agent.
      e.preventDefault();
      if (query) {
        setQuery('');
        setCursor(0);
      } else {
        close();
      }
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
          border: `1px ${watch.dismissed ? 'dashed' : 'solid'} var(--color-neutral-800)`,
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <span
          id="team-trigger-name"
          data-testid="team-trigger-name"
          style={{
            color: watch.dismissed ? 'var(--color-neutral-500)' : 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {watch.dismissed ? 'no session selected' : (sessionName ?? current)}
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
              alignItems: 'center',
              padding: '10px 14px 8px',
              color: 'var(--color-neutral-600)',
              fontSize: '10.5px',
              letterSpacing: '.12em',
            }}
          >
            <span>{`SESSIONS ON THIS MACHINE \u00b7 ${rows.length}`}</span>
            <input
              ref={search}
              data-testid="team-search"
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              placeholder="search"
              aria-label="search sessions"
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--color-text)',
                fontSize: '11px',
                letterSpacing: 'normal',
                width: '140px',
              }}
            />
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
            {filteredRows.map((team) => {
              const isCurrent = team.name === current;
              // A dismissed session is still the current one server-side — just
              // not rendered — so its checkmark would contradict the "not
              // watching" text sitting right below it. Drop the mark instead.
              const notWatching = isCurrent && watch.dismissed;
              const rowMark = mark?.team === team.name ? mark.kind : isCurrent && !notWatching ? 'current' : null;
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
                    {/* The name the operator gave the session, not the id the
                        directory happens to carry. Falls back to the id when a
                        session was never named, so the row is never blank. */}
                    <span
                      data-testid="team-title"
                      style={{
                        color: 'var(--color-text)',
                        fontSize: '12px',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {team.goal ?? team.name}
                    </span>
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
                    {isCurrent && !watch.dismissed && (
                      <button
                        type="button"
                        data-testid="row-stop-watching"
                        onClick={(e) => {
                          e.stopPropagation();
                          watch.requestStopWatching();
                        }}
                        style={{
                          fontSize: '10px',
                          color: 'var(--color-neutral-600)',
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          flex: 'none',
                        }}
                      >
                        stop watching
                      </button>
                    )}
                    {/* Removes the row from this browser's picker. Deliberately
                        offered on every row including the current one — the
                        sessions worth clearing are usually the stale ones you
                        are looking at. Hiding the current session empties the
                        body to `NoSessions`, which carries the way back. */}
                    <button
                      type="button"
                      data-testid="row-hide"
                      aria-label={`hide ${team.goal ?? team.name}`}
                      title="hide from this picker · nothing is stopped"
                      onClick={(e) => {
                        e.stopPropagation();
                        watch.hideSession(team.name);
                      }}
                      style={{
                        fontSize: '11px',
                        lineHeight: 1,
                        color: 'var(--color-neutral-700)',
                        background: 'transparent',
                        border: 'none',
                        padding: '0 2px',
                        cursor: 'pointer',
                        flex: 'none',
                      }}
                    >
                      {'✕'}
                    </button>
                  </div>
                  <div
                    data-testid="team-meta"
                    style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}
                  >
                    {team.goal && (
                      <span
                        data-testid="team-id"
                        style={{
                          color: 'var(--color-neutral-600)',
                          fontSize: '10.5px',
                          whiteSpace: 'nowrap',
                          flex: 'none',
                        }}
                      >
                        {team.name}
                      </span>
                    )}
                    {team.branch && (
                      <span
                        data-testid="team-branch"
                        style={{
                          color: 'var(--color-neutral-600)',
                          fontSize: '10.5px',
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {team.branch}
                      </span>
                    )}
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
                      {notWatching ? 'running · not watching' : stateText(team, now)}
                    </span>
                  </div>
                </div>
              );
            })}

            {filteredRows.length === 0 && (
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
                    : rows.length === 0
                      ? hiddenCount > 0
                        ? 'every session is hidden'
                        : 'no live teams'
                      : 'no matches'}
              </div>
            )}

            {/* The way back, in the picker itself as well as on the empty
                screen — hiding the last row otherwise leaves a list with no
                control in it at all. */}
            {hiddenCount > 0 && (
              <button
                type="button"
                data-testid="show-hidden-rows"
                onClick={() => {
                  watch.showHidden();
                  setCursor(0);
                }}
                style={{
                  margin: '2px 2px 0',
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px dashed var(--color-neutral-800)',
                  background: 'transparent',
                  color: 'var(--color-neutral-600)',
                  fontSize: '10.5px',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {`${hiddenCount} hidden · show ${hiddenCount === 1 ? 'it' : 'them'}`}
              </button>
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
