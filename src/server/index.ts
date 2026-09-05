import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import { openStore, type Store, type EventKind, type StoredEvent } from './store';
import { project, transcriptHistory, transcriptLineText } from './project';
import { startFileIngest } from './ingest/files';
import { createHookHandlers } from './ingest/hooks';
import { createPermits } from './control/permits';
import { setTeamsRoot } from './control/mailbox';
import { createStream } from './stream';
import { foldWorkflows, modeOf } from './workflow';
import { createHttpServer, listen, type SelectTeamOutcome } from './http';
import { readJsonSafe } from './watch/jsonfile';
import { checkClaudeVersion, readClaudeVersion, runSetup } from './setup';
import { isPidAlive, recycledSpares, startIdleReaper } from './lifecycle';
import { logError, logInfo } from './log';
import type { TeamConfig } from '../shared/roster';
import type { FolderSummary, TeamsResponse, TeamSummary, TeamState } from '../shared/domain';

const execFileAsync = promisify(execFile);

export const DEFAULT_PORT = 4823;
/**
 * How long the machine may be quiet before the reaper exits, and — reused by
 * the team listing — how recently a team must have moved to still read as
 * live. One window, so "live" in the dropdown and "live" to the reaper cannot
 * drift apart.
 */
export const IDLE_GRACE_MS = 10 * 60 * 1000;
/**
 * How often the console checks whether a real team has appeared beside the one
 * it is showing. Short: this is the gap between spawning a teammate and seeing
 * it, and it costs one readdir over ~/.claude/teams.
 */
export const FOLLOW_INTERVAL_MS = 3000;

export interface Cli {
  command: 'run' | 'setup' | 'uninstall';
  port: number;
  readOnly: boolean;
  confirm: boolean;
  claudeHome: string;
  settingsPath: string;
  dbPath: string;
  team?: string;
  /**
   * The session whose workflow runs to read. A session that never formed a team
   * has no config.json to discover, so this is the only way to scope its runs —
   * without it the ingest fails closed and workflow mode is unreachable.
   */
  session?: string;
  /**
   * The working copy this console belongs to, and the scope of its picker — see
   * {@link listTeamSummaries}. Defaults to where the process was started, which
   * IS the session's cwd: the plugin launches the server from inside the
   * session that asked for it.
   */
  cwd: string;
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
  let session: string | undefined;
  // Where the process was started, which is the session's own working copy —
  // the plugin launches the server from inside the session that asked for it.
  let cwd = process.cwd();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === 'setup' || arg === 'uninstall') command = arg;
    else if (arg === '--read-only') readOnly = true;
    else if (arg === '--yes') confirm = true;
    else if (arg === '--cwd') cwd = argv[++i];
    else if (arg.startsWith('--cwd=')) cwd = arg.slice('--cwd='.length);
    else if (arg === '--port') port = Number(argv[++i]);
    else if (arg.startsWith('--port=')) port = Number(arg.slice('--port='.length));
    else if (arg === '--claude-home') claudeHome = argv[++i];
    else if (arg.startsWith('--claude-home=')) claudeHome = arg.slice('--claude-home='.length);
    else if (arg === '--team') team = argv[++i];
    else if (arg.startsWith('--team=')) team = arg.slice('--team='.length);
    else if (arg === '--session') session = argv[++i];
    else if (arg.startsWith('--session=')) session = arg.slice('--session='.length);
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
    session,
    cwd,
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

/**
 * Session ids whose recorded pid is still running. The file is named for the
 * PID and carries the session id INSIDE it — `sessions/<sessionId>.json`, which
 * isSessionLive above reads, does not exist on a real machine.
 */
interface SessionFacts {
  live: Set<string>;
  /** sessionId -> the conversation name `/branch` writes, used as the row's goal. */
  names: Map<string, string>;
  /** sessionId -> its cwd, for finding the subagents directory it writes into. */
  cwds: Map<string, string>;
}

async function readSessions(sessionsRoot: string): Promise<SessionFacts> {
  const facts: SessionFacts = { live: new Set(), names: new Map(), cwds: new Map() };
  let entries: string[];
  try {
    entries = await fs.readdir(sessionsRoot);
  } catch {
    return facts;
  }
  const docs: { sessionId: string; pid?: number; name?: string; cwd?: string }[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const doc = await readJsonSafe<{
      sessionId?: string;
      pid?: number;
      name?: string;
      cwd?: string;
    }>(path.join(sessionsRoot, entry));
    if (typeof doc?.sessionId !== 'string') continue;
    docs.push({ sessionId: doc.sessionId, pid: doc.pid, name: doc.name, cwd: doc.cwd });
  }

  // A pid that answers is not proof the session behind it is still there:
  // Claude Code recycles a finished background session's process into its spare
  // pool, where it survives for hours. Asked once for every pid, not per row.
  const spares = await recycledSpares(
    docs.map((d) => d.pid).filter((p): p is number => typeof p === 'number'),
  );

  for (const doc of docs) {
    if (typeof doc.pid === 'number' && isPidAlive(doc.pid) && !spares.has(doc.pid)) {
      facts.live.add(doc.sessionId);
    }
    if (typeof doc.name === 'string' && doc.name !== '') facts.names.set(doc.sessionId, doc.name);
    if (typeof doc.cwd === 'string' && doc.cwd !== '') facts.cwds.set(doc.sessionId, doc.cwd);
  }
  return facts;
}

