import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentNameFrom } from './ingest/hooks';
import { agentOfTranscript, TAIL_POLL_MS } from './ingest/files';
import type { TeamState, TeamsResponse } from '../shared/domain';
import type { Sidecar } from '../shared/roster';

const FIXTURES = path.resolve(process.cwd(), 'fixtures');
const ENTRY = fileURLToPath(new URL('./index.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));

const TEAM = 'session-98b0b4a7';
const LEAD_SESSION = '98b0b4a7-3206-455b-aaf6-a5a81ad1e283';
const SLUG = '-Users-alanoliv-code-agents-team-ui';
const AGENT = 'probe-alpha';
const SPAWN_ID = `a${AGENT}-84fd551b27de6433`;

// The second team the selector switches to. Its teammate name appears in no
// other team's roster, so "nothing of A survives" is decidable by name alone.
const TEAM_B = 'session-b5129c7b';
const LEAD_SESSION_B = 'b5129c7b-1f0a-4a2e-9b3c-6d5e4f3a2b1c';
const AGENT_B = 'probe-delta';
const SPAWN_ID_B = `a${AGENT_B}-babf58016882bc72`;
// A third, so two racing selects can name different teams.
const TEAM_C = 'session-cccc3333';
const LEAD_SESSION_C = 'cccc3333-2b1a-4c3d-8e7f-1a2b3c4d5e6f';
const B_LINE = "team B's own line";

/**
 * How long after the hook the drained line is allowed to take. It has to stay
 * well under TAIL_POLL_MS, because the poll would deliver the same line on its
 * own and a deadline anywhere near it would pass with the drain unwired —
 * which is exactly the regression this file exists to catch. Measured: 6ms
 * with the drain, 247ms (the next poll tick) without it.
 */
const HOOK_DEADLINE_MS = 120;

let child: ChildProcess | null = null;
let home = '';

afterEach(async () => {
  if (child) {
    child.kill('SIGTERM');
    await new Promise((r) => child!.on('exit', r));
    child = null;
  }
  if (home) await fs.rm(home, { recursive: true, force: true });
  home = '';
});

/**
 * A ~/.claude the server can boot against, with one teammate whose transcript
 * is a SYMLINK to a file outside the watched tree. Appending to the target
 * produces no fs.watch event inside `projects/`, and `walk()` collects only
 * `isFile()` entries so the 5s sweep never lists it either — which leaves the
 * 250ms tail poll and the hook's drain as the only two ways a new line can
 * reach the state, and time as the only thing that tells them apart.
 */
async function layout(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiring-'));
  const subagents = path.join(dir, 'projects', SLUG, LEAD_SESSION, 'subagents');
  await fs.mkdir(subagents, { recursive: true });
  await fs.mkdir(path.join(dir, 'teams', TEAM), { recursive: true });
  await fs.mkdir(path.join(dir, 'tasks'), { recursive: true });
  await fs.mkdir(path.join(dir, 'sessions'), { recursive: true });
  await fs.mkdir(path.join(dir, 'outside'), { recursive: true });

  await fs.copyFile(
    path.join(FIXTURES, 'config-4-members.json'),
    path.join(dir, 'teams', TEAM, 'config.json'),
  );

  const sidecars = JSON.parse(
    await fs.readFile(path.join(FIXTURES, 'meta-sidecars.json'), 'utf8'),
  ) as Sidecar[];
  await fs.writeFile(
    path.join(subagents, `agent-${SPAWN_ID}.meta.json`),
    JSON.stringify(sidecars.find((s) => s.name === AGENT)),
  );

  const transcript = path.join(dir, 'outside', 'transcript.jsonl');
  await fs.writeFile(transcript, '');
  await fs.symlink(transcript, path.join(subagents, `agent-${SPAWN_ID}.jsonl`));

  // Teams B and C are ORDINARY files: the symlink above exists to defeat the
  // sweep's walk and the watcher, which is exactly the machinery a switch has
  // to exercise.
  await writeTeamConfig(dir, TEAM_B, LEAD_SESSION_B, AGENT_B);
  await writeTeamConfig(dir, TEAM_C, LEAD_SESSION_C, 'probe-echo');

  const subagentsB = path.join(dir, 'projects', SLUG, LEAD_SESSION_B, 'subagents');
  await fs.mkdir(subagentsB, { recursive: true });
  await fs.writeFile(
    path.join(subagentsB, `agent-${SPAWN_ID_B}.meta.json`),
    JSON.stringify({
      agentType: AGENT_B,
      description: 'the second team',
      name: AGENT_B,
      spawnDepth: 0,
      model: 'claude-opus-5',
      taskKind: 'in_process_teammate',
      teamName: TEAM_B,
      color: 'green',
    } satisfies Sidecar),
  );
  await fs.writeFile(
    path.join(subagentsB, `agent-${SPAWN_ID_B}.jsonl`),
    assistantLine('33333333-3333-3333-3333-333333333333', B_LINE),
  );
  return dir;
}


async function writeTeamConfig(dir: string, team: string, leadSessionId: string, teammate: string) {
  await fs.mkdir(path.join(dir, 'teams', team), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'teams', team, 'config.json'),
    JSON.stringify({
      name: team,
      createdAt: 1787798107581,
      leadAgentId: `team-lead@${team}`,
      leadSessionId,
      members: [
        { agentId: `team-lead@${team}`, name: 'team-lead', joinedAt: 1, tmuxPaneId: 'in-process', subscriptions: [] },
        { agentId: `${teammate}@${team}`, name: teammate, joinedAt: 2, tmuxPaneId: 'in-process', subscriptions: [] },
      ],
    }),
  );
}

async function boot(claudeHome: string, extra: string[] = []): Promise<string> {
  const args = [TSX, ENTRY, '--claude-home', claudeHome, '--team', TEAM, '--port', '0', ...extra];
  const proc = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child = proc;

  let out = '';
  let err = '';
  proc.stdout!.setEncoding('utf8');
  proc.stderr!.setEncoding('utf8');
  proc.stderr!.on('data', (d: string) => (err += d));

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server never announced a port\n${out}\n${err}`)), 10_000);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}\n${out}\n${err}`));
    });
    proc.stdout!.on('data', (d: string) => {
      out += d;
      const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${m[1]}`);
      }
    });
  });
}

// /stream opens with a `snapshot` frame built from the store as it stands, so
// one connection per read gives the projected state with no coalescing delay.
async function snapshot(url: string): Promise<TeamState> {
  const abort = new AbortController();
  const res = await fetch(`${url}/stream`, { signal: abort.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (!buf.includes('\n\n')) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
  } finally {
    abort.abort();
  }
  const start = buf.indexOf('data: ') + 'data: '.length;
  return JSON.parse(buf.slice(start, buf.indexOf('\n\n', start))) as TeamState;
}

function transcriptOf(state: TeamState, agent: string): string[] {
  return (state.agents.find((a) => a.name === agent)?.transcript ?? []).map((l) => l.text);
}

async function waitForLine(url: string, agent: string, text: string, deadlineAt: number): Promise<boolean> {
  for (;;) {
    if (transcriptOf(await snapshot(url), agent).includes(text)) return true;
    if (Date.now() >= deadlineAt) return false;
    await new Promise((r) => setTimeout(r, 5));
  }
}

function assistantLine(uuid: string, text: string): string {
  return `${JSON.stringify({
    type: 'assistant',
    uuid,
    timestamp: new Date().toISOString(),
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  })}\n`;
}

function postHook(url: string, body: unknown): Promise<Response> {
  return fetch(`${url}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function selectTeam(url: string, team: string): Promise<Response> {
  return fetch(`${url}/api/teams/${team}/select`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
}

// A statusline row exists only because a hook posted it: no file under the temp
// ~/.claude can re-derive it, so `branch` is the one field that proves whose LOG
// the console is reading rather than whose files it just swept.
function postBranch(url: string, branch: string): Promise<Response> {
  return fetch(`${url}/statusline`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent_id: `team-lead@${TEAM}`, gitBranch: branch }),
  });
}

