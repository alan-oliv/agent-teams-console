import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LAUNCH_SCRIPT } from './lifecycle';
import { atomicWrite } from './control/mailbox';
import { DEFAULT_PERMISSION_TIMEOUT_MS } from './ingest/hooks';
import { readJsonSafe } from './watch/jsonfile';

const run = promisify(execFile);

export const PINNED_CLAUDE_VERSION = '2.1.231';
export const HOOK_TIMEOUT_MS = 5000;
/** The hook's timeout has to be the hold window the handler actually uses. */
export const PERMISSION_HOOK_TIMEOUT_MS = DEFAULT_PERMISSION_TIMEOUT_MS;
export const LAUNCH_HOOK_TIMEOUT_MS = 5000;
/** Where the user's own status lines and env values are stashed while the console owns them. */
export const BACKUP_FILE = 'agent-teams-console.backup.json';

// Agent teams are what this console exists to show, and the task tools are the
// shared task list it renders. Neither can be turned on from a plugin manifest,
// so the setup that installs the hooks turns them on too.
export const AGENT_ENV_VARS = [
  'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
  'CLAUDE_CODE_ENABLE_TODO_TOOLS',
] as const;
type EnvVar = (typeof AGENT_ENV_VARS)[number];

export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'PreCompact',
] as const;

const MATCHER_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PermissionRequest']);
const CONSOLE_HOOK_URL = /^http:\/\/127\.0\.0\.1:\d+\/hook$/;

export interface HttpHook {
  type: 'http';
  url: string;
  timeout: number;
}
export interface CommandHook {
  type: 'command';
  command: string;
  timeout: number;
}
export interface HookEntry {
  matcher?: string;
  hooks: Array<HttpHook | CommandHook>;
}
export interface StatusLineCommand {
  type: 'command';
  command: string;
  refreshInterval?: number;
}
export interface HookBlock {
  hooks: Record<string, HookEntry[]>;
  statusLine: StatusLineCommand;
  subagentStatusLine: StatusLineCommand;
  env: Record<string, string>;
}

function post(port: number, route: string): string {
  return `curl -sS -m 2 -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:${port}/${route} >/dev/null 2>&1; printf ''`;
}

export function hookBlock(port: number): HookBlock {
  const hooks: Record<string, HookEntry[]> = {};
  for (const event of HOOK_EVENTS) {
    const entry: HookEntry = {
      hooks: [
        {
          type: 'http',
          url: `http://127.0.0.1:${port}/hook`,
          // PermissionRequest is deliberately held for the operator; every other
          // event must not be able to stall the agent's turn.
          timeout: event === 'PermissionRequest' ? PERMISSION_HOOK_TIMEOUT_MS : HOOK_TIMEOUT_MS,
        },
      ],
    };
    if (MATCHER_EVENTS.has(event)) entry.matcher = '*';
    hooks[event] = [entry];
  }

  // The launcher runs on EVERY Agent spawn and exits immediately unless a real
  // team exists, so its cost on the common path is one shell process.
  // Never SubagentStart: that runs in the spawned agent's context, where
  // systemMessage is filtered out of the hook result and the link never
  // reaches the operator.
  //
  // Both arms, matching hooks/hooks.json — the plugin install and this manual
  // one must announce at the same moment. PreToolUse is the fast path: it
  // fires BEFORE the teammate spawns, so the operator has the link while the
  // team is still coming up. PostToolUse is the safety net, gated on the
  // member count that only exists once the spawn returned. The launcher's
  // once-per-team marker file makes sure only one of the two announces.
  const launcher: HookEntry = {
    matcher: 'Agent',
    hooks: [
      {
        type: 'command',
        // The launcher defaults OCTO_PORT to 4823, so `setup --port 5000`
        // used to write hooks pointing at 5000 while the launcher started
        // the server on 4823. Carry the port across the language boundary.
        command: `OCTO_PORT=${port} '${LAUNCH_SCRIPT}'`,
        timeout: LAUNCH_HOOK_TIMEOUT_MS,
      },
    ],
  };
  hooks.PreToolUse = [...(hooks.PreToolUse ?? []), launcher];
  hooks.PostToolUse = [...(hooks.PostToolUse ?? []), { ...launcher }];

  return {
    hooks,
    statusLine: { type: 'command', command: post(port, 'statusline'), refreshInterval: 5 },
    subagentStatusLine: { type: 'command', command: post(port, 'substatus') },
    env: Object.fromEntries(AGENT_ENV_VARS.map((name) => [name, '1'])),
  };
}

