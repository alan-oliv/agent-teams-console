import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseArgs,
  discoverTeam,
  fencedSink,
  listTeamSummaries,
  DEFAULT_PORT,
  IDLE_GRACE_MS,
} from './index';
import type { EventKind, StoredEvent, Store } from './store';

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

describe('listTeamSummaries', () => {
  const teams = () => path.join(dir, 'teams');
  const sessions = () => path.join(dir, 'sessions');

  async function writeConfig(name: string, config: unknown) {
    await fs.mkdir(path.join(teams(), name), { recursive: true });
    await fs.writeFile(path.join(teams(), name, 'config.json'), JSON.stringify(config));
  }

  function team(name: string, opts: { createdAt: number; leadSessionId: string; members: number }) {
    return {
      name,
      createdAt: opts.createdAt,
      leadAgentId: `team-lead@${name}`,
      leadSessionId: opts.leadSessionId,
      members: Array.from({ length: opts.members }, (_, i) => ({ agentId: `a${i}`, name: `a${i}` })),
    };
  }

  // The REAL on-disk layout: the file is named for the PID and carries the
  // session id inside. isSessionLive reads sessions/<sessionId>.json, a path
  // that does not exist on a real machine — see the report's open question Q1.
  async function writeSession(pid: number, sessionId: string) {
    await fs.mkdir(sessions(), { recursive: true });
    await fs.writeFile(path.join(sessions(), `${pid}.json`), JSON.stringify({ pid, sessionId }));
  }

  // config.leadSessionId is a fresh id belonging to no session once a team has
  // been re-keyed, so joining live sessions on it marked a working team `done`.
  // The teammates' sidecars sit under the lead session's OWN directory and name
  // the team, which is the join that survives.
  it('finds the lead through a teammate sidecar when leadSessionId names nobody', async () => {
    const projects = path.join(dir, 'projects');
    const cwd = '/Users/someone/code/proj';
    const sessionId = 'aaaaaaaa-1111-2222-3333-444444444444';
    await writeConfig(
      'session-rekeyed',
      team('session-rekeyed', { createdAt: 10, leadSessionId: 'deadbeef-no-such-session', members: 3 }),
    );
    await fs.mkdir(path.join(sessions()), { recursive: true });
    await fs.writeFile(
      path.join(sessions(), `${process.pid}.json`),
      JSON.stringify({ pid: process.pid, sessionId, cwd, name: 'agents-team-ui' }),
    );
    const subagents = path.join(projects, cwd.replace(/[^a-zA-Z0-9]/g, '-'), sessionId, 'subagents');
    await fs.mkdir(subagents, { recursive: true });
    await fs.writeFile(
      path.join(subagents, 'agent-aworker-1111.meta.json'),
      JSON.stringify({ name: 'worker', taskKind: 'in_process_teammate', teamName: 'session-rekeyed' }),
    );

    const withProjects = await listTeamSummaries(teams(), sessions(), '', projects);
    expect(withProjects.teams[0].leadAlive).toBe(true);
    expect(withProjects.teams[0].state).toBe('live');
    // And the row is named after the session actually driving it — read from
    // the same place, so a re-keyed team stops showing up nameless.
    expect(withProjects.teams[0].goal).toBe('agents-team-ui');

    // Without the sidecar join it is the old, wrong answer.
    const without = await listTeamSummaries(teams(), sessions(), '');
    expect(without.teams[0].leadAlive).toBe(false);
  });

  it('counts members and marks the current team', async () => {
    await writeConfig('session-aaaa1111', team('session-aaaa1111', { createdAt: 10, leadSessionId: 'aaaa1111-x', members: 5 }));
    await writeConfig('session-bbbb2222', team('session-bbbb2222', { createdAt: 20, leadSessionId: 'bbbb2222-x', members: 1 }));

    const listed = await listTeamSummaries(teams(), sessions(), 'session-aaaa1111');
    expect(listed.current).toBe('session-aaaa1111');
    expect(listed.teams.map((t) => [t.name, t.members, t.current])).toEqual([
      ['session-aaaa1111', 5, true],
      ['session-bbbb2222', 1, false],
    ]);
  });

  it('reads leadAlive from the pid inside sessions/<pid>.json, not from its file name', async () => {
    await writeConfig('session-live0001', team('session-live0001', { createdAt: 10, leadSessionId: 'live0001-x', members: 2 }));
    await writeConfig('session-dead0002', team('session-dead0002', { createdAt: 20, leadSessionId: 'dead0002-x', members: 2 }));
    await writeSession(process.pid, 'live0001-x');
    // A session file that outlived its process: the pid is not running.
    await writeSession(2 ** 22 - 1, 'dead0002-x');

    const listed = await listTeamSummaries(teams(), sessions(), '');
    const byName = new Map(listed.teams.map((t) => [t.name, t]));
    expect(byName.get('session-live0001')!.leadAlive).toBe(true);
    expect(byName.get('session-dead0002')!.leadAlive).toBe(false);
  });

  it('calls a team with a dead lead live while it is still recent, and a stale one dead', async () => {
    await writeConfig('session-recent01', team('session-recent01', { createdAt: 10, leadSessionId: 'recent01-x', members: 2 }));
    await writeConfig('session-stale002', team('session-stale002', { createdAt: 20, leadSessionId: 'stale002-x', members: 2 }));
    const old = (Date.now() - IDLE_GRACE_MS * 2) / 1000;
    await fs.utimes(path.join(teams(), 'session-stale002', 'config.json'), old, old);

    const listed = await listTeamSummaries(teams(), sessions(), '');
    const byName = new Map(listed.teams.map((t) => [t.name, t]));
    expect(byName.get('session-recent01')!.live).toBe(true);
    expect(byName.get('session-stale002')!.live).toBe(false);
    // Dead teams are still listed — paging back through them is the point.
    expect(listed.teams).toHaveLength(2);
  });

  it('takes lastActivityAt from the newest inbox file when config.json is older', async () => {
    await writeConfig('session-busy0001', team('session-busy0001', { createdAt: 10, leadSessionId: 'busy0001-x', members: 2 }));
    const old = (Date.now() - IDLE_GRACE_MS * 2) / 1000;
    await fs.utimes(path.join(teams(), 'session-busy0001', 'config.json'), old, old);
    await fs.mkdir(path.join(teams(), 'session-busy0001', 'inboxes'), { recursive: true });
    await fs.writeFile(path.join(teams(), 'session-busy0001', 'inboxes', 'a1.json'), '[]');

    const [busy] = (await listTeamSummaries(teams(), sessions(), '')).teams;
    // config.json is only rewritten when membership changes, so a team that has
    // done nothing but exchange mail all day would otherwise read as idle.
    expect(busy.lastActivityAt).toBeGreaterThan(Date.now() - 60_000);
    expect(busy.live).toBe(true);
  });

  it('orders current first, then live, then by last activity', async () => {
    for (const [name, createdAt] of [['session-cur00001', 10], ['session-live0002', 20], ['session-old00003', 30], ['session-old00004', 40]] as const) {
      await writeConfig(name, team(name, { createdAt, leadSessionId: `${name}-x`, members: 2 }));
    }
    const stale = (Date.now() - IDLE_GRACE_MS * 2) / 1000;
    // session-old00003 is the older of the two dead teams.
    await fs.utimes(path.join(teams(), 'session-old00003', 'config.json'), stale - 100, stale - 100);
    await fs.utimes(path.join(teams(), 'session-old00004', 'config.json'), stale, stale);
    // The current team is dead too, and still sorts first.
    await fs.utimes(path.join(teams(), 'session-cur00001', 'config.json'), stale - 200, stale - 200);

    const listed = await listTeamSummaries(teams(), sessions(), 'session-cur00001');
    expect(listed.teams.map((t) => t.name)).toEqual([
      'session-cur00001',
      'session-live0002',
      'session-old00004',
      'session-old00003',
    ]);
  });

  it('omits a directory with no config, an unreadable one, and one of the wrong shape', async () => {
    await writeConfig('session-good0001', team('session-good0001', { createdAt: 10, leadSessionId: 'good0001-x', members: 2 }));
    await fs.mkdir(path.join(teams(), 'session-none0002'), { recursive: true });
    await writeConfig('session-torn0003', '{ not json' as unknown);
    await fs.writeFile(path.join(teams(), 'session-torn0003', 'config.json'), '{ not json');
    await writeConfig('session-shape004', { name: 'session-shape004', createdAt: 1, leadAgentId: 'l', leadSessionId: 's', members: 'nope' });

    const listed = await listTeamSummaries(teams(), sessions(), '');
    // The listing IS the definition of selectable: an entry that renders but
    // cannot be selected is a trap.
    expect(listed.teams.map((t) => t.name)).toEqual(['session-good0001']);
  });

  it('lists a team whose lead session id is empty — its history is what paging back means', async () => {
    await writeConfig('session-noneled1', { name: 'session-noneled1', createdAt: 1, leadAgentId: 'l', leadSessionId: '', members: [] });

    const [only] = (await listTeamSummaries(teams(), sessions(), '')).teams;
    expect(only.name).toBe('session-noneled1');
    expect(only.leadSessionId).toBe('');
    expect(only.leadAlive).toBe(false);
  });

  it('returns an empty listing when there is no teams directory at all', async () => {
    expect(await listTeamSummaries(teams(), sessions(), '')).toEqual({ current: '', teams: [] });
  });
});

