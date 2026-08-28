import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentNameFrom } from './ingest/hooks';
import { agentOfTranscript, TAIL_POLL_MS } from './ingest/files';
import type { TeamState } from '../shared/domain';
import type { Sidecar } from '../shared/roster';

const FIXTURES = path.resolve(process.cwd(), 'fixtures');
const ENTRY = fileURLToPath(new URL('./index.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));

const TEAM = 'session-98b0b4a7';
const LEAD_SESSION = '98b0b4a7-3206-455b-aaf6-a5a81ad1e283';
const SLUG = '-Users-alanoliv-code-agents-team-ui';
const AGENT = 'probe-alpha';
const SPAWN_ID = `a${AGENT}-84fd551b27de6433`;

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
  return dir;
}

async function boot(claudeHome: string): Promise<string> {
  const proc = spawn(process.execPath, [TSX, ENTRY, '--claude-home', claudeHome, '--team', TEAM, '--port', '0'], {
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
