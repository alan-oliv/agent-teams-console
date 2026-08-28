import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { openStore, type Store } from './store';
import { createPermits, type Permits } from './control/permits';
import { createHookHandlers } from './ingest/hooks';
import { createStream, type StreamHub } from './stream';
import { fileURLToPath } from 'node:url';
import {
  createHttpServer,
  listen,
  BAD_SEGMENT_BODY,
  DEFAULT_WEB_DIST,
  NO_BUNDLE_BODY,
  READ_ONLY_BODY,
  type SelectTeamOutcome,
} from './http';
import { setTeamsRoot } from './control/mailbox';
import type { InboxEntry } from '../shared/mailbox';
import type { TeamState, TeamsResponse } from '../shared/domain';

const FIXTURES = path.resolve(process.cwd(), 'fixtures');
const TEAM = 'session-98b0b4a7';

let dir: string;
let store: Store;
let permits: Permits;
let hub: StreamHub;
let state: TeamState;

function emptyState(readOnly: boolean): TeamState {
  return {
    teamName: TEAM,
    leadSessionId: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283',
    startedAt: 1787798107581,
    totalTokens: 734808,
    totalCostUsd: 0.898893,
    agents: [],
    tasks: [],
    mail: [],
    needsYou: [
      { id: 'plan-1', kind: 'plan', agent: 'probe-alpha', reason: 'plan approval', detail: '4 steps' },
    ],
    readOnly,
  };
}

let shutdowns: number;
let listed: TeamsResponse;
let selectCalls: string[];
let selectOutcome: (name: string) => SelectTeamOutcome;


async function boot(readOnly: boolean, webDist?: string): Promise<{ server: Server; url: string }> {
  state = emptyState(readOnly);
  shutdowns = 0;
  listed = {
    current: TEAM,
    teams: [
      {
        name: TEAM,
        members: 4,
        createdAt: 1787798107581,
        leadSessionId: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283',
        leadAlive: true,
        lastActivityAt: 1787798107581,
        live: true,
        current: true,
      },
    ],
  };
  selectCalls = [];
  selectOutcome = () => ({ ok: true, changed: true });
  hub = createStream(() => state, 50);
  const server = createHttpServer({
    permits,
    hooks: createHookHandlers({ store, permits }),
    stream: hub,
    state: () => state,
    readOnly,
    webDist,
    listTeams: () => Promise.resolve(listed),
    selectTeam: (name: string) => {
      selectCalls.push(name);
      return Promise.resolve(selectOutcome(name));
    },
    onShutdown: () => {
      shutdowns++;
    },
  });
  const port = await listen(server, 0);
  return { server, url: `http://127.0.0.1:${port}` };
}

function shutdown(server: Server): Promise<void> {
  hub.close();
  return new Promise((r) => server.close(() => r()));
}

// Control routes require `content-type: application/json`; a bodyless POST has
// to say so too, which is what the browser client does.
function post(target: string, body: unknown = {}): Promise<Response> {
  return fetch(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'http-'));
  await fs.mkdir(path.join(dir, TEAM, 'inboxes'), { recursive: true });
  await fs.copyFile(path.join(FIXTURES, 'config-4-members.json'), path.join(dir, TEAM, 'config.json'));
  setTeamsRoot(dir);
  store = openStore(path.join(dir, 'events.db'));
  permits = createPermits();
});

