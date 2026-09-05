import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { FolderSummary, TeamSummary, TeamsResponse } from '../../shared/domain';
import { postJson } from '../api';
import { diffStat, formatElapsed, shortPath } from '../format';
import { useCast } from '../state/useCast';
import { useWatch } from '../state/useWatch';

// Derived, not chosen: 2 border + 12 padding + 120.03 ("session-" + 8 hex at the
// bar's 12.5px) + 6 gap + 6 caret. Fixed so a longer team name ellipsizes instead
// of shoving the view switcher sideways on the operator's own click.
const TRIGGER_WIDTH = '146px';

// Ruling 14. The reconcile turned each row into two lines — name over id,
// branch and diffstat — and that anatomy was sized for 520; 432 predates it.
const PANEL_WIDTH = '520px';

// The folder menu is narrower than the panel it hangs off, and offset to start
// under the chip that opens it rather than at the panel's edge — both the
// canvas's own numbers.
const FOLDER_MENU_WIDTH = '288px';
const FOLDER_MENU_LEFT = '100px';

/**
 * The three session kinds the canvas knows, with the colours it gives them —
 * its own `KIND` table, transcribed. `subagents` is deliberately the quiet one:
 * a session with a subagent tree is still one operator's window, not a team.
 *
 * `solo` is ours. The canvas has no artboard for a window with nothing in it,
 * so it borrows the quietest pair rather than inventing a colour.
 */
export const KIND_STYLE: Record<string, { color: string; edge: string }> = {
  teammates: { color: 'var(--color-accent-300)', edge: 'var(--color-accent-700)' },
  subagents: { color: 'var(--color-neutral-400)', edge: 'var(--color-neutral-700)' },
  workflow: { color: 'var(--warn)', edge: 'var(--warn-edge)' },
  solo: { color: 'var(--color-neutral-400)', edge: 'var(--color-neutral-700)' },
};

/** What KIND a picker row is, by the same bar the console classifies on. */
export function kindOf(team: TeamSummary): string {
  if (team.members >= 2) return 'teammates';
  if (team.workflow) return 'workflow';
  return team.subagents ? 'subagents' : 'solo';
}

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
  /**
   * What KIND of session this is — `teammates`, `subagents`, `solo`, `workflow`.
   * Canvas `4a`/`6a`/`8a` all draw it as an outlined pill inside the trigger,
   * ahead of the goal, and it is the only thing in the chrome that says which
   * of the four shapes you are looking at. The wordmark used to carry it by
   * reading `TEAM` or `RUN`, which could not name the other two.
   */
  mode?: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  now: number;
}

