import { promises as fs } from 'node:fs';
import path from 'node:path';

const PROBE_PREFIX = 'arming-';

/**
 * Wait until the watcher is demonstrably delivering, by writing throwaway files
 * into its root until one comes back. FSEventStreamStart returns before the
 * stream is armed, and a write that lands in that window is never reported at
 * all — so the case under test has to start AFTER the watcher has proven
 * itself, or it is racing the arm rather than testing what it names. Retrying
 * the stimulus is the only fix: waiting longer cannot recover a dropped event,
 * which is why this waits on the watcher's own output and not on a clock.
 *
 * `ext` must be the extension the watcher under test accepts — `.jsonl` for
 * watchAppendOnly, `.json` for watchJsonTree — or the probe is filtered out
 * before delivery and every watcher looks permanently unarmed.
 */
export async function untilArmed(
  root: string,
  delivered: () => string[],
  ext: '.json' | '.jsonl',
): Promise<void> {
  // Inside vitest's 5s testTimeout with room left for the case under test, so
  // an unarmed watcher is reported as exactly that rather than as the caller's
  // assertion timing out with no explanation.
  const deadline = Date.now() + 3000;
  for (let attempt = 0; Date.now() < deadline; attempt++) {
    const probe = path.join(root, `${PROBE_PREFIX}${attempt}${ext}`);
    await fs.writeFile(probe, '{"arming":true}\n');
    // The deadline binds inside the retry too, so the whole wait stays under the
    // 3s above and the caller keeps the budget it was promised.
    for (let i = 0; i < 25 && Date.now() < deadline; i++) {
      if (delivered().includes(probe)) {
        await fs.rm(probe, { force: true });
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    await fs.rm(probe, { force: true });
  }
  throw new Error(`watcher on ${root} never reported a probe file`);
}

/**
 * A test whose assertion is "nothing else was reported" still sees the probes,
 * and the removal of the last one can land after arming returns.
 */
export function isArmingProbe(filePath: string): boolean {
  return path.basename(filePath).startsWith(PROBE_PREFIX);
}