afterEach(async () => {
  store.close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('GET /stream', () => {
  it('emits a snapshot event first, then coalesced state events', async () => {
    const { server, url } = await boot(false);
    try {
      const res = await fetch(`${url}/stream`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/event-stream');

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const first = decoder.decode((await reader.read()).value);
      expect(first).toContain('event: snapshot');
      expect(first).toContain('"teamName":"session-98b0b4a7"');

      hub.publish();
      hub.publish();
      const second = decoder.decode((await reader.read()).value);
      expect(second).toContain('event: state');
      expect(second.match(/event: state/g)).toHaveLength(1);

      await reader.cancel();
    } finally {
      await shutdown(server);
    }
  });

  // A throw out of project() must not reach the browser as an open, silent SSE
  // socket. Measured before the fix: subscribe() writes the 200 header first,
  // so the handler's own error path cannot answer any more ("Cannot write
  // headers after they are sent"), the rejection escapes the handler entirely
  // and the client waits on a dead stream until it gives up.
  it('answers a 500 when the snapshot throws, instead of a dead stream', async () => {
    const failing = createStream(() => {
      throw new Error('corrupt log row');
    }, 50);
    const server = createHttpServer({
      permits,
      hooks: createHookHandlers({ store, permits }),
      stream: failing,
      state: () => emptyState(false),
      readOnly: false,
    });
    const port = await listen(server, 0);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/stream`, { signal: AbortSignal.timeout(2000) });
      expect(res.status).toBe(500);
      expect(((await res.json()) as { message: string }).message).toBe('corrupt log row');
    } finally {
      failing.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe('static web bundle', () => {
  async function makeWebDist(): Promise<string> {
    const webDist = await fs.mkdtemp(path.join(os.tmpdir(), 'dist-web-'));
    await fs.writeFile(path.join(webDist, 'index.html'), '<!doctype html><title>console</title>');
    await fs.mkdir(path.join(webDist, 'assets'));
    await fs.writeFile(path.join(webDist, 'assets', 'index.js'), 'console.log(1)');
    return webDist;
  }

  it('serves index.html at GET / and real files under /assets/*', async () => {
    const webDist = await makeWebDist();
    const { server, url } = await boot(false, webDist);
    try {
      const root = await fetch(`${url}/`);
      expect(root.status).toBe(200);
      expect(root.headers.get('content-type')).toContain('text/html');
      expect(await root.text()).toContain('<title>console</title>');

      const asset = await fetch(`${url}/assets/index.js`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toContain('javascript');
      expect(await asset.text()).toBe('console.log(1)');
    } finally {
      await shutdown(server);
      await fs.rm(webDist, { recursive: true, force: true });
    }
  });

  it('falls back to index.html for an unmatched non-API GET, so client-side routes resolve', async () => {
    const webDist = await makeWebDist();
    const { server, url } = await boot(false, webDist);
    try {
      const res = await fetch(`${url}/wall?view=grid&agent=probe-bravo`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<title>console</title>');
    } finally {
      await shutdown(server);
      await fs.rm(webDist, { recursive: true, force: true });
    }
  });

  it('does not shadow /health, /hook or /api/* with the static bundle', async () => {
    const webDist = await makeWebDist();
    const { server, url } = await boot(false, webDist);
    try {
      const health = await fetch(`${url}/health`);
      expect(health.headers.get('content-type')).toContain('application/json');
      expect((await health.json()).ok).toBe(true);

      const apiGet = await fetch(`${url}/api/agents/probe-alpha/message`);
      expect(apiGet.status).toBe(404);
      expect(apiGet.headers.get('content-type')).toContain('application/json');
    } finally {
      await shutdown(server);
      await fs.rm(webDist, { recursive: true, force: true });
    }
  });

  it('404s a missing asset without falling back to index.html', async () => {
    const webDist = await makeWebDist();
    const { server, url } = await boot(false, webDist);
    try {
      const res = await fetch(`${url}/assets/does-not-exist.js`);
      expect(res.status).toBe(404);
    } finally {
      await shutdown(server);
      await fs.rm(webDist, { recursive: true, force: true });
    }
  });

  // C3 survived review because every case here injected `webDist`, so the
  // default — the only value production ever uses — was never exercised.
  it('resolves the default bundle from the module, not the cwd', async () => {
    expect(DEFAULT_WEB_DIST).toBe(fileURLToPath(new URL('../../dist/web', import.meta.url)));

    const assets = path.join(DEFAULT_WEB_DIST, 'assets');
    const probe = path.join(assets, '__default-webdist-probe.js');
    await fs.mkdir(assets, { recursive: true });
    await fs.writeFile(probe, 'export const servedFromTheModule = true;\n');

    // The launcher never cd's, so production runs from the Claude session's cwd.
    const cwd = process.cwd();
    process.chdir(os.tmpdir());
    try {
      const { server, url } = await boot(false);
      try {
        const res = await fetch(`${url}/assets/__default-webdist-probe.js`);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('servedFromTheModule');
      } finally {
        await shutdown(server);
      }
    } finally {
      process.chdir(cwd);
      await fs.rm(probe, { force: true });
    }
  });

  it('returns an explanatory 503 instead of a bare 404 when dist/web is missing', async () => {
    const missing = path.join(dir, 'no-such-dist-web');
    const { server, url } = await boot(false, missing);
    try {
      const res = await fetch(`${url}/`);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual(NO_BUNDLE_BODY);
    } finally {
      await shutdown(server);
    }
  });
});

describe('control routes', () => {
  it('POST /api/agents/:name/message writes the inbox and returns the msgId', async () => {
    const { server, url } = await boot(false);
    try {
      const res = await fetch(`${url}/api/agents/probe-charlie/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'stand down', summary: 'stand down' }),
      });
      expect(res.status).toBe(200);
      const { msgId } = (await res.json()) as { msgId: string };

      const entries = JSON.parse(
        await fs.readFile(path.join(dir, TEAM, 'inboxes', 'probe-charlie.json'), 'utf8'),
      ) as InboxEntry[];
      expect(entries).toHaveLength(1);
      expect(entries[0].msg_id).toBe(msgId);
      expect(entries[0].from).toBe('team-lead');
      expect(entries[0].text).toBe('stand down');
    } finally {
      await shutdown(server);
    }
  });

  it('sends to the lead under a sender that is not the lead itself', async () => {
    const { server, url } = await boot(false);
    try {
      const res = await fetch(`${url}/api/agents/team-lead/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'from the console' }),
      });
      expect(res.status).toBe(200);

      const entries = JSON.parse(
        await fs.readFile(path.join(dir, TEAM, 'inboxes', 'team-lead.json'), 'utf8'),
      ) as InboxEntry[];
      // Stamped 'team-lead' this was a message from the lead to itself, which is
      // what the operator's own message to the lead used to become.
      expect(entries.at(-1)!.from).not.toBe('team-lead');
      expect(entries.at(-1)!.text).toBe('from the console');
    } finally {
      await shutdown(server);
    }
  });

  it('POST /api/plans/:requestId/approve writes a plan_approval_response frame', async () => {
    const { server, url } = await boot(false);
    try {
      const res = await post(`${url}/api/plans/plan-1/approve`);
      expect(res.status).toBe(200);
      const entries = JSON.parse(
        await fs.readFile(path.join(dir, TEAM, 'inboxes', 'probe-alpha.json'), 'utf8'),
      ) as InboxEntry[];
      const frame = JSON.parse(entries[0].text) as Record<string, unknown>;
      expect(frame.type).toBe('plan_approval_response');
      expect(frame.requestId).toBe('plan-1');
      expect(frame.approved).toBe(true);
    } finally {
      await shutdown(server);
    }
  });

  it('POST /api/plans/:requestId/reject carries the feedback', async () => {
    const { server, url } = await boot(false);
    try {
      await fetch(`${url}/api/plans/plan-1/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feedback: 'do not drop migrations/legacy' }),
      });
      const entries = JSON.parse(
        await fs.readFile(path.join(dir, TEAM, 'inboxes', 'probe-alpha.json'), 'utf8'),
      ) as InboxEntry[];
      const frame = JSON.parse(entries[0].text) as Record<string, unknown>;
      expect(frame.approved).toBe(false);
      expect(frame.feedback).toBe('do not drop migrations/legacy');
    } finally {
      await shutdown(server);
    }
  });

  it('404s a plan id that is not on the needs-you strip', async () => {
    const { server, url } = await boot(false);
    try {
      const res = await post(`${url}/api/plans/nope/approve`);
      expect(res.status).toBe(404);
    } finally {
      await shutdown(server);
    }
  });

  it("404s a permission card's id on the plan route, and leaves the permit and inbox untouched", async () => {
    const { server, url } = await boot(false);
    try {
      const held = permits.hold('probe-bravo', 'Bash', {}, 600_000);
      state.needsYou = [
        ...state.needsYou,
        { id: held.id, kind: 'permission', agent: 'probe-bravo', reason: 'permission', detail: 'Bash' },
      ];

      const res = await post(`${url}/api/plans/${held.id}/approve`);
      expect(res.status).toBe(404);
      expect((await res.json()).message).toContain('permission');

      // Still held — /approve must not have resolved it.
      expect(permits.resolve(held.id, 'deny')).toBe(true);
      await expect(fs.stat(path.join(dir, TEAM, 'inboxes', 'probe-bravo.json'))).rejects.toThrow();
    } finally {
      await shutdown(server);
    }
  });

  it('POST /api/permits/:id/allow releases the held hook', async () => {
    const { server, url } = await boot(false);
    try {
      const held = permits.hold('probe-bravo', 'Bash', {}, 600000);
      const res = await post(`${url}/api/permits/${held.id}/allow`);
      expect(res.status).toBe(200);
      expect(await held.promise).toEqual({ decision: 'allow', reason: undefined });

      const missing = await post(`${url}/api/permits/${held.id}/deny`);
      expect(missing.status).toBe(404);
    } finally {
      await shutdown(server);
    }
  });

  it('POST /api/agents/:name/stop writes a shutdown_request frame', async () => {
    const { server, url } = await boot(false);
    try {
      await post(`${url}/api/agents/probe-bravo/stop`);
      const entries = JSON.parse(
        await fs.readFile(path.join(dir, TEAM, 'inboxes', 'probe-bravo.json'), 'utf8'),
      ) as InboxEntry[];
      const frame = JSON.parse(entries[0].text) as Record<string, unknown>;
      expect(frame.type).toBe('shutdown_request');
      expect(frame.reason).toBe('stop');
    } finally {
      await shutdown(server);
    }
  });

  it('POST /api/agents/:name/respawn asks the lead, not the dead teammate', async () => {
    const { server, url } = await boot(false);
    try {
      await post(`${url}/api/agents/probe-charlie/respawn`);
      const entries = JSON.parse(
        await fs.readFile(path.join(dir, TEAM, 'inboxes', 'team-lead.json'), 'utf8'),
      ) as InboxEntry[];
      expect(entries[0].text).toContain('probe-charlie');
      expect(entries[0].summary).toBe('respawn probe-charlie');
    } finally {
      await shutdown(server);
    }
  });
});

