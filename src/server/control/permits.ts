// Task 15 appends createPermits to this file. Task 14 only needs the port
// type: hooks.ts holds a PermissionRequest against it and awaits the decision.
import { randomUUID } from 'node:crypto';

export interface HeldPermit {
  id: string;
  agent: string;
  toolName: string;
  input: unknown;
  expiresAt: number;
}

export interface Permits {
  hold(
    agent: string,
    toolName: string,
    input: unknown,
    timeoutMs: number,
  ): { id: string; promise: Promise<{ decision: 'allow' | 'deny'; reason?: string }> };
  resolve(id: string, decision: 'allow' | 'deny', reason?: string): boolean;
  list(): HeldPermit[];
}

export function autoDenyReason(timeoutMs: number): string {
  return `auto-denied after ${Math.floor(timeoutMs * 0.9)}ms with no operator response`;
}

interface Entry {
  permit: HeldPermit;
  timer: NodeJS.Timeout;
  settle(decision: 'allow' | 'deny', reason?: string): void;
}

export function createPermits(): Permits {
  const held = new Map<string, Entry>();

  return {
    hold(agent, toolName, input, timeoutMs) {
      const id = randomUUID();
      // Auto-deny short of the hook's own timeout so the agent gets a clear
      // refusal instead of the turn hanging to the full 600s.
      const holdMs = Math.floor(timeoutMs * 0.9);
      let settle!: (v: { decision: 'allow' | 'deny'; reason?: string }) => void;
      const promise = new Promise<{ decision: 'allow' | 'deny'; reason?: string }>((res) => {
        settle = res;
      });

      const timer = setTimeout(() => {
        held.delete(id);
        settle({ decision: 'deny', reason: autoDenyReason(timeoutMs) });
      }, holdMs);
      timer.unref?.();

      held.set(id, {
        permit: { id, agent, toolName, input, expiresAt: Date.now() + holdMs },
        timer,
        settle: (decision, reason) => settle({ decision, reason }),
      });

      return { id, promise };
    },

    resolve(id, decision, reason) {
      const entry = held.get(id);
      if (!entry) return false;
      clearTimeout(entry.timer);
      held.delete(id);
      entry.settle(decision, reason);
      return true;
    },

    list() {
      return [...held.values()].map((e) => e.permit);
    },
  };
}
