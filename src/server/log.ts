const DEBUG_ON = process.env.OCTO_DEBUG === '1' || process.env.OCTO_DEBUG === 'true';

function describe(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;
  return String(err);
}

/**
 * The console is started detached by `bin/console-launch.sh` with its output
 * appended to a log the operator has no reason to open, so a swallowed error is
 * an undiagnosable one. Every `catch` that deliberately keeps serving logs here
 * first; nothing in this module ever throws.
 */
export function logError(scope: string, err: unknown): void {
  try {
    console.error(`[octo] ${scope}: ${describe(err)}`);
  } catch {
    /* a broken stderr must not take the server down */
  }
}

/** Chatter that is only useful when diagnosing; gated on OCTO_DEBUG=1. */
export function debug(scope: string, message: string): void {
  if (!DEBUG_ON) return;
  try {
    console.error(`[octo:debug] ${scope}: ${message}`);
  } catch {
    /* see logError */
  }
}