/**
 * The branch a team is on. `branch` reaches the header via the statusline hook,
 * which is push-only and only ever describes the CURRENT session — so for every
 * other team in the listing it has to come off disk. Reading .git/HEAD beats
 * spawning git per team: one small file, no subprocess, and a detached HEAD
 * simply yields nothing rather than a bogus name.
 */
async function branchOf(cwd: string | undefined): Promise<string | undefined> {
  if (!cwd) return undefined;
  try {
    const head = await fs.readFile(path.join(cwd, '.git', 'HEAD'), 'utf8');
    const ref = /^ref:\s+refs\/heads\/(.+)$/m.exec(head.trim());
    return ref ? ref[1] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * How much work is sitting uncommitted in a team's tree.
 *
 * `branchOf` above deliberately avoids a subprocess; this one cannot. A
 * diffstat means reading the index and diffing blobs, which is git's job and
 * nobody else's — so the listing pays for it once per DIRECTORY rather than
 * once per team, since several sessions open on one repo is ordinary.
 *
 * The timeout is not decoration: this runs on the same await chain that answers
 * `GET /api/teams`, and a git that never returns is a picker that never opens.
 */
const GIT_TIMEOUT_MS = 2000;

async function diffstatOf(cwd: string | undefined): Promise<TeamSummary['diffstat']> {
  if (!cwd) return undefined;
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--shortstat', 'HEAD'], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    });
    return parseShortstat(stdout);
  } catch {
    // Not a repo, no git on PATH, no HEAD to diff against yet, or a tree so
    // large the read timed out. None of those is a number to report.
    return undefined;
  }
}

/** ` 3 files changed, 14 insertions(+), 2 deletions(-)` — either clause can be absent. */
export function parseShortstat(out: string): TeamSummary['diffstat'] {
  const added = Number(/(\d+) insertions?\(\+\)/.exec(out)?.[1] ?? 0);
  const removed = Number(/(\d+) deletions?\(-\)/.exec(out)?.[1] ?? 0);
  return added === 0 && removed === 0 ? undefined : { added, removed };
}

/**
 * config.json is rewritten only when membership changes, so a team that has
 * done nothing all day but exchange mail would read as idle on its mtime alone.
 * The team's own event log is not usable here: it exists only for teams this
 * console has already watched, which is the opposite of the paging-back case.
 */
async function lastActivityOf(teamDir: string, configMtimeMs: number): Promise<number> {
  let latest = configMtimeMs;
  let entries: string[];
  try {
    entries = await fs.readdir(path.join(teamDir, 'inboxes'));
  } catch {
    return latest;
  }
  for (const entry of entries) {
    // `.json.lock` ends in `.lock`, so this also excludes the lockfile siblings.
    if (!entry.endsWith('.json')) continue;
    try {
      const st = await fs.stat(path.join(teamDir, 'inboxes', entry));
      if (st.mtimeMs > latest) latest = st.mtimeMs;
    } catch {
      // Vanished between readdir and stat.
    }
  }
  return latest;
}

/**
 * The newest workflow run in one session, for the picker's row.
 *
 * A run leaves two files, in two DIFFERENT subtrees of the same session:
 *
 *   <session>/subagents/workflows/<runId>/journal.jsonl   while it runs
 *   <session>/workflows/<runId>.json                      once it terminates
 *
 * so the snapshot's existence, not the journal's age, is what ends a run — a
 * run that finished a minute ago has a journal as fresh as a running one's.
 * The age is only here for the run killed mid-flight, whose snapshot never
 * lands and which would otherwise read as running for good.
 *
 * One stat per run directory, and for the winner alone one stat and one small
 * read — the snapshot is the only place the run's name exists.
 */
/**
 * How many Task-subagent transcripts sit under a session — the picker's second
 * member-count exception (decision 23). One readdir, no reads: the count is a
 * row's activity cell, not an ingest. `workflows` is a directory and the match
 * wants a `.jsonl` file, so a session that only ever ran workflows counts zero.
 */
async function subagentCountOf(
  projectsRoot: string,
  cwd: string,
  sessionId: string,
): Promise<number> {
  if (!cwd || !sessionId) return 0;
  const dir = path.join(
    projectsRoot,
    cwd.replace(/[^a-zA-Z0-9]/g, '-'),
    sessionId,
    'subagents',
  );
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((e) => /^agent-.*\.jsonl$/.test(e)).length;
  } catch {
    return 0;
  }
}

async function workflowOf(
  projectsRoot: string,
  cwd: string,
  sessionId: string,
  now: number,
): Promise<TeamSummary['workflow']> {
  if (!cwd || !sessionId) return undefined;
  const sessionDir = path.join(projectsRoot, cwd.replace(/[^a-zA-Z0-9]/g, '-'), sessionId);
  const runsDir = path.join(sessionDir, 'subagents', 'workflows');
  let entries: string[];
  try {
    entries = await fs.readdir(runsDir);
  } catch {
    return undefined;
  }
  let runId = '';
  let journalMtimeMs = 0;
  for (const entry of entries) {
    try {
      const st = await fs.stat(path.join(runsDir, entry, 'journal.jsonl'));
      if (st.mtimeMs > journalMtimeMs) {
        journalMtimeMs = st.mtimeMs;
        runId = entry;
      }
    } catch {
      // Not a run directory, or its journal is gone — either way, not a run.
    }
  }
  if (!runId) return undefined;

  const snapshot = path.join(sessionDir, 'workflows', `${runId}.json`);
  let ended = false;
  try {
    ended = (await fs.stat(snapshot)).isFile();
  } catch {
    // No snapshot: still running, or killed before it could write one.
  }
  const name = ended ? await workflowNameOf(snapshot) : undefined;
  return {
    runId,
    ...(name ? { name } : {}),
    live: !ended && now - journalMtimeMs < IDLE_GRACE_MS,
  };
}

