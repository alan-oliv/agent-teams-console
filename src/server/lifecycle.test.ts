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
function run(
  script: string,
  env: NodeJS.ProcessEnv,
  input: string,
  cwd?: string,
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(script, [], { env, cwd });
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

describe('plugin/bin/console-launch.sh', () => {
  const script = path.resolve('plugin/bin/console-launch.sh');

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
    // The once-per-team marker lives under the console's own state dir, not
    // under teams/<team> — see the "never creates a directory under teams/"
    // test below for why.
    await expect(
      fs.access(path.join(dir, 'agent-teams-console', 'announced', 'session-98b0b4a7')),
    ).resolves.toBeUndefined();
  });

  it('never creates a directory under teams/ for a team that does not exist yet', async () => {
    // No team directory exists at all: PreToolUse fires before the spawn
    // that would create config.json.
    const out = await launch(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Agent',
        session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283',
        tool_input: { description: 'x', prompt: 'y', subagent_type: 'general-purpose', name: 'probe-x' },
      },
      dir,
    );
    expect(JSON.parse(out).systemMessage).toContain('session-98b0b4a7');
    await expect(fs.access(path.join(dir, 'teams'))).rejects.toThrow();
  });

  it("resolves a forked session to its parent's real team, not a session-<id> guess", async () => {
    // /branch gives the session a brand new id but never touches
    // config.json, so the real team is still keyed on the ANCESTOR's id.
    const parentId = '98b0b4a7-3206-455b-aaf6-a5a81ad1e283';
    const childId = 'cccccccc-dddd-eeee-ffff-000000000000';
    await writeTeamUnder(path.join(dir, 'teams'), 'real-parent-team', ['team-lead', 'probe-alpha'], parentId);
    const projectCwd = path.join(dir, 'project');
    await fs.mkdir(projectCwd, { recursive: true });
    await writeForkedFrom(path.join(dir, 'projects'), projectCwd, childId, parentId);

    const { stdout } = await run(
      script,
      { ...process.env, CLAUDE_CONFIG_DIR: dir, OCTO_PORT: '4899', OCTO_NO_SPAWN: '1' },
      JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Agent', session_id: childId }),
      projectCwd,
    );
    expect(JSON.parse(stdout.trim()).systemMessage).toBe(
      'Agent teams console → http://127.0.0.1:4899/?team=real-parent-team',
    );
  });

  it('resolves a fork of a fork (deep chain) to the root team', async () => {
    const rootId = '98b0b4a7-3206-455b-aaf6-a5a81ad1e283';
    const midId = '11111111-2222-3333-4444-555555555555';
    const leafId = '66666666-7777-8888-9999-aaaaaaaaaaaa';
    await writeTeamUnder(path.join(dir, 'teams'), 'root-team', ['team-lead', 'probe'], rootId);
    const projectCwd = path.join(dir, 'project');
    await fs.mkdir(projectCwd, { recursive: true });
    await writeForkedFrom(path.join(dir, 'projects'), projectCwd, midId, rootId);
    await writeForkedFrom(path.join(dir, 'projects'), projectCwd, leafId, midId);

    const { stdout } = await run(
      script,
      { ...process.env, CLAUDE_CONFIG_DIR: dir, OCTO_PORT: '4899', OCTO_NO_SPAWN: '1' },
      JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Agent', session_id: leafId }),
      projectCwd,
    );
    expect(JSON.parse(stdout.trim()).systemMessage).toBe(
      'Agent teams console → http://127.0.0.1:4899/?team=root-team',
    );
  });

  it('terminates and exits 0 when forkedFrom forms a cycle, never hanging or resolving a team', async () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000001';
    const b = 'bbbbbbbb-0000-0000-0000-000000000002';
    const projectCwd = path.join(dir, 'project');
    await fs.mkdir(projectCwd, { recursive: true });
    await writeForkedFrom(path.join(dir, 'projects'), projectCwd, a, b);
    await writeForkedFrom(path.join(dir, 'projects'), projectCwd, b, a);

    // If the fork walk looped forever, this call itself would hang and the
    // test would time out rather than fail cleanly — the timeout IS the
    // no-hang assertion.
    const { stdout } = await run(
      script,
      { ...process.env, CLAUDE_CONFIG_DIR: dir, OCTO_PORT: '4899', OCTO_NO_SPAWN: '1' },
      JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Agent', session_id: a }),
      projectCwd,
    );
    expect(stdout.trim()).toBe('{}');
  });

  it('starts the server from CLAUDE_PLUGIN_ROOT, not from the cwd', async () => {
    const pluginRoot = path.join(dir, 'plugin');
    await fs.mkdir(path.join(pluginRoot, 'dist', 'server'), { recursive: true });
    const marker = path.join(dir, 'started');
    await fs.writeFile(
      path.join(pluginRoot, 'dist', 'server', 'index.js'),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes');\n`,
    );
    await fs.mkdir(path.join(dir, 'teams'), { recursive: true });
    await writeTeamUnder(path.join(dir, 'teams'), 'session-98b0b4a7', ['team-lead', 'probe-alpha']);

    // cwd is somewhere with no dist/ at all: only CLAUDE_PLUGIN_ROOT can find it.
    await run(
      script,
      {
        ...process.env,
        CLAUDE_CONFIG_DIR: dir,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        OCTO_PORT: '4897',
        OCTO_ROOT: '',
      },
      JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Agent', session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283' }),
      os.tmpdir(),
    );

    expect(await fs.readFile(marker, 'utf8')).toBe('yes');
  });

  it('passes --team to the server it spawns, so discovery cannot land on a different team', async () => {
    const pluginRoot = path.join(dir, 'plugin-team-flag');
    await fs.mkdir(path.join(pluginRoot, 'dist', 'server'), { recursive: true });
    const argsFile = path.join(dir, 'server-args.json');
    await fs.writeFile(
      path.join(pluginRoot, 'dist', 'server', 'index.js'),
      `require('node:fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\n`,
    );
    await fs.mkdir(path.join(dir, 'teams'), { recursive: true });
    await writeTeamUnder(path.join(dir, 'teams'), 'session-98b0b4a7', ['team-lead', 'probe-alpha']);

    await run(
      script,
      {
        ...process.env,
        CLAUDE_CONFIG_DIR: dir,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        OCTO_PORT: '4896',
        OCTO_ROOT: '',
      },
      JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Agent', session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283' }),
      os.tmpdir(),
    );

    const args = JSON.parse(await fs.readFile(argsFile, 'utf8'));
    expect(args).toEqual(expect.arrayContaining(['--team', 'session-98b0b4a7']));
  });

  it('exits 0 with {} on garbage input — a broken console must never fail a spawn', async () => {
    const { stdout } = await run(
      script,
      { ...process.env, CLAUDE_CONFIG_DIR: dir, OCTO_PORT: '4899', OCTO_NO_SPAWN: '1' },
      'not json at all',
    );
    expect(stdout.trim()).toBe('{}');
  });

  it('announces on PreToolUse when tool_input.name is present — the teammate signal', async () => {
    // No team directory needs to exist yet: PreToolUse fires before the spawn
    // that would create config.json.
    const out = await launch(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Agent',
        session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283',
        tool_input: {
          description: 'x',
          prompt: 'y',
          subagent_type: 'general-purpose',
          run_in_background: true,
          name: 'probe-x',
        },
      },
      dir,
    );
    expect(JSON.parse(out).systemMessage).toBe(
      'Agent teams console → http://127.0.0.1:4899/?team=session-98b0b4a7',
    );
  });

  it('prints {} on PreToolUse for an ordinary subagent — tool_input carries no name', async () => {
    const pluginRoot = path.join(dir, 'plugin-no-name');
    await fs.mkdir(path.join(pluginRoot, 'dist', 'server'), { recursive: true });
    const marker = path.join(dir, 'started-no-name');
    await fs.writeFile(
      path.join(pluginRoot, 'dist', 'server', 'index.js'),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes');\n`,
    );

    const { stdout } = await run(
      script,
      { ...process.env, CLAUDE_CONFIG_DIR: dir, CLAUDE_PLUGIN_ROOT: pluginRoot, OCTO_PORT: '4895', OCTO_ROOT: '' },
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Agent',
        session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283',
        tool_input: { description: 'x', prompt: 'y', subagent_type: 'general-purpose' },
      }),
      os.tmpdir(),
    );

    expect(stdout.trim()).toBe('{}');
    await expect(fs.access(marker)).rejects.toThrow();
  });

  it('prints {} on PreToolUse when tool_input is missing entirely', async () => {
    const out = await launch(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Agent',
        session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283',
      },
      dir,
    );
    expect(out).toBe('{}');
  });

  it('never emits a permissionDecision, on any path', async () => {
    await fs.mkdir(path.join(dir, 'teams'), { recursive: true });
    await writeTeamUnder(path.join(dir, 'teams'), 'session-98b0b4a7', ['team-lead', 'probe-alpha']);
    const payloads = [
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Agent',
        session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283',
        tool_input: { name: 'probe-x' },
      },
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Agent',
        session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283',
        tool_input: {},
      },
      { hook_event_name: 'PostToolUse', tool_name: 'Agent', session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283' },
    ];
    for (const payload of payloads) {
      const out = await launch(payload, dir);
      expect(out).not.toContain('permissionDecision');
    }
    const { stdout: garbage } = await run(
      script,
      { ...process.env, CLAUDE_CONFIG_DIR: dir, OCTO_PORT: '4899', OCTO_NO_SPAWN: '1' },
      'not json at all',
    );
    expect(garbage).not.toContain('permissionDecision');
  });

  it('announces once per team across a PreToolUse/PostToolUse pair', async () => {
    await fs.mkdir(path.join(dir, 'teams'), { recursive: true });
    await writeTeamUnder(path.join(dir, 'teams'), 'session-98b0b4a7', ['team-lead', 'probe-alpha']);

    const pre = await launch(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Agent',
        session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283',
        tool_input: { name: 'probe-alpha' },
      },
      dir,
    );
    const post = await launch(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Agent',
        session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283',
        agent_id: 'probe-alpha@session-98b0b4a7',
      },
      dir,
    );

    expect(JSON.parse(pre).systemMessage).toContain('http://127.0.0.1:4899');
    expect(post).toBe('{}');
  });
});

