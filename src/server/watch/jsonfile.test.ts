import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonSafe, watchJsonTree } from './jsonfile';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsonfile-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('watchJsonTree on a missing root', () => {
  it('does not throw, and keeps working once the root appears', async () => {
    // fs.watch throws ENOENT synchronously, which watcher.on('error') cannot
    // catch — this used to kill the server at boot on any machine without
    // ~/.claude/tasks or ~/.claude/sessions.
    const absent = path.join(dir, 'never-created');
    const seen: string[] = [];
    const watcher = watchJsonTree(absent, (f) => seen.push(f));
    try {
      expect(seen).toEqual([]);
    } finally {
      watcher.close();
    }
  });
});

describe('readJsonSafe', () => {
  it('parses a well-formed file', async () => {
    const file = path.join(dir, 'ok.json');
    await fs.writeFile(file, '{"name":"session-98b0b4a7"}');
    expect(await readJsonSafe<{ name: string }>(file)).toEqual({ name: 'session-98b0b4a7' });
  });

  it('retries once after 20ms and recovers a torn read', async () => {
    const file = path.join(dir, 'torn.json');
    await fs.writeFile(file, '{"name":"session-98b0b');
    setTimeout(() => {
      void fs.writeFile(file, '{"name":"session-98b0b4a7"}');
    }, 5);
    expect(await readJsonSafe<{ name: string }>(file)).toEqual({ name: 'session-98b0b4a7' });
  });

  it('returns null when both attempts fail', async () => {
    const file = path.join(dir, 'bad.json');
    await fs.writeFile(file, 'not json at all');
    expect(await readJsonSafe(file)).toBeNull();
  });

  it('returns null for a missing file', async () => {
    expect(await readJsonSafe(path.join(dir, 'gone.json'))).toBeNull();
  });
});

describe('watchJsonTree', () => {
  it('fires on the temp-file + rename arm of atomicWrite', async () => {
    await fs.mkdir(path.join(dir, 'session-98b0b4a7', 'inboxes'), { recursive: true });
    const seen: string[] = [];
    const w = watchJsonTree(dir, (p) => seen.push(p));
    try {
      const target = path.join(dir, 'session-98b0b4a7', 'inboxes', 'team-lead.json');
      const tmp = `${target}.tmp`;
      await fs.writeFile(tmp, '[{"from":"probe-alpha"}]');
      await fs.rename(tmp, target);
      const hit = await waitFor(() => seen.find((p) => p === target));
      expect(hit).toBe(target);
      expect(await readJsonSafe<Array<{ from: string }>>(target)).toEqual([{ from: 'probe-alpha' }]);
    } finally {
      w.close();
    }
  });

  it('fires on the in-place truncate(0) + write arm of atomicWrite', async () => {
    const target = path.join(dir, 'config.json');
    await fs.writeFile(target, '{"name":"old"}');
    const seen: string[] = [];
    const w = watchJsonTree(dir, (p) => seen.push(p));
    try {
      await new Promise((r) => setTimeout(r, 100));
      seen.length = 0;
      const fh = await fs.open(target, 'r+');
      await fh.truncate(0);
      await fh.write(Buffer.from('{"name":"session-98b0b4a7"}'), 0, 27, 0);
      await fh.close();
      const hit = await waitFor(() => seen.find((p) => p === target));
      expect(hit).toBe(target);
      expect(await readJsonSafe<{ name: string }>(target)).toEqual({ name: 'session-98b0b4a7' });
    } finally {
      w.close();
    }
  });

  it('ignores the proper-lockfile sibling', async () => {
    const seen: string[] = [];
    const w = watchJsonTree(dir, (p) => seen.push(p));
    try {
      await fs.mkdir(path.join(dir, 'team-lead.json.lock'), { recursive: true });
      await new Promise((r) => setTimeout(r, 300));
      expect(seen).toEqual([]);
    } finally {
      w.close();
    }
  });
});
