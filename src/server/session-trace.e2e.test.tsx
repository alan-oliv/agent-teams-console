// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { App } from '../web/App';
import { MockEventSource, installMockEventSource } from '../web/test/mockEventSource';
import type { TeamState, TeamsResponse } from '../shared/domain';

/**
 * The one case every other fixture in this repo assumes away: a session with NO
 * team artefact of any kind — no `teams/` directory, no config.json, no
 * teammate sidecar — reaching the trace view. Each half is unit-tested
 * elsewhere; only the whole path can show that the picker's row, the
 * `/api/select-session` retarget, the ingest's scope and the trace readout
 * agree about the same team-less session.
 */

// Resolved against the repo root, not `import.meta.url`: under jsdom that is an
// http URL, and this file spawns a real node process.
const ROOT = process.cwd();
const ENTRY = path.join(ROOT, 'src', 'server', 'index.ts');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');

const CWD = '/Users/someone/code/solo-session';
const SLUG = CWD.replace(/[^a-zA-Z0-9]/g, '-');
const SESSION = '8f2a1c00-9d4e-4f1b-8a77-0c2e6b5d4a31';
const CALLS = [
  { toolUseId: 'toolu_e2e_0001', name: 'probe-one', hex: '1111222233334444' },
  { toolUseId: 'toolu_e2e_0002', name: 'probe-two', hex: '5555666677778888' },
];
const T0 = 1787843382976;

let child: ChildProcess | null = null;
let home = '';

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  if (child) {
    child.kill('SIGTERM');
    await new Promise((r) => child!.on('exit', r));
    child = null;
  }
  if (home) await fs.rm(home, { recursive: true, force: true });
  home = '';
});

const line = (rec: unknown) => `${JSON.stringify(rec)}\n`;

function assistant(uuid: string, at: number, content: unknown[]) {
  return {
    type: 'assistant',
    uuid,
    timestamp: new Date(at).toISOString(),
    message: {
      id: `msg-${uuid}`,
      role: 'assistant',
      model: 'claude-opus-5',
      content,
      usage: {
        input_tokens: 1000,
        output_tokens: 1000,
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 500,
      },
    },
  };
}

/**
 * A ~/.claude holding one live session and nothing else. There is deliberately
 * no `teams` directory: not an empty one, none at all.
 */
async function soloHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'solo-e2e-'));
  await fs.mkdir(path.join(dir, 'sessions'), { recursive: true });
  await fs.mkdir(path.join(dir, 'tasks'), { recursive: true });
  const subagents = path.join(dir, 'projects', SLUG, SESSION, 'subagents');
  await fs.mkdir(subagents, { recursive: true });

  // The session's own transcript: two Task dispatches and their results, which
  // is what gives the tree its spine.
  const lead = [
    line(
      assistant(
        'lead-0001',
        T0,
        CALLS.map((c) => ({
          type: 'tool_use',
          id: c.toolUseId,
          name: 'Task',
          input: { name: c.name, description: `${c.name} sweep`, subagent_type: 'general-purpose' },
        })),
      ),
    ),
    ...CALLS.map((c, i) =>
      line({
        type: 'user',
        uuid: `lead-result-${i}`,
        timestamp: new Date(T0 + 60_000).toISOString(),
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: c.toolUseId, content: `${c.name} finished` },
          ],
        },
      }),
    ),
  ].join('');
  await fs.writeFile(path.join(dir, 'projects', SLUG, `${SESSION}.jsonl`), lead);

  for (const c of CALLS) {
    const stem = `agent-a${c.name}-${c.hex}`;
    await fs.writeFile(
      path.join(subagents, `${stem}.jsonl`),
      [0, 1, 2].map((i) => line(assistant(`${c.name}-${i}`, T0 + i * 1000, [{ type: 'text', text: `${c.name} ${i}` }]))).join(''),
    );
    // An ordinary Task subagent: `toolUseId` and no teammate `taskKind`, which
    // is the only sidecar a session that never formed a team ever writes.
    await fs.writeFile(
      path.join(subagents, `${stem}.meta.json`),
      JSON.stringify({
        agentType: 'general-purpose',
        description: `${c.name} sweep`,
        name: c.name,
        spawnDepth: 1,
        model: 'claude-opus-5',
        taskKind: 'subagent',
        teamName: '',
        toolUseId: c.toolUseId,
      }),
    );
  }

  await fs.writeFile(
    path.join(dir, 'sessions', `${process.pid}.json`),
    JSON.stringify({ pid: process.pid, sessionId: SESSION, cwd: CWD, name: 'a solo session' }),
  );
  return dir;
}

