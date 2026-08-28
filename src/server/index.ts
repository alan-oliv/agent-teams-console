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

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === 'setup' || arg === 'uninstall') command = arg;
    else if (arg === '--read-only') readOnly = true;
    else if (arg === '--yes') confirm = true;
    else if (arg === '--port') port = Number(argv[++i]);
    else if (arg.startsWith('--port=')) port = Number(arg.slice('--port='.length));
    else if (arg === '--claude-home') claudeHome = argv[++i];
    else if (arg.startsWith('--claude-home=')) claudeHome = arg.slice('--claude-home='.length);
  }

  return {
    command,
    port,
    readOnly,
    confirm,
    claudeHome,
    settingsPath: path.join(claudeHome, 'settings.json'),
    dbPath: path.join(claudeHome, 'agent-teams-console', 'events.db'),
  };
}

export interface DiscoveredTeam {
  teamName: string;
  leadSessionId: string;
  projectSlug: string;
}

export async function discoverTeam(teamsRoot: string): Promise<DiscoveredTeam | null> {
  let dirs: string[];
  try {
    dirs = (await fs.readdir(teamsRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return null;
  }

  let best: TeamConfig | null = null;
  for (const name of dirs) {
    const config = await readJsonSafe<TeamConfig>(path.join(teamsRoot, name, 'config.json'));
    if (!config) continue;
    if (!best || config.createdAt > best.createdAt) best = config;
  }
  if (!best) return null;

  const leadCwd = best.members.find((m) => m.agentId === best!.leadAgentId)?.cwd ?? '';
  return {
    teamName: best.name,
    leadSessionId: best.leadSessionId,
    projectSlug: leadCwd.replace(/[^a-zA-Z0-9]/g, '-'),
  };
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
  setTeamsRoot(teamsRoot);

  const discovered = await discoverTeam(teamsRoot);
  let leadSessionId = discovered?.leadSessionId;

  const store = openStore(cli.dbPath, discovered?.teamName ?? '');
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
    teamName: discovered?.teamName,
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