function names(state: TeamState): string[] {
  return state.agents.map((a) => a.name).sort();
}

describe('push -> pull wiring', () => {
  it(
    "a hook drains that agent's transcript immediately, without waiting for the tail poll",
    async () => {
      // Guards the whole test: if the poll ever gets fast enough to deliver
      // inside the deadline, this passes with the drain unwired and proves
      // nothing.
      expect(HOOK_DEADLINE_MS * 2).toBeLessThan(TAIL_POLL_MS);

      home = await layout();
      const url = await boot(home);
      const transcript = path.join(home, 'outside', 'transcript.jsonl');

      // The pull channel on its own, and a phase lock: observing this line
      // means a poll tick just fired, so the next one is a full TAIL_POLL_MS
      // away and cannot rescue the assertion below.
      await fs.appendFile(transcript, assistantLine('11111111-1111-1111-1111-111111111111', 'polled line'));
      expect(await waitForLine(url, AGENT, 'polled line', Date.now() + 4000)).toBe(true);

      await fs.appendFile(transcript, assistantLine('22222222-2222-2222-2222-222222222222', 'drained line'));
      const startedAt = Date.now();
      // A qualified `agent_id`, so the hook has to translate it to the bare
      // name the file ingest keys transcripts under before the drain can find
      // anything. Nothing else in the suite crosses those two name spaces.
      const res = await postHook(url, {
        hook_event_name: 'PostToolUse',
        agent_id: `${AGENT}@${TEAM}`,
        tool_name: 'Bash',
      });
      expect(res.status).toBe(200);

      const drained = await waitForLine(url, AGENT, 'drained line', startedAt + HOOK_DEADLINE_MS);
      expect(
        drained,
        `the hook did not drain ${AGENT}'s transcript within ${HOOK_DEADLINE_MS}ms — ` +
          'onAgentActivity is optional on HookDeps, so an unwired drain typechecks',
      ).toBe(true);
    },
    20_000,
  );

  it(
    'switches the console to another team at runtime, roster and transcript',
    async () => {
      home = await layout();
      const url = await boot(home);
      expect((await snapshot(url)).teamName).toBe(TEAM);

      const res = await selectTeam(url, TEAM_B);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, team: TEAM_B, changed: true });

      // The select awaits the new ingest's own sweep, so the state is finished
      // by the time it answers — no FSEvents delivery on the critical path.
      const after = await snapshot(url);
      expect(after.teamName).toBe(TEAM_B);
      expect(names(after)).toEqual(['team-lead', AGENT_B].sort());
      expect(transcriptOf(after, AGENT_B)).toContain(B_LINE);
    },
    20_000,
  );

  it(
    'leaves nothing of the team it left behind, then or 400ms later',
    async () => {
      home = await layout();
      const url = await boot(home);
      // Only a hook can produce this row, so no sweep of the new team can
      // re-derive it — it is present exactly while team A's log is the one
      // being read.
      expect((await postBranch(url, 'branch-of-team-a')).status).toBe(200);
      expect((await snapshot(url)).branch).toBe('branch-of-team-a');
      expect(names(await snapshot(url))).toContain(AGENT);

      expect((await selectTeam(url, TEAM_B)).status).toBe(200);

      const after = await snapshot(url);
      expect(names(after)).toEqual(['team-lead', AGENT_B].sort());
      expect(after.branch).toBeUndefined();

      // The retired ingest's sweep only tests `closed` between files and its
      // debounced watcher callbacks never test it at all, so a stale roster
      // append lands AFTER close() — measured inside 300ms. Without the
      // generation fence this second read flips teamName back to team A.
      await new Promise((r) => setTimeout(r, 400));
      const settled = await snapshot(url);
      expect(settled.teamName).toBe(TEAM_B);
      expect(names(settled)).toEqual(['team-lead', AGENT_B].sort());
      expect(settled.branch).toBeUndefined();
    },
    20_000,
  );

  it(
    "keeps the team it left behind readable — switching back restores its history",
    async () => {
      home = await layout();
      const url = await boot(home);
      expect((await postBranch(url, 'branch-of-team-a')).status).toBe(200);

      expect((await selectTeam(url, TEAM_B)).status).toBe(200);
      expect((await snapshot(url)).branch).toBeUndefined();

      const back = await selectTeam(url, TEAM);
      expect(back.status).toBe(200);
      expect(await back.json()).toEqual({ ok: true, team: TEAM, changed: true });

      const after = await snapshot(url);
      expect(after.teamName).toBe(TEAM);
      expect(names(after)).toContain(AGENT);
      // Nothing on disk can produce this: the round trip proves the store was
      // re-pointed rather than reopened or discarded.
      expect(after.branch).toBe('branch-of-team-a');
    },
    20_000,
  );

  it(
    'treats re-selecting the current team as a no-op, with no empty-roster blink',
    async () => {
      home = await layout();
      const url = await boot(home);
      const before = names(await snapshot(url));

      const res = await selectTeam(url, TEAM);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, team: TEAM, changed: false });

      // A rebuilt ingest starts with lastConfig = null, so a needless rebuild
      // is VISIBLE: teamName '' and zero agents until its sweep lands.
      const deadline = Date.now() + 400;
      while (Date.now() < deadline) {
        const state = await snapshot(url);
        expect(state.teamName).toBe(TEAM);
        expect(names(state)).toEqual(before);
      }
    },
    20_000,
  );

  it(
    '404s a team that is not there and one whose config cannot be read',
    async () => {
      home = await layout();
      const url = await boot(home);

      const missing = await selectTeam(url, 'session-nope0001');
      expect(missing.status).toBe(404);
      expect((await missing.json()).error).toBe('not found');

      await fs.mkdir(path.join(home, 'teams', 'session-torn0002'), { recursive: true });
      await fs.writeFile(path.join(home, 'teams', 'session-torn0002', 'config.json'), '{ not json');
      const torn = await selectTeam(url, 'session-torn0002');
      expect(torn.status).toBe(404);
      expect((await torn.json()).message).toContain('config.json');

      // Neither attempt tore anything down.
      expect((await snapshot(url)).teamName).toBe(TEAM);
    },
    20_000,
  );

  it(
    'lets exactly one of two racing selects win, and lands coherently on it',
    async () => {
      home = await layout();
      const url = await boot(home);

      const [b, c] = await Promise.all([selectTeam(url, TEAM_B), selectTeam(url, TEAM_C)]);
      expect([b.status, c.status].sort()).toEqual([200, 409]);
      const loser = b.status === 409 ? b : c;
      expect((await loser.json()).error).toBe('switch in progress');

      const winner = b.status === 200 ? TEAM_B : TEAM_C;
      const after = await snapshot(url);
      expect(after.teamName).toBe(winner);
      expect(names(after)).toEqual(['team-lead', winner === TEAM_B ? AGENT_B : 'probe-echo'].sort());
    },
    20_000,
  );

  it(
    'switches in --read-only, which still writes nothing into ~/.claude',
    async () => {
      home = await layout();
      const url = await boot(home, ['--read-only']);
      expect((await snapshot(url)).readOnly).toBe(true);

      const res = await selectTeam(url, TEAM_B);
      expect(res.status).toBe(200);
      const after = await snapshot(url);
      expect(after.teamName).toBe(TEAM_B);
      expect(after.readOnly).toBe(true);

      // Every other control route is still refused, and no inbox was written.
      const message = await fetch(`${url}/api/agents/${AGENT_B}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hi' }),
      });
      expect(message.status).toBe(409);
      for (const team of [TEAM, TEAM_B]) {
        await expect(fs.stat(path.join(home, 'teams', team, 'inboxes'))).rejects.toThrow();
      }
    },
    20_000,
  );

  it(
    'lists every team on the machine, and moves the current flag on a switch',
    async () => {
      home = await layout();
      const url = await boot(home);

      const listed = (await (await fetch(`${url}/api/teams`)).json()) as TeamsResponse;
      expect(listed.current).toBe(TEAM);
      expect(listed.teams.map((t) => t.name).sort()).toEqual([TEAM, TEAM_B, TEAM_C].sort());
      const byName = new Map(listed.teams.map((t) => [t.name, t]));
      expect(byName.get(TEAM)!.members).toBe(4);
      expect(byName.get(TEAM_B)!.members).toBe(2);
      expect(byName.get(TEAM)!.current).toBe(true);
      // The current team sorts first so the dropdown opens on it.
      expect(listed.teams[0].name).toBe(TEAM);

      expect((await selectTeam(url, TEAM_B)).status).toBe(200);
      const again = (await (await fetch(`${url}/api/teams`)).json()) as TeamsResponse;
      expect(again.current).toBe(TEAM_B);
      expect(again.teams.filter((t) => t.current).map((t) => t.name)).toEqual([TEAM_B]);
    },
    20_000,
  );

  it('resolves the same teammate name from a hook agent_id as from its transcript file', () => {
    // The two name spaces meet at `transcriptPaths`, which the ingest keys
    // from the sidecar and the drain looks up by the hook's name. Nothing
    // else makes them agree.
    const file = `/c/projects/${SLUG}/${LEAD_SESSION}/subagents/agent-${SPAWN_ID}.jsonl`;
    expect(agentOfTranscript(file, LEAD_SESSION, 'team-lead')).toBe(AGENT);
    expect(agentNameFrom(SPAWN_ID)).toBe(AGENT);
    expect(agentNameFrom(`${AGENT}@${TEAM}`)).toBe(AGENT);
  });
});