// No --team and no --session: the console boots knowing nothing, exactly as it
// does when the launcher has no team to announce.
async function boot(claudeHome: string): Promise<string> {
  // `--cwd` is the picker's scope, and the real launcher supplies it by simply
  // starting the server inside the session's own working copy. This fixture's
  // session lives in a made-up directory, so it has to be named explicitly.
  const proc = spawn(
    process.execPath,
    [TSX, ENTRY, '--claude-home', claudeHome, '--port', '0', '--cwd', CWD],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child = proc;
  let out = '';
  let err = '';
  proc.stdout!.setEncoding('utf8');
  proc.stderr!.setEncoding('utf8');
  proc.stderr!.on('data', (d: string) => (err += d));
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`server never announced a port\n${out}\n${err}`)),
      15_000,
    );
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

// /stream opens with a snapshot frame built from the store as it stands.
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

async function until<T>(what: string, read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

it('takes a session with no team config at all from the picker to a populated trace', async () => {
  home = await soloHome();
  const url = await boot(home);

  // 1. discoverable: the picker's listing offers it, flagged as a session.
  const listing = await until('the session to appear in the listing', async () => {
    const teams = (await (await fetch(`${url}/api/teams`)).json()) as TeamsResponse;
    return teams.teams.find((t) => t.name === SESSION);
  });
  expect(listing.sessionOnly).toBe(true);
  expect(listing.subagents).toBe(2);

  // 2. selectable: the route the picker row and the /s/ URL both post to.
  const select = await fetch(`${url}/api/select-session/${SESSION}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  expect(select.status).toBe(200);
  expect(await select.json()).toEqual({ ok: true, session: SESSION, changed: true });

  // 3. ingested: no team name, one synthetic lead, and the two Task calls under
  // it — all from a directory that has no config.json to read.
  const state = await until('the subagent tree', async () => {
    const s = await snapshot(url);
    return s.subagents && Object.keys(s.subagents).length > 0 ? s : undefined;
  });
  expect(state.teamName).toBe('');
  expect(state.agents).toHaveLength(1);
  const lead = state.agents[0];
  expect(state.subagents![lead.name]).toHaveLength(2);

  // 4. rendered: the real frame, in the real client, at the /s/ URL.
  installMockEventSource();
  window.history.replaceState(null, '', `/s/${SESSION}`);
  window.localStorage.clear();
  // Relative fetches go to the console that produced the state above, so the
  // client's own select and listing calls are the server's, not a stub's.
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(typeof input === 'string' && input.startsWith('/') ? `${url}${input}` : input, init),
  );
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', state));

  expect(await screen.findByTestId('trace-view')).toBeTruthy();
  const traceTabs = screen.getAllByRole('tab', { name: 'trace' });
  expect(traceTabs.every((t) => t.getAttribute('aria-selected') === 'true')).toBe(true);
  expect(screen.getByTestId('trace-subagents').textContent).toBe('2');
  expect(screen.getByTestId('trace-max-depth').textContent).toBe('1');
  // Read off the subagents' OWN transcripts — 2 calls x 3 records x 2,500
  // billed tokens. A zero here means the ingest never got inside a session it
  // had no config.json to scope it with.
  expect(screen.getByTestId('trace-tokens-in').textContent).toBe('15.0k');
  expect(screen.getByTestId('trace-spend').textContent).toBe('≈$0.01');
}, 40_000);
