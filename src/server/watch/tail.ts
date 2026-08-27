import { promises as fs, watch } from 'node:fs';
import path from 'node:path';

export interface TailState {
  inode: number;
  offset: number;
  partial: string;
}

export function emptyTailState(): TailState {
  return { inode: 0, offset: 0, partial: '' };
}

export async function drain(
  filePath: string,
  state: TailState,
): Promise<{ lines: string[]; state: TailState }> {
  let st;
  try {
    st = await fs.stat(filePath);
  } catch {
    return { lines: [], state };
  }

  // Inode change means the file was replaced; size below our offset means it was
  // truncated. Both invalidate the offset, so start over from byte 0.
  let next: TailState = state;
  if (st.ino !== state.inode || st.size < state.offset) {
    next = { inode: st.ino, offset: 0, partial: '' };
  }

  const length = st.size - next.offset;
  if (length <= 0) return { lines: [], state: next };

  const buf = Buffer.alloc(length);
  let read = 0;
  const fh = await fs.open(filePath, 'r');
  try {
    while (read < length) {
      const r = await fh.read(buf, read, length - read, next.offset + read);
      if (r.bytesRead === 0) break;
      read += r.bytesRead;
    }
  } finally {
    await fh.close();
  }

  const chunk = next.partial + buf.subarray(0, read).toString('utf8');
  const cut = chunk.lastIndexOf('\n');
  const offset = next.offset + read;

  if (cut === -1) {
    return { lines: [], state: { inode: next.inode, offset, partial: chunk } };
  }

  const lines = chunk
    .slice(0, cut)
    .split('\n')
    .filter((l) => l.length > 0);

  return { lines, state: { inode: next.inode, offset, partial: chunk.slice(cut + 1) } };
}

export function watchAppendOnly(
  root: string,
  onLines: (path: string, lines: string[]) => void,
): { close(): void } {
  const states = new Map<string, TailState>();
  const queues = new Map<string, Promise<void>>();
  let closed = false;

  const pump = (file: string) => {
    const prev = queues.get(file) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        if (closed) return;
        const out = await drain(file, states.get(file) ?? emptyTailState());
        states.set(file, out.state);
        if (out.lines.length > 0) onLines(file, out.lines);
      })
      .catch(() => undefined);
    queues.set(file, next);
  };

  const watcher = watch(root, { recursive: true }, (eventType, filename) => {
    // macOS reports 'rename' for the first write to a new file; a watcher that
    // only handles 'change' never sees a teammate transcript appear.
    if (eventType !== 'rename' && eventType !== 'change') return;
    if (!filename) return;
    if (!filename.endsWith('.jsonl')) return;
    pump(path.join(root, filename));
  });
  watcher.on('error', () => undefined);

  return {
    close() {
      closed = true;
      watcher.close();
    },
  };
}
