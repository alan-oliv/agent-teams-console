import { createContext, useCallback, useEffect, useState } from 'react';
import type { Agent, Diff, TeamState, TranscriptLine, ViewId } from '../../shared/domain';

export const VIEW_IDS: readonly ViewId[] = ['wall', 'overview', 'comms', 'tasks', 'rail', 'grid', 'usage'];

/**
 * The switcher a solo session offers (decision 24): a view is offered when its
 * subject exists, and the four compare-the-teammates views have nothing to
 * compare on a roster of one. `wall` is the first pill — it LABELS itself
 * `stream` there, because a single column already is the parent's stream; the
 * id, route and component are unchanged.
 */
export const SOLO_VIEW_IDS: readonly ViewId[] = ['wall', 'trace', 'tasks', 'usage'];

/** Every id a URL may carry, whatever mode the session turns out to be in. */
const URL_VIEW_IDS: readonly ViewId[] = [...VIEW_IDS, 'trace'];

export interface TeamStateStore {
  state: TeamState | null;
  connected: boolean;
  view: ViewId;
  agent: string | null;
  /** The team the launcher asked for, or null — see {@link isAnnouncedTeam}. */
  announcedTeam: string | null;
  /**
   * The workflow run the operator picked, or null for whatever the server's own
   * mode implies. A team always wins the mode, so a session running a workflow
   * beside a live team can only reach it by selecting it — which makes this the
   * client's override of `TeamState.mode`, not a mirror of it.
   */
  run: string | null;
  setRun(runId: string | null): void;
  setView(v: ViewId): void;
  setAgent(name: string | null): void;
  /** Wall column widths, keyed by agent name. Absent means {@link COLUMN_WIDTH}. */
  widths: Readonly<Record<string, number>>;
  /** Clamped to {@link COLUMN_MIN}..{@link COLUMN_MAX}; null resets to the default. */
  setWidth(name: string, px: number | null): void;
  /** The patch open in the diff modal, or null when none is. */
  openDiff: Diff | null;
  setOpenDiff(diff: Diff | null): void;
}

// A diff-bearing row can be clicked from any view the transcript renders in
// (wall, grid, overview, rail); threading the opener through each one as a
// prop would touch every view for a control none of them own — the same
// reason SettingsContext exists.
export const DiffContext = createContext<((diff: Diff) => void) | null>(null);

export const COLUMN_WIDTH = 366;
export const COLUMN_MIN = 232;
export const COLUMN_MAX = 720;

// A wall the operator has sized is a property of this screen, not of the team
// being watched — the same reasoning, and the same store, as the appearance
// settings. Kept under its own key because the entries are agent names, so the
// shape is open where Settings is fixed.
export const WIDTHS_KEY = 'console.widths';

const clampWidth = (px: number): number =>
  Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, Math.round(px)));

/**
 * Key by key, so one bad entry from an older build — or a hand-edited store —
 * costs that column and not the whole layout. A width outside the grip's range
 * is clamped rather than dropped: the number came from a real drag, and the
 * range is only what this build happens to allow.
 */
export function parseWidths(raw: string | null): Record<string, number> {
  if (!raw) return {};
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  const widths: Record<string, number> = {};
  for (const [name, px] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof px === 'number' && Number.isFinite(px)) widths[name] = clampWidth(px);
  }
  return widths;
}

function readWidths(): Record<string, number> {
  try {
    return parseWidths(window.localStorage.getItem(WIDTHS_KEY));
  } catch {
    // Private browsing and a blocked origin both throw on access, not on write.
    return {};
  }
}

export function readUrlState(search: string): {
  view: ViewId;
  agent: string | null;
  team: string | null;
  run: string | null;
} {
  const params = new URLSearchParams(search);
  const raw = params.get('view');
  const view = URL_VIEW_IDS.find((v) => v === raw) ?? 'wall';
  return {
    view,
    agent: params.get('agent'),
    team: params.get('team'),
    run: params.get('run'),
  };
}

export function writeUrlState(
  view: ViewId,
  agent: string | null,
  team: string | null,
  run: string | null,
): void {
  const params = new URLSearchParams();
  params.set('view', view);
  if (agent) params.set('agent', agent);
  if (team) params.set('team', team);
  if (run) params.set('run', run);
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

/**
 * The launcher announces a bare `/?team=<name>` while writeUrlState always writes
 * `view`, so `view`'s absence is proof the URL came from the launcher rather than
 * from a reload or a restored tab. Selecting is server-global — every connected
 * client follows — so honouring any `?team=` would let a background tab yank a
 * console someone is watching.
 */
export function isAnnouncedTeam(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has('team') && !params.has('view');
}

const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30_000;

// A projected line is derived from one transcript record, and the projection keeps the
// first record it sees for a uuid (src/server/project.ts), so a line's marker and text
// can never change once its id has been seen. Comparing ids is therefore enough, and
// walking backwards rejects on the first frame that appended a line.
function sameTranscript(prev: TranscriptLine[], next: TranscriptLine[]): boolean {
  if (prev.length !== next.length) return false;
  for (let i = next.length - 1; i >= 0; i--) if (prev[i].id !== next[i].id) return false;
  return true;
}

// tokenSplit is the one other field on Agent that is an object rather than a
// scalar, so it needs the same by-value treatment transcript gets: a fresh
// JSON.parse hands it a new identity every frame even when every number in it
// is unchanged.
function sameTokenSplit(prev: Agent['tokenSplit'], next: Agent['tokenSplit']): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  return (
    prev.in === next.in &&
    prev.out === next.out &&
    prev.cacheWrite === next.cacheWrite &&
    prev.cacheWrite1h === next.cacheWrite1h &&
    prev.cacheRead === next.cacheRead
  );
}