function isConsoleEntry(entry: unknown): boolean {
  const hooks = (entry as HookEntry | undefined)?.hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some(
    (h) =>
      (h?.type === 'http' && typeof h.url === 'string' && CONSOLE_HOOK_URL.test(h.url)) ||
      (h?.type === 'command' && typeof h.command === 'string' && h.command.includes('console-launch.sh')),
  );
}

function isConsoleStatusLine(value: unknown, route: string): boolean {
  const command = (value as StatusLineCommand | undefined)?.command;
  return typeof command === 'string' && command.includes(`127.0.0.1:`) && command.includes(`/${route}`);
}

export function mergeHookBlock(
  settings: Record<string, unknown>,
  port: number,
): Record<string, unknown> {
  const block = hookBlock(port);
  const existing = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const hooks: Record<string, unknown[]> = {};
  for (const [event, entries] of Object.entries(existing)) {
    hooks[event] = (Array.isArray(entries) ? entries : []).filter((e) => !isConsoleEntry(e));
  }
  for (const event of HOOK_EVENTS) {
    hooks[event] = [...(hooks[event] ?? []), ...block.hooks[event]];
  }
  return {
    ...settings,
    hooks,
    statusLine: block.statusLine,
    subagentStatusLine: block.subagentStatusLine,
    env: { ...((settings.env ?? {}) as Record<string, unknown>), ...block.env },
  };
}

export function removeHookBlock(settings: Record<string, unknown>): Record<string, unknown> {
  const out = { ...settings };
  const existing = settings.hooks as Record<string, unknown[]> | undefined;
  if (existing) {
    const hooks: Record<string, unknown[]> = {};
    for (const [event, entries] of Object.entries(existing)) {
      const kept = (Array.isArray(entries) ? entries : []).filter((e) => !isConsoleEntry(e));
      if (kept.length > 0) hooks[event] = kept;
    }
    if (Object.keys(hooks).length > 0) out.hooks = hooks;
    else delete out.hooks;
  }
  if (isConsoleStatusLine(out.statusLine, 'statusline')) delete out.statusLine;
  if (isConsoleStatusLine(out.subagentStatusLine, 'substatus')) delete out.subagentStatusLine;
  const env = settings.env as Record<string, unknown> | undefined;
  if (env) {
    // Only "1" is ours to drop. An explicit "0" is the user saying *off*, which
    // a bare `uninstall` — with no backup to restore from — must not undo.
    const kept = Object.fromEntries(
      Object.entries(env).filter(([key, value]) => !(AGENT_ENV_VARS.includes(key as EnvVar) && value === '1')),
    );
    if (Object.keys(kept).length > 0) out.env = kept;
    else delete out.env;
  }
  return out;
}

export function checkClaudeVersion(raw: string | null): { ok: boolean; message: string } {
  const version = raw ? /(\d+\.\d+\.\d+)/.exec(raw)?.[1] : undefined;
  if (!version) {
    return {
      ok: false,
      message: `could not read \`claude --version\`; the console is pinned to ${PINNED_CLAUDE_VERSION} internals`,
    };
  }
  if (version === PINNED_CLAUDE_VERSION) {
    return { ok: true, message: `claude ${version} matches the pinned contract` };
  }
  return {
    ok: false,
    message: `claude ${version} does not match the pinned ${PINNED_CLAUDE_VERSION}; the control plane writes internal protocols and may be wrong`,
  };
}

