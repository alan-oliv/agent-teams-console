import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyTailState, drain, watchAppendOnly } from './tail';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tail-'));
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

describe('drain', () => {
  it('recovers appended lines exactly and advances the offset', async () => {
    const file = path.join(dir, 'a.jsonl');
    await fs.writeFile(file, '{"i":1}\n{"i":2}\n');

    const first = await drain(file, emptyTailState());
    expect(first.lines).toEqual(['{"i":1}', '{"i":2}']);
    expect(first.state.offset).toBe(16);
    expect(first.state.partial).toBe('');

    await fs.appendFile(file, '{"i":3}\n');
    const second = await drain(file, first.state);
    expect(second.lines).toEqual(['{"i":3}']);
    expect(second.state.offset).toBe(24);
  });

  it('never emits a torn line and completes it on the next drain', async () => {
    const file = path.join(dir, 'b.jsonl');
    await fs.writeFile(file, '{"i":1}\n{"par');

    const first = await drain(file, emptyTailState());
    expect(first.lines).toEqual(['{"i":1}']);
    expect(first.state.partial).toBe('{"par');

    await fs.appendFile(file, 'tial":true}\n');
    const second = await drain(file, first.state);
    expect(second.lines).toEqual(['{"partial":true}']);
    expect(second.state.partial).toBe('');
  });

  it('resets to offset 0 when the file is truncated', async () => {
    const file = path.join(dir, 'c.jsonl');
    await fs.writeFile(file, '{"i":1}\n{"i":2}\n');
    const first = await drain(file, emptyTailState());
    expect(first.state.offset).toBe(16);

    await fs.truncate(file, 0);
    await fs.writeFile(file, '{"i":9}\n');
    const second = await drain(file, first.state);
    expect(second.lines).toEqual(['{"i":9}']);
    expect(second.state.offset).toBe(8);
  });

  it('resets to offset 0 when the inode changes', async () => {
    const file = path.join(dir, 'd.jsonl');
    await fs.writeFile(file, '{"i":1}\n{"i":2}\n');
    const first = await drain(file, emptyTailState());
    expect(first.lines).toHaveLength(2);

    await fs.rm(file);
    await fs.writeFile(file, '{"i":7}\n{"i":8}\n');
    const second = await drain(file, first.state);
    expect(second.lines).toEqual(['{"i":7}', '{"i":8}']);
    expect(second.state.offset).toBe(16);
  });

  it('returns no lines for a missing file', async () => {
    const out = await drain(path.join(dir, 'nope.jsonl'), emptyTailState());
    expect(out.lines).toEqual([]);
  });
});

describe('watchAppendOnly', () => {
  it('picks up a brand-new file in an already-watched nested directory (macOS reports rename, not change)', async () => {
    // The containing directory exists before the watcher arms, so the only thing
    // under test is the file's first-write event.
    await fs.mkdir(path.join(dir, 'slug', 'subagents'), { recursive: true });
    const got: Array<{ path: string; lines: string[] }> = [];
    const w = watchAppendOnly(dir, (p, lines) => got.push({ path: p, lines }));
    try {
      const file = path.join(dir, 'slug', 'subagents', 'agent-aprobe-charlie-12ee4cb1ed35cf7c.jsonl');
      await fs.writeFile(file, '{"type":"assistant"}\n');
      const hit = await waitFor(() => got.find((g) => g.path === file));
      expect(hit.lines).toEqual(['{"type":"assistant"}']);

      await fs.appendFile(file, '{"type":"user"}\n');
      const second = await waitFor(() =>
        got.filter((g) => g.path === file).length > 1
          ? got.filter((g) => g.path === file)[1]
          : undefined,
      );
      expect(second.lines).toEqual(['{"type":"user"}']);
    } finally {
      w.close();
    }
  });

  it('picks up a file written into a directory created after the watcher starts', async () => {
    const got: Array<{ path: string; lines: string[] }> = [];
    const w = watchAppendOnly(dir, (p, lines) => got.push({ path: p, lines }));
    try {
      // Unlike the test above, the nested directory itself is new here: it appears
      // after the recursive watcher is already running. This is the genuinely
      // timing-dependent case, since macOS FSEvents has to notice the brand-new
      // subtree before it can report the rename inside it, so this test gets the
      // most generous budget in the suite. The raw watcher has no fallback for a
      // missed/delayed event; in production, ingest/files.ts layers a periodic
      // reconciliation sweep on top of watchAppendOnly for exactly this case.
      await fs.mkdir(path.join(dir, 'slug', 'subagents'), { recursive: true });
      const file = path.join(dir, 'slug', 'subagents', 'agent-aprobe-charlie-12ee4cb1ed35cf7c.jsonl');
      await fs.writeFile(file, '{"type":"assistant"}\n');
      const hit = await waitFor(() => got.find((g) => g.path === file), 20_000);
      expect(hit.lines).toEqual(['{"type":"assistant"}']);
    } finally {
      w.close();
    }
  });

  it('ignores files that are not .jsonl', async () => {
    const got: string[] = [];
    const w = watchAppendOnly(dir, (p) => got.push(p));
    try {
      await fs.writeFile(path.join(dir, 'config.json'), '{}');
      await new Promise((r) => setTimeout(r, 300));
      expect(got).toEqual([]);
    } finally {
      w.close();
    }
  });
});
