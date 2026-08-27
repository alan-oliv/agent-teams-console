// Test support only. Builds the four real spike agents from the captured corpus.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Agent, AgentStatus, Marker, TranscriptLine } from '../shared/domain';
import type { Sidecar, TeamConfig } from '../shared/roster';

// Resolved via fileURLToPath + path, not `new URL(rel, import.meta.url)` directly:
// Vite statically rewrites that literal pattern into a dev-server asset URL, which
// breaks under the jsdom test environment (Composer.test.tsx needs jsdom for RTL).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(HERE, '../../fixtures/config-4-members.json');
const SIDECAR_PATH = path.resolve(HERE, '../../fixtures/meta-sidecars.json');

// probe-alpha is mid-`sleep 20`; probe-charlie has already sent its idle_notification.
export const FIXTURE_NOW = 1787843425000;

const MODEL: Record<string, string> = {
  'team-lead': 'claude-opus-5',
  'probe-alpha': 'claude-opus-5',
  'probe-bravo': 'claude-opus-5',
  'probe-charlie': 'claude-haiku-4-5',
};

// input_tokens + cache_read + cache_creation of the last record per agent in usage-records.json.
const CONTEXT_TOKENS: Record<string, number> = {
  'team-lead': 0,
  'probe-alpha': 34_469,
  'probe-bravo': 34_561,
  'probe-charlie': 23_639,
};

// Spec §4.1 cost formula over the deduped records in usage-records.json.
const COST_USD: Record<string, number> = {
  'team-lead': 0,
  'probe-alpha': 0.464434,
  'probe-bravo': 0.390121,
  'probe-charlie': 0.044338,
};

const RUN_STATE: Record<string, { status: AgentStatus; currentTool?: string }> = {
  'team-lead': { status: 'working', currentTool: 'Task(probe-charlie)' },
  'probe-alpha': { status: 'working', currentTool: 'Bash(sleep 20)' },
  'probe-bravo': { status: 'working', currentTool: 'Bash(sleep 20)' },
  'probe-charlie': { status: 'idle' },
};

const TRANSCRIPTS: Record<string, Array<[Marker, string]>> = {
  'team-lead': [
    ['❯', 'run the agent-teams data-capture spike'],
    ['⏺', 'Task(probe-alpha) general-purpose'],
    ['⏺', 'Task(probe-bravo) Explore'],
    ['⏺', 'Task(probe-charlie) general-purpose'],
    ['⎿', 'probe-charlie alive'],
    ['⎿', 'probe-alpha claimed task 1'],
  ],
  'probe-alpha': [
    ['❯', 'Spike probe alpha'],
    ['⏺', 'Bash(sleep 10)'],
    ['⏺', 'TaskList'],
    ['⏺', 'TaskUpdate(1) owner=probe-alpha status=in_progress'],
    ['⏺', 'SendMessage(team-lead) probe-alpha claimed task 1'],
    ['⏺', 'Bash(sleep 20)'],
  ],
  'probe-bravo': [
    ['❯', 'Spike probe bravo'],
    ['⏺', 'Bash(sleep 12)'],
    ['⏺', 'TaskUpdate(2) owner=probe-bravo status=in_progress'],
    ['⏺', 'SendMessage(probe-alpha) bravo greets alpha'],
    ['⏺', 'SendMessage(team-lead) probe-bravo claimed task 2'],
    ['⏺', 'Bash(sleep 20)'],
  ],
  'probe-charlie': [
    ['❯', 'Spike probe charlie'],
    ['⏺', 'Bash(sleep 14)'],
    ['⏺', 'SendMessage(team-lead) probe-charlie alive'],
    ['⏺', 'Bash(sleep 30)'],
    ['✓', 'probe-charlie done'],
  ],
};

function linesFor(name: string, joinedAt: number): TranscriptLine[] {
  return (TRANSCRIPTS[name] ?? []).map(([marker, text], i) => ({
    id: `${name}-${i}`,
    marker,
    text,
    ts: joinedAt + i * 1000,
  }));
}

export function fixtureAgents(): Agent[] {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as TeamConfig;
  const sidecars = JSON.parse(readFileSync(SIDECAR_PATH, 'utf8')) as Sidecar[];

  return config.members.map((m): Agent => {
    const model = MODEL[m.name];
    const contextLimit = model === 'claude-haiku-4-5' ? 200_000 : 1_000_000;
    const run = RUN_STATE[m.name];
    return {
      name: m.name,
      agentId: m.agentId,
      isLead: m.agentId === config.leadAgentId,
      agentType: m.agentType ?? 'team-lead',
      model,
      role: sidecars.find((s) => s.name === m.name)?.description ?? 'team lead',
      color: m.color,
      status: run.status,
      currentTool: run.currentTool,
      contextTokens: CONTEXT_TOKENS[m.name],
      contextLimit,
      compactAt: contextLimit - 33_000,
      costUsd: COST_USD[m.name],
      startedAt: m.joinedAt,
      transcript: linesFor(m.name, m.joinedAt),
      unread: 0,
    };
  });
}

export function padAgents(agents: Agent[], count: number): Agent[] {
  const out = agents.slice();
  while (out.length < count) {
    const src = agents[out.length % agents.length];
    const name = `${src.name}-${out.length}`;
    out.push({ ...src, name, agentId: `${name}@session-98b0b4a7`, isLead: false });
  }
  return out;
}
