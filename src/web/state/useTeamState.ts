import { useEffect, useState } from 'react';
import type { Agent, TeamState, TranscriptLine, ViewId } from '../../shared/domain';

export const VIEW_IDS: readonly ViewId[] = ['wall', 'overview', 'tasks', 'rail', 'grid'];

export interface TeamStateStore {
  state: TeamState | null;
  connected: boolean;
  view: ViewId;
  agent: string | null;
  /** The team the launcher asked for, or null — see {@link isAnnouncedTeam}. */
  announcedTeam: string | null;
  setView(v: ViewId): void;
  setAgent(name: string | null): void;
}

export function readUrlState(search: string): {
  view: ViewId;
  agent: string | null;
  team: string | null;
} {
  const params = new URLSearchParams(search);
  const raw = params.get('view');
  const view = VIEW_IDS.find((v) => v === raw) ?? 'wall';
  return { view, agent: params.get('agent'), team: params.get('team') };
}

export function writeUrlState(view: ViewId, agent: string | null, team: string | null): void {
  const params = new URLSearchParams();
  params.set('view', view);
  if (agent) params.set('agent', agent);
  if (team) params.set('team', team);
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

// Deliberately a key walk rather than a hand-listed field set: a list rots the moment a
// field is added to Agent, and the failure mode is a silently stale console.
function sameAgent(prev: Agent, next: Agent): boolean {
  const keys = Object.keys(next) as Array<keyof Agent>;
  if (keys.length !== Object.keys(prev).length) return false;
  for (const k of keys) {
    if (k === 'transcript') continue;
    if (prev[k] !== next[k]) return false;
  }
  return sameTranscript(prev.transcript, next.transcript);
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

  // A switch replaces the whole roster, so the selected name is meaningless in the
  // new team. Derived rather than cleared in an effect: the render path must stay
  // pure under StrictMode, the URL self-heals, and a deep-linked ?agent= survives
  // the connect window because `state` is null until the first frame.
  const agent = state && selected && !state.agents.some((a) => a.name === selected) ? null : selected;

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
    writeUrlState(view, agent, team);
  }, [view, agent, team]);

  return {
    state,
    connected,
    view,
    agent,
    announcedTeam: initial.announced ? initial.team : null,
    setView,
    setAgent,
  };
}
