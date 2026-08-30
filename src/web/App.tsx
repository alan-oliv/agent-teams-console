import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './theme.css';
import type { Agent } from '../shared/domain';
import { postJson } from './api';
import { NeedsYou } from './chrome/NeedsYou';
import { Panel } from './chrome/Panel';
import { StatusBar } from './chrome/StatusBar';
import { StopConfirm } from './chrome/StopConfirm';
import { DiffModal } from './components/DiffModal';
import { StopContext } from './components/StopButton';
import { useKeyboard } from './state/useKeyboard';
import { SettingsContext, useSettings } from './state/useSettings';
import { DiffContext, useTeamState } from './state/useTeamState';
import { Comms } from './views/Comms';
import { Grid } from './views/Grid';
import { Overview } from './views/Overview';
import { Rail } from './views/Rail';
import { Tasks } from './views/Tasks';
import { Wall } from './views/Wall';

export function App() {
  const store = useTeamState();
  const appearance = useSettings();
  const [now, setNow] = useState(() => Date.now());
  const [teamsOpen, setTeamsOpen] = useState(false);

  // The theme lives on the console root, but the page behind it is the body's,
  // and an overscroll on a light theme would otherwise flash the dark default.
  useEffect(() => {
    document.documentElement.style.backgroundColor = appearance.vars['--term'];
  }, [appearance.vars]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const state = store.state;
  const toggleTeams = useCallback(() => setTeamsOpen((open) => !open), []);

  // The launcher announces a new team at a console that is already running for
  // another one. Ref-guarded because main.tsx mounts under StrictMode, and a
  // second POST would tear the ingest down and rebuild it twice.
  const announced = useRef(false);
  useEffect(() => {
    const target = store.announcedTeam;
    if (!target || announced.current || !state || target === state.teamName) return;
    announced.current = true;
    void postJson(`/api/teams/${encodeURIComponent(target)}/select`);
  }, [state, store.announcedTeam]);

  // The wall pins the lead leftmost, so column navigation (h/l) walks the
  // same order — computed here rather than exported from Wall, since App
  // needs only the names, not the rendered columns.
  const wallOrder = state
    ? (() => {
        const lead = state.agents.find((a) => a.isLead);
        return lead
          ? [lead.name, ...state.agents.filter((a) => a !== lead).map((a) => a.name)]
          : state.agents.map((a) => a.name);
      })()
    : [];

  function isDeparted(name: string): boolean {
    return state?.agents.find((a) => a.name === name)?.status === 'departed';
  }

  // Stopping is confirmed before it is sent, and the request is remembered so
  // the row can say it is pending. Both are console-local: a stop is a
  // shutdown_request in the agent's inbox, so nothing observable changes until
  // the agent reaches its next turn boundary and acts on it.
  const [stopping, setStopping] = useState<Agent | null>(null);
  const [stopRequested, setStopRequested] = useState<ReadonlySet<string>>(() => new Set());

  const sendStop = useCallback((name: string) => {
    setStopRequested((prev) => new Set(prev).add(name));
    void postJson(`/api/agents/${encodeURIComponent(name)}/stop`);
  }, []);

  const confirmStop = useCallback(() => {
    if (!stopping) return;
    // Teammates run inside the lead's session, so ending it ends them. The
    // request is sent to each one as well rather than left implicit — an agent
    // that never got one has no reason to wind down.
    const targets = stopping.isLead
      ? [stopping.name, ...(state?.agents ?? []).filter((a) => !a.isLead).map((a) => a.name)]
      : [stopping.name];
    for (const name of targets) if (!isDeparted(name)) sendStop(name);
    setStopping(null);
  }, [stopping, state, sendStop]);

  const askStop = useCallback(
    (name: string) => {
      const agent = state?.agents.find((a) => a.name === name);
      if (agent && agent.status !== 'departed' && !state?.readOnly) setStopping(agent);
    },
    [state],
  );

  // Above the `!state` return: every hook has to run on the frame before the
  // first snapshot lands too, or the hook order changes between renders.
  const stopControl = useMemo(
    () => ({
      requested: stopRequested,
      ask: (a: Agent) => setStopping(a),
      // No frame yet means no team to act on, so the control stays inert.
      readOnly: state?.readOnly ?? true,
    }),
    [stopRequested, state?.readOnly],
  );

  useKeyboard({
    agents: wallOrder,
    view: store.view,
    focused: store.agent,
    setFocused: store.setAgent,
    setView: store.setView,
    interrupt: (name) => {
      if (!isDeparted(name)) void postJson(`/api/agents/${encodeURIComponent(name)}/interrupt`);
    },
    // `x` opens the same confirmation the control does — the keystroke used to
    // send the request outright, which is a hard thing to undo from one key.
    stop: askStop,
    toggleTeams,
  });

  if (!state) {
    return (
      <div className="console" style={appearance.vars} data-motion={appearance.settings.motion ? 'on' : 'off'}>
        <main className="console-body" />
      </div>
    );
  }

  return (
    <StopContext.Provider value={stopControl}>
    <SettingsContext.Provider value={appearance.settings}>
    <DiffContext.Provider value={store.setOpenDiff}>
    <div
      className="console"
      style={appearance.vars}
      data-motion={appearance.settings.motion ? 'on' : 'off'}
    >
      <StatusBar
        state={state}
        view={store.view}
        onViewChange={store.setView}
        now={now}
        teamsOpen={teamsOpen}
        onTeamsOpenChange={setTeamsOpen}
        appearance={appearance}
      />
      <main className="console-body">
        {store.view === 'wall' && (
          <Wall
            agents={state.agents}
            focused={store.agent}
            onFocus={store.setAgent}
            now={now}
            readOnly={state.readOnly}
            widths={store.widths}
            onWidthChange={store.setWidth}
          />
        )}
        {store.view === 'overview' && (
          <Overview agents={state.agents} focused={store.agent} onFocus={store.setAgent} now={now} />
        )}
        {store.view === 'comms' && (
          <Comms
            agents={state.agents}
            mail={state.mail}
            tasks={state.tasks}
            focused={store.agent}
            onFocus={store.setAgent}
            onShowInWall={(name) => {
              store.setAgent(name);
              store.setView('wall');
            }}
            now={now}
            readOnly={state.readOnly}
          />
        )}
        {store.view === 'tasks' && <Tasks tasks={state.tasks} teamName={state.teamName} />}
        {store.view === 'rail' && (
          <Rail
            agents={state.agents}
            focused={store.agent}
            onFocus={store.setAgent}
            now={now}
            readOnly={state.readOnly}
          />
        )}
        {store.view === 'grid' && (
          <Grid agents={state.agents} focused={store.agent} onFocus={store.setAgent} now={now} />
        )}
      </main>
      <DiffModal diff={store.openDiff} onClose={() => store.setOpenDiff(null)} />
      <StopConfirm target={stopping} onConfirm={confirmStop} onCancel={() => setStopping(null)} />
      <NeedsYou items={state.needsYou} readOnly={state.readOnly} now={now} />
      <Panel agents={state.agents} focusedAgent={store.agent} onFocusAgent={store.setAgent} />
    </div>
    </DiffContext.Provider>
    </SettingsContext.Provider>
    </StopContext.Provider>
  );
}