describe('fencedSink', () => {
  function recorder(): { live: Store; kinds: string[]; teams: string[] } {
    const kinds: string[] = [];
    const teams: string[] = [];
    const live: Store = {
      append(kind: EventKind, payload: unknown, agent?: string): StoredEvent {
        kinds.push(kind);
        return { seq: kinds.length, ts: 0, kind, agent, payload };
      },
      replay: () => [],
      setTeam: (name: string) => void teams.push(name),
      close: () => {},
    };
    return { live, kinds, teams };
  }

  it('drops what a retired ingest writes after the switch has moved past it', () => {
    const { live, kinds, teams } = recorder();
    let generation = 0;
    const boot = fencedSink(live, 0, () => generation);
    boot.append('roster', {});
    expect(kinds).toEqual(['roster']);

    // The switch revokes the licence BEFORE ingest.close(), so a sweep already
    // awaiting a file and a debounce that has already fired are both inert.
    generation = 1;
    const next = fencedSink(live, 1, () => generation);

    boot.append('roster', {});
    boot.append('mail', {});
    expect(kinds).toEqual(['roster']);

    next.append('task', {});
    expect(kinds).toEqual(['roster', 'task']);
  });

  it("refuses a retired ingest's setTeam, which would yank the console back unannounced", () => {
    const { live, teams } = recorder();
    let generation = 0;
    const boot = fencedSink(live, 0, () => generation);
    generation = 1;
    const next = fencedSink(live, 1, () => generation);

    // main() wires onTeam to store.setTeam, so this is the dangerous one: the
    // operator is on team B and the store silently goes back to team A.
    boot.setTeam('session-98b0b4a7');
    expect(teams).toEqual([]);

    next.setTeam('session-b5129c7b');
    expect(teams).toEqual(['session-b5129c7b']);
  });
});
