import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './theme.css';
import { buildCast } from '../shared/cast';
import type { Agent, TeamsResponse, TeamSummary } from '../shared/domain';
import { wallOrder as rosterOrder } from '../shared/roster';
import { postJson } from './api';
import { NeedsYou } from './chrome/NeedsYou';
import { Panel } from './chrome/Panel';
import { StatusBar } from './chrome/StatusBar';
import { StopConfirm, WatchConfirm } from './chrome/StopConfirm';
import { DiffModal } from './components/DiffModal';
import { StopContext } from './components/StopButton';
import { CastContext } from './state/useCast';
import { isEmptySession, isNotShown, useHiddenSessions } from './state/useHiddenSessions';
import { useKeyboard } from './state/useKeyboard';
import { SettingsContext, useSettings } from './state/useSettings';
import { useSpendSamples } from './state/useSpendSamples';
import { DiffContext, useTeamState } from './state/useTeamState';
import { WatchContext } from './state/useWatch';
import { Comms } from './views/Comms';
import { Grid } from './views/Grid';
import { LeftSession } from './views/LeftSession';
import { NoSessions } from './views/NoSessions';
import { Overview } from './views/Overview';
import { Rail } from './views/Rail';
import { Tasks } from './views/Tasks';
import { Trace } from './views/Trace';
import { Usage } from './views/Usage';
import { Wall } from './views/Wall';
import { Workflow } from './views/Workflow';

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

  // Solo (decisions 23/24): a roster of one whose session carries a subagent
  // tree. The switcher then offers stream · trace · tasks · usage, and a
  // `trace` in the URL of any OTHER session falls back to the wall rather
  // than mounting a view its switcher never offered.
  const soloLead = state !== null && state.agents.length === 1 ? state.agents[0] : null;
  const solo =
    soloLead !== null && Object.values(state?.subagents ?? {}).some((list) => list.length > 0);
  const view = store.view === 'trace' && !solo ? 'wall' : store.view;
  // Lives here, not in the view, so switching away from usage and back does
  // not restart the sampler — the same reason widths and hidden sessions live
  // above the views that read them.
  const spendSamples = useSpendSamples(state?.totalCostUsd, state?.agents);
  const toggleTeams = useCallback(() => setTeamsOpen((open) => !open), []);

  // An open-this-thread intent, not a selection: comms opens the everyone room
  // on any plain view switch, and only the in-flight badge asks it for one
  // agent's messages. Dropped on the way out, so the next visit is plain again.
  const [mailFor, setMailFor] = useState<string | null>(null);
  // The trace view's selected lane. Lives here like mailFor so leaving and
  // returning to trace keeps the operator's place.
  const [traceSelected, setTraceSelected] = useState<string | null>(null);
  useEffect(() => {
    if (view !== 'comms') setMailFor(null);
  }, [view]);

  // A comms "show in wall" scroll hint — the pair's other half, dropped once
  // the wall is left so a later plain focus change does not re-trigger it.
  const [alsoReveal, setAlsoReveal] = useState<string | null>(null);
  useEffect(() => {
    if (view !== 'wall') setAlsoReveal(null);
  }, [view]);

  // "Stop watching" is a view-local dismissal, never written to `~/.claude` and
  // scoped to this tab — the team keeps running and this state is the only
  // place that knows the console stopped following it.
  const [dismissed, setDismissed] = useState(false);
  const [pendingDismiss, setPendingDismiss] = useState(false);
  const [awaySince, setAwaySince] = useState<{ at: number; cost: number } | null>(null);
  const [elsewhere, setElsewhere] = useState<TeamSummary[]>([]);

  // The console actually switching teams is what "watching" means — dismissal
  // never survives past that, whichever way the switch happened.
  useEffect(() => {
    setDismissed(false);
  }, [state?.teamName]);

  const { hidden, hide, showAll, revealed } = useHiddenSessions();
  /**
   * Nothing worth drawing in the body. Two ways to get here:
   *
   * - the session on screen was hidden with the picker's `✕`;
   * - or NO session on this machine is actually a team. Claude Code writes a
   *   `teams/<session>/config.json` for every session, holding just that
   *   session's own lead, so a machine with three windows open and no teammates
   *   anywhere still has three of them. Drawing a wall for one is a column with
   *   a lead in it and nothing to watch.
   *
   * The second condition deliberately asks about EVERY session, not just this
   * one: a real team elsewhere means the console has somewhere to be, and a
   * team that is mid-spawn — lead present, first teammate not yet — must not
   * flash the empty screen on its way to becoming real.
   */
  const currentHidden = state ? hidden.has(state.teamName) : false;
  // `!solo`: a lead-only session WITH a subagent tree is somewhere to be
  // (decision 23) — the empty screen is for the bare window, not for it.
  const leadOnlyHere = state ? state.mode !== 'workflow' && state.agents.length < 2 && !solo : false;
  // A team that has ENDED is not somewhere the console has to be, so it does not
  // hold the empty screen off — even though the lists below keep it, because
  // paging back into a finished session is what they are for.
  const noTeamsAnywhere =
    leadOnlyHere && elsewhere.every((t) => t.state === 'done' || isEmptySession(t));
  const bodyEmpty = currentHidden || noTeamsAnywhere;

  // ONE rule for both empty screens. They disagreed: LeftSession got the raw
  // list, so hidden and lead-only sessions were one-click destinations there and
  // absent from NoSessions. What is offered is what the picker would let you
  // switch to, nothing more.
  const switchable = elsewhere.filter((t) => !hidden.has(t.name) && !isEmptySession(t));
  // Everything the picker is dropping, plus the session on screen when hiding it
  // is how we got here — `elsewhere` excludes it, and without it the way back
  // disappears exactly when it is needed.
  const notShownCount =
    elsewhere.filter((t) => isNotShown(t, hidden, revealed)).length + (currentHidden ? 1 : 0);

  // Fetched only once there's something to show — the same "on open" rule the
  // picker's own listing follows.
  useEffect(() => {
    if ((!dismissed && !currentHidden && !leadOnlyHere) || !state) return;
    let live = true;
    fetch('/api/teams')
      .then((res) => (res.ok ? (res.json() as Promise<TeamsResponse>) : Promise.reject(res.status)))
      .then((payload) => {
        if (!live) return;
        // Finished sessions stay: the design makes paging back into "a running
        // or finished session" the picker's whole point, and dropping them here
        // left the ✓ treatment on both screens as dead code.
        setElsewhere(payload.teams.filter((t) => t.name !== state.teamName));
      })
      .catch(() => {
        if (live) setElsewhere([]);
      });
    return () => {
      live = false;
    };
  }, [dismissed, currentHidden, leadOnlyHere, state?.teamName, state?.agents.length]);

  const watchAgain = useCallback(() => {
    setDismissed(false);
    setAwaySince(null);
  }, []);

  const watchState = useMemo(
    () => ({
      dismissed,
      requestStopWatching: () => setPendingDismiss(true),
      watchAgain,
      hidden,
      hideSession: hide,
      showHidden: showAll,
      revealed,
    }),
    [dismissed, watchAgain, hidden, hide, showAll, revealed],
  );

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

  // The wall pins the lead leftmost then departed last, so column navigation
  // (h/l) walks the same order — App needs only the names, not the rendered
  // columns.
  const wallOrder = state ? rosterOrder(state.agents).map((a) => a.name) : [];

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

  // "End it for real" on the left-session screen is the same destructive verb
  // as ending it from the wall — same confirmation, same fan-out to every
  // teammate — just reached from a dismissed session instead of a live view.
  const endForReal = useCallback(() => {
    const lead = state?.agents.find((a) => a.isLead);
    if (lead) askStop(lead.name);
  }, [state, askStop]);

  // Built ONCE and handed to every view, from the roster's OWN order — the
  // append-only join order out of `members[]`, not the wall's.
  //
  // Two different invariants, and both are needed. One cast for every view is
  // what stops the wall and the grid disagreeing. Seeding it from an order that
  // never re-sorts is what stops the team being recast over TIME: the theme's
  // spare characters are dealt out in the order they arrive, and the wall's
  // order moves a departed teammate to the end, so a single departure would
  // deal every spare-drawn agent one seat along mid-session.
  const cast = useMemo(
    () => buildCast(state?.agents ?? [], appearance.settings.movieTheme),
    [state?.agents, appearance.settings.movieTheme],
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
    view,
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
    // The patch owns the keyboard while it is open, or Esc interrupts the
    // focused agent instead of closing it.
    suspended: store.openDiff !== null,
  });

  if (!state) {
    return (
      <div className="console" style={appearance.vars} data-motion={appearance.settings.motion ? 'on' : 'off'}>
        <main className="console-body" />
      </div>
    );
  }

  // Workflow mode is a different shell, not a different view: no roster, no
  // task list, no inboxes, no composer, and `RUN` where the team bar says
  // `TEAM`. The chrome is the same chrome, so the providers it reads are the
  // same ones: the picker shows what this browser has hidden, and the gear
  // writes the appearance the leaves below it read.
  //
  // The server's mode is only the DEFAULT, and it hands a team the mode whenever
  // there is one — so a workflow launched beside a live team is on the frame and
  // undrawable until the operator asks for it. Asking is `store.run`, and it
  // wins in either mode; the team keeps running behind it either way.
  const runs = state.workflows ?? [];
  const run = runs.find((r) => r.runId === store.run) ?? (state.mode === 'workflow' ? runs[0] : undefined);
  if (run) {
    return (
      <SettingsContext.Provider value={appearance.settings}>
      <WatchContext.Provider value={watchState}>
      <div className="console" style={appearance.vars} data-motion={appearance.settings.motion ? 'on' : 'off'}>
        <Workflow
          run={run}
          runs={runs}
          onSelectRun={store.setRun}
          backToTeam={state.mode === 'team' ? (state.sessionName ?? state.teamName) : undefined}
          now={now}
          teamName={state.teamName}
          sessionName={state.sessionName}
          teamsOpen={teamsOpen}
          onTeamsOpenChange={setTeamsOpen}
          appearance={appearance}
          subagents={state.subagents}
        />
      </div>
      </WatchContext.Provider>
      </SettingsContext.Provider>
    );
  }

  return (
    <StopContext.Provider value={stopControl}>
    <SettingsContext.Provider value={appearance.settings}>
    <CastContext.Provider value={cast}>
    <DiffContext.Provider value={store.setOpenDiff}>
    <WatchContext.Provider value={watchState}>
    <div
      className="console"
      style={appearance.vars}
      data-motion={appearance.settings.motion ? 'on' : 'off'}
    >
      <StatusBar
        state={state}
        view={view}
        onViewChange={store.setView}
        now={now}
        teamsOpen={teamsOpen}
        onTeamsOpenChange={setTeamsOpen}
        onSelectRun={store.setRun}
        appearance={appearance}
        solo={solo}
      />
      <main className="console-body">
        {/* Hiding wins over dismissal: a session taken out of the picker has no
            row left to page back into, so LeftSession's "watch again" would
            point at nothing. */}
        {bodyEmpty ? (
          <NoSessions
            remaining={switchable}
            notShownCount={notShownCount}
            onShowHidden={showAll}
            onSwitchTo={(name) => void postJson(`/api/teams/${encodeURIComponent(name)}/select`)}
          />
        ) : dismissed ? (
          <LeftSession
            state={state}
            now={now}
            awaySince={awaySince}
            elsewhere={switchable}
            onWatchAgain={watchState.watchAgain}
            onEndForReal={endForReal}
            onSwitchTo={(name) => void postJson(`/api/teams/${encodeURIComponent(name)}/select`)}
          />
        ) : (
        <>
        {view === 'wall' && (
          <Wall
            agents={state.agents}
            focused={store.agent}
            revealAlso={alsoReveal}
            onFocus={store.setAgent}
            now={now}
            readOnly={state.readOnly}
            widths={store.widths}
            onWidthChange={store.setWidth}
            onOpenMail={(name) => {
              setMailFor(name);
              store.setAgent(name);
              store.setView('comms');
            }}
            subagents={state.subagents}
          />
        )}
        {view === 'overview' && (
          <Overview
            agents={state.agents}
            focused={store.agent}
            onFocus={store.setAgent}
            now={now}
            subagents={state.subagents}
          />
        )}
        {view === 'comms' && (
          <Comms
            agents={state.agents}
            mail={state.mail}
            tasks={state.tasks}
            openThread={mailFor}
            onFocus={store.setAgent}
            onShowInWall={(name, reveal) => {
              store.setAgent(name);
              setAlsoReveal(reveal ?? null);
              store.setView('wall');
            }}
            now={now}
            readOnly={state.readOnly}
          />
        )}
        {view === 'tasks' && <Tasks tasks={state.tasks} teamName={state.teamName} />}
        {view === 'trace' && soloLead && (
          <Trace
            agent={soloLead.name}
            subagents={
              state.subagents?.[soloLead.name] ?? Object.values(state.subagents ?? {}).flat()
            }
            now={now}
            selected={traceSelected}
            onSelect={setTraceSelected}
          />
        )}
        {view === 'rail' && (
          <Rail
            agents={state.agents}
            focused={store.agent}
            onFocus={store.setAgent}
            now={now}
            readOnly={state.readOnly}
            subagents={state.subagents}
          />
        )}
        {view === 'grid' && (
          <Grid
            agents={state.agents}
            focused={store.agent}
            onFocus={store.setAgent}
            now={now}
            subagents={state.subagents}
          />
        )}
        {view === 'usage' && (
          <Usage
            mode="team"
            state={state}
            now={now}
            focused={store.agent}
            onFocus={(name) => {
              store.setAgent(name);
              store.setView('wall');
            }}
            spendSamples={spendSamples}
          />
        )}
        </>
        )}
      </main>
      <DiffModal diff={store.openDiff} onClose={() => store.setOpenDiff(null)} />
      <StopConfirm target={stopping} onConfirm={confirmStop} onCancel={() => setStopping(null)} />
      <WatchConfirm
        show={pendingDismiss}
        onConfirm={() => {
          setAwaySince({ at: Date.now(), cost: state.totalCostUsd });
          setDismissed(true);
          setPendingDismiss(false);
        }}
        onCancel={() => setPendingDismiss(false)}
      />
      <NeedsYou items={state.needsYou} readOnly={state.readOnly} now={now} />
      <Panel agents={state.agents} focusedAgent={store.agent} onFocusAgent={store.setAgent} />
    </div>
    </WatchContext.Provider>
    </DiffContext.Provider>
    </CastContext.Provider>
    </SettingsContext.Provider>
    </StopContext.Provider>
  );
}
