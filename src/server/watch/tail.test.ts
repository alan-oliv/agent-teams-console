import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appendFileSync, promises as fs, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyTailState, drain, watchAppendOnly } from './tail';
import { isArmingProbe, untilArmed } from './arming.testkit';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tail-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 1500): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('watchAppendOnly on a missing root', () => {
  it('does not throw when the root does not exist', async () => {
    // Same synchronous-ENOENT crash as watchJsonTree; both watchers shared the
    // boilerplate and therefore shared the bug.
    const absent = path.join(dir, 'never-created');
    const seen: string[] = [];
    const watcher = watchAppendOnly(absent, (f) => seen.push(f));
    try {
      expect(seen).toEqual([]);
    } finally {
      watcher.close();
    }
  });
});

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
    // No stat happened, so there is no clock to report — absent, not 0, which
    // is a real epoch and would read as 1970.
    expect(out.mtimeMs).toBeUndefined();
  });

  // The file's own clock, which is what tells a live log from a replayed one:
  // a live log's mtime tracks the timestamps inside it, while a fixture is
  // written now and describes days ago. Reported even when the drain found
  // nothing, because a log that has stopped growing is exactly the case the
  // staleness rule has to judge.
  it('reports the file mtime, with new bytes and without', async () => {
    const file = path.join(dir, 'clock.jsonl');
    await fs.writeFile(file, '{"i":1}\n');
    const stat = await fs.stat(file);

    const first = await drain(file, emptyTailState());
    expect(first.lines).toEqual(['{"i":1}']);
    expect(first.mtimeMs).toBe(stat.mtimeMs);

    const again = await drain(file, first.state);
    expect(again.lines).toEqual([]);
    expect(again.mtimeMs).toBe(stat.mtimeMs);
  });

  // The ingest marks the first batch of a from-byte-0 read so the fold can clear
  // what it already holds for that agent. Without it a re-read of a file whose
  // older records the store has trimmed leaves the projection stuck in the past,
  // because the uuid dedupe keeps the FIRST copy of every record it sees.
  it('says when the lines it returns start at the first byte', async () => {
    const file = path.join(dir, 'from-start.jsonl');
    await fs.writeFile(file, '{"i":1}\n{"i":2}\n');

    const first = await drain(file, emptyTailState());
    expect(first.fromStart).toBe(true);

    await fs.appendFile(file, '{"i":3}\n');
    const second = await drain(file, first.state);
    expect(second.lines).toEqual(['{"i":3}']);
    expect(second.fromStart).toBe(false);

    await fs.truncate(file, 0);
    await fs.writeFile(file, '{"i":9}\n');
    const truncated = await drain(file, second.state);
    expect(truncated.lines).toEqual(['{"i":9}']);
    expect(truncated.fromStart).toBe(true);

    await fs.rm(file);
    await fs.writeFile(file, '{"i":7}\n');
    const replaced = await drain(file, truncated.state);
    expect(replaced.lines).toEqual(['{"i":7}']);
    expect(replaced.fromStart).toBe(true);
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
      await untilArmed(dir, () => got.map((g) => g.path), '.jsonl');
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
      // subtree before it can report the rename inside it. The raw watcher has no
      // fallback for a missed/delayed event; in production, ingest/files.ts layers
      // a periodic reconciliation sweep on top of watchAppendOnly for exactly this
      // case.
      await untilArmed(dir, () => got.map((g) => g.path), '.jsonl');
      await fs.mkdir(path.join(dir, 'slug', 'subagents'), { recursive: true });
      const file = path.join(dir, 'slug', 'subagents', 'agent-aprobe-charlie-12ee4cb1ed35cf7c.jsonl');
      await fs.writeFile(file, '{"type":"assistant"}\n');
      const hit = await waitFor(() => got.find((g) => g.path === file));
      expect(hit.lines).toEqual(['{"type":"assistant"}']);
    } finally {
      w.close();
    }
  });

  it('ignores files that are not .jsonl', async () => {
    const got: string[] = [];
    const w = watchAppendOnly(dir, (p) => got.push(p));
    try {
      // Without this the watcher may never have been listening, and the
      // assertion below would hold for that reason instead of the filter's.
      await untilArmed(dir, () => got, '.jsonl');
      await fs.writeFile(path.join(dir, 'config.json'), '{}');
      await new Promise((r) => setTimeout(r, 300));
      expect(got.filter((p) => !isArmingProbe(p))).toEqual([]);
    } finally {
      w.close();
    }
  });
});

