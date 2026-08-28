import type { ServerResponse } from 'node:http';
import type { TeamState } from '../shared/domain';
import { logError } from './log';

export const COALESCE_MS = 250;
const HEARTBEAT_MS = 15_000;

export interface StreamHub {
  subscribe(res: ServerResponse): void;
  publish(): void;
  close(): void;
  readonly clients: number;
}

function frame(event: string, state: TeamState): string {
  return `event: ${event}\ndata: ${JSON.stringify(state)}\n\n`;
}

export function createStream(snapshot: () => TeamState, coalesceMs = COALESCE_MS): StreamHub {
  const clients = new Set<ServerResponse>();
  let timer: NodeJS.Timeout | null = null;
  let lastFlush = 0;
  let closed = false;

  // This runs from a bare setTimeout, so a throw inside snapshot() would be an
  // uncaught exception with nothing above it to catch.
  const flush = () => {
    if (clients.size === 0) return;
    try {
      const payload = frame('state', snapshot());
      for (const res of clients) res.write(payload);
    } catch (err) {
      logError('stream flush', err);
    }
  };

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': keepalive\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    subscribe(res) {
      if (closed) {
        res.end();
        return;
      }
      // Build the first frame BEFORE the headers go out. A throw from
      // snapshot() after writeHead leaves the caller's error path unable to
      // answer at all, and the browser holding an open, silent SSE socket.
      const first = frame('snapshot', snapshot());
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write(first);
      clients.add(res);
      res.on('close', () => clients.delete(res));
    },

    publish() {
      if (closed || timer) return;
      const wait = Math.max(0, coalesceMs - (Date.now() - lastFlush));
      timer = setTimeout(() => {
        timer = null;
        lastFlush = Date.now();
        flush();
      }, wait);
      timer.unref?.();
    },

    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      clearInterval(heartbeat);
      for (const res of clients) res.end();
      clients.clear();
    },

    get clients() {
      return clients.size;
    },
  };
}
