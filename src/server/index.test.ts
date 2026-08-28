import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, discoverTeam, DEFAULT_PORT } from './index';

const FIXTURES = path.resolve(process.cwd(), 'fixtures');

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('parseArgs', () => {
  it('binds DEFAULT_PORT to 4823, matching the vite proxy and lifecycle probe', () => {
    expect(DEFAULT_PORT).toBe(4823);
  });

  it('defaults to running the console on 4823', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '');
    const cli = parseArgs([]);
    expect(cli.command).toBe('run');
    expect(cli.port).toBe(DEFAULT_PORT);
    expect(DEFAULT_PORT).toBe(4823);
    expect(cli.readOnly).toBe(false);
    expect(cli.confirm).toBe(false);
    expect(cli.claudeHome.endsWith(path.join('.claude'))).toBe(true);
  });

  it('reads the setup command with an explicit port and confirmation', () => {
    const cli = parseArgs(['setup', '--port', '4400', '--yes']);
    expect(cli.command).toBe('setup');
    expect(cli.port).toBe(4400);
    expect(cli.confirm).toBe(true);
  });

  it('reads uninstall and --read-only', () => {
    expect(parseArgs(['uninstall']).command).toBe('uninstall');
    expect(parseArgs(['--read-only']).readOnly).toBe(true);
    expect(parseArgs(['--read-only']).command).toBe('run');
  });

  it('follows CLAUDE_CONFIG_DIR, which the launcher already resolves the team through', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/tmp/elsewhere-claude');
    expect(parseArgs([]).claudeHome).toBe('/tmp/elsewhere-claude');
    // An explicit flag still wins.
    expect(parseArgs(['--claude-home', '/tmp/flag']).claudeHome).toBe('/tmp/flag');
  });

  it('accepts --port=NNNN and an overridden claude home', () => {
    const cli = parseArgs(['--port=4500', '--claude-home', '/tmp/fake-claude']);
    expect(cli.port).toBe(4500);
    expect(cli.claudeHome).toBe('/tmp/fake-claude');
    expect(cli.settingsPath).toBe('/tmp/fake-claude/settings.json');
    expect(cli.dbPath).toBe('/tmp/fake-claude/agent-teams-console/events.db');
  });

  it('reads --team, so the launcher can tell the server which team it announced', () => {
    expect(parseArgs([]).team).toBeUndefined();
    expect(parseArgs(['--team', 'session-98b0b4a7']).team).toBe('session-98b0b4a7');
    expect(parseArgs(['--team=session-98b0b4a7']).team).toBe('session-98b0b4a7');
  });
});

