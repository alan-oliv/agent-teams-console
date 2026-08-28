import config from '../../../fixtures/config-4-members.json';
import sidecars from '../../../fixtures/meta-sidecars.json';
import rawTasks from '../../../fixtures/tasks.json';
import type { Agent, AgentStatus, Task, TeamState, TeamSummary } from '../../shared/domain';

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
}

const TUNING: Record<string, Tuning> = {
  'team-lead': { status: 'working', contextTokens: 53_100, costUsd: 1.31, model: 'claude-opus-5', ...OPUS },
  'probe-alpha': { status: 'idle', contextTokens: 120_000, costUsd: 0.42, model: 'claude-opus-5', ...OPUS },
  'probe-bravo': { status: 'working', contextTokens: 500_000, costUsd: 0.61, model: 'claude-opus-5', ...OPUS },
  'probe-charlie': { status: 'idle', contextTokens: 156_000, costUsd: 0.22, model: 'claude-haiku-4-5', ...HAIKU },
};

/** epoch ms 45m 12s after the fixture team was created */
export const FIXTURE_NOW = config.createdAt + 2_712_000;

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
      startedAt: m.joinedAt,
      transcript: [],
      unread: 0,
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
    mail: [],
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
    },
    {
      name: 'session-b5129c7b',
      members: 1,
      createdAt: config.createdAt - 86_400_000,
      leadSessionId: 'b5129c7b-a009-4de3-9a42-4664d1214f39',
      leadAlive: false,
      lastActivityAt: FIXTURE_NOW - 15_120_000,
      live: false,
      current: false,
    },
  ];
}
