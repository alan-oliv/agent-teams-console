import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
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
import type { TeamsResponse, TeamSummary, TeamState } from '../shared/domain';

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

export async function listTeamSummaries(
  teamsRoot: string,
  sessionsRoot: string,
  current: string,
  projectsRoot?: string,
): Promise<TeamsResponse> {
  let entries: string[];
  try {
    entries = await fs.readdir(teamsRoot);
  } catch {
    return { current, teams: [] };
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
    });
  }

  adoptByCwd(teams, leadCwds, sessions);

  teams.sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      Number(b.live) - Number(a.live) ||
      b.lastActivityAt - a.lastActivityAt ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return { current, teams };
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
): void {
  const byCwd = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const sessionId of sessions.live) {
    const cwd = sessions.cwds.get(sessionId);
    if (!cwd) continue;
    if (byCwd.has(cwd)) ambiguous.add(cwd);
    else byCwd.set(cwd, sessionId);
  }
  for (const cwd of ambiguous) byCwd.delete(cwd);
  if (byCwd.size === 0) return;

  const claimed = new Set(teams.filter((t) => t.leadAlive).map((t) => t.name));
  for (const [cwd, sessionId] of byCwd) {
    const best = teams
      .filter((t) => !claimed.has(t.name) && leadCwds.get(t.name) === cwd)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
    if (!best) continue;
    claimed.add(best.name);
    best.leadAlive = true;
    best.live = true;
    best.state = 'live';
    best.goal ??= sessions.names.get(sessionId);
  }
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
    return { ...team, mode: modeOf(team.agents.length, workflows), workflows };
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
    listTeams: () => listTeamSummaries(teamsRoot, sessionsRoot, currentTeam, projectsRoot),
    history: (agent: string) => transcriptHistory(store.replay(), agent),
    lineText: (agent: string, id: string) => transcriptLineText(store.replay(), agent, id),
    selectTeam,
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
    if (pinned || switching) return;
    const { teams } = await listTeamSummaries(teamsRoot, sessionsRoot, currentTeam, projectsRoot);
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
