import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The directory that ships as the plugin — `bin/`, `commands/`, `hooks/`,
 * `dist/`. Resolved from THIS MODULE rather than `process.cwd()`, because the
 * launcher starts the server without cd'ing and the cwd is the user's project.
 *
 * It has to answer from two places whose relative depth differs: `src/server/`
 * when a clone runs the source through tsx, and `plugin/dist/server/` when the
 * bundle runs. No single relative path is right for both, so try each and take
 * the one that is actually on disk.
 */
function resolvePluginDir(): string {
  const candidates = ['../../plugin/', '../../'];
  for (const rel of candidates) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(path.join(dir, 'bin', 'console-launch.sh'))) return dir;
  }
  return fileURLToPath(new URL('../../', import.meta.url));
}

export const PLUGIN_DIR = resolvePluginDir();

/** Absolute path to the PostToolUse(Agent) launcher, used by hookBlock(). */
export const LAUNCH_SCRIPT = path.join(PLUGIN_DIR, 'bin', 'console-launch.sh');

/**
 * The CLI derives the team name from the lead session id. Verified rule:
 * teamName = "session-" + sessionId.slice(0, 8).
 */
export function teamNameFromSessionId(sessionId: string): string {
  if (!sessionId || sessionId.length < 8) return '';
  return `session-${sessionId.slice(0, 8)}`;
}

/**
 * A pid file can outlive the process it names (crash, kill -9), so a recorded
 * pid is only evidence once the OS agrees it is still running.
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we may not signal it — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * A team "exists" only once a real teammate has joined. Ordinary Agent-tool
 * subagents and workflow fan-outs never appear in members[] — verified during
 * the capture spike, where six workflow subagents were live and members[] still
 * held only the lead. A torn read is treated as "no team", never as an error.
 */
export async function hasLiveTeam(teamsRoot: string, teamName: string): Promise<boolean> {
  if (!teamName) return false;
  const configPath = path.join(teamsRoot, teamName, 'config.json');
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as { members?: unknown[] };
    return Array.isArray(parsed.members) && parsed.members.length >= 2;
  } catch {
    return false;
  }
}

/**
 * Exits the process once no team has been live for `graceMs`. Belt-and-braces
 * against a crashed session leaving the server running: the SessionEnd hook is
 * the primary shutdown path, this is the backstop.
 */
async function teamConfigExists(teamsRoot: string, team: string): Promise<boolean> {
  try {
    return (await fs.stat(path.join(teamsRoot, team, 'config.json'))).isFile();
  } catch {
    return false;
  }
}

export function startIdleReaper(opts: {
  teamsRoot: string;
  graceMs: number;
  onIdle(): void;
  /** The team the console is showing, so the reaper can tell when it is gone. */
  watchedTeam?: () => string | undefined;
  /** How often to look. Injectable so the reaper is testable against real I/O. */
  tickMs?: number;
}): { stop(): void } {
  let idleSince: number | null = null;
  const timer = setInterval(async () => {
    let any = false;
    try {
      for (const entry of await fs.readdir(opts.teamsRoot)) {
        if (await hasLiveTeam(opts.teamsRoot, entry)) {
          any = true;
          break;
        }
      }
    } catch {
      any = false;
    }
    if (any) {
      idleSince = null;
      return;
    }

    // Claude Code DELETES a team's directory when the session behind it exits —
    // watched live: the team holding five teammates was gone the moment its
    // session did. With nothing live anywhere and the watched team's own
    // config.json deleted, there is nothing left to wait for, so skip the grace
    // window rather than serving a frozen wall for another ten minutes. The
    // SessionEnd hook is the fast path; this covers a lead that never sent one
    // — no hooks installed, a crash, a kill -9.
    const watched = opts.watchedTeam?.();
    if (watched !== undefined && watched !== '' && !(await teamConfigExists(opts.teamsRoot, watched))) {
      clearInterval(timer);
      opts.onIdle();
      return;
    }

    idleSince ??= Date.now();
    if (Date.now() - idleSince >= opts.graceMs) {
      clearInterval(timer);
      opts.onIdle();
    }
  }, opts.tickMs ?? 30_000);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
    },
  };
}
