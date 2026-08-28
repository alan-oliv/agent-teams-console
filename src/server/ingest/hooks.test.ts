import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, type Store, type StoredEvent } from '../store';
import type { HeldPermit, Permits } from '../control/permits';
import { agentNameFrom, createHookHandlers, type HookHandlers } from './hooks';
import type { HookPayload, StatuslinePayload, SubstatusPayload } from '../project';
import type { NeedsYouItem } from '../../shared/domain';

// permits.ts (Task 14) declares only the Permits port type; createPermits is
// added in Task 15. This fake gives the real async hold/resolve semantics the
// 'holds PermissionRequest' test needs, without depending on Task 15's work.
function stubPermits(): Permits & { held: HeldPermit[] } {
  const held: HeldPermit[] = [];
  const settlers = new Map<string, (d: { decision: 'allow' | 'deny'; reason?: string }) => void>();
  return {
    held,
    hold(agent, toolName, input, timeoutMs) {
      const id = `permit-${held.length + 1}`;
      held.push({ id, agent, toolName, input, expiresAt: Date.now() + timeoutMs });
      const promise = new Promise<{ decision: 'allow' | 'deny'; reason?: string }>((settle) => {
        settlers.set(id, settle);
      });
      return { id, promise };
    },
    resolve(id, decision, reason) {
      const idx = held.findIndex((p) => p.id === id);
      if (idx === -1) return false;
      held.splice(idx, 1);
      settlers.get(id)?.({ decision, reason });
      settlers.delete(id);
      return true;
    },
    list: () => held,
  };
}

let dir: string;
let store: Store;
let permits: Permits;
let handlers: HookHandlers;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hooks-'));
  store = openStore(path.join(dir, 'events.db'));
  permits = stubPermits();
  handlers = createHookHandlers({ store, permits });
});

afterEach(async () => {
  store.close();
  await fs.rm(dir, { recursive: true, force: true });
});

const of = (events: StoredEvent[], kind: string) => events.filter((e) => e.kind === kind);

describe('substatus scope rule: teammates only', () => {
  it('stores in_process_teammate rows and ignores every other subagent row', async () => {
    const store = openStore(':memory:');
    const handlers = createHookHandlers({ store, permits: stubPermits() });

    await handlers.substatus({
      session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283',
      tasks: [
        { agentId: 'probe-alpha', name: 'probe-alpha', type: 'in_process_teammate',
          tokenCount: 34469, contextWindowSize: 1000000, status: 'active', model: 'claude-opus-5' },
        { agentId: 'a9f20a3464bfe2362', name: 'searcher', type: 'task',
          tokenCount: 91000, contextWindowSize: 1000000, status: 'active', model: 'claude-opus-5' },
        { agentId: 'a3eeaa94f896ac303', name: 'plan-author', type: 'workflow',
          tokenCount: 120000, contextWindowSize: 1000000, status: 'active', model: 'claude-opus-5' },
      ],
    });

    const rows = store.replay().filter((e) => e.kind === 'substatus');
    expect(rows).toHaveLength(1);
    expect(rows[0].agent).toBe('probe-alpha');
    expect((rows[0].payload as { tokenCount: number }).tokenCount).toBe(34469);
    store.close();
  });
});

describe('agentNameFrom', () => {
  it('strips the a-prefix and 16-hex suffix of a subagent id', () => {
    expect(agentNameFrom('aprobe-alpha-84fd551b27de6433')).toBe('probe-alpha');
    expect(agentNameFrom('aprobe-charlie-12ee4cb1ed35cf7c')).toBe('probe-charlie');
  });

  it('takes the bare name from an agentId', () => {
    expect(agentNameFrom('probe-bravo@session-98b0b4a7')).toBe('probe-bravo');
  });

  it('falls back to the lead name', () => {
    expect(agentNameFrom(undefined)).toBe('team-lead');
    expect(agentNameFrom(null, 'lead')).toBe('lead');
  });
});

describe('hook', () => {
  it('answers a non-permission hook immediately and attributes the agent', async () => {
    const res = await handlers.hook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'sleep 10' },
      agent_id: 'aprobe-alpha-84fd551b27de6433',
      agent_type: 'general-purpose',
    });
    expect(res).toEqual({ status: 200, body: {} });

    const events = of(store.replay(), 'hook');
    expect(events).toHaveLength(1);
    expect(events[0].agent).toBe('probe-alpha');
    expect(events[0].payload).toMatchObject({ event: 'PreToolUse', agent: 'probe-alpha', toolName: 'Bash' });
  });

  it('never throws on a malformed body', async () => {
    expect(await handlers.hook(null)).toEqual({ status: 200, body: {} });
    expect(await handlers.hook('nonsense')).toEqual({ status: 200, body: {} });
    expect(await handlers.hook({ hook_event_name: 42 })).toEqual({ status: 200, body: {} });
  });

  it('captures MessageDisplay text and UserPromptSubmit prompts', async () => {
    await handlers.hook({ hook_event_name: 'Notification', message: 'Claude needs your permission' });
    await handlers.hook({ hook_event_name: 'UserPromptSubmit', prompt: 'spawn three probes' });
    const events = of(store.replay(), 'hook').map((e) => e.payload as HookPayload);
    expect(events[0].text).toBe('Claude needs your permission');
    expect(events[1].text).toBe('spawn three probes');
  });

  it('holds PermissionRequest until the operator decides', async () => {
    const pending = handlers.hook({
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf migrations/legacy' },
      agent_id: 'aprobe-bravo-babf58016882bc72',
      timeout: 10000,
    });

    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false);

    const card = of(store.replay(), 'needsyou').at(-1)!.payload as NeedsYouItem;
    expect(card.kind).toBe('permission');
    expect(card.agent).toBe('probe-bravo');
    expect(card.detail).toContain('Bash');
    expect(permits.list().map((p) => p.id)).toEqual([card.id]);

    expect(permits.resolve(card.id, 'allow')).toBe(true);
    expect(await pending).toEqual({
      status: 200,
      body: {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          permissionDecision: 'allow',
          permissionDecisionReason: '',
        },
      },
    });
    expect((of(store.replay(), 'needsyou-resolved').at(-1)!.payload as { id: string }).id).toBe(card.id);
  });
});

