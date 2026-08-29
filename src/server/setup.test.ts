import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import catalog from '../shared/catalog.json';
import {
  AGENT_ENV_VARS,
  backupPathFor,
  HOOK_EVENTS,
  HOOK_TIMEOUT_SECONDS,
  PERMISSION_HOOK_TIMEOUT_SECONDS,
  PINNED_CLAUDE_VERSION,
  checkClaudeVersion,
  hookBlock,
  mergeHookBlock,
  removeHookBlock,
  runSetup,
  type CommandHook,
} from './setup';

interface ObserveHook { type: string; command: string; timeout: number }
interface HookEntry { matcher?: string; hooks: ObserveHook[] }

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('hookBlock', () => {
  const block = hookBlock(4823);

  it('round-trips as valid JSON', () => {
    expect(JSON.parse(JSON.stringify(block))).toEqual(block);
  });

  it('registers every event as a command hook posting to the right port', () => {
    expect(Object.keys(block.hooks)).toEqual([...HOOK_EVENTS]);
    for (const event of HOOK_EVENTS) {
      const entries = block.hooks[event] as HookEntry[];
      // Both Agent arms carry one extra entry: the command-hook launcher.
      const carriesLauncher = event === 'PreToolUse' || event === 'PostToolUse';
      expect(entries).toHaveLength(carriesLauncher ? 2 : 1);
      expect(entries.filter((e) => e.matcher === 'Agent')).toHaveLength(carriesLauncher ? 1 : 0);
      expect(entries[0].hooks).toHaveLength(1);
      // A command hook, not an http one: Claude Code renders an http hook's
      // connection refusal as a "<event> hook error" on EVERY tool call while
      // the console is down. This posts through curl and exits 0 instead.
      expect(entries[0].hooks[0].type).toBe('command');
      expect(entries[0].hooks[0].command).toContain('http://127.0.0.1:4823/hook');
      expect(entries[0].hooks[0].command).toContain('exit 0');
    }
  });

  it('sets an explicit timeout on every entry, long only for the deliberate hold', () => {
    for (const event of HOOK_EVENTS) {
      const hook = (block.hooks[event] as HookEntry[])[0].hooks[0];
      expect(typeof hook.timeout).toBe('number');
      expect(hook.timeout).toBe(
        event === 'PermissionRequest' ? PERMISSION_HOOK_TIMEOUT_SECONDS : HOOK_TIMEOUT_SECONDS,
      );
    }
    // Seconds, not milliseconds: the harness would otherwise let a hung console
    // hold a turn for 83 minutes, and a permission request for a week.
    expect(HOOK_TIMEOUT_SECONDS).toBe(5);
    expect(PERMISSION_HOOK_TIMEOUT_SECONDS).toBe(600);
  });

  it('carries a matcher only on the tool events', () => {
    expect((block.hooks.PreToolUse as HookEntry[])[0].matcher).toBe('*');
    expect((block.hooks.PostToolUse as HookEntry[])[0].matcher).toBe('*');
    expect((block.hooks.PermissionRequest as HookEntry[])[0].matcher).toBe('*');
    expect((block.hooks.SessionStart as HookEntry[])[0].matcher).toBeUndefined();
  });

  it('points both status lines at their own endpoints', () => {
    expect(block.statusLine.type).toBe('command');
    expect(block.statusLine.command).toContain('http://127.0.0.1:4823/statusline');
    expect(block.subagentStatusLine.command).toContain('http://127.0.0.1:4823/substatus');
  });

  it('turns on agent teams and the task tools, which no plugin manifest can', () => {
    expect(block.env).toEqual({
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      CLAUDE_CODE_ENABLE_TODO_TOOLS: '1',
    });
  });

  it('honours a non-default port', () => {
    const other = hookBlock(4400);
    expect(((other.hooks.Stop as HookEntry[])[0].hooks[0]).command).toContain(
      'http://127.0.0.1:4400/hook',
    );
    expect(other.statusLine.command).toContain(':4400/statusline');
  });

  it('propagates the port to the launcher, which otherwise defaults to 4823', () => {
    const entry = hookBlock(5000).hooks.PostToolUse.find((e) => e.matcher === 'Agent')!;
    expect((entry.hooks[0] as CommandHook).command).toMatch(/^OCTO_PORT=5000 /);
  });

  it('pins the same claude version as the model catalog', () => {
    expect(catalog.version).toBe(PINNED_CLAUDE_VERSION);
  });

  it.each(['PreToolUse', 'PostToolUse'] as const)(
    'registers the launcher as a %s:Agent command hook with an explicit timeout',
    (event) => {
      const entry = block.hooks[event].find((e) => e.matcher === 'Agent');
      expect(entry).toBeDefined();
      expect(entry!.hooks[0]).toMatchObject({ type: 'command', timeout: 5 });
      expect((entry!.hooks[0] as CommandHook).command).toMatch(
        /^OCTO_PORT=4823 '.*console-launch\.sh'$/,
      );
    },
  );

  it('does not register a SubagentStart hook — systemMessage is stripped there', () => {
    expect(hookBlock(4823).hooks.SubagentStart).toBeUndefined();
  });

  it('uninstall removes the launcher as well as the http hooks', () => {
    const installed = mergeHookBlock({}, 4823);
    const cleaned = removeHookBlock(installed) as { hooks?: Record<string, unknown[]> };
    expect(cleaned.hooks?.PostToolUse ?? []).toHaveLength(0);
  });
});