export async function readClaudeVersion(): Promise<string | null> {
  try {
    const { stdout } = await run('claude', ['--version'], { timeout: 5000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

interface SettingsBackup {
  statusLine: unknown;
  subagentStatusLine: unknown;
  /** Absent in backups written before the console owned these vars. */
  env?: Record<string, string | null>;
}

function envBackup(settings: Record<string, unknown>): Record<string, string | null> {
  const env = (settings.env ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    AGENT_ENV_VARS.map((name) => [name, typeof env[name] === 'string' ? (env[name] as string) : null]),
  );
}

export function backupPathFor(settingsPath: string): string {
  return path.join(path.dirname(settingsPath), BACKUP_FILE);
}

export async function runSetup(opts: {
  settingsPath: string;
  port: number;
  confirm: boolean;
  uninstall?: boolean;
}): Promise<string> {
  const block = hookBlock(opts.port);
  const lines: string[] = [];

  if (!opts.uninstall) {
    lines.push(`This block goes into ${opts.settingsPath}:`, '', JSON.stringify(block, null, 2), '');
  } else {
    lines.push(
      `This removes the console's hooks and status lines from ${opts.settingsPath}, and puts`,
      `${AGENT_ENV_VARS.join(' and ')} back the way you had them.`,
      '',
    );
  }

  if (!opts.confirm) {
    lines.push('nothing was written — re-run with --yes to apply.');
    return lines.join('\n');
  }

  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(await fs.readFile(opts.settingsPath, 'utf8')) as Record<string, unknown>;
  } catch {
    current = {};
  }

  const next = opts.uninstall ? removeHookBlock(current) : mergeHookBlock(current, opts.port);
  await fs.mkdir(path.dirname(opts.settingsPath), { recursive: true });

  // The console takes both status lines over while it is installed, and the one
  // it installs ends in `printf ''` — so an unstashed original leaves the user's
  // terminal status line permanently blank with no way back.
  const backupPath = backupPathFor(opts.settingsPath);
  const saved = await readJsonSafe<SettingsBackup>(backupPath);
  if (opts.uninstall) {
    if (saved?.statusLine) next.statusLine = saved.statusLine;
    if (saved?.subagentStatusLine) next.subagentStatusLine = saved.subagentStatusLine;
    if (saved?.env) {
      const env = { ...((next.env ?? {}) as Record<string, string>) };
      for (const [name, value] of Object.entries(saved.env)) {
        if (typeof value === 'string') env[name] = value;
      }
      if (Object.keys(env).length > 0) next.env = env;
      else delete next.env;
    }
    await fs.rm(backupPath, { force: true });
    if (saved?.statusLine || saved?.subagentStatusLine) lines.push('restored your status line.');
    if (saved?.env) lines.push(`put ${AGENT_ENV_VARS.join(' and ')} back the way you had them.`);
  } else {
    // Stash once: a second install would otherwise record the console's own
    // status line as if it were the user's. `env` is stashed on its own because
    // a backup from before the console owned these vars has none, and without
    // it an uninstall would delete an agent-teams setting the user made.
    if (saved === null || saved.env === undefined) {
      const stash: SettingsBackup = saved ?? {
        statusLine: current.statusLine ?? null,
        subagentStatusLine: current.subagentStatusLine ?? null,
      };
      stash.env = envBackup(current);
      await atomicWrite(backupPath, `${JSON.stringify(stash, null, 2)}\n`);
    }
    if (saved === null && current.statusLine) lines.push(`your status line is stashed in ${backupPath}.`);
    lines.push(`${AGENT_ENV_VARS.join(' and ')} are on — restart Claude Code for the task tools to load.`);
  }

  // settings.json is the most important config file on the machine and Claude
  // Code may be reading it; a rename is the only write that cannot tear it.
  await atomicWrite(opts.settingsPath, `${JSON.stringify(next, null, 2)}\n`);
  lines.push(opts.uninstall ? 'removed.' : 'written.');
  return lines.join('\n');
}
