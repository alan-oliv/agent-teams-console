import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import catalog from '../shared/catalog.json';
import {
  backupPathFor,
  HOOK_EVENTS,
  HOOK_TIMEOUT_MS,
  PERMISSION_HOOK_TIMEOUT_MS,
  PINNED_CLAUDE_VERSION,
  checkClaudeVersion,
  hookBlock,
  mergeHookBlock,
  removeHookBlock,
  runSetup,
  type CommandHook,
} from './setup';

interface HttpHook { type: string; url: string; timeout: number }
interface HookEntry { matcher?: string; hooks: HttpHook[] }

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

  it('registers every event as an http hook at the right port', () => {
    expect(Object.keys(block.hooks)).toEqual([...HOOK_EVENTS]);
    for (const event of HOOK_EVENTS) {
      const entries = block.hooks[event] as HookEntry[];
      // Both Agent arms carry one extra entry: the command-hook launcher.
      const carriesLauncher = event === 'PreToolUse' || event === 'PostToolUse';
      expect(entries).toHaveLength(carriesLauncher ? 2 : 1);
      expect(entries.filter((e) => e.matcher === 'Agent')).toHaveLength(carriesLauncher ? 1 : 0);
      expect(entries[0].hooks).toHaveLength(1);
      expect(entries[0].hooks[0].type).toBe('http');
      expect(entries[0].hooks[0].url).toBe('http://127.0.0.1:4823/hook');
    }
  });

  it('sets an explicit timeout on every entry, long only for the deliberate hold', () => {
    for (const event of HOOK_EVENTS) {
      const hook = (block.hooks[event] as HookEntry[])[0].hooks[0];
      expect(typeof hook.timeout).toBe('number');
      expect(hook.timeout).toBe(
        event === 'PermissionRequest' ? PERMISSION_HOOK_TIMEOUT_MS : HOOK_TIMEOUT_MS,
      );
    }
    expect(HOOK_TIMEOUT_MS).toBe(5000);
    expect(PERMISSION_HOOK_TIMEOUT_MS).toBe(600000);
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

  it('honours a non-default port', () => {
    const other = hookBlock(4400);
    expect(((other.hooks.Stop as HookEntry[])[0].hooks[0]).url).toBe('http://127.0.0.1:4400/hook');
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
      expect(entry!.hooks[0]).toMatchObject({ type: 'command', timeout: 5000 });
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

describe('mergeHookBlock / removeHookBlock', () => {
  it('adds the block without disturbing unrelated settings', () => {
    const merged = mergeHookBlock({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }, 4823);
    expect(merged.model).toBe('opus');
    const stop = (merged.hooks as Record<string, HookEntry[]>).Stop;
    expect(stop).toHaveLength(2);
    expect((stop[0].hooks[0] as unknown as { command: string }).command).toBe('say done');
    expect(stop[1].hooks[0].url).toBe('http://127.0.0.1:4823/hook');
  });

  it('is idempotent', () => {
    const once = mergeHookBlock({}, 4823);
    expect(mergeHookBlock(once, 4823)).toEqual(once);
  });

  it('removes exactly what it added', () => {
    const original = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } };
    expect(removeHookBlock(mergeHookBlock(original, 4823))).toEqual(original);
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
    expect(output).toContain('"type": "http"');
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

  it("preserves the user's status line and restores it on uninstall", async () => {
    // The installed status line ends in `printf ''`, so clobbering the user's
    // also blanks their terminal status line for as long as it is installed.
    const settingsPath = path.join(dir, 'settings.json');
    const mine = { type: 'command', command: '~/bin/my-fancy-statusline.sh' };
    await fs.writeFile(settingsPath, JSON.stringify({ statusLine: mine }, null, 2));

    await runSetup({ settingsPath, port: 4823, confirm: true });
    const installed = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as Record<string, unknown>;
    expect(installed.statusLine).not.toEqual(mine);

    // A second install must not stash the console's own line as "the user's".
    await runSetup({ settingsPath, port: 4823, confirm: true });

    await runSetup({ settingsPath, port: 4823, confirm: true, uninstall: true });
    const restored = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as Record<string, unknown>;
    expect(restored.statusLine).toEqual(mine);
    await expect(fs.stat(backupPathFor(settingsPath))).rejects.toThrow();
  });

  it("leaves no status line behind when the user never had one", async () => {
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

  it('creates a settings file that does not exist yet', async () => {
    const settingsPath = path.join(dir, 'nested', 'settings.json');
    await runSetup({ settingsPath, port: 4400, confirm: true });
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as { hooks: Record<string, HookEntry[]> };
    expect(written.hooks.PreToolUse[0].hooks[0].url).toBe('http://127.0.0.1:4400/hook');
  });
});
