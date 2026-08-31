import config from '../../../fixtures/config-4-members.json';
import sidecars from '../../../fixtures/meta-sidecars.json';
import rawTasks from '../../../fixtures/tasks.json';
import type {
  Agent,
  AgentStatus,
  MailMessage,
  Task,
  TeamState,
  TeamSummary,
} from '../../shared/domain';
import type { TokenSplit } from '../../shared/cost';

const OPUS = { contextLimit: 1_000_000, compactAt: 967_000 };
const HAIKU = { contextLimit: 200_000, compactAt: 167_000 };

const ROLES = new Map(sidecars.map((s) => [s.name, s.description]));

interface Tuning {
  status: AgentStatus;
  contextTokens: number;
  contextLimit: number;
  compactAt: number;
  costUsd: number;
  model: string;
  tokenSplit: TokenSplit;
}

// Cache reads dominate real usage (~95% on the live team USAGE-STATE.md
// audited), so every fixture split follows that shape rather than an even
// spread — a usage-view test rendering an unrealistic split would not catch
// the bug it exists to catch.
const TUNING: Record<string, Tuning> = {
  'team-lead': {
    status: 'working', contextTokens: 53_100, costUsd: 1.31, model: 'claude-opus-5', ...OPUS,
    tokenSplit: { in: 4200, out: 3800, cacheWrite: 18_000, cacheWrite1h: 0, cacheRead: 2_400_000 },
  },
  'probe-alpha': {
    status: 'idle', contextTokens: 120_000, costUsd: 0.42, model: 'claude-opus-5', ...OPUS,
    tokenSplit: { in: 1800, out: 2600, cacheWrite: 9600, cacheWrite1h: 0, cacheRead: 1_180_000 },
  },
  'probe-bravo': {
    status: 'working', contextTokens: 500_000, costUsd: 0.61, model: 'claude-opus-5', ...OPUS,
    tokenSplit: { in: 2100, out: 3100, cacheWrite: 8800, cacheWrite1h: 0, cacheRead: 1_420_000 },
  },
  'probe-charlie': {
    status: 'idle', contextTokens: 156_000, costUsd: 0.22, model: 'claude-haiku-4-5', ...HAIKU,
    tokenSplit: { in: 900, out: 1200, cacheWrite: 6200, cacheWrite1h: 0, cacheRead: 410_000 },
  },
};

/** epoch ms 45m 12s after the fixture team was created */
export const FIXTURE_NOW = config.createdAt + 2_712_000;

/**
 * Two threads: one teammate-to-teammate exchange whose last message is still
 * sitting unread, and one settled report to the lead. The pair is what the
 * comms view groups on, so both directions of the first are present.
 */
export function sampleMail(): MailMessage[] {
  const base = config.createdAt + 600_000;
  return [
    {
      msgId: 'm1',
      from: 'probe-alpha',
      to: 'probe-bravo',
      text: 'I want to batch the lookup — does your rotation depend on it being per-session?',
      summary: 'batching vs rotation',
      ts: base,
      tsIsDelivery: false,
      read: true,
    },
    {
      msgId: 'm2',
      from: 'probe-bravo',
      to: 'probe-alpha',
      text: 'Rotation is keyed on the session row, so batching is fine.',
      summary: 'rotation is keyed on the row',
      ts: base + 60_000,
      tsIsDelivery: false,
      read: true,
    },
    {
      msgId: 'm3',
      from: 'probe-bravo',
      to: 'probe-alpha',
      text: 'Marking finding 1 resolved and dropping it from my report.',
      summary: 'finding 1 resolved',
      ts: FIXTURE_NOW - 34_000,
      tsIsDelivery: false,
      read: false,
    },
    {
      msgId: 'm4',
      from: 'probe-charlie',
      to: 'team-lead',
      text: 'coverage 84% → 91%, 46 tests green',
      summary: 'coverage roll-up',
      ts: base + 30_000,
      tsIsDelivery: false,
      read: true,
    },
  ];
}

export function sampleTeamState(): TeamState {
  const agents: Agent[] = config.members.map((m) => {
    const t = TUNING[m.name];
    return {
      name: m.name,
      agentId: m.agentId,
      isLead: m.agentId === config.leadAgentId,
      agentType: m.agentType,
      model: t.model,
      role: ROLES.get(m.name) ?? 'team lead',
      color: 'color' in m ? m.color : undefined,
      status: t.status,
      contextTokens: t.contextTokens,
      contextLimit: t.contextLimit,
      compactAt: t.compactAt,
      costUsd: t.costUsd,
      tokenSplit: t.tokenSplit,
      startedAt: m.joinedAt,
      transcript: [],
      // An inbox drains oldest first, so this is how many of the agent's
      // newest messages have not reached a turn boundary yet.
      unread: m.name === 'probe-alpha' ? 1 : 0,
    };
  });

  const done = rawTasks[4];
  const running = rawTasks[3];
  const tasks: Task[] = [
    {
      id: done.id,
      subject: done.subject,
      description: done.description,
      activeForm: done.activeForm,
      owner: 'probe-alpha',
      state: 'completed',
      blocks: [],
      blockedBy: [],
    },
    {
      id: running.id,
      subject: running.subject,
      description: running.description,
      activeForm: running.activeForm,
      owner: 'probe-bravo',
      state: 'in_progress',
      blocks: [],
      blockedBy: [],
    },
  ];

  return {
    teamName: config.name,
    leadSessionId: config.leadSessionId,
    startedAt: config.createdAt,
    totalTokens: agents.reduce((n, a) => n + a.contextTokens, 0),
    totalCostUsd: 2.56,
    rateLimits: { fiveHourPct: 41, sevenDayPct: 12 },
    agents,
    tasks,
    mail: sampleMail(),
    needsYou: [],
    readOnly: false,
  };
}

/**
 * `GET /api/teams` for a machine holding the fixture team plus one that has
 * finished — the two-row case the selector was designed against.
 */
export function sampleTeams(): TeamSummary[] {
  return [
    {
      name: config.name,
      members: config.members.length,
      createdAt: config.createdAt,
      leadSessionId: config.leadSessionId,
      leadAlive: true,
      lastActivityAt: FIXTURE_NOW - 12_000,
      live: true,
      current: true,
      branch: 'fix/engine-latency-and-frame-size',
      goal: 'agents-team-console-design',
      state: 'live',
    },
    {
      name: 'session-b5129c7b',
      members: 1,
      createdAt: config.createdAt - 86_400_000,
      leadSessionId: 'b5129c7b-a009-4de3-9a42-4664d1214f39',
      leadAlive: false,
      lastActivityAt: FIXTURE_NOW - 15_120_000,
      live: false,
      branch: 'main',
      state: 'done',
      current: false,
    },
  ];
}
