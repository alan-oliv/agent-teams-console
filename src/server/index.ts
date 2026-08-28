import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { openStore, type Store, type EventKind, type StoredEvent } from './store';
import { project } from './project';
import { startFileIngest } from './ingest/files';
import { createHookHandlers } from './ingest/hooks';
import { createPermits } from './control/permits';
import { setTeamsRoot } from './control/mailbox';
import { createStream } from './stream';
import { createHttpServer, listen } from './http';
import { readJsonSafe } from './watch/jsonfile';
import { checkClaudeVersion, readClaudeVersion, runSetup } from './setup';
import { startIdleReaper } from './lifecycle';
import { logError, logInfo } from './log';
import type { TeamConfig } from '../shared/roster';

export const DEFAULT_PORT = 4823;
const IDLE_GRACE_MS = 10 * 60 * 1000;

export interface Cli {
  command: 'run' | 'setup' | 'uninstall';
  port: number;
  readOnly: boolean;
  confirm: boolean;
  claudeHome: string;
  settingsPath: string;
  dbPath: string;
  team?: string;
}

export function parseArgs(argv: string[]): Cli {
  let command: Cli['command'] = 'run';
  let port = DEFAULT_PORT;
  let readOnly = false;
  let confirm = false;
  // bin/console-launch.sh already resolves the team config through
  // CLAUDE_CONFIG_DIR, so the server it starts has to agree — otherwise the
  // launcher announces a team the server is not watching.
  let claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  // The launcher already knows which team it announced; --team lets it tell
  // the server directly instead of trusting discovery to land on the same one.
  let team: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === 'setup' || arg === 'uninstall') command = arg;
    else if (arg === '--read-only') readOnly = true;
    else if (arg === '--yes') confirm = true;
    else if (arg === '--port') port = Number(argv[++i]);
    else if (arg.startsWith('--port=')) port = Number(arg.slice('--port='.length));
    else if (arg === '--claude-home') claudeHome = argv[++i];
    else if (arg.startsWith('--claude-home=')) claudeHome = arg.slice('--claude-home='.length);
    else if (arg === '--team') team = argv[++i];
    else if (arg.startsWith('--team=')) team = arg.slice('--team='.length);
  }

  return {
    command,
    port,
    readOnly,
    confirm,
    claudeHome,
    settingsPath: path.join(claudeHome, 'settings.json'),
    dbPath: path.join(claudeHome, 'agent-teams-console', 'events.db'),
    team,
  };
}

export interface DiscoveredTeam {
  teamName: string;
  leadSessionId: string;
  projectSlug: string;
}

