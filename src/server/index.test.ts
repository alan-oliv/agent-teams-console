import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  await fs.rm(dir, { recursive: true, force: true });
});

describe('parseArgs', () => {
  it('defaults to running the console on 4317', () => {
    const cli = parseArgs([]);
    expect(cli.command).toBe('run');
    expect(cli.port).toBe(DEFAULT_PORT);
    expect(DEFAULT_PORT).toBe(4317);
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

  it('accepts --port=NNNN and an overridden claude home', () => {
    const cli = parseArgs(['--port=4500', '--claude-home', '/tmp/fake-claude']);
    expect(cli.port).toBe(4500);
    expect(cli.claudeHome).toBe('/tmp/fake-claude');
    expect(cli.settingsPath).toBe('/tmp/fake-claude/settings.json');
    expect(cli.dbPath).toBe('/tmp/fake-claude/agent-teams-console/events.db');
  });
});

describe('discoverTeam', () => {
  it('returns null when no team directory exists', async () => {
    await fs.mkdir(path.join(dir, 'teams'), { recursive: true });
    expect(await discoverTeam(path.join(dir, 'teams'))).toBeNull();
  });

  it('picks the newest team by createdAt and derives the project slug', async () => {
    const teams = path.join(dir, 'teams');
    await fs.mkdir(path.join(teams, 'session-98b0b4a7'), { recursive: true });
    await fs.mkdir(path.join(teams, 'session-older11'), { recursive: true });
    await fs.copyFile(
      path.join(FIXTURES, 'config-4-members.json'),
      path.join(teams, 'session-98b0b4a7', 'config.json'),
    );
    await fs.writeFile(
      path.join(teams, 'session-older11', 'config.json'),
      JSON.stringify({
        name: 'session-older11',
        createdAt: 1,
        leadAgentId: 'team-lead@session-older11',
        leadSessionId: 'older',
        members: [],
      }),
    );

    const found = (await discoverTeam(teams))!;
    expect(found.teamName).toBe('session-98b0b4a7');
    expect(found.leadSessionId).toBe('98b0b4a7-3206-455b-aaf6-a5a81ad1e283');
    expect(found.projectSlug).toBe('-Users-alanoliv-code-agents-team-ui');
  });
});
