import type { Agent, AgentStatus, TaskState } from './domain';

export interface StatusStyle { glyph: string; label: string; color: string }

export const AGENT_STATUS: Record<AgentStatus, StatusStyle> = {
  working: { glyph: '●', label: 'working', color: 'var(--color-accent-400)' },
  idle: { glyph: '○', label: 'idle', color: 'var(--color-neutral-600)' },
  plan_pending: { glyph: '▲', label: 'plan approval', color: '#d99e5c' },
  failed: { glyph: '✗', label: 'failed', color: '#c98d8d' },
  blocked: { glyph: '⊘', label: 'blocked', color: 'var(--color-neutral-600)' },
  departed: { glyph: '◌', label: 'departed', color: 'var(--color-neutral-800)' },
};

/**
 * How long a teammate can go with no transcript activity and no idle signal
 * before the console stops calling it 'working' and calls it 'departed'
 * instead. The system's own longest legitimate single stall is 600_000ms —
 * DEFAULT_PERMISSION_TIMEOUT_MS in server/ingest/hooks.ts, matched by the
 * Bash tool's own 10-minute cap — so this is 3x that: one maxed-out
 * permission hold plus ordinary slack can never trip it, but a process that
 * is really gone (seen live: silent 19h, no shutdown or idle frame ever
 * sent) does, in minutes rather than hours.
 */
export const AGENT_STALE_MS = 30 * 60 * 1000;

export const TASK_STATUS: Record<TaskState, StatusStyle> = {
  pending: { glyph: '○', label: 'pending', color: 'var(--color-neutral-500)' },
  in_progress: { glyph: '●', label: 'in progress', color: 'var(--color-accent-400)' },
  completed: { glyph: '✓', label: 'completed', color: 'var(--color-accent-500)' },
  plan_pending: { glyph: '▲', label: 'plan approval', color: '#d99e5c' },
  failed: { glyph: '✗', label: 'failed', color: '#c98d8d' },
  blocked: { glyph: '⊘', label: 'blocked', color: 'var(--color-neutral-600)' },
};

export function deriveTaskState(
  raw: 'pending' | 'in_progress' | 'completed',
  task: { owner?: string; blockedBy: string[] },
  agents: Agent[],
): TaskState {
  if (raw === 'completed') return 'completed';
  const owner = task.owner ? agents.find((a) => a.name === task.owner) : undefined;
  if (owner?.status === 'plan_pending') return 'plan_pending';
  if (owner?.status === 'failed') return 'failed';
  if (task.blockedBy.length > 0 || owner?.status === 'blocked') return 'blocked';
  return raw;
}
