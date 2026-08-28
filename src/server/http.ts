import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Permits } from './control/permits';
import type { HookHandlers } from './ingest/hooks';
import type { StreamHub } from './stream';
import { sendToInbox } from './control/mailbox';
import type { TeamState } from '../shared/domain';

export const READ_ONLY_BODY = {
  error: 'read-only',
  message: 'the console was started with --read-only; control routes are disabled',
};

export const NO_BUNDLE_BODY = {
  error: 'no build',
  message: 'dist/web is missing — run `npm run build` first',
};

export const FORBIDDEN_BODY = {
  error: 'forbidden',
  message: 'the console only answers same-origin requests from this machine',
};

export const UNSUPPORTED_MEDIA_BODY = {
  error: 'unsupported media type',
  message: 'content-type: application/json is required',
};

export const BAD_SEGMENT_BODY = {
  error: 'bad request',
  message: 'name must match /^[A-Za-z0-9_-]+$/',
};

/**
 * Where the built bundle lives, resolved from THIS MODULE rather than from
 * `process.cwd()`. The launcher starts the server with `nohup node
 * "$ROOT/dist/server/index.js"` and never cd's, so the server inherits the
 * Claude session's cwd — the user's project, not this repo — and a cwd-relative
 * default served `503 {"error":"no build"}` at the announced URL for everyone
 * whose project is not this one.
 *
 * `../../dist/web` is correct from both `src/server/` and the bundled
 * `dist/server/`, the same trick LAUNCH_SCRIPT already uses.
 */
