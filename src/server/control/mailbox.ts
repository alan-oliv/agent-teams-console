import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { readJsonSafe } from '../watch/jsonfile';
import type { InboxEntry } from '../../shared/mailbox';
import type { TeamConfig } from '../../shared/roster';

// The pinned sendToInbox signature carries no base directory, so the teams root
// is module state — set once at startup and overridden by tests.
let teamsRoot = path.join(os.homedir(), '.claude', 'teams');

export function setTeamsRoot(root: string): void {
  teamsRoot = root;
}

export function getTeamsRoot(): string {
  return teamsRoot;
}

export async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, filePath);
}

async function colorOf(teamName: string, agent: string): Promise<string | undefined> {
  const config = await readJsonSafe<TeamConfig>(path.join(teamsRoot, teamName, 'config.json'));
  return config?.members.find((m) => m.name === agent)?.color;
}

/**
 * Team and agent names are interpolated straight into a path, and `path.join`
 * resolves `..`. Callers must not be trusted with that: a name of
 * `../../../settings` lands on `~/.claude/settings.json`. The HTTP layer
 * rejects hostile segments before they ever get here; this is the second,
 * independent gate, so no future caller can reintroduce the hole.
 */
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

export async function sendToInbox(
  teamName: string,
  toAgent: string,
  body: { text: string; summary?: string; from?: string },
): Promise<{ msgId: string }> {
  if (!SAFE_NAME.test(teamName) || !SAFE_NAME.test(toAgent)) {
    throw new Error(`refusing to write an inbox for ${JSON.stringify(`${teamName}/${toAgent}`)}`);
  }

  const from = body.from ?? 'team-lead';
  const dir = path.join(teamsRoot, teamName, 'inboxes');
  const file = path.join(dir, `${toAgent}.json`);
  // Belt and braces behind the name check: assert the resolved target is still
  // inside the intended inboxes directory before anything touches the disk.
  if (!path.resolve(file).startsWith(path.resolve(dir) + path.sep)) {
    throw new Error(`refusing to write ${file} outside ${dir}`);
  }

  await fs.mkdir(dir, { recursive: true });
  const color = await colorOf(teamName, from);
  const msgId = randomUUID();

  // The lockfile is keyed off `file` but doesn't require `file` itself to
  // exist (realpath: false skips the fs.realpath that would need it), so the
  // lock can be taken before the inbox is ever created. Everything that
  // touches `file` — including its lazy creation — must happen after this,
  // or two concurrent sends to a brand-new inbox can race to initialize it
  // and the second one clobbers the first's entry with an empty array.
  const release = await lockfile.lock(file, {
    lockfilePath: `${file}.lock`,
    realpath: false,
    retries: { retries: 20, minTimeout: 10, maxTimeout: 200 },
  });
  try {
    const existing = (await readJsonSafe<InboxEntry[]>(file)) ?? [];
    // Key order matches the on-disk shape Claude Code writes; JSON.stringify
    // drops the undefined ones, so absent summary/colour leave no empty keys.
    const entry: InboxEntry = {
      from,
      text: body.text,
      summary: body.summary,
      timestamp: new Date().toISOString(),
      color,
      msgV: 1,
      msg_id: msgId,
      type: 'message',
      read: false,
    };
    await atomicWrite(file, JSON.stringify([...(Array.isArray(existing) ? existing : []), entry], null, 2));
  } finally {
    await release();
  }

  return { msgId };
}
