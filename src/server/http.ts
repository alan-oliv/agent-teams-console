import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Permits } from './control/permits';
import type { HookHandlers } from './ingest/hooks';
import type { StreamHub } from './stream';
import { sendToInbox } from './control/mailbox';
import type { TeamState } from '../shared/domain';

export const READ_ONLY_BODY = {
  error: 'read-only',
  message: 'the console was started with --read-only; control routes are disabled',
};

export interface HttpDeps {
  permits: Permits;
  hooks: HookHandlers;
  stream: StreamHub;
  state: () => TeamState;
  readOnly: boolean;
  leadName?: string;
}

const AGENT_ROUTE = /^\/api\/agents\/([^/]+)\/(message|interrupt|stop|respawn)$/;
const PLAN_ROUTE = /^\/api\/plans\/([^/]+)\/(approve|reject)$/;
const PERMIT_ROUTE = /^\/api\/permits\/([^/]+)\/(allow|deny)$/;

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
  const team = () => deps.state().teamName;

  return http.createServer((req, res) => {
    void (async () => {
      try {
        const method = req.method ?? 'GET';
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const route = url.pathname;

        if (method === 'GET' && route === '/stream') {
          deps.stream.subscribe(res);
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
          const name = decodeURIComponent(agentMatch[1]);
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
          const requestId = decodeURIComponent(planMatch[1]);
          const approved = planMatch[2] === 'approve';
          const card = deps.state().needsYou.find((n) => n.id === requestId);
          if (!card) {
            json(res, 404, { error: 'not found', message: `no pending plan ${requestId}` });
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
          const id = decodeURIComponent(permitMatch[1]);
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