export const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../dist/web', import.meta.url));

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function contentTypeFor(file: string): string {
  return MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

// `/assets/*` maps to a real file; every other non-API GET (including `/`) is
// the SPA shell, since the client router owns the rest of the path space.
async function serveWebBundle(res: ServerResponse, webDist: string, route: string): Promise<void> {
  const isAsset = route.startsWith('/assets/');
  const target = path.join(webDist, isAsset ? route : 'index.html');
  if (!target.startsWith(path.join(webDist, path.sep))) {
    json(res, 404, { error: 'not found', message: `no route for GET ${route}` });
    return;
  }
  try {
    const data = await fs.readFile(target);
    res.writeHead(200, {
      'content-type': contentTypeFor(target),
      'content-length': data.length,
    });
    res.end(data);
  } catch {
    if (isAsset) {
      json(res, 404, { error: 'not found', message: `no route for GET ${route}` });
    } else {
      json(res, 503, NO_BUNDLE_BODY);
    }
  }
}

export interface HttpDeps {
  permits: Permits;
  hooks: HookHandlers;
  stream: StreamHub;
  state: () => TeamState;
  readOnly: boolean;
  leadName?: string;
  /** Directory holding the built web bundle (default: {@link DEFAULT_WEB_DIST}). */
  webDist?: string;
}

const AGENT_ROUTE = /^\/api\/agents\/([^/]+)\/(message|interrupt|stop|respawn)$/;
const PLAN_ROUTE = /^\/api\/plans\/([^/]+)\/(approve|reject)$/;
const PERMIT_ROUTE = /^\/api\/permits\/([^/]+)\/(allow|deny)$/;

/**
 * The route patterns exclude a literal `/`, but every id below is
 * percent-decoded afterwards, so `%2F` would smuggle a separator back in past
 * the guard and `path.join` would resolve the `..` it precedes. Decoding is
 * therefore always paired with this allowlist, and the result is what reaches
 * the filesystem — never the raw segment.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

function decodeSegment(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null; // a malformed escape such as `%zz`
  }
  return SAFE_SEGMENT.test(decoded) ? decoded : null;
}

// The server binds 127.0.0.1, but that does not protect it from a browser the
// user is also running: a page on any origin can POST to it, and a DNS name
// resolving to 127.0.0.1 can reach it with a foreign Host header.
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    return LOCAL_HOSTS.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

function isLocalOrigin(origin: string | undefined): boolean {
  // No Origin at all means no browser initiated it — the hook curl and the
  // launcher's health probe are in that class.
  if (origin === undefined) return true;
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false; // includes the literal `null` origin of a sandboxed frame
  }
}

// `content-type: text/plain` is a CORS *simple* request, so it crosses origins
// with no preflight; requiring JSON forces a preflight this server never
// answers, which closes the whole CSRF class.
function isJsonBody(contentType: string | undefined): boolean {
  return (contentType ?? '').split(';')[0].trim().toLowerCase() === 'application/json';
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function createHttpServer(deps: HttpDeps): Server {
  const leadName = deps.leadName ?? 'team-lead';
  const webDist = deps.webDist ?? DEFAULT_WEB_DIST;
  const team = () => deps.state().teamName;

  return http.createServer((req, res) => {
    void (async () => {
      try {
        const method = req.method ?? 'GET';
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const route = url.pathname;

        if (!isLocalHost(req.headers.host)) {
          json(res, 403, FORBIDDEN_BODY);
          return;
        }
        if (method === 'POST') {
          if (!isLocalOrigin(req.headers.origin)) {
            json(res, 403, FORBIDDEN_BODY);
            return;
          }
          if (!isJsonBody(req.headers['content-type'])) {
            json(res, 415, UNSUPPORTED_MEDIA_BODY);
            return;
          }
        }

        if (method === 'GET' && route === '/stream') {
          deps.stream.subscribe(res);
          return;
        }

        if (method === 'GET' && route === '/health') {
          const s = deps.state();
          json(res, 200, { ok: true, team: s.teamName, agents: s.agents.length });
          return;
        }

        if (method === 'POST' && (route === '/hook' || route === '/statusline' || route === '/substatus')) {
          const body = await readBody(req);
          const out =
            route === '/hook'
              ? await deps.hooks.hook(body)
              : route === '/statusline'
                ? await deps.hooks.statusline(body)
                : await deps.hooks.substatus(body);
          deps.stream.publish();
          json(res, out.status, out.body);
          return;
        }

        // Every other non-API GET is the built web bundle — `/` and any
        // client-side route the SPA owns (e.g. a deep-linked `?view=...`).
        if (method === 'GET' && !route.startsWith('/api/')) {
          await serveWebBundle(res, webDist, route);
          return;
        }

        if (method !== 'POST' || !route.startsWith('/api/')) {
          json(res, 404, { error: 'not found', message: `no route for ${method} ${route}` });
          return;
        }

        // Every /api/ route is a control write, so the read-only gate is one check.
        if (deps.readOnly) {
          json(res, 409, READ_ONLY_BODY);
          return;
        }

        const body = await readBody(req);
        const timestamp = new Date().toISOString();

        const agentMatch = AGENT_ROUTE.exec(route);
        if (agentMatch) {
          const name = decodeSegment(agentMatch[1]);
          if (name === null) {
            json(res, 400, BAD_SEGMENT_BODY);
            return;
          }
          const action = agentMatch[2];
          if (action === 'message') {
            const text = str(body.text);
            if (!text) {
              json(res, 400, { error: 'bad request', message: 'text is required' });
              return;
            }
            const out = await sendToInbox(team(), name, { text, summary: str(body.summary), from: leadName });
            deps.stream.publish();
            json(res, 200, out);
            return;
          }
          if (action === 'respawn') {
            // There is no external respawn path; the lead has to do it, and the
            // card says so rather than pretending this is direct.
            const out = await sendToInbox(team(), leadName, {
              text: `Teammate ${name} needs respawning. Re-spawn it with the same role and prompt.`,
              summary: `respawn ${name}`,
              from: leadName,
            });
            deps.stream.publish();
            json(res, 200, out);
            return;
          }
          const out = await sendToInbox(team(), name, {
            text: JSON.stringify({ type: 'shutdown_request', reason: action, from: leadName, timestamp }),
            summary: `${action} ${name}`,
            from: leadName,
          });
          deps.stream.publish();
          json(res, 200, out);
          return;
        }

        const planMatch = PLAN_ROUTE.exec(route);
        if (planMatch) {
          const requestId = decodeSegment(planMatch[1]);
          if (requestId === null) {
            json(res, 400, BAD_SEGMENT_BODY);
            return;
          }
          const approved = planMatch[2] === 'approve';
          const card = deps.state().needsYou.find((n) => n.id === requestId);
          if (!card) {
            json(res, 404, { error: 'not found', message: `no pending plan ${requestId}` });
            return;
          }
          // The card's agent came from an unauthenticated /hook payload, so it
          // is caller input too — a hostile one would otherwise reach the inbox
          // writer on the operator's own approve click.
          if (!SAFE_SEGMENT.test(card.agent)) {
            json(res, 400, BAD_SEGMENT_BODY);
            return;
          }
          const out = await sendToInbox(team(), card.agent, {
            text: JSON.stringify({
              type: 'plan_approval_response',
              requestId,
              approved,
              feedback: str(body.feedback),
              timestamp,
            }),
            summary: `plan ${approved ? 'approved' : 'rejected'}`,
            from: leadName,
          });
          deps.stream.publish();
          json(res, 200, out);
          return;
        }

        const permitMatch = PERMIT_ROUTE.exec(route);
        if (permitMatch) {
          const id = decodeSegment(permitMatch[1]);
          if (id === null) {
            json(res, 400, BAD_SEGMENT_BODY);
            return;
          }
          const decision = permitMatch[2] === 'allow' ? 'allow' : 'deny';
          const ok = deps.permits.resolve(id, decision, str(body.reason));
          if (!ok) {
            json(res, 404, { error: 'not found', message: `no held permit ${id}` });
            return;
          }
          deps.stream.publish();
          json(res, 200, {});
          return;
        }

        json(res, 404, { error: 'not found', message: `no route for ${method} ${route}` });
      } catch (err) {
        json(res, 500, { error: 'server error', message: (err as Error).message });
      }
    })();
  });
}

export function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}