/**
 * Deliberately not `readJsonSafe`: its retry exists for files rewritten under
 * us, and a snapshot is written once. A torn or nameless one simply has no name
 * to give, which the row already renders as the run id.
 */
async function workflowNameOf(snapshot: string): Promise<string | undefined> {
  try {
    const raw = JSON.parse(await fs.readFile(snapshot, 'utf8')) as { workflowName?: unknown };
    return typeof raw.workflowName === 'string' && raw.workflowName ? raw.workflowName : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every team on the machine, dead ones included — paging back through a team
 * that has ended is the point of the selector, and `departed` already renders
 * one. Metadata only: folding each team's log to report cost or tokens measured
 * 48x this whole listing PER TEAM, on the same thread as the SSE flush.
 *
 * A team is omitted only when it could not be selected: no config.json, one
 * that survives readJsonSafe's retry still unparseable, or one whose name and
 * members are not the right shape. The listing is the definition of selectable,
 * so an entry that renders but cannot be picked would be a trap.
 */
/**
 * Which teams a live session is actually driving.
 *
 * `config.leadSessionId` cannot answer this: once a team is re-keyed it holds a
 * fresh id belonging to no session, so joining live sessions on it marked every
 * real team `done` while its lead sat there working. The teammates' sidecars
 * can — they live under the lead session's OWN directory and name their team —
 * and looking only under sessions already known to be live keeps this to a
 * handful of reads rather than a walk of every project.
 */
async function teamsOfLiveSessions(
  projectsRoot: string,
  sessions: SessionFacts,
): Promise<Map<string, string>> {
  const teams = new Map<string, string>();
  for (const sessionId of sessions.live) {
    const cwd = sessions.cwds.get(sessionId);
    if (!cwd) continue;
    const dir = path.join(projectsRoot, cwd.replace(/[^a-zA-Z0-9]/g, '-'), sessionId, 'subagents');
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.meta.json')) continue;
      const meta = await readJsonSafe<{ teamName?: string; taskKind?: string }>(
        path.join(dir, entry),
      );
      if (meta?.taskKind !== 'in_process_teammate') continue;
      if (typeof meta.teamName === 'string' && meta.teamName !== '') {
        teams.set(meta.teamName, sessionId);
      }
    }
  }
  return teams;
}

/**
 * Where a session's records live — the only thing that makes a config-less
 * session selectable, since it has no config.json to check the way a team does.
 *
 * The slug comes off the session's recorded cwd when there is a record; the
 * scan is the fallback for a session whose `sessions/<id>.json` was never
 * written or has since been reaped, which is exactly the long-lived,
 * team-less session this path exists for.
 *
 * **The transcript counts, not just the directory.** Claude Code writes
 * `<slug>/<sessionId>.jsonl` for every session, but only creates the sibling
 * `<slug>/<sessionId>/` directory once that session spills a tool result or
 * spawns a subagent. A bare solo window has the file and no directory — so
 * requiring the directory 404'd `/api/select-session` for precisely the
 * sessions the route was widened to serve. Returns the DIRECTORY either way,
 * since that is what the caller ingests; it just no longer has to exist yet.
 */
export async function sessionProjectDir(
  projectsRoot: string,
  sessionId: string,
  cwd?: string,
): Promise<string | null> {
  const isDir = async (dir: string): Promise<boolean> => {
    try {
      return (await fs.stat(dir)).isDirectory();
    } catch {
      return false;
    }
  };
  const isFile = async (file: string): Promise<boolean> => {
    try {
      return (await fs.stat(file)).isFile();
    } catch {
      return false;
    }
  };
  const found = async (slug: string): Promise<string | null> => {
    const dir = path.join(projectsRoot, slug, sessionId);
    if (await isDir(dir)) return dir;
    return (await isFile(`${dir}.jsonl`)) ? dir : null;
  };
  if (cwd) {
    const hit = await found(cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    if (hit) return hit;
  }
  let slugs: string[];
  try {
    slugs = await fs.readdir(projectsRoot);
  } catch {
    return null;
  }
  for (const slug of slugs) {
    const hit = await found(slug);
    if (hit) return hit;
  }
  return null;
}

/**
 * Live sessions that never formed a team, as picker rows.
 *
 * Everything in the loop above is keyed on a `teams/<name>/config.json`, which
 * these sessions never wrote — so without this pass an ordinary session with a
 * subagent tree is simply absent from the picker, and `/api/select-session`
 * has nothing to offer the operator. The subagent count is the bar: it keeps
 * every idle window on the machine out of the list.
 */
async function sessionRows(
  projectsRoot: string,
  sessionIds: readonly string[],
  folderCwd: string,
  sessions: SessionFacts,
  covered: ReadonlySet<string>,
  diffstats: Map<string, TeamSummary['diffstat']>,
  now: number,
): Promise<TeamSummary[]> {
  const rows: TeamSummary[] = [];
  for (const sessionId of sessionIds) {
    if (covered.has(sessionId)) continue;
    const cwd = sessions.cwds.get(sessionId) ?? folderCwd;
    const dir = path.join(projectsRoot, cwd.replace(/[^a-zA-Z0-9]/g, '-'), sessionId);
    const subagents = await subagentCountOf(projectsRoot, cwd, sessionId);
    const workflow = await workflowOf(projectsRoot, cwd, sessionId, now);
    // The transcript is the session, so its mtime is the session's last sign of
    // life — and unlike `subagents/` it is written by every session, including
    // the bare ones this list exists to stop dropping.
    let lastActivityAt = 0;
    try {
      lastActivityAt = (await fs.stat(`${dir}.jsonl`)).mtimeMs;
    } catch {
      try {
        lastActivityAt = (await fs.stat(path.join(dir, 'subagents'))).mtimeMs;
      } catch {
        // Enumerated from this directory a moment ago; `now` is close enough.
        lastActivityAt = now;
      }
    }
    const leadAlive = sessions.live.has(sessionId);
    const recent = now - lastActivityAt < IDLE_GRACE_MS;
    if (!diffstats.has(cwd)) diffstats.set(cwd, await diffstatOf(cwd));
    rows.push({
      // The SESSION id, not a team directory: `sessionOnly` below is what tells
      // the client to send it to /api/select-session rather than /select.
      name: sessionId,
      sessionOnly: true,
      members: 1,
      createdAt: 0,
      leadSessionId: sessionId,
      leadAlive,
      lastActivityAt,
      live: leadAlive || recent,
      current: false,
      branch: await branchOf(cwd),
      goal: sessions.names.get(sessionId),
      state: leadAlive ? 'live' : recent ? 'idle' : 'done',
      ...(workflow ? { workflow } : {}),
      ...(subagents > 0 ? { subagents } : {}),
      ...(diffstats.get(cwd) ? { diffstat: diffstats.get(cwd) } : {}),
    });
  }
  return rows;
}

/**
 * Every session this folder has ever held, newest first — the `<sessionId>.jsonl`
 * files Claude Code writes per session under the cwd's project slug.
 *
 * This is the durable record and the only complete one. `teams/<name>/` is
 * reaped when a team ends, so a listing keyed on it loses every finished team:
 * three real teams on this machine, one of them seven members, were absent from
 * the picker entirely while their transcripts sat right here.
 *
 * A session counts by EITHER form, the same rule {@link sessionProjectDir}
 * follows: `<sessionId>.jsonl` is written for every session, and the sibling
 * `<sessionId>/` directory only appears once one spills a tool result or spawns
 * a subagent. Requiring one form would drop whichever sessions have the other.
 */
async function sessionIdsIn(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const ids = new Set<string>();
  for (const entry of entries) {
    const id = entry.endsWith('.jsonl') ? entry.slice(0, -'.jsonl'.length) : entry;
    // Session ids are uuids; anything else in here is not a session.
    if (/^[0-9a-f]{8}-[0-9a-f-]+$/i.test(id)) ids.add(id);
  }
  return [...ids];
}

async function folderSessionIds(projectsRoot: string, cwd: string): Promise<string[]> {
  return sessionIdsIn(path.join(projectsRoot, cwd.replace(/[^a-zA-Z0-9]/g, '-')));
}

/**
 * The directory a project dir was recorded for, read back out of one of its
 * transcripts.
 *
 * The slug cannot be reversed — `cwd.replace(/[^a-zA-Z0-9]/g, '-')` maps `/`,
 * `.`, `_` and `-` all onto the same character, so `-private-tmp` is as much
 * `/private/tmp` as it is `/private-tmp`. Every transcript record carries the
 * real `cwd`, so one of them is asked instead. Not the first line: a resumed
 * session opens with a summary record that has no cwd on it, so the scan runs
 * until it finds one.
 */
async function folderPathOf(dir: string, sessionIds: string[]): Promise<string | undefined> {
  // A session id can name a spill directory with no transcript beside it, so
  // the first id is not always readable. Three is enough to clear that without
  // turning a miss into a scan of the whole folder.
  for (const sessionId of sessionIds.slice(0, 3)) {
    const cwd = await cwdInTranscript(path.join(dir, `${sessionId}.jsonl`));
    if (cwd) return cwd;
  }
  return undefined;
}

async function cwdInTranscript(file: string): Promise<string | undefined> {
  let head: string;
  try {
    const fh = await fs.open(file);
    try {
      // 64 KiB covers a transcript's opening records many times over; reading
      // the whole file would mean pulling megabytes per folder to answer a
      // question the first few lines always settle.
      const { buffer, bytesRead } = await fh.read(Buffer.alloc(65536), 0, 65536, 0);
      head = buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await fh.close();
    }
  } catch {
    return undefined;
  }
  for (const line of head.split('\n')) {
    if (!line.includes('"cwd"')) continue;
    try {
      const rec = JSON.parse(line) as { cwd?: unknown };
      if (typeof rec.cwd === 'string' && rec.cwd !== '') return rec.cwd;
    } catch {
      // A truncated last line is expected — we read a fixed prefix of the file.
    }
  }
  return undefined;
}

/**
 * Every folder the machine has sessions in, newest first — the folder menu.
 *
 * Ordered by the project directory's own mtime, which moves when a session is
 * written into it: the folder worked in most recently sits at the top, which is
 * the one an operator switching folders most often wants. A folder whose path
 * cannot be read back is dropped rather than shown under its slug — a row the
 * operator cannot recognise is worse than no row.
 */
export async function listFolders(projectsRoot: string): Promise<FolderSummary[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(projectsRoot);
  } catch {
    return [];
  }
  const folders: (FolderSummary & { at: number })[] = [];
  for (const entry of entries) {
    const dir = path.join(projectsRoot, entry);
    const ids = await sessionIdsIn(dir);
    if (ids.length === 0) continue;
    const cwd = await folderPathOf(dir, ids);
    if (!cwd) continue;
    let at = 0;
    try {
      at = (await fs.stat(dir)).mtimeMs;
    } catch {
      // Ordering only — a directory we cannot stat still lists, just last.
    }
    folders.push({ path: cwd, name: path.basename(cwd), sessions: ids.length, at });
  }
  folders.sort((a, b) => b.at - a.at);
  return folders.map(({ at: _at, ...folder }) => folder);
}

/**
 * Which folder a listing request may actually be answered for.
 *
 * The scope is not just a filter: it reaches `<cwd>/.git/HEAD` and a `git diff`
 * spawned in that directory, so a path the browser names is checked against the
 * folders that demonstrably hold sessions before any of that runs. `fallback`
 * is this process's own `--cwd` and needs no check — and deliberately is not
 * required to be in the list, since a working copy whose first session has not
 * been written yet is still the right scope for it.
 */
export async function folderScope(
  projectsRoot: string,
  fallback: string,
  folder?: string,
): Promise<string> {
  if (!folder || folder === fallback) return fallback;
  const known = await listFolders(projectsRoot);
  return known.some((f) => f.path === folder) ? folder : fallback;
}

/**
 * The picker's rows, scoped to ONE FOLDER — the directory the console was
 * started from.
 *
 * The scope is the point. A console is launched from inside a session in a
 * working copy, so that working copy is what the operator is switching between;
 * a machine-wide list mixed in every unrelated window and still MISSED the
 * sessions that mattered, because it was keyed on `teams/<name>/config.json`,
 * which is reaped when a team ends. Enumerating the folder's transcripts
 * instead makes the list both narrower and more complete: the three finished
 * multi-member teams that never appeared come back, and the four windows open
 * on unrelated repos drop out.
 *
 * `cwd` absent keeps the old machine-wide behaviour, which is what the tests
 * that predate the scope still exercise.
 */
export async function listTeamSummaries(
  teamsRoot: string,
  sessionsRoot: string,
  current: string,
  projectsRoot?: string,
  cwd?: string,
): Promise<TeamsResponse> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(teamsRoot);
  } catch {
    // No teams directory at all is the config-less machine, not an empty
    // picker: the session rows below are the only thing it has to offer.
  }

  const sessions = await readSessions(sessionsRoot);
  // team -> the REAL session driving it, which is also the only place its name
  // ("agents-team-ui", whatever `/rename` last wrote) can be read from.
  const liveTeams = projectsRoot
    ? await teamsOfLiveSessions(projectsRoot, sessions)
    : new Map<string, string>();
  const now = Date.now();
  const teams: TeamSummary[] = [];
  // Team directory -> the cwd its lead sits in, kept for the cwd pass below.
  const leadCwds = new Map<string, string>();
  // One git invocation per DIRECTORY, not per team: two sessions open on the
  // same repo report the same tree, and the listing runs on the request thread.
  const diffstats = new Map<string, TeamSummary['diffstat']>();
  for (const name of entries) {
    const teamDir = path.join(teamsRoot, name);
    let configMtimeMs: number;
    try {
      const st = await fs.stat(path.join(teamDir, 'config.json'));
      if (!st.isFile()) continue;
      configMtimeMs = st.mtimeMs;
    } catch {
      continue;
    }
    const config = await readJsonSafe<TeamConfig>(path.join(teamDir, 'config.json'));
    if (!config || typeof config.name !== 'string' || !Array.isArray(config.members)) continue;

    // A team whose lead session id is missing is still selectable: its log
    // history is exactly what paging back means.
    const leadSessionId = typeof config.leadSessionId === 'string' ? config.leadSessionId : '';
    // Either answer proves the lead is there: the sidecars say a live session
    // is driving this team, or config.json's leadSessionId is a real session
    // that is still running (a team that has never been re-keyed).
    const leadSession = liveTeams.get(name) ?? leadSessionId;
    const leadAlive = liveTeams.has(name) || (leadSessionId !== '' && sessions.live.has(leadSessionId));
    const lastActivityAt = await lastActivityOf(teamDir, configMtimeMs);
    const recent = now - lastActivityAt < IDLE_GRACE_MS;
    const lead = config.members.find((m) => m.agentId === config.leadAgentId) ?? config.members[0];
    leadCwds.set(name, lead?.cwd ?? '');
    // The session's own cwd first: it is the directory whose slug names the
    // project dir the run writes into, and a re-keyed team's members[] can name
    // a different one.
    const workflow = projectsRoot
      ? await workflowOf(projectsRoot, sessions.cwds.get(leadSession) ?? lead?.cwd ?? '', leadSession, now)
      : undefined;
    const subagents = projectsRoot
      ? await subagentCountOf(projectsRoot, sessions.cwds.get(leadSession) ?? lead?.cwd ?? '', leadSession)
      : 0;
    const leadCwd = lead?.cwd ?? '';
    if (!diffstats.has(leadCwd)) diffstats.set(leadCwd, await diffstatOf(leadCwd));
    teams.push({
      // The DIRECTORY name, not config.name: the ingest gates its own team's
      // config.json on the directory, so a mismatch would make the team
      // unselectable in practice.
      name,
      members: config.members.length,
      createdAt: typeof config.createdAt === 'number' ? config.createdAt : 0,
      leadSessionId,
      leadAlive,
      lastActivityAt,
      live: leadAlive || recent,
      current: name === current,
      branch: await branchOf(lead?.cwd),
      // Named after the session actually driving the team. Keyed on
      // config.leadSessionId this was blank for every re-keyed team — the live
      // one showed no name while a four-hour-dead one showed its own.
      goal: sessions.names.get(leadSession),
      // `idle` is a team whose lead process is gone but whose files moved
      // recently — it can still be paged back into; `done` is finished.
      state: leadAlive ? 'live' : recent ? 'idle' : 'done',
      ...(workflow ? { workflow } : {}),
      ...(subagents > 0 ? { subagents } : {}),
      ...(diffstats.get(leadCwd) ? { diffstat: diffstats.get(leadCwd) } : {}),
    });
  }

  // Runs first: a session it hands a team to is represented by that team's row
  // and must not also appear below as a bare session.
  const adopted = adoptByCwd(teams, leadCwds, sessions, now);

  const scoped = projectsRoot && cwd ? await folderSessionIds(projectsRoot, cwd) : undefined;
  if (scoped) {
    // A team whose lead ran somewhere else belongs to that folder's picker, not
    // this one. The session ON SCREEN is the exception, always: dropping the row
    // you are looking at would leave the picker contradicting the body, and
    // would take away the only way back to it.
    const here = new Set(scoped);
    for (let i = teams.length - 1; i >= 0; i--) {
      if (!here.has(teams[i].leadSessionId) && !teams[i].current) teams.splice(i, 1);
    }
  }

  if (projectsRoot) {
    const covered = new Set([
      ...teams.map((t) => t.leadSessionId),
      ...liveTeams.values(),
      ...adopted,
    ]);
    // Scoped: every session this folder holds, so a finished team whose
    // `teams/` directory was reaped still lists. Unscoped: the old rule, live
    // sessions only, since there is no folder to enumerate.
    const ids = scoped ?? [...sessions.live].filter((id) => sessions.cwds.has(id));
    teams.push(...(await sessionRows(projectsRoot, ids, cwd ?? '', sessions, covered, diffstats, now)));
  }

  teams.sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      Number(b.live) - Number(a.live) ||
      b.lastActivityAt - a.lastActivityAt ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  // Only when there is a folder to be scoped to: a machine-wide listing has no
  // chip to draw, and the menu would be offering to leave a scope it is not in.
  const folders = projectsRoot && cwd ? await listFolders(projectsRoot) : undefined;
  return { current, teams, ...(folders ? { folder: cwd, folders } : {}) };
}

