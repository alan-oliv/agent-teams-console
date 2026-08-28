import { watch } from 'node:fs';
import { debug, logError, logInfo } from '../log';

/**
 * `fs.watch()` throws SYNCHRONOUSLY with ENOENT when the root does not exist,
 * so `watcher.on('error', …)` — which only sees asynchronous errors — cannot
 * catch it and the throw escapes to the top level and kills the process at
 * boot. That happens on any machine where one of the four watched roots was
 * never created: a user who has never used tasks or agent teams has no
 * `~/.claude/tasks` and no `~/.claude/sessions`.
 *
 * A missing or vanished root degrades to "sweep only" instead: the 5s
 * reconciliation pass walks the tree anyway and picks it up if it appears.
 *
 * Both watchers share this because both used to carry the same bug.
 */
export function watchRoot(
  root: string,
  onEvent: (filename: string) => void,
): { close(): void } {
  let watcher;
  try {
    watcher = watch(root, { recursive: true }, (eventType, filename) => {
      // macOS reports 'rename' for the first write to a new file; a watcher
      // that only handles 'change' never sees a new file appear at all.
      if (eventType !== 'rename' && eventType !== 'change') return;
      if (!filename) return;
      onEvent(filename.toString());
    });
  } catch (err) {
    // A root that has never been created is the normal case on a fresh
    // install, not a fault — say so plainly and carry on.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      logInfo(`no ${root} yet — the reconciliation sweep will pick it up if it appears`);
    } else {
      logError(`cannot watch ${root} — falling back to the reconciliation sweep`, err);
    }
    return { close() {} };
  }
  debug('watchRoot', `watching ${root}`);
  watcher.on('error', (err) => logError(`watcher for ${root} failed`, err));
  return {
    close() {
      watcher.close();
    },
  };
}
