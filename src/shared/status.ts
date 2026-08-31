import type { Agent, AgentStatus, TaskState } from './domain';

export interface StatusStyle { glyph: string; label: string; color: string }

export const AGENT_STATUS: Record<AgentStatus, StatusStyle> = {
  working: { glyph: '●', label: 'working', color: 'var(--color-accent-400)' },
  idle: { glyph: '○', label: 'idle', color: 'var(--color-neutral-600)' },
  plan_pending: { glyph: '▲', label: 'plan approval', color: 'var(--warn)' },
  failed: { glyph: '✗', label: 'failed', color: 'var(--fail)' },
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

/**
 * How far a transcript file's own clock may sit from the newest timestamp
 * inside it before the console stops reading the wall clock against it.
 *
 * Generous by two orders of magnitude on purpose: a live append writes its
 * record within milliseconds of the timestamp it carries, and the case being
 * excluded is days out, so anything between is a machine having a bad day
 * rather than a case worth tuning for.
 */
export const LOG_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Whether a transcript's two clocks are the same clock, and therefore whether
 * `Date.now()` means anything when measured against its records.
 *
 * This is the whole of what separates a session that has gone quiet from a
 * replayed one, and it is why staleness could not simply be measured against
 * the wall clock (CONSOLE-NOTES.md §17). A log being appended live has an mtime
 * that tracks the timestamps inside it — both are now, and hours later both are
 * hours old together. A fixture or a replayed log is written NOW and describes
 * days ago, so its two clocks are days apart and the wall clock says nothing
 * about the agent that wrote it.
 *
 * Note what this deliberately does NOT ask: whether the file is still growing.
 * A file that stopped growing is the case being judged, not evidence about it —
 * a session silent for ten hours and a replay both sit perfectly still.
 */
export function isWallClockLog(mtimeMs: number | undefined, lastRecordTs: number): boolean {
  if (mtimeMs === undefined || lastRecordTs <= 0) return false;
  return Math.abs(mtimeMs - lastRecordTs) <= LOG_CLOCK_SKEW_MS;
}

/**
 * Agents drawn at reduced strength. `idle` sits with `departed` because an
 * idle teammate is a subagent that has already returned its result — the
 * console cannot reach it, and a `shutdown_request` written to its inbox
 * drains with nothing running to read it. Drawing it at full strength beside
 * a working agent implies a teammate that is merely between turns.
 *
 * `failed`, `blocked` and `plan_pending` are deliberately NOT here: each one
 * wants the operator, and dimming the rows that need a human is backwards.
 */
export function isDormant(status: AgentStatus): boolean {
  return status === 'idle' || status === 'departed';
}

export const DORMANT_OPACITY = 0.55;

export const TASK_STATUS: Record<TaskState, StatusStyle> = {
  pending: { glyph: '○', label: 'pending', color: 'var(--color-neutral-500)' },
  in_progress: { glyph: '●', label: 'in progress', color: 'var(--color-accent-400)' },
  completed: { glyph: '✓', label: 'completed', color: 'var(--color-accent-500)' },
  plan_pending: { glyph: '▲', label: 'plan approval', color: 'var(--warn)' },
  failed: { glyph: '✗', label: 'failed', color: 'var(--fail)' },
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
  if (owner?.status === 'blocked') return 'blocked';
  // Once someone has started a task, an unresolved dependency no longer
  // describes it — 'blocked' only applies before work begins.
  if (raw === 'pending' && task.blockedBy.length > 0) return 'blocked';
  return raw;
}
