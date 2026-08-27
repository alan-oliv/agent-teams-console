import { useEffect, useState } from 'react';
import type { TeamState, ViewId } from '../../shared/domain';

export const VIEW_IDS: readonly ViewId[] = ['wall', 'overview', 'tasks', 'rail', 'grid'];

export interface TeamStateStore {
  state: TeamState | null;
  connected: boolean;
  view: ViewId;
  agent: string | null;
  setView(v: ViewId): void;
  setAgent(name: string | null): void;
}

export function readUrlState(search: string): { view: ViewId; agent: string | null } {
  const params = new URLSearchParams(search);
  const raw = params.get('view');
  const view = VIEW_IDS.find((v) => v === raw) ?? 'wall';
  return { view, agent: params.get('agent') };
}

export function writeUrlState(view: ViewId, agent: string | null): void {
  const params = new URLSearchParams();
  params.set('view', view);
  if (agent) params.set('agent', agent);
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30_000;

export function useTeamState(url = '/stream'): TeamStateStore {
  const [initial] = useState(() => readUrlState(window.location.search));
  const [state, setState] = useState<TeamState | null>(null);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<ViewId>(initial.view);
  const [agent, setAgent] = useState<string | null>(initial.agent);

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
        setState(JSON.parse((ev as MessageEvent<string>).data) as TeamState);
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
    writeUrlState(view, agent);
  }, [view, agent]);

  return { state, connected, view, agent, setView, setAgent };
}
