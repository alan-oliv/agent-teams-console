import { useEffect } from 'react';
import type { ViewId } from '../../shared/domain';

const VIEW_ORDER: ViewId[] = ['wall', 'overview', 'comms', 'tasks', 'rail', 'grid'];

const STEP: Record<string, number | undefined> = {
  ArrowUp: -1,
  ArrowDown: 1,
  h: -1,
  l: 1,
};

export interface KeyboardActions {
  agents: string[];
  view: ViewId;
  focused: string | null;
  setFocused(name: string): void;
  setView(view: ViewId): void;
  interrupt(name: string): void;
  stop(name: string): void;
  toggleTeams(): void;
  /**
   * True while a modal owns the keyboard. The wall's bindings are not merely
   * shadowed but unbound: Esc has to close the patch rather than interrupt the
   * focused agent, and j/k must not also drive a selection behind the scrim.
   */
  suspended?: boolean;
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.isContentEditable === true;
}

export function useKeyboard(actions: KeyboardActions): void {
  useEffect(() => {
    if (actions.suspended) return;

    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (isEditable(e.target)) return;

      if (e.metaKey) {
        if (e.ctrlKey || e.altKey) return;
        const view = VIEW_ORDER[Number(e.key) - 1];
        if (view) {
          e.preventDefault();
          actions.setView(view);
        }
        return;
      }

      if (e.ctrlKey) {
        if (e.altKey) return;
        if (e.key === 't' || e.key === 'T') {
          e.preventDefault();
          actions.setView(actions.view === 'tasks' ? 'wall' : 'tasks');
        }
        return;
      }

      if (e.altKey) return;

      // A view that handled the key itself — the rail's own listbox — calls
      // preventDefault, so selection is not applied twice.
      if (e.defaultPrevented) return;

      // Above the focused-agent guard below: which team the console is showing is
      // not a per-agent action, and there is no agent to focus in a team the
      // console has not ingested yet.
      if (e.key === 't') {
        e.preventDefault();
        actions.toggleTeams();
        return;
      }

      // The panel legend advertises ↑↓ and ⏎ (spec §6); h/l stay as vim aliases.
      const step = STEP[e.key];
      if (step !== undefined) {
        if (actions.agents.length === 0) return;
        e.preventDefault();
        const at = actions.focused ? actions.agents.indexOf(actions.focused) : 0;
        const from = at < 0 ? 0 : at;
        const next = Math.min(actions.agents.length - 1, Math.max(0, from + step));
        actions.setFocused(actions.agents[next]);
        return;
      }

      if (!actions.focused) return;

      if (e.key === 'Enter') {
        // "open" the focused agent: the rail is the single-agent detail view.
        e.preventDefault();
        actions.setView('rail');
      } else if (e.key === 'Escape') {
        actions.interrupt(actions.focused);
      } else if (e.key === 'x') {
        actions.stop(actions.focused);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);
}