async function writeTeamUnder(root: string, name: string, memberNames: string[], leadSessionId?: string) {
  const teamDir = path.join(root, name);
  await fs.mkdir(teamDir, { recursive: true });
  await fs.writeFile(
    path.join(teamDir, 'config.json'),
    JSON.stringify({
      name,
      ...(leadSessionId ? { leadSessionId } : {}),
      members: memberNames.map((n) => ({ agentId: `${n}@${name}`, name: n, subscriptions: [] })),
    }),
  );
}

// A fork's transcript lives at projects/<slug>/<sessionId>.jsonl, where slug
// is the launch cwd with every non-alnum byte replaced by '-' — the same
// formula index.ts's toDiscovered() uses for a member's cwd.
function slugFor(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

async function writeForkedFrom(projectsRoot: string, cwd: string, sessionId: string, parentSessionId: string) {
  // The script's own `pwd` reports whatever the OS's getcwd() resolves to,
  // which follows symlinks (macOS's tmpdir sits under /var -> /private/var) —
  // so the fixture has to slug the REAL path, not whatever string mkdtemp
  // happened to hand back, or the two never agree on which project dir to use.
  const dir = path.join(projectsRoot, slugFor(await fs.realpath(cwd)));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${sessionId}.jsonl`),
    JSON.stringify({ forkedFrom: { sessionId: parentSessionId, messageUuid: 'x' } }) + '\n',
  );
}
