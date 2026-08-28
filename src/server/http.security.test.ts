import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http, { type Server } from 'node:http';
import { openStore, type Store } from './store';
import { createPermits, type Permits } from './control/permits';
import { createHookHandlers } from './ingest/hooks';
import { createStream, type StreamHub } from './stream';
import {
  createHttpServer,
  listen,
  BAD_SEGMENT_BODY,
  FORBIDDEN_BODY,
  UNSUPPORTED_MEDIA_BODY,
} from './http';
import { sendToInbox, setTeamsRoot } from './control/mailbox';
import type { TeamState } from '../shared/domain';

const TEAM = 'session-98b0b4a7';

let root: string;
let teamsRoot: string;
let store: Store;
let permits: Permits;
let hub: StreamHub;
let state: TeamState;

function emptyState(): TeamState {
  return {
    teamName: TEAM,
    leadSessionId: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283',
    startedAt: 1787798107581,
    totalTokens: 0,
    totalCostUsd: 0,
    agents: [],
    tasks: [],
    mail: [],
    needsYou: [],
    readOnly: false,
  };
}

let selectCalls: string[];

async function boot(): Promise<{ server: Server; url: string }> {
  hub = createStream(() => state, 50);
  selectCalls = [];
  const server = createHttpServer({
    permits,
    hooks: createHookHandlers({ store, permits }),
    stream: hub,
    state: () => state,
    readOnly: false,
    selectTeam: (name: string) => {
      selectCalls.push(name);
      return Promise.resolve({ ok: true as const, changed: true });
    },
  });
  const port = await listen(server, 0);
  return { server, url: `http://127.0.0.1:${port}` };
}

function shutdown(server: Server): Promise<void> {
  hub.close();
  return new Promise((r) => server.close(() => r()));
}

// undici refuses to set the forbidden `Host` header, so the DNS-rebinding
// shape has to be sent with the raw client.
function rawGet(target: string, host: string): Promise<number> {
  const u = new URL(target);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: u.hostname, port: u.port, path: u.pathname, method: 'GET', headers: { host } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function tree(dir: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const at = stack.pop()!;
    for (const e of await fs.readdir(at, { withFileTypes: true })) {
      const full = path.join(at, e.name);
      if (e.isDirectory()) stack.push(full);
      else out.push(path.relative(dir, full));
    }
  }
  return out.sort();
}

beforeEach(async () => {
  // `root` stands in for the user's ~/.claude: the teams tree lives inside it,
  // and the traversal target (settings.json) is its sibling one level up.
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hostile-'));
  teamsRoot = path.join(root, 'teams');
  await fs.mkdir(path.join(teamsRoot, TEAM, 'inboxes'), { recursive: true });
  await fs.writeFile(path.join(root, 'settings.json'), '{"hooks":{"mine":true}}\n');
  setTeamsRoot(teamsRoot);
  store = openStore(path.join(root, 'events.db'));
  permits = createPermits();
  state = emptyState();
});

afterEach(async () => {
  store.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe('hostile agent names on the control routes', () => {
  // Each case is a name that used to reach `path.join(dir, name + '.json')`
  // unchecked. `..%2F..%2F..%2Fsettings` landed on ~/.claude/settings.json.
  const CASES: Array<[label: string, segment: string]> = [
    ['percent-encoded traversal', '..%2F..%2F..%2Fsettings'],
    ['double-encoded traversal', '..%252F..%252F..%252Fsettings'],
    ['absolute path', '%2Fetc%2Fpasswd'],
    ['backslash traversal', '..%5C..%5C..%5Csettings'],
    ['null byte', 'probe-alpha%00'],
    ['unicode name', 'probe%E2%80%A6alpha'],
    ['empty name', '%20'],
  ];

  for (const [label, segment] of CASES) {
    it(`rejects a ${label} without writing anything`, async () => {
      const before = await tree(root);
      const { server, url } = await boot();
      try {
        const res = await fetch(`${url}/api/agents/${segment}/message`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'pwned by a web page' }),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual(BAD_SEGMENT_BODY);
      } finally {
        await shutdown(server);
      }
      expect(await tree(root)).toEqual(before);
      expect(await fs.readFile(path.join(root, 'settings.json'), 'utf8')).toBe(
        '{"hooks":{"mine":true}}\n',
      );
    });
  }

  it('404s a bare dot-dot segment, which URL parsing normalises away before routing', async () => {
    // `%2F` survives URL normalisation and is why the `..%2F` cases above are
    // the dangerous shape; `..` and `%2E%2E` collapse into the path instead.
    const before = await tree(root);
    const { server, url } = await boot();
    try {
      for (const segment of ['..', '%2E%2E']) {
        const res = await fetch(`${url}/api/agents/${segment}/message`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'pwned by a web page' }),
        });
        expect(res.status).toBe(404);
      }
    } finally {
      await shutdown(server);
    }
    expect(await tree(root)).toEqual(before);
  });

  it('rejects a hostile name on interrupt, stop and respawn too', async () => {
    const before = await tree(root);
    const { server, url } = await boot();
    try {
      for (const action of ['interrupt', 'stop', 'respawn']) {
        const res = await fetch(`${url}/api/agents/..%2F..%2F..%2Fsettings/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        expect(res.status).toBe(400);
      }
    } finally {
      await shutdown(server);
    }
    expect(await tree(root)).toEqual(before);
  });

  it('rejects a hostile permit id', async () => {
    const { server, url } = await boot();
    try {
      const res = await fetch(`${url}/api/permits/..%2F..%2Fsettings/allow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(400);
    } finally {
      await shutdown(server);
    }
  });

  it('rejects a plan card whose agent came in hostile from the /hook payload', async () => {
    // The second reachable path: /hook is unauthenticated, so a hostile payload
    // can plant a needs-you card whose `agent` is a traversal string, and the
    // operator's own approve click fires the write.
    state.needsYou = [
      { id: 'plan-1', kind: 'plan', agent: '../../../settings', reason: 'plan', detail: '1 step' },
    ];
    const before = await tree(root);
    const { server, url } = await boot();
    try {
      const res = await fetch(`${url}/api/plans/plan-1/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(BAD_SEGMENT_BODY);
    } finally {
      await shutdown(server);
    }
    expect(await tree(root)).toEqual(before);
  });

  it('still accepts a well-formed name', async () => {
    const { server, url } = await boot();
    try {
      const res = await fetch(`${url}/api/agents/probe-alpha/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      });
      expect(res.status).toBe(200);
    } finally {
      await shutdown(server);
    }
    expect(await tree(root)).toContain(path.join('teams', TEAM, 'inboxes', 'probe-alpha.json'));
  });
});

