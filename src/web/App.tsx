import { useEffect, useState } from 'react';
import './theme.css';
import { NeedsYou } from './chrome/NeedsYou';
import { Panel } from './chrome/Panel';
import { StatusBar } from './chrome/StatusBar';
import { useTeamState } from './state/useTeamState';

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
      <main className="console-body" />
      <NeedsYou items={state.needsYou} readOnly={state.readOnly} now={now} />
      <Panel
        agents={state.agents}
        focusedAgent={store.agent}
        onFocusAgent={(name) => store.setAgent(name)}
      />
    </div>
  );
}