describe("the plugin's own hooks.json", () => {
  // The plugin registers these itself, so a plugin user never has to write hooks
  // into settings.json. Both copies have to describe the same observation, or
  // whichever half you happen to have installed silently disagrees.
  const shipped = JSON.parse(
    readFileSync(new URL('../../plugin/hooks/hooks.json', import.meta.url), 'utf8'),
  ) as { hooks: Record<string, HookEntry[]> };

  it('registers every event the settings installer would, on the default port', () => {
    expect(Object.keys(shipped.hooks)).toEqual([...HOOK_EVENTS]);
    // Only the LAUNCHER's command legitimately differs between the two copies
    // (absolute path here, ${CLAUDE_PLUGIN_ROOT} there). The observation hooks
    // are command hooks too now, so masking every command would let the two
    // copies POST to different places and still pass.
    const normalise = (entries: HookEntry[]) =>
      JSON.stringify(
        entries.map((e) =>
          e.matcher === 'Agent' ? { ...e, hooks: [{ ...e.hooks[0], command: '<launcher>' }] } : e,
        ),
      );
    const block = hookBlock(4823);
    for (const event of HOOK_EVENTS) {
      expect(normalise(shipped.hooks[event])).toBe(
        normalise(block.hooks[event] as unknown as HookEntry[]),
      );
    }
  });

  it('resolves the launcher through the plugin root, not a machine-local path', () => {
    const entry = shipped.hooks.PreToolUse.find((e) => e.matcher === 'Agent');
    expect((entry!.hooks[0] as unknown as { command: string }).command).toBe(
      '"${CLAUDE_PLUGIN_ROOT}/bin/console-launch.sh"',
    );
  });
});

