import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { teamNameFromSessionId, hasLiveTeam } from './lifecycle';

// Async execFile has no `input` option (only execFileSync/spawnSync do) — an
// async execFile call with `input` silently ignores it, leaving the child's
// stdin open forever. The script blocks on `cat` reading that stdin, which
// reads as the test hanging rather than failing. spawn + manual stdin.end()
// is the async-correct way to feed a child process stdin and await its exit.
function run(script: string, env: NodeJS.ProcessEnv, input: string): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(script, [], { env });
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', () => resolve({ stdout }));
    child.stdin.write(input);
    child.stdin.end();
  });
}

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'octo-life-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function writeTeam(name: string, memberNames: string[]) {
  const teamDir = path.join(dir, name);
  await fs.mkdir(teamDir, { recursive: true });
  await fs.writeFile(
    path.join(teamDir, 'config.json'),
    JSON.stringify({
      name,
      createdAt: 1787798107581,
      leadAgentId: `team-lead@${name}`,
      leadSessionId: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283',
      members: memberNames.map((n, i) => ({
        agentId: `${n}@${name}`,
        name: n,
        joinedAt: 1787798107581 + i,
        tmuxPaneId: n === 'team-lead' ? 'leader' : 'in-process',
        subscriptions: [],
        backendType: 'in-process',
      })),
    }),
  );
}

describe('teamNameFromSessionId', () => {
  it('takes the first eight characters, matching the CLI rule', () => {
    expect(teamNameFromSessionId('98b0b4a7-3206-455b-aaf6-a5a81ad1e283')).toBe('session-98b0b4a7');
    expect(teamNameFromSessionId('5cd370e5-2d86-4b64-878e-095f726aea82')).toBe('session-5cd370e5');
  });

  it('returns an empty string for a missing or short id rather than a bogus team', () => {
    expect(teamNameFromSessionId('')).toBe('');
    expect(teamNameFromSessionId('abc')).toBe('');
  });
});

describe('hasLiveTeam', () => {
  it('is false when the team directory does not exist', async () => {
    expect(await hasLiveTeam(dir, 'session-deadbeef')).toBe(false);
  });

  it('is false for a lead-only roster — an ordinary subagent must not wake the console', async () => {
    await writeTeam('session-98b0b4a7', ['team-lead']);
    expect(await hasLiveTeam(dir, 'session-98b0b4a7')).toBe(false);
  });

  it('is true once a real teammate has joined', async () => {
    await writeTeam('session-98b0b4a7', ['team-lead', 'probe-alpha']);
    expect(await hasLiveTeam(dir, 'session-98b0b4a7')).toBe(true);
  });

  it('matches the captured 4-member fixture', async () => {
    const real = JSON.parse(
      await fs.readFile(new URL('../../fixtures/config-4-members.json', import.meta.url), 'utf8'),
    );
    expect(real.members).toHaveLength(4);
    const teamDir = path.join(dir, real.name);
    await fs.mkdir(teamDir, { recursive: true });
    await fs.writeFile(path.join(teamDir, 'config.json'), JSON.stringify(real));
    expect(await hasLiveTeam(dir, real.name)).toBe(true);
  });

  it('is false on a torn or malformed config rather than throwing', async () => {
    const teamDir = path.join(dir, 'session-98b0b4a7');
    await fs.mkdir(teamDir, { recursive: true });
    await fs.writeFile(path.join(teamDir, 'config.json'), '{"members":[{"na');
    expect(await hasLiveTeam(dir, 'session-98b0b4a7')).toBe(false);
  });
});

describe('bin/console-launch.sh', () => {
  const script = path.resolve('bin/console-launch.sh');

  async function launch(payload: unknown, teamsRoot: string) {
    const { stdout } = await run(
      script,
      {
        ...process.env,
        CLAUDE_CONFIG_DIR: teamsRoot,
        OCTO_PORT: '4899',
        OCTO_NO_SPAWN: '1', // test hook: never actually start a server
      },
      JSON.stringify(payload),
    );
    return stdout.trim();
  }

  it('prints {} and exits 0 for a lead-only roster', async () => {
    await fs.mkdir(path.join(dir, 'teams'), { recursive: true });
    await writeTeamUnder(path.join(dir, 'teams'), 'session-98b0b4a7', ['team-lead']);
    const out = await launch(
      { hook_event_name: 'PostToolUse', tool_name: 'Agent', session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283', agent_id: 'a9f20a34', agent_type: 'general-purpose' },
      dir,
    );
    expect(out).toBe('{}');
  });

  it('announces the link once a teammate has joined', async () => {
    await fs.mkdir(path.join(dir, 'teams'), { recursive: true });
    await writeTeamUnder(path.join(dir, 'teams'), 'session-98b0b4a7', ['team-lead', 'probe-alpha']);
    const out = await launch(
      { hook_event_name: 'PostToolUse', tool_name: 'Agent', session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283', agent_id: 'probe-alpha@session-98b0b4a7', agent_type: 'teammate' },
      dir,
    );
    expect(JSON.parse(out).systemMessage).toBe(
      'Agent teams console → http://127.0.0.1:4899/?team=session-98b0b4a7',
    );
  });

  it('announces only once per team', async () => {
    await fs.mkdir(path.join(dir, 'teams'), { recursive: true });
    await writeTeamUnder(path.join(dir, 'teams'), 'session-98b0b4a7', ['team-lead', 'a', 'b']);
    const payload = { hook_event_name: 'PostToolUse', tool_name: 'Agent', session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283', agent_id: 'a@session-98b0b4a7', agent_type: 'teammate' };
    const first = await launch(payload, dir);
    const second = await launch(payload, dir);
    expect(JSON.parse(first).systemMessage).toContain('http://127.0.0.1:4899');
    expect(second).toBe('{}');
  });

  it('exits 0 with {} on garbage input — a broken console must never fail a spawn', async () => {
    const { stdout } = await run(
      script,
      { ...process.env, CLAUDE_CONFIG_DIR: dir, OCTO_PORT: '4899', OCTO_NO_SPAWN: '1' },
      'not json at all',
    );
    expect(stdout.trim()).toBe('{}');
  });
});

async function writeTeamUnder(root: string, name: string, memberNames: string[]) {
  const teamDir = path.join(root, name);
  await fs.mkdir(teamDir, { recursive: true });
  await fs.writeFile(
    path.join(teamDir, 'config.json'),
    JSON.stringify({
      name,
      members: memberNames.map((n) => ({ agentId: `${n}@${name}`, name: n, subscriptions: [] })),
    }),
  );
}