describe('pump', () => {
  // The whole point of exporting pump is that the pull path must not depend on
  // FSEvents, so every test here arms the watcher on a root that does not exist
  // — watchRoot degrades to a no-op and there is no fs.watch at all.
  const deadWatcher = (onLines: (p: string, lines: string[]) => void) =>
    watchAppendOnly(path.join(dir, 'never-created'), onLines);

  it('passes the from-byte-0 flag through to onLines', async () => {
    const got: Array<{ lines: string[]; fromStart: boolean }> = [];
    const w = watchAppendOnly(path.join(dir, 'never-created'), (_p, lines, fromStart) =>
      got.push({ lines, fromStart }),
    );
    try {
      const file = path.join(dir, 'flagged.jsonl');
      await fs.writeFile(file, '{"i":1}\n');
      await w.pump(file);
      await fs.appendFile(file, '{"i":2}\n');
      await w.pump(file);
      expect(got).toEqual([
        { lines: ['{"i":1}'], fromStart: true },
        { lines: ['{"i":2}'], fromStart: false },
      ]);
    } finally {
      w.close();
    }
  });

  it('reads a file the watcher never reported', async () => {
    const got: string[] = [];
    const w = deadWatcher((_p, lines) => got.push(...lines));
    try {
      const file = path.join(dir, 'orphan.jsonl');
      await fs.writeFile(file, '{"i":1}\n{"i":2}\n');
      await w.pump(file);
      expect(got).toEqual(['{"i":1}', '{"i":2}']);
    } finally {
      w.close();
    }
  });

  it('resolves only once its lines have been delivered', async () => {
    const got: string[] = [];
    const w = deadWatcher((_p, lines) => got.push(...lines));
    try {
      const file = path.join(dir, 'awaited.jsonl');
      await fs.writeFile(file, '{"i":1}\n');
      const done = w.pump(file);
      expect(got).toEqual([]);
      await done;
      expect(got).toEqual(['{"i":1}']);

      await fs.appendFile(file, '{"i":2}\n');
      await w.pump(file);
      expect(got).toEqual(['{"i":1}', '{"i":2}']);
    } finally {
      w.close();
    }
  });

  it('coalesces a burst of pumps of one file into a single queued drain', async () => {
    const file = path.join(dir, 'coalesce.jsonl');
    const batches: string[][] = [];
    // Feeding one more line per delivery means any drain that runs has bytes to
    // report, so `batches` counts the drains the burst actually performed —
    // which is the only thing the de-duplication changes. The writes are
    // synchronous so they land before the drain chain gets its first microtask.
    const w = deadWatcher((_p, lines) => {
      batches.push(lines);
      appendFileSync(file, `${JSON.stringify({ i: batches.length })}\n`);
    });
    try {
      writeFileSync(file, '{"i":0}\n');
      // Issued in one tick, so none has started draining: the first runs, the
      // second stats after all twenty and therefore covers them, and the rest
      // are pure duplicate work.
      await Promise.all(Array.from({ length: 20 }, () => w.pump(file)));
      expect(batches).toEqual([['{"i":0}'], ['{"i":1}']]);
    } finally {
      w.close();
    }
  });

  it('delivers every line exactly once under concurrent pumps of one file', async () => {
    const got: string[] = [];
    const w = deadWatcher((_p, lines) => got.push(...lines));
    try {
      const file = path.join(dir, 'hammer.jsonl');
      await fs.writeFile(file, '');

      // Enough half-records to land many drains mid-record without making this
      // a filesystem storm. Churn here is paid for elsewhere: FSEvents drops
      // events under load, a dropped event is unrecoverable, and the watcher
      // tests that follow have no way to tell that apart from a real defect.
      const total = 40;
      let writing = true;
      const hammer = (async () => {
        while (writing) {
          await w.pump(file);
          await new Promise((r) => setImmediate(r));
        }
      })();

      // Half a record at a time: every drain that lands mid-record has to carry
      // the remainder forward in `partial` rather than emit or drop it.
      for (let i = 0; i < total; i++) {
        const rec = `${JSON.stringify({ i })}\n`;
        const cut = Math.max(1, Math.floor(rec.length / 2));
        await fs.appendFile(file, rec.slice(0, cut));
        await fs.appendFile(file, rec.slice(cut));
      }
      writing = false;
      await hammer;
      await w.pump(file);

      const seen = new Set<number>();
      let unparseable = 0;
      for (const line of got) {
        try {
          seen.add((JSON.parse(line) as { i: number }).i);
        } catch {
          unparseable += 1;
        }
      }
      expect(unparseable).toBe(0);
      expect(seen.size).toBe(total);
      expect(got).toHaveLength(total);
    } finally {
      w.close();
    }
  });
});
