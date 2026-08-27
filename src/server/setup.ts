import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LAUNCH_SCRIPT } from './lifecycle';

const run = promisify(execFile);

export const PINNED_CLAUDE_VERSION = '2.1.231';
export const HOOK_TIMEOUT_MS = 5000;
export const PERMISSION_HOOK_TIMEOUT_MS = 600_000;
export const LAUNCH_HOOK_TIMEOUT_MS = 5000;

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
  // It must be PostToolUse, not SubagentStart: SubagentStart runs in the
  // spawned agent's context, where systemMessage is filtered out of the hook
  // result and the link never reaches the operator. PostToolUse also fires
  // AFTER the spawn returns, so config.json already lists the new member.
  hooks.PostToolUse = [
    ...(hooks.PostToolUse ?? []),
    {
      matcher: 'Agent',
      hooks: [{ type: 'command', command: LAUNCH_SCRIPT, timeout: LAUNCH_HOOK_TIMEOUT_MS }],
    },
  ];

  return {
    hooks,
    statusLine: { type: 'command', command: post(port, 'statusline'), refreshInterval: 5 },
    subagentStatusLine: { type: 'command', command: post(port, 'substatus') },
  };
}

function isConsoleEntry(entry: unknown): boolean {
  const hooks = (entry as HookEntry | undefined)?.hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some(
    (h) =>
      (h?.type === 'http' && typeof h.url === 'string' && CONSOLE_HOOK_URL.test(h.url)) ||
      (h?.type === 'command' && typeof h.command === 'string' && h.command.endsWith('console-launch.sh')),
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
    lines.push(`This removes the console's hooks and status lines from ${opts.settingsPath}.`, '');
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
  await fs.writeFile(opts.settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  lines.push(opts.uninstall ? 'removed.' : 'written.');
  return lines.join('\n');
}