describe('mergeHookBlock / removeHookBlock', () => {
  it('adds the block without disturbing unrelated settings', () => {
    const merged = mergeHookBlock({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }, 4823);
    expect(merged.model).toBe('opus');
    const stop = (merged.hooks as Record<string, HookEntry[]>).Stop;
    expect(stop).toHaveLength(2);
    expect((stop[0].hooks[0] as unknown as { command: string }).command).toBe('say done');
    expect(stop[1].hooks[0].command).toContain('http://127.0.0.1:4823/hook');
  });

  it('claims the status line only when nobody else has it', () => {
    const mine = { type: 'command', command: 'ccstatusline' };
    expect(mergeHookBlock({ statusLine: mine }, 4823).statusLine).toEqual(mine);
    expect(mergeHookBlock({}, 4823).statusLine).toEqual(hookBlock(4823).statusLine);
  });

  it('still moves its own status line to a new port', () => {
    const moved = mergeHookBlock(mergeHookBlock({}, 4823), 4400);
    expect((moved.statusLine as { command: string }).command).toContain(':4400/statusline');
  });

  it('is idempotent', () => {
    const once = mergeHookBlock({}, 4823);
    expect(mergeHookBlock(once, 4823)).toEqual(once);
  });

  it('removes exactly what it added', () => {
    const original = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } };
    expect(removeHookBlock(mergeHookBlock(original, 4823))).toEqual(original);
  });

  it('adds the env vars beside the ones already there', () => {
    const merged = mergeHookBlock({ env: { FOO: 'bar' } }, 4823);
    expect(merged.env).toEqual({
      FOO: 'bar',
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      CLAUDE_CODE_ENABLE_TODO_TOOLS: '1',
    });
    expect(removeHookBlock(merged).env).toEqual({ FOO: 'bar' });
  });

  it('leaves an explicit "0" alone — that is the user saying off', () => {
    const off = { env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '0' } };
    expect(removeHookBlock(off)).toEqual(off);
  });

  it('leaves a settings file with no console hooks untouched', () => {
    const original = { model: 'opus', statusLine: { type: 'command', command: 'my-prompt' } };
    expect(removeHookBlock(original)).toEqual(original);
  });
});

describe('checkClaudeVersion', () => {
  it('accepts the pinned version', () => {
    expect(PINNED_CLAUDE_VERSION).toBe('2.1.231');
    expect(checkClaudeVersion('2.1.231 (Claude Code)')).toEqual({
      ok: true,
      message: 'claude 2.1.231 matches the pinned contract',
    });
  });

  it('warns on any other version', () => {
    expect(checkClaudeVersion('2.2.0 (Claude Code)')).toEqual({
      ok: false,
      message: 'claude 2.2.0 does not match the pinned 2.1.231; the control plane writes internal protocols and may be wrong',
    });
  });

  it('warns when the version cannot be read', () => {
    expect(checkClaudeVersion(null)).toEqual({
      ok: false,
      message: 'could not read `claude --version`; the console is pinned to 2.1.231 internals',
    });
    expect(checkClaudeVersion('command not found').ok).toBe(false);
  });
});