describe('POST /api/shutdown', () => {
  it('answers before shutting down, which is the route spec §5.4 names', async () => {
    const { server, url } = await boot(false);
    try {
      const res = await post(`${url}/api/shutdown`);
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 120));
      expect(shutdowns).toBe(1);
    } finally {
      await shutdown(server);
    }
  });
});

describe('the team selector', () => {
  it('lists the teams the console can switch to', async () => {
    const { server, url } = await boot(false);
    try {
      const res = await fetch(`${url}/api/teams`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(listed);
    } finally {
      await shutdown(server);
    }
  });

  it('acks a switch without repeating the state the SSE frame already carries', async () => {
    const { server, url } = await boot(false);
    try {
      const res = await post(`${url}/api/teams/session-b5129c7b/select`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, team: 'session-b5129c7b', changed: true });
      expect(selectCalls).toEqual(['session-b5129c7b']);
    } finally {
      await shutdown(server);
    }
  });

  it('answers 200 changed:false for the team already showing', async () => {
    const { server, url } = await boot(false);
    try {
      selectOutcome = () => ({ ok: true, changed: false });
      const res = await post(`${url}/api/teams/${TEAM}/select`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, team: TEAM, changed: false });
    } finally {
      await shutdown(server);
    }
  });

  it('404s a team that is not there, unusable and absent alike', async () => {
    const { server, url } = await boot(false);
    try {
      selectOutcome = () => ({ ok: false, reason: 'missing', message: 'no team session-nope0001' });
      const res = await post(`${url}/api/teams/session-nope0001/select`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not found', message: 'no team session-nope0001' });
    } finally {
      await shutdown(server);
    }
  });

  it('409s the loser of a race rather than queueing it behind a team it changed its mind about', async () => {
    const { server, url } = await boot(false);
    try {
      selectOutcome = () => ({ ok: false, reason: 'busy', message: 'a switch is already running' });
      const res = await post(`${url}/api/teams/session-b5129c7b/select`);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: 'switch in progress',
        message: 'a switch is already running',
      });
      // A different error field from READ_ONLY_BODY's, so the client can tell a
      // busy console from a disabled one.
      expect(await (await post(`${url}/api/teams/session-b5129c7b/select`)).json()).not.toEqual(
        READ_ONLY_BODY,
      );
    } finally {
      await shutdown(server);
    }
  });

  it('rejects a name that would smuggle a separator past the guard, before calling anything', async () => {
    const { server, url } = await boot(false);
    try {
      for (const hostile of ['%2e%2e%2f', '%zz', 'has%20space']) {
        const res = await post(`${url}/api/teams/${hostile}/select`);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual(BAD_SEGMENT_BODY);
      }
      expect(selectCalls).toEqual([]);
    } finally {
      await shutdown(server);
    }
  });
});