export function TeamSelect({ current, sessionName, mode, open, onOpenChange, now }: TeamSelectProps) {
  // The in-world team name, and the only place it appears: the session id below
  // it, the listing, the URL and every select call stay real.
  const inWorld = useCast().theme.team;
  const watch = useWatch();
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [mark, setMark] = useState<Mark | null>(null);
  const [query, setQuery] = useState('');
  // Two folders, not one: `folder` is what the operator asked for ('' being
  // "wherever the console was started"), `scope` is what the server answered
  // with. Reading the chip off the reply rather than the request keeps them
  // from chasing each other — setting one from the other would refetch.
  const [folder, setFolder] = useState('');
  const [scope, setScope] = useState('');
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [foldersOpen, setFoldersOpen] = useState(false);
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
    fetch(folder ? `/api/teams?folder=${encodeURIComponent(folder)}` : '/api/teams')
      .then((res) => (res.ok ? (res.json() as Promise<TeamsResponse>) : Promise.reject(res.status)))
      .then((payload) => {
        if (!live) return;
        setTeams(payload.teams);
        setScope(payload.folder ?? '');
        setFolders(payload.folders ?? []);
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
  }, [open, folder]);

  function close() {
    setMark(null);
    setQuery('');
    // Only one menu is ever open: opening the session dropdown puts the folder
    // menu away, and so does closing it.
    setFoldersOpen(false);
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

  function select(name: string, sessionOnly?: boolean, leadSessionId?: string) {
    if (mark?.kind === 'switching') return;
    if (name === current) {
      // Reselecting the session you dismissed is how you resume watching it —
      // the picker's whole purpose is paging back in with one click.
      if (watch.dismissed) watch.watchAgain();
      close();
      return;
    }
    if (sessionOnly) {
      // Flag-off rows have `name` as the session id itself; flag-on solo rows
      // have `name` as the team directory name, so `leadSessionId` — the
      // actual session uuid `/api/select-session` and `/s/:id` need — is the
      // one to navigate with, falling back to `name` when it's absent.
      // Task #4's route is what carries it, and its own mount effect fires
      // the `/api/select-session/<id>` POST once the URL lands there.
      window.location.assign(`/s/${encodeURIComponent(leadSessionId ?? name)}`);
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

  // The picker filters nothing. Every session type has a view of its own now —
  // a bare window renders its own stream, a finished one is history you page
  // back into, which is what the picker is FOR — so there is no longer such a
  // thing as a row with nowhere to go. That was the only thing the lead-only
  // filter, its `reveal` escape hatch and the `done` drop were ever
  // compensating for (supersedes decision 23's bare-window carve-out).
  //
  // The `✕` stays: taking a row out is an operator's choice, not a rule.
  const runOf = (t: TeamSummary) => (t.members < 2 ? t.workflow : undefined);
  const listed = teams ?? [];
  const rows = listed.filter((t) => !watch.hidden.has(t.name));
  const hiddenCount = listed.length - rows.length;
  const filteredRows = rows.filter((t) => matchesQuery(t, query));
  const teamCount = rows.length;
  const cursorTeam = filteredRows[Math.min(cursor, filteredRows.length - 1)];

  // The chip and the note count SESSIONS ON DISK, which is what the folder menu
  // beside them counts; the header count above the list counts ROWS, because it
  // sits directly on top of them. The two differ whenever a folder's sessions
  // fold into one team row, and each is true of what it is next to.
  const here = folders.find((f) => f.path === scope);
  const folderName = here?.name ?? scope.split('/').filter(Boolean).pop() ?? scope;
  const totalSessions = folders.reduce((n, f) => n + f.sessions, 0);
  const folderNote = here
    ? `${here.sessions} of ${totalSessions} sessions are in this folder` +
      (here.sessions === totalSessions ? '' : ' · switch folders to see the rest')
    : '';

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(filteredRows.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cursorTeam) select(cursorTeam.name, cursorTeam.sessionOnly, cursorTeam.leadSessionId);
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
          // Ruling 14 measured 146px for the GOAL, so that is what carries it
          // (below) rather than the whole trigger: the badge and the in-world
          // chip are decoration either side of it, and pinning the trigger
          // instead would let a long badge eat the goal it was sized for. The
          // tabs still cannot move when the operator switches session, which is
          // what the pin is for — only a change of session KIND shifts them.
          flex: 'none',
          whiteSpace: 'nowrap',
          padding: '3px 8px',
          margin: '-3px 0',
          border: `1px ${watch.dismissed ? 'dashed' : 'solid'} var(--color-neutral-800)`,
          borderRadius: 'var(--radius-sm)',
        }}
      >
        {mode && (
          <span
            data-testid="team-mode"
            style={{
              color: (KIND_STYLE[mode] ?? KIND_STYLE.solo).color,
              fontSize: 9.5,
              border: `1px solid ${(KIND_STYLE[mode] ?? KIND_STYLE.solo).edge}`,
              borderRadius: 8,
              padding: '0 7px',
              whiteSpace: 'nowrap',
              flex: 'none',
            }}
          >
            {mode}
          </span>
        )}
        <span
          id="team-trigger-name"
          data-testid="team-trigger-name"
          style={{
            maxWidth: TRIGGER_WIDTH,
            color: watch.dismissed ? 'var(--color-neutral-500)' : 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {watch.dismissed ? 'no session selected' : (sessionName ?? current)}
        </span>
        {inWorld && !watch.dismissed && (
          <span
            data-testid="team-chip"
            style={{
              color: 'var(--color-accent-300)',
              fontSize: 10,
              border: '1px solid var(--color-accent-700)',
              borderRadius: 8,
              padding: '0 7px',
              whiteSpace: 'nowrap',
              flex: 'none',
            }}
          >
            {inWorld}
          </span>
        )}
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
            // The panel floats on the same ground as the bar behind it, so the
            // shadow alone leaves its top edge indistinguishable.
            border: '1px solid var(--color-neutral-800)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            outline: 'none',
          }}
        >
          {/* The header is a folder picker, not a caption: `SESSIONS ON` plus
              the folder itself, because the scope is now something the operator
              chooses rather than something the launcher decided for them. The
              noun stays "SESSIONS" (decision 23) \u2014 the ruling that chose
              "TEAMS" was compensating for a filter that listed bare windows,
              and with that fixed the list holds teams, workflow sessions and
              solo sessions alike. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '9px',
              padding: '7px 12px 6px',
              borderBottom: '1px solid var(--color-neutral-900)',
              color: 'var(--color-neutral-600)',
              fontSize: '10px',
              letterSpacing: '.12em',
              position: 'relative',
            }}
          >
            <span style={{ flex: 'none' }}>SESSIONS ON</span>
            <button
              type="button"
              data-testid="folder-chip"
              aria-haspopup="listbox"
              aria-expanded={foldersOpen}
              onClick={() => setFoldersOpen((o) => !o)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '2px 8px',
                border: '1px solid var(--color-neutral-800)',
                borderRadius: 'var(--radius-sm)',
                background: 'transparent',
                letterSpacing: 'normal',
                cursor: 'pointer',
                flex: 'none',
              }}
            >
              <span style={{ color: 'var(--color-accent-300)', fontSize: '11px', whiteSpace: 'nowrap' }}>
                {folderName}
              </span>
              <span style={{ color: 'var(--color-neutral-600)', fontSize: '10px', whiteSpace: 'nowrap' }}>
                {shortPath(scope)}
              </span>
              <span aria-hidden="true" style={{ color: 'var(--color-accent-400)', fontSize: '10px' }}>
                {foldersOpen ? '\u25b4' : '\u25be'}
              </span>
            </button>
            {/* The canvas leaves this slot as bare spacer \u2014 a mock has no live
                search to draw in it. It is the only gap in the row wide enough
                to type into, and the footer's `\u2318K to search` promises somewhere
                to type, so the input fills it rather than displacing the count. */}
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
                flex: 1,
                minWidth: 0,
              }}
            />
            <span data-testid="session-count" style={{ flex: 'none' }}>
              {teamCount}
            </span>

            {foldersOpen && (
              <div
                data-testid="folder-menu"
                role="listbox"
                aria-label="folders"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 5px)',
                  left: FOLDER_MENU_LEFT,
                  zIndex: 22,
                  display: 'flex',
                  flexDirection: 'column',
                  width: FOLDER_MENU_WIDTH,
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-neutral-800)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-md)',
                  overflow: 'hidden',
                  letterSpacing: 'normal',
                  // The canvas draws three folders and needs no cap. This
                  // machine has eighteen, and uncapped the menu ran 200px past
                  // the panel it hangs off. Same ceiling as the session list
                  // below it, so the two menus stop in the same place.
                  maxHeight: '320px',
                  overflowY: 'auto',
                }}
              >
                {folders.map((f) => {
                  const isHere = f.path === scope;
                  return (
                    <div
                      key={f.path}
                      role="option"
                      aria-selected={isHere}
                      onClick={() => {
                        // Picking filters the list and closes the folder menu \u2014
                        // the session dropdown stays open, since choosing a
                        // folder is how you get to the session in it.
                        setFolder(f.path);
                        setFoldersOpen(false);
                        setCursor(0);
                      }}
                      style={{
                        padding: '7px 11px',
                        display: 'flex',
                        gap: '9px',
                        alignItems: 'baseline',
                        cursor: 'pointer',
                        background: isHere ? 'var(--color-accent-900)' : 'transparent',
                        borderBottom: '1px solid var(--color-neutral-900)',
                      }}
                    >
                      <span
                        style={{
                          color: isHere ? 'var(--color-accent-300)' : 'var(--color-text)',
                          fontSize: '11.5px',
                          whiteSpace: 'nowrap',
                          flex: 'none',
                        }}
                      >
                        {f.name}
                      </span>
                      <span
                        style={{
                          color: 'var(--color-neutral-600)',
                          fontSize: '10px',
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {shortPath(f.path)}
                      </span>
                      <span style={{ flex: 1 }} />
                      <span
                        style={{
                          color: 'var(--color-neutral-600)',
                          fontSize: '10px',
                          whiteSpace: 'nowrap',
                          flex: 'none',
                        }}
                      >
                        {f.sessions}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
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
              const run = runOf(team);
              const rowMark = mark?.team === team.name ? mark.kind : isCurrent && !notWatching ? 'current' : null;
              const state = team.state ?? (team.live ? 'live' : 'done');
              return (
                <div
                  key={team.name}
                  id={`team-option-${team.name}`}
                  role="option"
                  aria-selected={isCurrent}
                  onClick={() => select(team.name, team.sessionOnly, team.leadSessionId)}
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
                    {/* Canvas: every row leads with its kind, then the goal —
                        it is how the list tells the four shapes apart without
                        the operator having to read the counts on the line
                        below. Smaller than the trigger's badge (9px / 0 6px),
                        which is the canvas's own pair of sizes. */}
                    <span
                      data-testid="team-kind"
                      style={{
                        color: KIND_STYLE[kindOf(team)].color,
                        fontSize: '9px',
                        border: `1px solid ${KIND_STYLE[kindOf(team)].edge}`,
                        borderRadius: 8,
                        padding: '0 6px',
                        whiteSpace: 'nowrap',
                        flex: 'none',
                      }}
                    >
                      {kindOf(team)}
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
                        color: 'var(--color-neutral-600)',
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
                    {/* The run's own name lands with its snapshot, which is
                        written at termination — so a live run has only its id,
                        and that is what the row says rather than a placeholder
                        that would read like a name. */}
                    {run && (
                      <span
                        data-testid="team-run"
                        style={{
                          color: 'var(--color-neutral-600)',
                          fontSize: '10.5px',
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {run.name ?? run.runId}
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
                    {/* The design pairs this with the branch. It reads the
                        narrowest thing a local console can know for certain —
                        which is not self-evident from `+14 −2`, so the row says
                        so rather than leaving it to be assumed. */}
                    {team.diffstat && (
                      <span
                        data-testid="team-diffstat"
                        title="uncommitted in the working tree, against HEAD"
                        style={{
                          color: 'var(--color-neutral-600)',
                          fontSize: '10.5px',
                          whiteSpace: 'nowrap',
                          flex: 'none',
                        }}
                      >
                        {diffStat(team.diffstat.added, team.diffstat.removed)}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span
                      style={{
                        color: 'var(--color-neutral-600)',
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
                      {/* The kind pill above says WHAT this is, so this cell
                          says what it is DOING — the canvas's own split, whose
                          state column reads `4 working` / `6 subagents` /
                          `9 of 10 slots`. It used to repeat the kind here
                          (`solo · 4 subagents`) because nothing else carried
                          it. A finished session's age wins over either: `ended
                          6h ago` is what the operator picks between rows on. */}
                      {notWatching
                        ? 'running · not watching'
                        : state === 'done'
                          ? stateText(team, now)
                          : run
                            ? run.live
                              ? 'running'
                              : 'ended'
                            : team.members < 2 && team.subagents
                              ? `${team.subagents} subagent${team.subagents === 1 ? '' : 's'}`
                              : stateText(team, now)}
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
                  color: unreadable && !loading ? 'var(--fail)' : 'var(--color-neutral-600)',
                }}
              >
                {loading
                  ? 'reading teams…'
                  : unreadable
                    ? 'could not read teams'
                    : rows.length === 0
                      ? 'no sessions'
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
                {`${hiddenCount} not shown · show ${hiddenCount === 1 ? 'it' : 'them'}`}
              </button>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              gap: '12px',
              padding: '8px 12px',
              color: 'var(--color-neutral-600)',
              fontSize: '10px',
            }}
          >
            {/* The canvas gives the footer two slots: the shortcut it wants
                named, and the scope. The separator above comes from the last
                row's own bottom border, so there is no border here. */}
            {/* Both `flex: none`: a flex child shrinks below its content by
                default, and these two wrapped to four lines before the spacer
                between them gave up any width. */}
            <span style={{ flex: 'none' }}>⌘K to search</span>
            <span style={{ flex: 1 }} />
            <span data-testid="folder-note" style={{ flex: 'none' }}>
              {folderNote}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
