import { promises as fs, watch } from 'node:fs';
import path from 'node:path';

const RETRY_DELAY_MS = 20;
const DEBOUNCE_MS = 15;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
    } catch {
      // These files are atomically rewritten under a lock we deliberately do not
      // take, so a failed read is usually a torn read mid-rewrite, not corruption.
      if (attempt === 0) await delay(RETRY_DELAY_MS);
    }
  }
  return null;
}

export function watchJsonTree(
  root: string,
  onChange: (path: string) => void,
): { close(): void } {
  const timers = new Map<string, NodeJS.Timeout>();
  let closed = false;

  const watcher = watch(root, { recursive: true }, (eventType, filename) => {
    if (eventType !== 'rename' && eventType !== 'change') return;
    if (!filename) return;
    // `.json.lock` ends in `.lock`, so this also excludes proper-lockfile siblings.
    if (!filename.endsWith('.json')) return;

    const full = path.join(root, filename);
    const pending = timers.get(full);
    if (pending) clearTimeout(pending);
    // The truncate(0)+write arm fires twice; debouncing keeps the consumer out of
    // the zero-byte window between them.
    timers.set(
      full,
      setTimeout(() => {
        timers.delete(full);
        if (!closed) onChange(full);
      }, DEBOUNCE_MS),
    );
  });
  watcher.on('error', () => undefined);

  return {
    close() {
      closed = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      watcher.close();
    },
  };
}