/**
 * Links a team to the live session driving it by the directory they share.
 *
 * The sidecar route can only answer once a TEAMMATE has spawned, because a
 * sidecar is a teammate's own file. A session that has just started — the lead
 * alone, no teammates yet — therefore had no name and no proof of life: the
 * picker offered `session-e9044edd · 1 agent · idle` for a session that was
 * running at that moment, and the row said nothing a person could recognise.
 *
 * Evidence, not derivation: members[] records each member's cwd, and the
 * session records its own. Two guards keep it honest — a cwd running more than
 * one live session is ambiguous and is skipped rather than guessed at, and only
 * the most recently active team in a directory is claimed, so yesterday's
 * leftover team in the same repo is not resurrected as live.
 */
function adoptByCwd(
  teams: TeamSummary[],
  leadCwds: Map<string, string>,
  sessions: SessionFacts,
  now: number,
): Set<string> {
  const adopted = new Set<string>();
  const byCwd = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const sessionId of sessions.live) {
    const cwd = sessions.cwds.get(sessionId);
    if (!cwd) continue;
    if (byCwd.has(cwd)) ambiguous.add(cwd);
    else byCwd.set(cwd, sessionId);
  }
  for (const cwd of ambiguous) byCwd.delete(cwd);
  if (byCwd.size === 0) return adopted;

  const claimed = new Set(teams.filter((t) => t.leadAlive).map((t) => t.name));
  for (const [cwd, sessionId] of byCwd) {
    const best = teams
      .filter(
        (t) =>
          !claimed.has(t.name) &&
          leadCwds.get(t.name) === cwd &&
          // Bounded, and this bound is the whole point. Sharing a working
          // directory is weak evidence — two sessions open on the same repo is
          // ordinary — so without it a live session with no team of its own
          // adopts the most recent LEFTOVER team in that directory and reports
          // it as live. Observed: a session adopting a team last touched 26
          // hours earlier, which then showed as `1 agent live` in the picker.
          // A session genuinely driving a re-keyed team is writing to it, so
          // requiring recent movement keeps the `/branch` case and drops the
          // corpses.
          now - t.lastActivityAt < IDLE_GRACE_MS,
      )
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
    if (!best) continue;
    claimed.add(best.name);
    adopted.add(sessionId);
    best.leadAlive = true;
    best.live = true;
    best.state = 'live';
    best.goal ??= sessions.names.get(sessionId);
  }
  return adopted;
}

