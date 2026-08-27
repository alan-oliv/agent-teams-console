import { useEffect } from 'react';
import type { ViewId } from '../../shared/domain';

const VIEW_ORDER: ViewId[] = ['wall', 'overview', 'tasks', 'rail', 'grid'];

export interface KeyboardActions {
  agents: string[];
  view: ViewId;
  focused: string | null;
  setFocused(name: string): void;
  setView(view: ViewId): void;
  interrupt(name: string): void;
  stop(name: string): void;
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.isContentEditable === true;
}

export function useKeyboard(actions: KeyboardActions): void {
  useEffect(() => {
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

      if (e.key === 'h' || e.key === 'l') {
        if (actions.agents.length === 0) return;
        e.preventDefault();
        const at = actions.focused ? actions.agents.indexOf(actions.focused) : 0;
        const from = at < 0 ? 0 : at;
        const next = Math.min(actions.agents.length - 1, Math.max(0, from + (e.key === 'l' ? 1 : -1)));
        actions.setFocused(actions.agents[next]);
        return;
      }

      if (!actions.focused) return;

      if (e.key === 'Escape') {
        actions.interrupt(actions.focused);
      } else if (e.key === 'x') {
        actions.stop(actions.focused);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);
}
