import type { Store } from '../store';
import { holdMsFor, type Permits } from '../control/permits';
import { debug, logError, logInfo } from '../log';

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
  readOnly?: boolean;
  /**
   * The lead's session id, read late: the console can start before any team
   * exists, so the ingest may only learn it once config.json lands.
   */
  leadSessionId?: () => string | undefined;
  /** Runs when the LEAD's session ends. Defaults to exiting the process. */
  onShutdown?: () => void;
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
  const shutdown =
    deps.onShutdown ??
    (() => {
      logInfo('lead session ended — exiting');
      process.exit(0);
    });

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
          // The hooks live in ~/.claude/settings.json — USER scope — so every
          // session on the machine posts SessionEnd here. Only the lead's ends
          // the console; the 10-minute idle reaper covers a crashed lead.
          const ending = str(b.session_id);
          const lead = deps.leadSessionId?.();
          if (lead && ending === lead) {
            // Respond first; a hook that never gets its 200 stalls the session's exit.
            setTimeout(shutdown, 250);
          } else {
            debug('hook', `SessionEnd for ${ending ?? 'an unknown session'} is not the lead's`);
          }
        }

        if (event !== 'PermissionRequest') return { status: 200, body: {} };

        // Holding in read-only mode is the worst of both worlds: the card
        // renders with its buttons disabled, /api/permits 409s, and nobody can
        // resolve it, so the agent stalls for the full auto-deny window.
        // Answering with no decision hands the prompt back to Claude Code.
        if (deps.readOnly) return { status: 200, body: {} };

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
            expiresAt: Date.now() + holdMsFor(timeoutMs),
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
      } catch (err) {
        logError('hook', err);
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
      } catch (err) {
        logError('statusline hook', err); // never throw into the turn
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
      } catch (err) {
        logError('substatus hook', err); // never throw into the turn
      }
      return { status: 200, body: {} };
    },
  };
}
