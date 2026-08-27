// src/shared/status.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Agent, AgentStatus } from './domain';
import { AGENT_STATUS, deriveTaskState, TASK_STATUS } from './status';

interface DiskTask {
  id: string; subject: string; description: string; activeForm: string;
  owner?: string; status: 'pending' | 'in_progress' | 'completed';
  blocks: string[]; blockedBy: string[];
}

const diskTasks = JSON.parse(
  readFileSync(new URL('../../fixtures/tasks.json', import.meta.url), 'utf8'),
) as DiskTask[];

const agent = (name: string, status: AgentStatus): Agent => ({
  name,
  agentId: `${name}@session-98b0b4a7`,
  isLead: false,
  agentType: 'general-purpose',
  model: 'claude-opus-5',
  role: 'Spike probe alpha',
  status,
  contextTokens: 34469,
  contextLimit: 1_000_000,
  compactAt: 967_000,
  costUsd: 0.464434,
  startedAt: 1787843382976,
  transcript: [],
  unread: 0,
});

describe('AGENT_STATUS', () => {
  it('carries the exact glyphs, labels and colours from the design', () => {
    expect(AGENT_STATUS.working).toEqual({ glyph: '●', label: 'working', color: 'var(--color-accent-400)' });
    expect(AGENT_STATUS.idle).toEqual({ glyph: '○', label: 'idle', color: 'var(--color-neutral-600)' });
    expect(AGENT_STATUS.plan_pending).toEqual({ glyph: '▲', label: 'plan approval', color: '#d99e5c' });
    expect(AGENT_STATUS.failed).toEqual({ glyph: '✗', label: 'failed', color: '#c98d8d' });
    expect(AGENT_STATUS.blocked).toEqual({ glyph: '⊘', label: 'blocked', color: 'var(--color-neutral-600)' });
    expect(Object.keys(AGENT_STATUS)).toHaveLength(5);
  });
});

describe('TASK_STATUS', () => {
  it('carries the exact glyphs, labels and colours from the design', () => {
    expect(TASK_STATUS.pending).toEqual({ glyph: '○', label: 'pending', color: 'var(--color-neutral-500)' });
    expect(TASK_STATUS.in_progress).toEqual({ glyph: '●', label: 'in progress', color: 'var(--color-accent-400)' });
    expect(TASK_STATUS.completed).toEqual({ glyph: '✓', label: 'completed', color: 'var(--color-accent-500)' });
    expect(TASK_STATUS.plan_pending).toEqual({ glyph: '▲', label: 'plan approval', color: '#d99e5c' });
    expect(TASK_STATUS.failed).toEqual({ glyph: '✗', label: 'failed', color: '#c98d8d' });
    expect(TASK_STATUS.blocked).toEqual({ glyph: '⊘', label: 'blocked', color: 'var(--color-neutral-600)' });
    expect(Object.keys(TASK_STATUS)).toHaveLength(6);
  });

  it('uses the attention amber for plan approval and the failure rose for failed', () => {
    expect(TASK_STATUS.plan_pending.color).toBe('#d99e5c');
    expect(TASK_STATUS.failed.color).toBe('#c98d8d');
  });
});

describe('deriveTaskState', () => {
  it('passes the three on-disk states through when nothing derives', () => {
    const unclaimed = diskTasks[0];
    expect(unclaimed.status).toBe('pending');
    expect(deriveTaskState(unclaimed.status, unclaimed, [])).toBe('pending');

    const claimed = diskTasks[2];
    expect(claimed.status).toBe('in_progress');
    expect(claimed.owner).toBe('probe-alpha');
    expect(deriveTaskState(claimed.status, claimed, [agent('probe-alpha', 'working')])).toBe('in_progress');

    const done = diskTasks[4];
    expect(done.status).toBe('completed');
    expect(deriveTaskState(done.status, done, [agent('probe-alpha', 'working')])).toBe('completed');
  });

  it('derives plan_pending from the owning agent', () => {
    const claimed = diskTasks[2];
    expect(deriveTaskState(claimed.status, claimed, [agent('probe-alpha', 'plan_pending')])).toBe('plan_pending');
  });

  it('derives failed from the owning agent', () => {
    const claimed = diskTasks[2];
    expect(deriveTaskState(claimed.status, claimed, [agent('probe-alpha', 'failed')])).toBe('failed');
  });

  it('derives blocked from a non-empty blockedBy', () => {
    expect(deriveTaskState('pending', { blockedBy: ['1'] }, [])).toBe('blocked');
    expect(deriveTaskState('in_progress', { owner: 'probe-alpha', blockedBy: ['1', '2'] }, [
      agent('probe-alpha', 'working'),
    ])).toBe('blocked');
  });

  it('derives blocked from a blocked owner', () => {
    expect(deriveTaskState('in_progress', { owner: 'probe-alpha', blockedBy: [] }, [
      agent('probe-alpha', 'blocked'),
    ])).toBe('blocked');
  });

  it('lets completed beat every derived state', () => {
    expect(deriveTaskState('completed', { owner: 'probe-alpha', blockedBy: ['1'] }, [
      agent('probe-alpha', 'failed'),
    ])).toBe('completed');
  });

  it('ignores an owner that is not in the roster', () => {
    expect(deriveTaskState('in_progress', { owner: 'probe-ghost', blockedBy: [] }, [
      agent('probe-alpha', 'failed'),
    ])).toBe('in_progress');
  });
});