describe('sendToInbox refuses hostile names on its own', () => {
  // The HTTP layer rejects these first; this proves the writer does not depend
  // on that, so a future caller cannot reintroduce the hole.
  for (const name of ['../../../settings', '..', '/etc/passwd', 'probe\0alpha', 'a/b']) {
    it(`throws for ${JSON.stringify(name)}`, async () => {
      const before = await tree(root);
      await expect(sendToInbox(TEAM, name, { text: 'x' })).rejects.toThrow(/refusing to write/);
      expect(await tree(root)).toEqual(before);
    });
  }

  it('throws for a hostile team name', async () => {
    const before = await tree(root);
    await expect(sendToInbox('../..', 'probe-alpha', { text: 'x' })).rejects.toThrow(
      /refusing to write/,
    );
    expect(await tree(root)).toEqual(before);
  });
});

describe('cross-origin and cross-host requests', () => {
  it('rejects a POST from a foreign origin', async () => {
    const before = await tree(root);
    const { server, url } = await boot();
    try {
      const res = await fetch(`${url}/api/agents/probe-alpha/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ text: 'pwned by a web page' }),
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(FORBIDDEN_BODY);
    } finally {
      await shutdown(server);
    }
    expect(await tree(root)).toEqual(before);
  });

  it('rejects the preflight-free text/plain POST the exploit used', async () => {
    const before = await tree(root);
    const { server, url } = await boot();
    try {
      const res = await fetch(`${url}/api/agents/probe-alpha/message`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
        body: JSON.stringify({ text: 'pwned by a web page' }),
      });
      expect(res.status).toBe(403);
    } finally {
      await shutdown(server);
    }
    expect(await tree(root)).toEqual(before);
  });

  it('fronts the team switch with the same gate, the one control route read-only allows', async () => {
    const { server, url } = await boot();
    try {
      const foreign = await fetch(`${url}/api/teams/session-b5129c7b/select`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: '{}',
      });
      expect(foreign.status).toBe(403);
      expect(await foreign.json()).toEqual(FORBIDDEN_BODY);

      const simple = await fetch(`${url}/api/teams/session-b5129c7b/select`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: '{}',
      });
      expect(simple.status).toBe(415);
      expect(selectCalls).toEqual([]);
    } finally {
      await shutdown(server);
    }
  });

  it('rejects a same-origin-looking POST that is not JSON', async () => {
    const { server, url } = await boot();
    try {
      const res = await fetch(`${url}/api/agents/probe-alpha/message`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ text: 'hi' }),
      });
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual(UNSUPPORTED_MEDIA_BODY);
    } finally {
      await shutdown(server);
    }
  });

  it('rejects an unauthenticated /hook POST from a foreign origin', async () => {
    const { server, url } = await boot();
    try {
      const res = await fetch(`${url}/hook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 'whatever' }),
      });
      expect(res.status).toBe(403);
      expect(store.replay()).toHaveLength(0);
    } finally {
      await shutdown(server);
    }
  });

  it('rejects any request carrying a foreign Host, the DNS-rebinding shape', async () => {
    const { server, url } = await boot();
    try {
      expect(await rawGet(`${url}/health`, 'evil.example')).toBe(403);
      expect(await rawGet(`${url}/health`, '127.0.0.1')).toBe(200);
    } finally {
      await shutdown(server);
    }
  });

  it('accepts the dev-proxy origin, which is localhost on another port', async () => {
    const { server, url } = await boot();
    try {
      const res = await fetch(`${url}/api/agents/probe-alpha/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
        body: JSON.stringify({ text: 'hi' }),
      });
      expect(res.status).toBe(200);
    } finally {
      await shutdown(server);
    }
  });
});