describe('discoverTeam', () => {
  const teams = () => path.join(dir, 'teams');
  const sessions = () => path.join(dir, 'sessions');

  function membersOf(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      agentId: i === 0 ? 'team-lead' : `agent-${i}`,
      name: i === 0 ? 'team-lead' : `agent-${i}`,
    }));
  }

  async function writeTeam(
    name: string,
    opts: { createdAt: number; leadSessionId: string; memberCount: number },
  ) {
    const teamDir = path.join(teams(), name);
    await fs.mkdir(teamDir, { recursive: true });
    await fs.writeFile(
      path.join(teamDir, 'config.json'),
      JSON.stringify({
        name,
        createdAt: opts.createdAt,
        leadAgentId: 'team-lead',
        leadSessionId: opts.leadSessionId,
        members: membersOf(opts.memberCount),
      }),
    );
  }

  async function writeSession(sessionId: string, pid: number) {
    await fs.mkdir(sessions(), { recursive: true });
    await fs.writeFile(path.join(sessions(), `${sessionId}.json`), JSON.stringify({ sessionId, pid }));
  }

  it('returns null when no team directory exists', async () => {
    await fs.mkdir(teams(), { recursive: true });
    expect(await discoverTeam(teams(), sessions())).toBeNull();
  });

  it('picks the newest team by createdAt and derives the project slug', async () => {
    await fs.mkdir(path.join(teams(), 'session-98b0b4a7'), { recursive: true });
    await fs.mkdir(path.join(teams(), 'session-older11'), { recursive: true });
    await fs.copyFile(
      path.join(FIXTURES, 'config-4-members.json'),
      path.join(teams(), 'session-98b0b4a7', 'config.json'),
    );
    await fs.writeFile(
      path.join(teams(), 'session-older11', 'config.json'),
      JSON.stringify({
        name: 'session-older11',
        createdAt: 1,
        leadAgentId: 'team-lead@session-older11',
        leadSessionId: 'older',
        members: [],
      }),
    );

    const found = (await discoverTeam(teams(), sessions()))!;
    expect(found.teamName).toBe('session-98b0b4a7');
    expect(found.leadSessionId).toBe('98b0b4a7-3206-455b-aaf6-a5a81ad1e283');
    expect(found.projectSlug).toBe('-Users-alanoliv-code-agents-team-ui');
  });

  it('prefers a >=2-member team over a newer lead-only one — a lead-only team is not a team', async () => {
    await writeTeam('session-newer-lead-only', {
      createdAt: 2000,
      leadSessionId: 'lead-only-session',
      memberCount: 1,
    });
    await writeTeam('session-older-real', {
      createdAt: 1000,
      leadSessionId: 'real-session',
      memberCount: 2,
    });

    const found = (await discoverTeam(teams(), sessions()))!;
    expect(found.teamName).toBe('session-older-real');
  });

  it('when both teams have >=2 members, the one whose lead session is live wins', async () => {
    await writeTeam('session-newer-untracked', {
      createdAt: 2000,
      leadSessionId: 'no-session-file',
      memberCount: 2,
    });
    await writeTeam('session-older-live', {
      createdAt: 1000,
      leadSessionId: 'live-session',
      memberCount: 2,
    });
    await writeSession('live-session', process.pid);
    // 'no-session-file' has no matching file under sessions/, so it cannot be live.

    const found = (await discoverTeam(teams(), sessions()))!;
    expect(found.teamName).toBe('session-older-live');
  });

  it('a team whose leadSessionId names a dead pid loses to one that is live', async () => {
    await writeTeam('session-newer-dead', {
      createdAt: 2000,
      leadSessionId: 'dead-session',
      memberCount: 2,
    });
    await writeTeam('session-older-live', {
      createdAt: 1000,
      leadSessionId: 'live-session',
      memberCount: 2,
    });
    await writeSession('dead-session', 999999); // not a running pid
    await writeSession('live-session', process.pid);

    const found = (await discoverTeam(teams(), sessions()))!;
    expect(found.teamName).toBe('session-older-live');
  });

  it('--team overrides discovery entirely, even when it names an older or lead-only team', async () => {
    await writeTeam('session-newer-real', {
      createdAt: 2000,
      leadSessionId: 'real-session',
      memberCount: 2,
    });
    await writeTeam('session-older-lead-only', {
      createdAt: 1000,
      leadSessionId: 'lead-only-session',
      memberCount: 1,
    });

    const found = (await discoverTeam(teams(), sessions(), 'session-older-lead-only'))!;
    expect(found.teamName).toBe('session-older-lead-only');
  });

  it('an explicit --team with no config.json yet reports unknown rather than a different team', async () => {
    // PreToolUse can announce a team before the spawn that creates its
    // directory. Falling back to whatever else exists would latch the server
    // onto the wrong team and never let go once the real config.json lands.
    await writeTeam('session-existing', {
      createdAt: 2000,
      leadSessionId: 'existing-session',
      memberCount: 2,
    });

    expect(await discoverTeam(teams(), sessions(), 'session-not-yet-created')).toBeNull();
  });

  it('finds a team directory reached through a symlink', async () => {
    const real = path.join(dir, 'real-team-location');
    await fs.mkdir(real, { recursive: true });
    await fs.copyFile(
      path.join(FIXTURES, 'config-4-members.json'),
      path.join(real, 'config.json'),
    );
    await fs.mkdir(teams(), { recursive: true });
    await fs.symlink(real, path.join(teams(), 'session-98b0b4a7'), 'dir');

    const found = (await discoverTeam(teams(), sessions()))!;
    expect(found.teamName).toBe('session-98b0b4a7');
  });

  it('falls back to the newest team when none has >=2 members, as today', async () => {
    await writeTeam('session-newer-lead-only', {
      createdAt: 2000,
      leadSessionId: 'newer-session',
      memberCount: 1,
    });
    await writeTeam('session-older-lead-only', {
      createdAt: 1000,
      leadSessionId: 'older-session',
      memberCount: 1,
    });

    const found = (await discoverTeam(teams(), sessions()))!;
    expect(found.teamName).toBe('session-newer-lead-only');
  });
});