describe('runSetup', () => {
  it('prints the block and writes nothing without confirmation', async () => {
    const settingsPath = path.join(dir, 'settings.json');
    const output = await runSetup({ settingsPath, port: 4823, confirm: false });
    expect(output).toContain('"type": "command"');
    expect(output).toContain('http://127.0.0.1:4823/hook');
    expect(output).toContain('nothing was written');
    await expect(fs.stat(settingsPath)).rejects.toThrow();
  });

  it('writes on confirmation and restores on uninstall', async () => {
    const settingsPath = path.join(dir, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({ model: 'opus' }, null, 2));

    await runSetup({ settingsPath, port: 4823, confirm: true });
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as Record<string, unknown>;
    expect(written.model).toBe('opus');
    expect(Object.keys(written.hooks as object)).toEqual([...HOOK_EVENTS]);

    await runSetup({ settingsPath, port: 4823, confirm: true, uninstall: true });
    expect(JSON.parse(await fs.readFile(settingsPath, 'utf8'))).toEqual({ model: 'opus' });
  });

  it("never touches a status line it does not own", async () => {
    // The console's own status line ends in `printf ''`, so taking the key over
    // does not replace someone's status bar, it blanks it.
    const settingsPath = path.join(dir, 'settings.json');
    const mine = { type: 'command', command: '~/bin/my-fancy-statusline.sh' };
    await fs.writeFile(settingsPath, JSON.stringify({ statusLine: mine }, null, 2));

    const output = await runSetup({ settingsPath, port: 4823, confirm: true });
    const installed = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as Record<string, unknown>;
    expect(installed.statusLine).toEqual(mine);
    expect(output).toContain('left your own status line alone');

    await runSetup({ settingsPath, port: 4823, confirm: true, uninstall: true });
    const after = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as Record<string, unknown>;
    expect(after.statusLine).toEqual(mine);
    await expect(fs.stat(backupPathFor(settingsPath))).rejects.toThrow();
  });

  it("takes the status line only when the key is free, and hands it back", async () => {
    const settingsPath = path.join(dir, 'settings.json');
    await runSetup({ settingsPath, port: 4823, confirm: true });
    await runSetup({ settingsPath, port: 4823, confirm: true, uninstall: true });
    const after = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as Record<string, unknown>;
    expect(after.statusLine).toBeUndefined();
    expect(after.subagentStatusLine).toBeUndefined();
  });

  it("preserves the user's own hooks across install and uninstall", async () => {
    const settingsPath = path.join(dir, 'settings.json');
    const guard = { hooks: [{ type: 'command', command: 'my-guard.sh' }] };
    await fs.writeFile(settingsPath, JSON.stringify({ hooks: { PreToolUse: [guard] } }, null, 2));

    await runSetup({ settingsPath, port: 4823, confirm: true });
    const installed = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as {
      hooks: Record<string, unknown[]>;
    };
    expect(installed.hooks.PreToolUse[0]).toEqual(guard);

    await runSetup({ settingsPath, port: 4823, confirm: true, uninstall: true });
    const after = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as {
      hooks: Record<string, unknown[]>;
    };
    expect(after.hooks.PreToolUse).toEqual([guard]);
  });

  it('turns the env vars on and takes them off again on uninstall', async () => {
    const settingsPath = path.join(dir, 'settings.json');
    await runSetup({ settingsPath, port: 4823, confirm: true });
    const installed = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as { env: Record<string, string> };
    for (const name of AGENT_ENV_VARS) expect(installed.env[name]).toBe('1');

    await runSetup({ settingsPath, port: 4823, confirm: true, uninstall: true });
    const after = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as { env?: unknown };
    expect(after.env).toBeUndefined();
  });

  it('restores the env values the user had before the install', async () => {
    const settingsPath = path.join(dir, 'settings.json');
    const mine = { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1', CLAUDE_CODE_ENABLE_TODO_TOOLS: '0', FOO: 'bar' };
    await fs.writeFile(settingsPath, JSON.stringify({ env: mine }, null, 2));

    await runSetup({ settingsPath, port: 4823, confirm: true });
    const installed = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as { env: Record<string, string> };
    expect(installed.env.CLAUDE_CODE_ENABLE_TODO_TOOLS).toBe('1');

    await runSetup({ settingsPath, port: 4823, confirm: true, uninstall: true });
    expect(JSON.parse(await fs.readFile(settingsPath, 'utf8'))).toEqual({ env: mine });
  });

  it('does not re-stash on a second install', async () => {
    // Otherwise the console records its own "1" as if it were the user's.
    const settingsPath = path.join(dir, 'settings.json');
    await runSetup({ settingsPath, port: 4823, confirm: true });
    await runSetup({ settingsPath, port: 4823, confirm: true });
    await runSetup({ settingsPath, port: 4823, confirm: true, uninstall: true });
    const after = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as { env?: unknown };
    expect(after.env).toBeUndefined();
  });

  it('creates a settings file that does not exist yet', async () => {
    const settingsPath = path.join(dir, 'nested', 'settings.json');
    await runSetup({ settingsPath, port: 4400, confirm: true });
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as { hooks: Record<string, HookEntry[]> };
    expect(written.hooks.PreToolUse[0].hooks[0].command).toContain('http://127.0.0.1:4400/hook');
  });
});