/**
 * A store wrapper that only writes while its generation is the current one.
 *
 * `FileIngest.close()` stops the timers and the watchers, but it does not stop
 * work already in flight: `sweep()` tests its `closed` flag between files, so
 * the file it is awaiting completes, and a debounced watcher callback that has
 * already fired never tests it at all. A retired ingest therefore keeps writing
 * — measured, one roster row landing in the NEXT team's log — and its `onTeam`
 * can call `setTeam` and yank the console back to the team the operator just
 * left, with nothing on screen to explain it. Since the generation is bumped
 * BEFORE close(), everything already scheduled is inert from that instant.
 */
export function fencedSink(live: Store, generation: number, current: () => number): Store {
  const mine = () => generation === current();
  return {
    // No caller reads this event back; the return only satisfies the contract.
    append: (kind: EventKind, payload: unknown, agent?: string): StoredEvent =>
      mine() ? live.append(kind, payload, agent) : { seq: 0, ts: Date.now(), kind, agent, payload },
    replay: () => live.replay(),
    setTeam: (name: string) => {
      if (mine()) live.setTeam(name);
    },
    close: () => {},
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
  const sessionsRoot = path.join(cli.claudeHome, 'sessions');
  const projectsRoot = path.join(cli.claudeHome, 'projects');
  setTeamsRoot(teamsRoot);

  const discovered = await discoverTeam(teamsRoot, sessionsRoot, cli.team);
  // --team can name a team whose config.json has not been written yet (the
  // launcher announces before the spawn that creates it); discoverTeam then
  // reports unknown rather than guessing, so fall back to the name itself —
  // the ingest below picks up the directory once it appears.
  const teamName = discovered?.teamName ?? cli.team;
  let leadSessionId = discovered?.leadSessionId ?? cli.session;

  const store = openStore(cli.dbPath, teamName ?? '');
  const permits = createPermits();

  /**
   * The published frame. `project()` folds a TEAM and knows nothing about
   * workflows, so mode and runs are layered on here rather than threaded
   * through it — one replay, one place where the two modes meet.
   */
  const publish = (): TeamState => {
    const events = store.replay();
    const team = project(events, cli.readOnly);
    const workflows = foldWorkflows(events);
    return {
      ...team,
      // Hook-supplied values win; the disk-derived ones are the floor, so the
      // header is right whether or not the status line is installed.
      sessionName: team.sessionName ?? leadFacts.sessionName,
      branch: team.branch ?? leadFacts.branch,
      mode: modeOf(team.agents.length, workflows),
      workflows,
    };
  };

  const hub = createStream(publish);

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

  // The ingest's licence to write — see fencedSink.
  let generation = 0;
  // The authoritative answer to "which team is showing". NOT state().teamName,
  // which is '' for the whole window between setTeam and the sweep landing.
  let currentTeam = teamName ?? '';
  // The session the console is scoped to when there is no team at all — set at
  // boot by `--session`, and by selectSession below. Kept apart from
  // `currentTeam` so neither mode's no-op check can answer for the other.
  let currentSession = teamName ? '' : (leadSessionId ?? '');

  const startIngest = (gen: number, team: string | undefined, lead: string | undefined) =>
    startFileIngest(fencedSink(live, gen, () => generation), {
      paths: {
        projects: path.join(cli.claudeHome, 'projects'),
        teams: teamsRoot,
        tasks: path.join(cli.claudeHome, 'tasks'),
        sessions: path.join(cli.claudeHome, 'sessions'),
      },
      teamName: team,
      leadSessionId: lead,
      sessionOnly: team === undefined && lead !== undefined,
      onTeam: (info) => {
        if (gen !== generation) return;
        store.setTeam(info.teamName);
        currentTeam = info.teamName;
        leadSessionId = info.leadSessionId;
      },
      onLeadSession: (id) => {
        if (gen === generation) leadSessionId = id;
      },
    });

  // `let`, so the closures below — and `stop`'s close, and the hook's drain —
  // follow the rebind instead of staying frozen on the boot ingest.
  // `leadSessionId`, not `discovered?.leadSessionId`: with no team to discover
  // the only session id we have is the one `--session` named, and the ingest
  // scopes workflow runs on it.
  let ingest = startIngest(generation, teamName, leadSessionId);
  await ingest.sweep();

  let switching = false;
  // Set the moment the operator picks a team themselves. The follower below
  // only ever corrects the console's OWN guess — once a human has chosen, a
  // team appearing elsewhere must not yank them off what they are reading.
  let pinned = false;
  /**
   * Session name and branch read off disk for the CURRENT team, refreshed by
   * the follower. A floor under the `statusline` hook, which is optional.
   */
  let leadFacts: { sessionName?: string; branch?: string } = {};

  /**
   * Only the ingest is rebuilt. The store is RE-POINTED: setTeam already clears
   * the events, loads the target team's log and hands the owner stamp over,
   * while reopening it would orphan the hub's snapshot closure, `live`, and the
   * hook handlers' destructured copy. The rebuild is what matters for the
   * ingest: its mtime marks alone would make the new team's config.json look
   * already-seen, and the sweep would skip it forever.
   */
  const retarget = async (team: string, lead: string): Promise<void> => {
    const gen = ++generation;
    ingest.close();
    store.setTeam(team);
    leadSessionId = lead;
    currentTeam = team;
    currentSession = '';
    // Dropped, not left to the follower's next tick: these are the OLD team's
    // name and branch, and holding them for even one interval would show the
    // session you just left in the header of the one you switched to. Cleared
    // here so the worst case is a blank field for a moment, not a wrong one.
    leadFacts = {};
    ingest = startIngest(gen, team, lead);
    // Answering before the sweep lands would return a console with no team name
    // — which is also what http.ts's team() reads, so a control request racing
    // that window would throw inside sendToInbox's name guard.
    await ingest.sweep();
    hub.publish();
  };

  const selectTeam = async (team: string): Promise<SelectTeamOutcome> => {
    // A rebuild for nothing is visible, not just wasteful: a fresh ingest has no
    // config until its sweep lands, so the console would blink empty.
    if (team === currentTeam) {
      pinned = true;
      return { ok: true, changed: false };
    }
    // Claimed synchronously with the check, before the reads below await — a
    // second request landing in that window would otherwise pass the guard too.
    // Rejected rather than queued: a queued second click resolves after the
    // first and lands the operator on the team they changed their mind about.
    if (switching) {
      return { ok: false, reason: 'busy', message: `a team switch is already running — retry ${team}` };
    }
    switching = true;
    try {
      let exists = false;
      try {
        exists = (await fs.stat(path.join(teamsRoot, team))).isDirectory();
      } catch {
        // Absent, or vanished under us — either way there is nothing to show.
      }
      if (!exists) return { ok: false, reason: 'missing', message: `no team ${team}` };

      const config = await readJsonSafe<TeamConfig>(path.join(teamsRoot, team, 'config.json'));
      if (!config || typeof config.name !== 'string' || !Array.isArray(config.members)) {
        logError(`select ${team}`, new Error('config.json is missing or unreadable'));
        return {
          ok: false,
          reason: 'missing',
          message: `teams/${team}/config.json is missing or unreadable`,
        };
      }
      await retarget(team, typeof config.leadSessionId === 'string' ? config.leadSessionId : '');
      // The operator has chosen; the follower stops correcting from here on.
      pinned = true;
      return { ok: true, changed: true };
    } finally {
      // In a finally, so a throw cannot wedge the console into permanent 409s.
      switching = false;
    }
  };

  /**
   * The same rebuild as `retarget`, aimed at a session with no team. The store
   * is re-pointed at a log named for the SESSION: `setTeam` is what clears the
   * previous target's events, and a session id passes its name gate, so the
   * session gets the per-target log every team already gets. `currentTeam`
   * stays empty — there is no team to highlight in the picker, and a name with
   * no `teams/<name>` directory behind it would read as a deleted team and have
   * the idle reaper exit the console out from under the operator.
   */
  const retargetSession = async (sessionId: string): Promise<void> => {
    const gen = ++generation;
    ingest.close();
    store.setTeam(sessionId);
    leadSessionId = sessionId;
    currentTeam = '';
    currentSession = sessionId;
    leadFacts = {};
    ingest = startIngest(gen, undefined, sessionId);
    await ingest.sweep();
    hub.publish();
  };

  const selectSession = async (sessionId: string): Promise<SelectTeamOutcome> => {
    if (sessionId === currentSession) {
      pinned = true;
      return { ok: true, changed: false };
    }
    if (switching) {
      return {
        ok: false,
        reason: 'busy',
        message: `a team switch is already running — retry ${sessionId}`,
      };
    }
    switching = true;
    try {
      const sessions = await readSessions(sessionsRoot);
      const dir = await sessionProjectDir(projectsRoot, sessionId, sessions.cwds.get(sessionId));
      if (!dir) return { ok: false, reason: 'missing', message: `no session ${sessionId}` };
      await retargetSession(sessionId);
      pinned = true;
      return { ok: true, changed: true };
    } finally {
      switching = false;
    }
  };

  let reaper: { stop(): void } | null = null;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    reaper?.stop();
    clearInterval(follower);
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
    state: publish,
    readOnly: cli.readOnly,
    listTeams: async (folder?: string) =>
      listTeamSummaries(
        teamsRoot,
        sessionsRoot,
        currentTeam,
        projectsRoot,
        await folderScope(projectsRoot, cli.cwd, folder),
      ),
    history: (agent: string) => transcriptHistory(store.replay(), agent),
    lineText: (agent: string, id: string) => transcriptLineText(store.replay(), agent, id),
    selectTeam,
    selectSession,
    onShutdown: stop,
  });

  const port = await listen(server, cli.port);
  console.log(`agent teams console on http://127.0.0.1:${port}${cli.readOnly ? ' (read-only)' : ''}`);

  /**
   * A console can be running before the team it should show even exists: the
   * launcher starts it on PreToolUse, BEFORE the spawn that writes config.json,
   * and Claude Code gives each new team a fresh directory. The ingest only ever
   * learns one team — handleTeamsJson ignores every other directory once it has
   * one — so without this the console sat on whatever it guessed at startup
   * while the real team filled up beside it, and teammates never appeared.
   *
   * Only corrects its own guess, and only towards a REAL team (two or more
   * members, the same bar the launcher uses), so a lead-only leftover cannot
   * steal the view from a team that is actually working.
   */
  const followRealTeam = async (): Promise<void> => {
    if (switching) return;
    const { teams } = await listTeamSummaries(
      teamsRoot,
      sessionsRoot,
      currentTeam,
      projectsRoot,
      cli.cwd,
    );

    // The listing already resolved both of these off disk for every row, so
    // caching the current team's costs nothing. The frame's own copies come
    // from the `statusline` hook, which only fires when the console owns the
    // `statusLine` key — an optional install step — so on most machines the
    // header fell back to the directory id while the picker row two lines
    // below it showed the real name.
    const mine = teams.find((t) => t.name === currentTeam);
    leadFacts = { sessionName: mine?.goal, branch: mine?.branch };

    if (pinned) return;
    if (teams.some((t) => t.name === currentTeam && t.members >= 2)) return;
    // Sorted live-first, then by most recent activity, so the first real team
    // is the one worth watching.
    const target = teams.find((t) => t.members >= 2 && t.live);
    if (!target || target.name === currentTeam) return;
    switching = true;
    try {
      logInfo(`following ${target.name} (${target.members} members)`);
      await retarget(target.name, target.leadSessionId);
    } catch (err) {
      logError('follow', err);
    } finally {
      switching = false;
    }
  };

  const follower = setInterval(() => void followRealTeam(), FOLLOW_INTERVAL_MS);
  follower.unref();
  void followRealTeam();

  reaper = startIdleReaper({
    watchedTeam: () => currentTeam,
    teamsRoot,
    graceMs: IDLE_GRACE_MS,
    onIdle: () => {
      logInfo('nothing live to show — exiting');
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