describe('--read-only', () => {
  it('409s every control route with an explanatory body', async () => {
    const { server, url } = await boot(true);
    try {
      const routes: Array<[string, unknown]> = [
        ['/api/agents/probe-alpha/message', { text: 'hi' }],
        ['/api/plans/plan-1/approve', {}],
        ['/api/plans/plan-1/reject', { feedback: 'no' }],
        ['/api/permits/x/allow', {}],
        ['/api/agents/probe-alpha/interrupt', {}],
        ['/api/agents/probe-alpha/stop', {}],
        ['/api/agents/probe-alpha/respawn', {}],
        ['/api/shutdown', {}],
      ];
      for (const [route, body] of routes) {
        const res = await fetch(url + route, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual(READ_ONLY_BODY);
      }
      await expect(fs.stat(path.join(dir, TEAM, 'inboxes', 'probe-alpha.json'))).rejects.toThrow();
      expect(shutdowns).toBe(0);
    } finally {
      await shutdown(server);
    }
  });

  it('still lists and still switches — a switch changes what is watched, not ~/.claude', async () => {
    const { server, url } = await boot(true);
    try {
      const list = await fetch(`${url}/api/teams`);
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual(listed);

      const res = await post(`${url}/api/teams/session-b5129c7b/select`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, team: 'session-b5129c7b', changed: true });
      expect(selectCalls).toEqual(['session-b5129c7b']);
    } finally {
      await shutdown(server);
    }
  });

  it('leaves the observer routes working', async () => {
    const { server, url } = await boot(true);
    try {
      const res = await fetch(`${url}/hook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({});
      expect(store.replay().filter((e) => e.kind === 'hook')).toHaveLength(1);
    } finally {
      await shutdown(server);
    }
  });
});