describe('--read-only', () => {
  it('answers PermissionRequest immediately instead of holding the turn', async () => {
    // Holding in read-only was the worst case: the card renders with disabled
    // buttons, /api/permits 409s, nobody can resolve it, and the agent stalls
    // for the full 540s auto-deny.
    const readOnly = createHookHandlers({ store, permits, readOnly: true });
    const out = await readOnly.hook({
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf migrations/legacy' },
      agent_id: 'aprobe-bravo-babf58016882bc72',
      timeout: 10000,
    });
    expect(out).toEqual({ status: 200, body: {} });
    expect(permits.list()).toEqual([]);
    expect(of(store.replay(), 'needsyou')).toEqual([]);
  });
});

describe('SessionEnd', () => {
  it('exits only for the lead session', async () => {
    // The hooks live in ~/.claude/settings.json — user scope — so every session
    // on the machine posts SessionEnd here.
    const ended: string[] = [];
    const withLead = createHookHandlers({
      store,
      permits,
      leadSessionId: () => 'lead-session-id',
      onShutdown: () => ended.push('shutdown'),
    });

    await withLead.hook({ hook_event_name: 'SessionEnd', session_id: 'some-other-session' });
    await new Promise((r) => setTimeout(r, 400));
    expect(ended).toEqual([]);

    await withLead.hook({ hook_event_name: 'SessionEnd', session_id: 'lead-session-id' });
    await new Promise((r) => setTimeout(r, 400));
    expect(ended).toEqual(['shutdown']);
  });

  it('does not exit while the lead session is still unknown', async () => {
    const ended: string[] = [];
    const noLead = createHookHandlers({ store, permits, onShutdown: () => ended.push('shutdown') });
    await noLead.hook({ hook_event_name: 'SessionEnd', session_id: 'anything' });
    await new Promise((r) => setTimeout(r, 400));
    expect(ended).toEqual([]);
  });
});

describe('statusline', () => {
  it('extracts cost, context window and both rate limits', async () => {
    const res = await handlers.statusline({
      cost: { total_cost_usd: 8.4 },
      context_window: { used_tokens: 53100, max_tokens: 1000000 },
      rate_limits: {
        five_hour: { used_pct: 41, resets_at: '2026-08-27T20:00:00Z' },
        seven_day: { used_pct: 12 },
      },
      gitBranch: 'HEAD',
    });
    expect(res).toEqual({ status: 200, body: {} });

    const payload = of(store.replay(), 'statusline').at(-1)!.payload as StatuslinePayload;
    expect(payload.totalCostUsd).toBe(8.4);
    expect(payload.contextTokens).toBe(53100);
    expect(payload.contextWindow).toBe(1000000);
    expect(payload.fiveHourPct).toBe(41);
    expect(payload.sevenDayPct).toBe(12);
    expect(payload.resetsAt).toBe('2026-08-27T20:00:00Z');
    expect(payload.branch).toBe('HEAD');
  });

  it('answers 200 on a body with none of the expected fields', async () => {
    expect(await handlers.statusline({})).toEqual({ status: 200, body: {} });
    expect(await handlers.statusline(undefined)).toEqual({ status: 200, body: {} });
  });
});

describe('substatus', () => {
  it('appends one event per teammate task entry', async () => {
    const res = await handlers.substatus({
      tasks: [
        { name: 'probe-charlie', type: 'in_process_teammate', tokenCount: 23639, contextWindowSize: 200000, status: 'idle', model: 'claude-haiku-4-5-20251001' },
        { agentId: 'aprobe-alpha-84fd551b27de6433', type: 'in_process_teammate', tokenCount: 34469, contextWindowSize: 1000000, status: 'working' },
      ],
    });
    expect(res).toEqual({ status: 200, body: {} });

    const payloads = of(store.replay(), 'substatus').map((e) => e.payload as SubstatusPayload);
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toEqual({
      agent: 'probe-charlie',
      tokenCount: 23639,
      contextWindowSize: 200000,
      status: 'idle',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(payloads[1].agent).toBe('probe-alpha');
    expect(payloads[1].tokenCount).toBe(34469);
  });

  it('drops a task row with no type field, rather than treating it as a teammate', async () => {
    const res = await handlers.substatus({
      tasks: [
        { name: 'probe-charlie', tokenCount: 23639, contextWindowSize: 200000, status: 'idle' },
      ],
    });
    expect(res).toEqual({ status: 200, body: {} });
    expect(of(store.replay(), 'substatus')).toHaveLength(0);
  });

  it('answers 200 when tasks is missing', async () => {
    expect(await handlers.substatus({})).toEqual({ status: 200, body: {} });
    expect(store.replay()).toHaveLength(0);
  });
});
