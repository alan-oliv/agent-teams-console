import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

/** Absolute path to the restarter every observation hook falls back to. */
export const RESTART_SCRIPT = path.join(PLUGIN_DIR, 'bin', 'console-restart.sh');

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
 * Claude Code keeps a pool of pre-warmed processes, and a finished background
 * session's process is RECYCLED into it, where it lingers for hours as
 * `claude bg-spare …`. Its session record is never updated, so a pid check
 * alone still calls that session live: the dropdown kept offering a
 * conversation that ended four hours earlier, marked `1 agent live`, on a
 * machine with one terminal open.
 *
 * Parsed apart from the `ps` call so the rule is testable without a spare.
 */
export function sparePidsFrom(psOutput: string): Set<number> {
  const spares = new Set<number>();
  for (const line of psOutput.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m && m[2].includes('bg-spare')) spares.add(Number(m[1]));
  }
  return spares;
}

/**
 * One `ps` for every pid at once — a listing runs on each poll, so this must
 * not be a subprocess per session. An unreadable `ps` yields no spares, which
 * keeps the old behaviour rather than hiding every session.
 */
export async function recycledSpares(pids: number[]): Promise<Set<number>> {
  const wanted = pids.filter((p) => Number.isInteger(p) && p > 0);
  if (wanted.length === 0) return new Set();
  try {
    const { stdout } = await execFileAsync('ps', ['-p', wanted.join(','), '-o', 'pid=,command=']);
    return sparePidsFrom(stdout);
  } catch {
    return new Set();
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
