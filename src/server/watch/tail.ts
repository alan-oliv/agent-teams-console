import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logError } from '../log';
import { watchRoot } from './root';

export interface TailState {
  inode: number;
  offset: number;
  partial: string;
}

export function emptyTailState(): TailState {
  return { inode: 0, offset: 0, partial: '' };
}

/**
 * `fromStart` says the lines returned begin at the file's first byte — a first
 * read, an inode change or a truncation. The ingest marks that batch so the
 * fold can clear what it already holds for the agent instead of colliding with
 * it: the uuid dedupe keeps the FIRST copy of a record, so a re-read landing
 * behind an already-trimmed prefix would otherwise leave the projection stuck
 * at whatever the log still happened to hold.
 *
 * `mtimeMs` is the file's own clock, carried out for the staleness rule: a log
 * being appended live has an mtime that tracks the timestamps inside it, while
 * a replayed or fixture log is written now and describes days ago. Absent only
 * when the stat failed — 0 is a real epoch and would read as 1970.
 */
export async function drain(
  filePath: string,
  state: TailState,
): Promise<{ lines: string[]; state: TailState; fromStart: boolean; mtimeMs?: number }> {
  let st;
  try {
    st = await fs.stat(filePath);
  } catch {
    return { lines: [], state, fromStart: false };
  }

  // Inode change means the file was replaced; size below our offset means it was
  // truncated. Both invalidate the offset, so start over from byte 0.
  let next: TailState = state;
  if (st.ino !== state.inode || st.size < state.offset) {
    next = { inode: st.ino, offset: 0, partial: '' };
  }

  const fromStart = next.offset === 0;
  const mtimeMs = st.mtimeMs;
  const length = st.size - next.offset;
  if (length <= 0) return { lines: [], state: next, fromStart: false, mtimeMs };

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
    return { lines: [], state: { inode: next.inode, offset, partial: chunk }, fromStart, mtimeMs };
  }

  const lines = chunk
    .slice(0, cut)
    .split('\n')
    .filter((l) => l.length > 0);

  return {
    lines,
    state: { inode: next.inode, offset, partial: chunk.slice(cut + 1) },
    fromStart,
    mtimeMs,
  };
}

export interface AppendOnlyWatcher {
  /**
   * Read whatever `file` has gained since the last read, and resolve once those
   * lines have been delivered. Every reader — the watcher, the tail poll, a
   * hook — goes through here, so one TailState and one serialisation point per
   * file cover all of them and no two readers can emit the same bytes twice.
   */
  pump(file: string): Promise<void>;
  close(): void;
}

export function watchAppendOnly(
  root: string,
  onLines: (path: string, lines: string[], fromStart: boolean, mtimeMs?: number) => void,
): AppendOnlyWatcher {
  const states = new Map<string, TailState>();
  const queues = new Map<string, Promise<void>>();
  const queued = new Set<string>();
  let closed = false;

  const pump = (file: string): Promise<void> => {
    // A drain already waiting behind the running one will stat AFTER this call,
    // so it sees every byte this call cares about and a third is pure duplicate
    // work. `queued` is cleared at the top of that drain, before its stat, so a
    // call arriving mid-drain still enqueues a fresh one.
    const tail = queues.get(file);
    if (tail && queued.has(file)) return tail;
    if (tail) queued.add(file);

    const next = (tail ?? Promise.resolve())
      .then(async () => {
        queued.delete(file);
        if (closed) return;
        const out = await drain(file, states.get(file) ?? emptyTailState());
        states.set(file, out.state);
        if (out.lines.length > 0) onLines(file, out.lines, out.fromStart, out.mtimeMs);
      })
      .catch((err: unknown) => logError(`tail ${file}`, err));
    queues.set(file, next);
    return next;
  };

  const watcher = watchRoot(root, (filename) => {
    if (!filename.endsWith('.jsonl')) return;
    void pump(path.join(root, filename));
  });

  return {
    pump,
    close() {
      closed = true;
      watcher.close();
    },
  };
}
