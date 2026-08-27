import type { Store } from '../store';
import type { Permits } from '../control/permits';

export const DEFAULT_PERMISSION_TIMEOUT_MS = 600_000;
const SUBAGENT_ID = /^a(.+)-[0-9a-f]{16}$/;

export interface HookResponse {
  status: number;
  body: unknown;
}

export interface HookDeps {
  store: Store;
  permits: Permits;
  permissionTimeoutMs?: number;
  leadName?: string;
}

export interface HookHandlers {
  hook(body: unknown): Promise<HookResponse>;
  statusline(body: unknown): Promise<HookResponse>;
  substatus(body: unknown): Promise<HookResponse>;
}

type Bag = Record<string, unknown>;

const bagOf = (v: unknown): Bag => (v !== null && typeof v === 'object' ? (v as Bag) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function agentNameFrom(raw: unknown, leadName = 'team-lead'): string {
  const id = str(raw);
  if (!id) return leadName;
  const at = id.indexOf('@');
  if (at > 0) return id.slice(0, at);
  const m = SUBAGENT_ID.exec(id);
  return m ? m[1] : id;
}

// The statusline rate-limit and context-window shapes are not pinned by the
// contract, so both readers below are tolerant: a bare number, or an object
// carrying any of the observed key spellings.
function pctOf(raw: unknown): number | undefined {
  const n = num(raw);
  if (n !== undefined) return n;
  const b = bagOf(raw);
  return num(b.used_pct) ?? num(b.utilization) ?? num(b.percent);
}

function resetOf(raw: unknown): string | undefined {
  const b = bagOf(raw);
  return str(b.resets_at) ?? str(b.reset_at) ?? str(b.resetsAt);
}

export function createHookHandlers(deps: HookDeps): HookHandlers {
  const { store, permits } = deps;
  const leadName = deps.leadName ?? 'team-lead';

  return {
    async hook(body) {
      // A thrown error or a hang here is a 10-minute stall of the agent's turn,
      // so every path returns 200 and nothing escapes this try.
      try {
        const b = bagOf(body);
        const event = str(b.hook_event_name) ?? '';
        const agent = agentNameFrom(b.agent_id, leadName);
        const toolName = str(b.tool_name);
        const text = str(b.message) ?? str(b.prompt);
        store.append('hook', { event, agent, toolName, text }, agent);

        if (event === 'SessionEnd') {
          // Respond first; a hook that never gets its 200 stalls the session's exit.
          setTimeout(() => {
            console.error('[octo] session ended — exiting');
            process.exit(0);
          }, 250);
        }

        if (event !== 'PermissionRequest') return { status: 200, body: {} };

        const timeoutMs = num(b.timeout) ?? deps.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS;
        const held = permits.hold(agent, toolName ?? 'unknown', b.tool_input, timeoutMs);
        store.append(
          'needsyou',
          {
            id: held.id,
            kind: 'permission',
            agent,
            reason: 'permission',
            detail: `${toolName ?? 'unknown'} — awaiting your decision`,
            expiresAt: Date.now() + Math.floor(timeoutMs * 0.9),
          },
          agent,
        );

        const decided = await held.promise;
        store.append('needsyou-resolved', { id: held.id }, agent);
        return {
          status: 200,
          body: {
            hookSpecificOutput: {
              hookEventName: 'PermissionRequest',
              permissionDecision: decided.decision,
              permissionDecisionReason: decided.reason ?? '',
            },
          },
        };
      } catch {
        return { status: 200, body: {} };
      }
    },

    async statusline(body) {
      try {
        const b = bagOf(body);
        const cost = bagOf(b.cost);
        const window = bagOf(b.context_window);
        const limits = bagOf(b.rate_limits);
        store.append(
          'statusline',
          {
            totalCostUsd: num(cost.total_cost_usd),
            contextTokens: num(window.used_tokens) ?? num(window.input_tokens),
            contextWindow: num(window.max_tokens) ?? num(window.context_window_size),
            branch: str(b.gitBranch) ?? str(b.branch),
            fiveHourPct: pctOf(limits.five_hour),
            sevenDayPct: pctOf(limits.seven_day),
            resetsAt: resetOf(limits.five_hour),
          },
          agentNameFrom(b.agent_id, leadName),
        );
      } catch {
        /* never throw into the turn */
      }
      return { status: 200, body: {} };
    },

    async substatus(body) {
      try {
        const b = bagOf(body);
        const tasks = Array.isArray(b.tasks) ? b.tasks : [];
        for (const raw of tasks) {
          const t = bagOf(raw);
          // SCOPE RULE: agent teams only. subagentStatusLine reports a row for
          // EVERY subagent, including Agent-tool subagents and workflow
          // fan-outs. Only in_process_teammate rows are team members — a row
          // with no `type` at all is dropped, not treated as a teammate.
          if (str(t.type) !== 'in_process_teammate') continue;
          const agent = agentNameFrom(t.agentId ?? t.agent_id ?? t.name, leadName);
          store.append(
            'substatus',
            {
              agent,
              tokenCount: num(t.tokenCount),
              contextWindowSize: num(t.contextWindowSize),
              status: str(t.status),
              model: str(t.model),
            },
            agent,
          );
        }
      } catch {
        /* never throw into the turn */
      }
      return { status: 200, body: {} };
    },
  };
}
