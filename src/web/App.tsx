import { useEffect, useState } from 'react';
import './theme.css';
import { NeedsYou } from './chrome/NeedsYou';
import { Panel } from './chrome/Panel';
import { StatusBar } from './chrome/StatusBar';
import { useTeamState } from './state/useTeamState';
import { Grid } from './views/Grid';
import { Overview } from './views/Overview';
import { Rail } from './views/Rail';
import { Tasks } from './views/Tasks';
import { Wall } from './views/Wall';

export function App() {
  const store = useTeamState();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const state = store.state;
  if (!state) {
    return (
      <div className="console">
        <main className="console-body" />
      </div>
    );
  }

  return (
    <div className="console">
      <StatusBar state={state} view={store.view} onViewChange={store.setView} now={now} />
      <main className="console-body">
        {store.view === 'wall' && (
          <Wall agents={state.agents} focused={store.agent} onFocus={store.setAgent} now={now} />
        )}
        {store.view === 'overview' && (
          <Overview agents={state.agents} focused={store.agent} onFocus={store.setAgent} now={now} />
        )}
        {store.view === 'tasks' && (
          <Tasks tasks={state.tasks} mail={state.mail} teamName={state.teamName} />
        )}
        {store.view === 'rail' && (
          <Rail agents={state.agents} focused={store.agent} onFocus={store.setAgent} now={now} />
        )}
        {store.view === 'grid' && (
          <Grid agents={state.agents} focused={store.agent} onFocus={store.setAgent} now={now} />
        )}
      </main>
      <NeedsYou items={state.needsYou} readOnly={state.readOnly} now={now} />
      <Panel
        agents={state.agents}
        focusedAgent={store.agent}
        onFocusAgent={(name) => store.setAgent(name)}
      />
    </div>
  );
}