function toDiscovered(config: TeamConfig): DiscoveredTeam {
  const leadCwd = config.members.find((m) => m.agentId === config.leadAgentId)?.cwd ?? '';
  return {
    teamName: config.name,
    leadSessionId: config.leadSessionId,
    projectSlug: leadCwd.replace(/[^a-zA-Z0-9]/g, '-'),
  };
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we may not signal it — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// A session file can outlive the process it describes (crash, kill -9), so a
// name match alone is not enough — the pid inside it has to still be running.
async function isSessionLive(sessionsRoot: string, sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  const session = await readJsonSafe<{ sessionId?: string; pid?: number }>(
    path.join(sessionsRoot, `${sessionId}.json`),
  );
  return typeof session?.pid === 'number' && isPidAlive(session.pid);
}

export async function discoverTeam(
  teamsRoot: string,
  sessionsRoot: string,
  explicitTeam?: string,
): Promise<DiscoveredTeam | null> {
  if (explicitTeam) {
    // The launcher can name a team before its directory exists at all (it
    // announces before the spawn that creates config.json). Falling through
    // to the scan below would let discovery latch onto a different,
    // already-existing team and never let go — worse than reporting unknown.
    const config = await readJsonSafe<TeamConfig>(path.join(teamsRoot, explicitTeam, 'config.json'));
    return config ? toDiscovered(config) : null;
  }

  let entries: string[];
  try {
    entries = await fs.readdir(teamsRoot);
  } catch {
    return null;
  }
  // Dirent.isDirectory() reflects the entry's own type, which is false for a
  // symlink even when it points at a directory — fs.stat follows the link.
  const dirs: string[] = [];
  for (const name of entries) {
    try {
      if ((await fs.stat(path.join(teamsRoot, name))).isDirectory()) dirs.push(name);
    } catch {
      // Vanished between readdir and stat, or a broken symlink — skip it.
    }
  }

  const configs: TeamConfig[] = [];
  for (const name of dirs) {
    const config = await readJsonSafe<TeamConfig>(path.join(teamsRoot, name, 'config.json'));
    if (config) configs.push(config);
  }
  if (configs.length === 0) return null;

  // A lead-only roster is not a real team — matches the launcher's own
  // members.length >= 2 gate. Only fall back to lead-only teams when nothing
  // else exists, so a solo session still shows itself.
  const realTeams = configs.filter((c) => c.members.length >= 2);
  const candidates = realTeams.length > 0 ? realTeams : configs;

  let best: TeamConfig | null = null;
  let bestLive = false;
  for (const config of candidates) {
    const live = realTeams.length > 0 && (await isSessionLive(sessionsRoot, config.leadSessionId));
    const better = !best || (live && !bestLive) || (live === bestLive && config.createdAt > best.createdAt);
    if (better) {
      best = config;
      bestLive = live;
    }
  }
  return best ? toDiscovered(best) : null;
}

export async function main(argv: string[]): Promise<number> {
  const cli = parseArgs(argv);

  if (cli.command === 'setup' || cli.command === 'uninstall') {
    const guard = checkClaudeVersion(await readClaudeVersion());
    if (!guard.ok) console.warn(`warning: ${guard.message}`);
    console.log(
      await runSetup({
        settingsPath: cli.settingsPath,
        port: cli.port,
        confirm: cli.confirm,
        uninstall: cli.command === 'uninstall',
      }),
    );
    return 0;
  }

  // A detached server whose output goes to a log nobody reads must not die
  // silently: log and keep serving rather than taking Node's default exit.
  process.on('unhandledRejection', (err) => logError('unhandled rejection', err));
  process.on('uncaughtException', (err) => logError('uncaught exception', err));

  const guard = checkClaudeVersion(await readClaudeVersion());
  console.log(guard.ok ? guard.message : `warning: ${guard.message}`);

  const teamsRoot = path.join(cli.claudeHome, 'teams');
  const sessionsRoot = path.join(cli.claudeHome, 'sessions');
  setTeamsRoot(teamsRoot);

  const discovered = await discoverTeam(teamsRoot, sessionsRoot, cli.team);
  // --team can name a team whose config.json has not been written yet (the
  // launcher announces before the spawn that creates it); discoverTeam then
  // reports unknown rather than guessing, so fall back to the name itself —
  // the ingest below picks up the directory once it appears.
  const teamName = discovered?.teamName ?? cli.team;
  let leadSessionId = discovered?.leadSessionId;

  const store = openStore(cli.dbPath, teamName ?? '');
  const permits = createPermits();
  const hub = createStream(() => project(store.replay(), cli.readOnly));

  // Every append is a state change, so the store is the single publish point;
  // the fold runs per coalesced flush rather than being cached, which at a few
  // events a second is cheaper than keeping a second copy of the truth.
  const live: Store = {
    append(kind: EventKind, payload: unknown, agent?: string): StoredEvent {
      const ev = store.append(kind, payload, agent);
      hub.publish();
      return ev;
    },
    replay: () => store.replay(),
    setTeam: (name: string) => store.setTeam(name),
    close: () => store.close(),
  };

  const ingest = startFileIngest(live, {
    paths: {
      projects: path.join(cli.claudeHome, 'projects'),
      teams: teamsRoot,
      tasks: path.join(cli.claudeHome, 'tasks'),
      sessions: path.join(cli.claudeHome, 'sessions'),
    },
    teamName,
    leadSessionId: discovered?.leadSessionId,
    onTeam: (info) => {
      store.setTeam(info.teamName);
      leadSessionId = info.leadSessionId;
    },
  });
  await ingest.sweep();

  let reaper: { stop(): void } | null = null;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    reaper?.stop();
    ingest.close();
    hub.close();
    server.close();
    store.close();
    process.exit(0);
  };

  const server = createHttpServer({
    permits,
    hooks: createHookHandlers({
      store: live,
      permits,
      readOnly: cli.readOnly,
      leadSessionId: () => leadSessionId,
      onAgentActivity: (agent) => void ingest.drainAgent(agent),
      onShutdown: stop,
    }),
    stream: hub,
    state: () => project(store.replay(), cli.readOnly),
    readOnly: cli.readOnly,
    onShutdown: stop,
  });

  const port = await listen(server, cli.port);
  console.log(`agent teams console on http://127.0.0.1:${port}${cli.readOnly ? ' (read-only)' : ''}`);

  reaper = startIdleReaper({
    teamsRoot,
    graceMs: IDLE_GRACE_MS,
    onIdle: () => {
      logInfo('no live team for 10 minutes — exiting');
      process.exit(0);
    },
  });

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  return 0;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  void main(process.argv.slice(2));
}