// Deliberately a key walk rather than a hand-listed field set: a list rots the moment a
// field is added to Agent, and the failure mode is a silently stale console.
function sameAgent(prev: Agent, next: Agent): boolean {
  const keys = Object.keys(next) as Array<keyof Agent>;
  if (keys.length !== Object.keys(prev).length) return false;
  for (const k of keys) {
    if (k === 'transcript' || k === 'tokenSplit') continue;
    if (prev[k] !== next[k]) return false;
  }
  return sameTranscript(prev.transcript, next.transcript) && sameTokenSplit(prev.tokenSplit, next.tokenSplit);
}

/**
 * Every frame is a fresh JSON.parse, so without this each agent — and each of its
 * transcript lines — arrives with a new identity and React.memo can never hit. Reusing
 * the unchanged objects is what lets the views skip the columns that did not move.
 * Must stay pure: StrictMode double-invokes state updaters in dev.
 */
function reconcile(prev: TeamState, next: TeamState): TeamState {
  const previous = new Map(prev.agents.map((a) => [a.name, a]));
  const agents = next.agents.map((a) => {
    const before = previous.get(a.name);
    return before && sameAgent(before, a) ? before : a;
  });
  const unchanged =
    agents.length === prev.agents.length && agents.every((a, i) => a === prev.agents[i]);
  return { ...next, agents: unchanged ? prev.agents : agents };
}

export function useTeamState(url = '/stream'): TeamStateStore {
  const [initial] = useState(() => ({
    ...readUrlState(window.location.search),
    announced: isAnnouncedTeam(window.location.search),
  }));
  const [state, setState] = useState<TeamState | null>(null);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<ViewId>(initial.view);
  const [selected, setAgent] = useState<string | null>(initial.agent);
  const [selectedRun, setRun] = useState<string | null>(initial.run);
  // Held here rather than in Wall so a width survives a trip through another
  // view — Wall unmounts on every switch.
  const [widths, setWidths] = useState<Record<string, number>>(readWidths);
  const [openDiff, setOpenDiff] = useState<Diff | null>(null);

  const setWidth = useCallback((name: string, px: number | null) => {
    setWidths((prev) => {
      if (px === null) {
        if (!(name in prev)) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      }
      const clamped = clampWidth(px);
      return prev[name] === clamped ? prev : { ...prev, [name]: clamped };
    });
  }, []);

  // From an effect rather than the updater above, which StrictMode invokes
  // twice. Identity is the gate: setWidth returns `prev` unchanged when a drag
  // lands on the width it already had, so a mousemove that moves nothing costs
  // no write.
  useEffect(() => {
    try {
      window.localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths));
    } catch {
      // A full or blocked store costs persistence, never the session in hand.
    }
  }, [widths]);

  // A switch replaces the whole roster, so the selected name is meaningless in the
  // new team. Derived rather than cleared in an effect: the render path must stay
  // pure under StrictMode, the URL self-heals, and a deep-linked ?agent= survives
  // the connect window because `state` is null until the first frame.
  const agent = state && selected && !state.agents.some((a) => a.name === selected) ? null : selected;

  // Same rule for the run, and for the same reason: the runs on the frame are
  // the ones this session has, so a selection the new team never made is a dead
  // deep link rather than a run waiting to appear.
  const run =
    state && selectedRun && !(state.workflows ?? []).some((r) => r.runId === selectedRun)
      ? null
      : selectedRun;

  // Always the server's own answer, so the address bar can never disagree with the
  // header; before the first frame, the announcement it arrived with.
  const team = state ? state.teamName : initial.team;

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const es = new EventSource(url);
      source = es;

      const onState = (ev: Event) => {
        attempt = 0;
        setConnected(true);
        const next = JSON.parse((ev as MessageEvent<string>).data) as TeamState;
        // Functional form on purpose: reading `state` here would put it in the effect's
        // dep array and rebuild the EventSource on every frame.
        setState((prev) => (prev ? reconcile(prev, next) : next));
      };
      es.addEventListener('snapshot', onState);
      es.addEventListener('state', onState);
      es.addEventListener('error', () => {
        setConnected(false);
        es.close();
        if (stopped) return;
        const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
        attempt += 1;
        retry = setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      source?.close();
    };
  }, [url]);

  useEffect(() => {
    writeUrlState(view, agent, team, run);
  }, [view, agent, team, run]);

  return {
    state,
    connected,
    view,
    agent,
    announcedTeam: initial.announced ? initial.team : null,
    run,
    setRun,
    setView,
    setAgent,
    widths,
    setWidth,
    openDiff,
    setOpenDiff,
  };
}
