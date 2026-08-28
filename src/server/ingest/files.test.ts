import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, type Store, type StoredEvent } from '../store';
import {
  startFileIngest,
  agentOfTranscript,
  INGEST_BATCH_RECORDS,
  type IngestPaths,
  type FileIngest,
} from './files';
import { dedupeUsage, tokensOf, totalCost, usageRecordsOf } from '../../shared/usage';
import type { TranscriptRecord } from '../../shared/transcript';
import { project } from '../project';
import type { RosterPayload, TranscriptPayload, TaskPayload, MailPayload } from '../project';

const FIXTURES = path.resolve(process.cwd(), 'fixtures');
const SLUG = '-Users-alanoliv-code-agents-team-ui';
const TEAM = 'session-98b0b4a7';
const LEAD_SESSION = '98b0b4a7-3206-455b-aaf6-a5a81ad1e283';

let home: string;
let store: Store;
let paths: IngestPaths;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-home-'));
  paths = {
    projects: path.join(home, 'projects'),
    teams: path.join(home, 'teams'),
    tasks: path.join(home, 'tasks'),
    sessions: path.join(home, 'sessions'),
  };
  for (const p of Object.values(paths)) await fs.mkdir(p, { recursive: true });
  store = openStore(path.join(home, 'events.db'));
});

afterEach(async () => {
  store.close();
  await fs.rm(home, { recursive: true, force: true });
});

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

// A fixed wait for the live watchers' debounce (jsonfile.ts: 15ms) and fs.watch
// event delivery to settle, used where the assertion is a negative ("nothing
// landed yet") and there is nothing to poll for.
function settle(ms = 300): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function layout(): Promise<void> {
  await fs.mkdir(path.join(paths.teams, TEAM, 'inboxes'), { recursive: true });
  await fs.mkdir(path.join(paths.tasks, TEAM), { recursive: true });
  await fs.mkdir(path.join(paths.projects, SLUG, LEAD_SESSION, 'subagents'), { recursive: true });

  await fs.copyFile(
    path.join(FIXTURES, 'config-4-members.json'),
    path.join(paths.teams, TEAM, 'config.json'),
  );

  const sidecars = JSON.parse(
    await fs.readFile(path.join(FIXTURES, 'meta-sidecars.json'), 'utf8'),
  ) as Array<Record<string, unknown>>;
  await fs.writeFile(
    path.join(paths.projects, SLUG, LEAD_SESSION, 'subagents', 'agent-aprobe-charlie-12ee4cb1ed35cf7c.meta.json'),
    JSON.stringify(sidecars.find((s) => s.name === 'probe-charlie')),
  );

  await fs.copyFile(
    path.join(FIXTURES, 'transcript-agent-aprobe-charlie-12ee4cb1ed35cf7c.jsonl'),
    path.join(paths.projects, SLUG, LEAD_SESSION, 'subagents', 'agent-aprobe-charlie-12ee4cb1ed35cf7c.jsonl'),
  );

  const tasks = JSON.parse(await fs.readFile(path.join(FIXTURES, 'tasks.json'), 'utf8')) as TaskPayload[];
  await fs.writeFile(path.join(paths.tasks, TEAM, '1.json'), JSON.stringify(tasks[4]));

  const snapshots = JSON.parse(
    await fs.readFile(path.join(FIXTURES, 'inbox-snapshots.json'), 'utf8'),
  ) as Array<{ path: string; entries: unknown[] }>;
  await fs.writeFile(
    path.join(paths.teams, TEAM, 'inboxes', 'team-lead.json'),
    JSON.stringify(snapshots[3].entries),
  );

  await fs.writeFile(
    path.join(paths.sessions, `${LEAD_SESSION}.json`),
    JSON.stringify({ sessionId: LEAD_SESSION, gitBranch: 'HEAD' }),
  );
}

const of = (events: StoredEvent[], kind: string) => events.filter((e) => e.kind === kind);

describe('agentOfTranscript', () => {
  it('maps a subagent filename to the bare teammate name', () => {
    expect(
      agentOfTranscript(
        `/a/${LEAD_SESSION}/subagents/agent-aprobe-charlie-12ee4cb1ed35cf7c.jsonl`,
        LEAD_SESSION,
        'team-lead',
      ),
    ).toBe('probe-charlie');
  });

  it('maps the lead session transcript to the lead name', () => {
    expect(agentOfTranscript(`/a/${LEAD_SESSION}.jsonl`, LEAD_SESSION, 'team-lead')).toBe('team-lead');
  });

  it('ignores an unrelated session transcript', () => {
    expect(agentOfTranscript('/a/11111111-2222-3333-4444-555555555555.jsonl', LEAD_SESSION, 'team-lead')).toBeNull();
  });
});

describe('scope rule: agent teams only', () => {
  const LEAD = '98b0b4a7-3206-455b-aaf6-a5a81ad1e283';
  const base = `/Users/alanoliv/.claude/projects/${SLUG}`;

  it('attributes a real teammate transcript under the lead session', () => {
    const f = `${base}/${LEAD}/subagents/agent-aprobe-alpha-84fd551b27de6433.jsonl`;
    expect(agentOfTranscript(f, LEAD, 'team-lead')).toBe('probe-alpha');
  });

  it('attributes the lead transcript to the lead', () => {
    expect(agentOfTranscript(`${base}/${LEAD}.jsonl`, LEAD, 'team-lead')).toBe('team-lead');
  });

  it('REJECTS workflow fan-out transcripts', () => {
    const f = `${base}/${LEAD}/subagents/workflows/wf_920cc391-abe/agent-a3eeaa94f896ac303.jsonl`;
    expect(agentOfTranscript(f, LEAD, 'team-lead')).toBeNull();
  });

  it('REJECTS subagents belonging to a different session', () => {
    const other = '5cd370e5-2d86-4b64-878e-095f726aea82';
    const f = `${base}/${other}/subagents/agent-ahatch-elixir-scout-cbe1898474d3f8fe.jsonl`;
    expect(agentOfTranscript(f, LEAD, 'team-lead')).toBeNull();
  });

  describe('pending buffer for pre-sidecar transcript lines', () => {
    let ingest: FileIngest;

    beforeEach(() => {
      // A short sweep here isn't just cleanup: this describe block creates the
      // agentDir *after* the watcher's recursive fs.watch is already running, so
      // FSEvents on macOS can drop or coalesce the event for that fresh nested
      // path. sweepIntervalMs: 0 would leave these tests with no recovery path
      // at all inside waitFor's budget; 200ms keeps the sweep well inside it.
      // teamName matches the sidecars these tests write below — the ingest
      // must know the team to admit them at all now that an unresolved team
      // fails closed (see the cross-team leak test at the bottom of this file).
      ingest = startFileIngest(store, {
        paths,
        teamName: TEAM,
        leadSessionId: LEAD,
        leadName: 'team-lead',
        sweepIntervalMs: 200,
      });
    });

    afterEach(() => {
      ingest.close();
    });

    it('buffers an unknown agent and only stores it once a teammate sidecar lands', async () => {
      const agentDir = path.join(paths.projects, SLUG, LEAD, 'subagents');
      await fs.mkdir(agentDir, { recursive: true });

      const jsonl = path.join(agentDir, 'agent-alater-1111111111111111.jsonl');
      await fs.writeFile(
        jsonl,
        JSON.stringify({ type: 'user', uuid: 'u1', timestamp: new Date().toISOString() }) + '\n',
      );
      await settle();
      // No sidecar yet -> nothing stored.
      expect(store.replay().filter((e) => e.kind === 'transcript')).toHaveLength(0);

      await fs.writeFile(
        path.join(agentDir, 'agent-alater-1111111111111111.meta.json'),
        JSON.stringify({
          name: 'later',
          agentType: 'later',
          description: 'a teammate',
          spawnDepth: 0,
          model: 'claude-opus-5',
          taskKind: 'in_process_teammate',
          teamName: TEAM,
        }),
      );
      const stored = await waitFor(() => {
        const events = store.replay().filter((e) => e.kind === 'transcript');
        return events.length > 0 ? events : undefined;
      });
      expect(stored.map((e) => e.agent)).toContain('later');
    });

    it('DISCARDS a buffered agent whose sidecar proves it is an ordinary subagent', async () => {
      const agentDir = path.join(paths.projects, SLUG, LEAD, 'subagents');
      await fs.mkdir(agentDir, { recursive: true });

      await fs.writeFile(
        path.join(agentDir, 'agent-ahelper-2222222222222222.jsonl'),
        JSON.stringify({ type: 'user', uuid: 'u2', timestamp: new Date().toISOString() }) + '\n',
      );
      await settle();
      await fs.writeFile(
        path.join(agentDir, 'agent-ahelper-2222222222222222.meta.json'),
        JSON.stringify({
          name: 'helper',
          agentType: 'general-purpose',
          description: 'an ordinary subagent',
          spawnDepth: 0,
          model: 'claude-opus-5',
          taskKind: 'task', // NOT in_process_teammate
          teamName: TEAM,
        }),
      );
      await settle();
      const agents = store.replay().filter((e) => e.kind === 'transcript').map((e) => e.agent);
      expect(agents).not.toContain('helper');
    });
  });
});

describe('startFileIngest with roots that do not exist', () => {
  it('starts and sweeps without throwing when every ~/.claude root is missing', async () => {
    // A fresh install has no ~/.claude/tasks and no ~/.claude/sessions. fs.watch
    // throws ENOENT synchronously, so this used to take the whole process down
    // at boot with nothing listening and a stack trace in a detached log.
    const bare = await fs.mkdtemp(path.join(os.tmpdir(), 'bare-home-'));
    const missing: IngestPaths = {
      projects: path.join(bare, 'projects'),
      teams: path.join(bare, 'teams'),
      tasks: path.join(bare, 'tasks'),
      sessions: path.join(bare, 'sessions'),
    };
    const ingest = startFileIngest(store, { paths: missing, sweepIntervalMs: 0 });
    try {
      await expect(ingest.sweep()).resolves.toBeUndefined();
      expect(store.replay()).toHaveLength(0);
    } finally {
      ingest.close();
      await fs.rm(bare, { recursive: true, force: true });
    }
  });
});

describe('startFileIngest', () => {
  it('reconciliation sweep ingests every pre-existing file', async () => {
    await layout();
    const ingest = startFileIngest(store, { paths, sweepIntervalMs: 0 });
    try {
      // fs.watch's FSEvents backend can replay a change from just before the
      // watcher registered; settle so any such replay lands before the sweep
      // runs, instead of racing it for the same file.
      await settle();
      await ingest.sweep();
    } finally {
      ingest.close();
    }

    const events = store.replay();

    const roster = of(events, 'roster').at(-1)!.payload as RosterPayload;
    expect(roster.config!.name).toBe(TEAM);
    expect(roster.config!.members).toHaveLength(4);
    expect(roster.sidecars.map((s) => s.meta.name)).toEqual(['probe-charlie']);
    expect(roster.sidecars[0].transcriptPath.endsWith('agent-aprobe-charlie-12ee4cb1ed35cf7c.jsonl')).toBe(true);

    const transcripts = of(events, 'transcript');
    expect(transcripts).toHaveLength(1);
    const tp = transcripts[0].payload as TranscriptPayload;
    expect(tp.agent).toBe('probe-charlie');
    expect(tp.records).toHaveLength(21);
    expect(tp.records[0].uuid).toBe('11e6d4d8-e189-4e20-af44-164cbfed2cfa');

    const task = of(events, 'task').at(-1)!.payload as TaskPayload;
    expect(task.id).toBe('1');
    expect(task.status).toBe('completed');
    expect(task.owner).toBe('probe-alpha');

    const mail = of(events, 'mail').at(-1)!.payload as MailPayload;
    expect(mail.source).toBe('inbox');
    expect(mail.to).toBe('team-lead');
    if (mail.source === 'inbox') {
      expect(mail.entries[0].msg_id).toBe('4a236089-e8f5-4688-bca2-e47c6f0d8310');
    }

    expect(of(events, 'statusline').at(-1)!.payload).toEqual({ branch: 'HEAD' });
  });

  it('a second sweep with no mtime advance appends nothing', async () => {
    await layout();
    const ingest = startFileIngest(store, { paths, sweepIntervalMs: 0 });
    try {
      // See the comment in the previous test: settle before the FIRST sweep so
      // any FSEvents replay from layout()'s writes is captured there, not in
      // the gap between the two sweeps this test is actually asserting on.
      await settle();
      await ingest.sweep();
      const after = store.replay().length;
      await ingest.sweep();
      expect(store.replay()).toHaveLength(after);
    } finally {
      ingest.close();
    }
  });

  it('watches a live inbox rewrite without a sweep', async () => {
    await layout();
    // A short sweep is the recovery path for a watcher event FSEvents drops or
    // coalesces; sweepIntervalMs: 0 would leave waitFor below with nothing to
    // fall back on inside its budget.
    const ingest = startFileIngest(store, { paths, sweepIntervalMs: 200 });
    try {
      await settle();
      await ingest.sweep();
      const before = of(store.replay(), 'mail').length;
      await fs.writeFile(
        path.join(paths.teams, TEAM, 'inboxes', 'probe-alpha.json'),
        JSON.stringify([{ from: 'team-lead', text: 'live', timestamp: '2026-08-27T15:20:00.000Z', msg_id: 'live-1', read: false }]),
      );
      const hit = await waitFor(() => {
        const events = of(store.replay(), 'mail');
        return events.length > before ? (events.at(-1)!.payload as MailPayload) : undefined;
      });
      expect(hit.to).toBe('probe-alpha');
    } finally {
      ingest.close();
    }
  });

  it('watches a live transcript append without a sweep', async () => {
    await layout();
    // Same recovery-path reasoning as the inbox test above: a short sweep gives
    // waitFor a fallback if the watcher's own event is dropped or coalesced.
    const ingest = startFileIngest(store, { paths, sweepIntervalMs: 200 });
    try {
      const agentDir = path.join(paths.projects, SLUG, LEAD_SESSION, 'subagents');
      const file = path.join(agentDir, 'agent-aprobe-bravo-babf58016882bc72.jsonl');
      await fs.writeFile(file, JSON.stringify({ type: 'assistant', uuid: 'live-uuid' }) + '\n');

      // Give the .jsonl its own fs.watch delivery: two writes into the same
      // directory microseconds apart can coalesce into a single recursive
      // FSEvents notification on macOS, which would drop this one silently.
      await settle();

      // No sidecar has landed for probe-bravo yet, so the line sits in the
      // pending buffer until its sidecar proves it is a teammate (same rule
      // covered above) — write it, from the same fixture layout() draws from.
      const sidecars = JSON.parse(
        await fs.readFile(path.join(FIXTURES, 'meta-sidecars.json'), 'utf8'),
      ) as Array<Record<string, unknown>>;
      await fs.writeFile(
        path.join(agentDir, 'agent-aprobe-bravo-babf58016882bc72.meta.json'),
        JSON.stringify(sidecars.find((s) => s.name === 'probe-bravo')),
      );

      const hit = await waitFor(() => {
        const found = of(store.replay(), 'transcript')
          .map((e) => e.payload as TranscriptPayload)
          .find((p) => p.agent === 'probe-bravo');
        return found;
      });
      expect(hit.records[0].uuid).toBe('live-uuid');
    } finally {
      ingest.close();
    }
  });

  it('fails CLOSED on sidecars while the team is unresolved — no cross-team leak', async () => {
    // No config.json anywhere under paths.teams: the team is genuinely
    // unknown, exactly the window between the launcher announcing a team and
    // that team's config.json being written. Two sidecars from two different
    // teams sit under paths.projects, as they would if another session's
    // teammates happened to be running on the same machine.
    const ourDir = path.join(paths.projects, SLUG, LEAD_SESSION, 'subagents');
    await fs.mkdir(ourDir, { recursive: true });
    await fs.writeFile(
      path.join(ourDir, 'agent-aprobe-alpha-1111111111111111.meta.json'),
      JSON.stringify({
        agentType: 'probe-alpha',
        description: 'ours',
        name: 'probe-alpha',
        spawnDepth: 0,
        model: 'claude-opus-5',
        taskKind: 'in_process_teammate',
        teamName: TEAM,
      }),
    );
    const otherDir = path.join(paths.projects, `${SLUG}-other`, 'other-session', 'subagents');
    await fs.mkdir(otherDir, { recursive: true });
    await fs.writeFile(
      path.join(otherDir, 'agent-astray-agent-2222222222222222.meta.json'),
      JSON.stringify({
        agentType: 'stray-agent',
        description: 'a different session entirely',
        name: 'stray-agent',
        spawnDepth: 0,
        model: 'claude-opus-5',
        taskKind: 'in_process_teammate',
        teamName: 'session-5cd370e5',
      }),
    );

    const ingest = startFileIngest(store, { paths, sweepIntervalMs: 0 });
    try {
      await settle();
      await ingest.sweep();
    } finally {
      ingest.close();
    }

    const roster = of(store.replay(), 'roster').at(-1)?.payload as RosterPayload | undefined;
    expect(roster?.sidecars ?? []).toHaveLength(0);
    expect(project(store.replay(), false).agents).toHaveLength(0);
  });

  it('still adopts a sidecar it had to reject for want of a team, once config.json lands', async () => {
    // The same unresolved-team window as the test above, but this time our own
    // config.json arrives afterwards. A sidecar read in that window is rejected
    // because the team is unknown, not on its own merits — and its mtime is
    // recorded either way, so the sweep's gate will never offer the file again.
    // Sidecars are written once and never touched, so this read is the only
    // chance there is: dropping it strands the teammate for the whole run.
    const ourDir = path.join(paths.projects, SLUG, LEAD_SESSION, 'subagents');
    await fs.mkdir(ourDir, { recursive: true });
    const sidecars = JSON.parse(
      await fs.readFile(path.join(FIXTURES, 'meta-sidecars.json'), 'utf8'),
    ) as Array<Record<string, unknown>>;
    await fs.writeFile(
      path.join(ourDir, 'agent-aprobe-charlie-12ee4cb1ed35cf7c.meta.json'),
      JSON.stringify(sidecars.find((s) => s.name === 'probe-charlie')),
    );

    const ingest = startFileIngest(store, { paths, sweepIntervalMs: 0 });
    try {
      // Let any watcher delivery for that sidecar land while the team is still
      // unknown, so the sweep below is not the only reader that saw it.
      await settle();
      await ingest.sweep();
      const before = of(store.replay(), 'roster').at(-1)?.payload as RosterPayload | undefined;
      expect(before?.sidecars ?? []).toHaveLength(0);

      await fs.mkdir(path.join(paths.teams, TEAM), { recursive: true });
      await fs.copyFile(
        path.join(FIXTURES, 'config-4-members.json'),
        path.join(paths.teams, TEAM, 'config.json'),
      );
      await ingest.sweep();
    } finally {
      ingest.close();
    }

    const roster = of(store.replay(), 'roster').at(-1)!.payload as RosterPayload;
    expect(roster.config!.name).toBe(TEAM);
    expect(roster.sidecars.map((s) => s.meta.name)).toEqual(['probe-charlie']);
  });
});

describe('transcript latency', () => {
  const recordsFor = (agent: string) =>
    of(store.replay(), 'transcript')
      .map((e) => e.payload as TranscriptPayload)
      .filter((p) => p.agent === agent)
      .flatMap((p) => p.records);

  const leadTranscript = () => path.join(paths.projects, SLUG, `${LEAD_SESSION}.jsonl`);
  const charlieTranscript = () =>
    path.join(paths.projects, SLUG, LEAD_SESSION, 'subagents', 'agent-aprobe-charlie-12ee4cb1ed35cf7c.jsonl');

  // Starts the ingest with paths.projects DELETED, so watchRoot degrades to a
  // no-op and no fs.watch on the transcript tree exists at all — the exact
  // stand-in for an FSEvents delivery that never arrives, which is the case the
  // sweep alone used to cover at up to five seconds' latency.
  const startWithoutFsWatch = async (over: { sweepIntervalMs: number; tailPollMs: number }) => {
    await fs.rm(paths.projects, { recursive: true, force: true });
    return startFileIngest(store, {
      paths,
      teamName: TEAM,
      leadSessionId: LEAD_SESSION,
      leadName: 'team-lead',
      ...over,
    });
  };

  const write = async (file: string, uuid: string, type = 'assistant') => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify({ type, uuid, timestamp: new Date().toISOString() })}\n`);
  };

  it('delivers a transcript line within the tail poll when fs.watch never fires', async () => {
    const ingest = await startWithoutFsWatch({ sweepIntervalMs: 60_000, tailPollMs: 50 });
    try {
      await write(leadTranscript(), 'poll-1');
      await ingest.sweep(); // discovery, as at boot: registers the lead's transcript
      expect(recordsFor('team-lead').map((r) => r.uuid)).toEqual(['poll-1']);

      await write(leadTranscript(), 'poll-2');
      // The next sweep is a minute away and there is no watcher, so only the
      // tail poll can land this.
      const hit = await waitFor(
        () => recordsFor('team-lead').find((r) => r.uuid === 'poll-2'),
        3000,
      );
      expect(hit.uuid).toBe('poll-2');
    } finally {
      ingest.close();
    }
  });

  it('drainAgent reads that agent transcript immediately, with no sweep and no poll', async () => {
    const ingest = await startWithoutFsWatch({ sweepIntervalMs: 0, tailPollMs: 0 });
    try {
      await layout();
      await ingest.sweep();
      const before = recordsFor('probe-charlie').length;
      expect(before).toBeGreaterThan(0);

      await write(charlieTranscript(), 'hook-1');
      await ingest.drainAgent('probe-charlie');
      expect(recordsFor('probe-charlie')).toHaveLength(before + 1);
      expect(recordsFor('probe-charlie').at(-1)!.uuid).toBe('hook-1');
    } finally {
      ingest.close();
    }
  });

  it('drainAgent resolves the LEAD own transcript, which is never in sidecars', async () => {
    const ingest = await startWithoutFsWatch({ sweepIntervalMs: 0, tailPollMs: 0 });
    try {
      await write(leadTranscript(), 'lead-1');
      await ingest.sweep();
      expect(recordsFor('team-lead').map((r) => r.uuid)).toEqual(['lead-1']);

      await write(leadTranscript(), 'lead-2', 'user');
      await ingest.drainAgent('team-lead');
      expect(recordsFor('team-lead').map((r) => r.uuid)).toEqual(['lead-1', 'lead-2']);
    } finally {
      ingest.close();
    }
  });

  it('drainAgent for an unknown agent appends nothing and does not throw', async () => {
    const ingest = await startWithoutFsWatch({ sweepIntervalMs: 0, tailPollMs: 0 });
    try {
      await expect(ingest.drainAgent('nobody')).resolves.toBeUndefined();
      expect(store.replay()).toHaveLength(0);
    } finally {
      ingest.close();
    }
  });

  it('appends each record exactly once with the watcher, the sweep and the poll all live', async () => {
    await fs.mkdir(path.join(paths.projects, SLUG), { recursive: true });
    const ingest = startFileIngest(store, {
      paths,
      teamName: TEAM,
      leadSessionId: LEAD_SESSION,
      leadName: 'team-lead',
      sweepIntervalMs: 100,
      tailPollMs: 50,
    });
    try {
      await settle();
      await ingest.sweep();

      const total = 150;
      for (let i = 0; i < total; i++) {
        await write(leadTranscript(), `once-${i}`);
        await new Promise((r) => setTimeout(r, 8));
      }
      await waitFor(() => (recordsFor('team-lead').length >= total ? true : undefined));
      await settle();

      const uuids = recordsFor('team-lead').map((r) => r.uuid);
      expect(new Set(uuids).size).toBe(total);
      expect(uuids).toHaveLength(total);
    } finally {
      ingest.close();
    }
  });

  it('close clears both the sweep timer and the poll timer', () => {
    // The behavioural test below cannot see this on its own: close() also stops
    // the shared tail state, so a leaked interval would keep firing without
    // appending anything and nothing on screen would say so.
    vi.useFakeTimers();
    try {
      const ingest = startFileIngest(store, { paths, sweepIntervalMs: 50, tailPollMs: 50 });
      expect(vi.getTimerCount()).toBe(2);
      ingest.close();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('appends nothing more once closed', async () => {
    const ingest = await startWithoutFsWatch({ sweepIntervalMs: 50, tailPollMs: 50 });
    try {
      await write(leadTranscript(), 'before-close');
      await waitFor(() => recordsFor('team-lead').find((r) => r.uuid === 'before-close'), 3000);
    } finally {
      ingest.close();
    }

    const after = store.replay().length;
    await write(leadTranscript(), 'after-close');
    await settle(500);
    expect(store.replay()).toHaveLength(after);
  });
});

// A boot re-reads a whole transcript in one drain — measured at 2,630 records
// for the largest real file — so the ingest splits it into events the store can
// bound by record count, and carries the agent's cumulative spend on the last
// one so trimming records can never move the money.
describe('transcript batching', () => {
  const leadTranscript = () => path.join(paths.projects, SLUG, `${LEAD_SESSION}.jsonl`);

  const assistant = (i: number) => ({
    type: 'assistant',
    uuid: `rec-${i}`,
    timestamp: new Date(1787843400000 + i * 1000).toISOString(),
    message: {
      id: `msg_${i}`,
      model: 'claude-sonnet-4-5-20250929',
      role: 'assistant',
      usage: {
        input_tokens: 4,
        output_tokens: 100 + (i % 37),
        cache_read_input_tokens: 20000 + i,
        cache_creation_input_tokens: 500,
      },
      content: [{ type: 'text', text: `turn ${i}` }],
    },
  });

  const startLead = () =>
    startFileIngest(store, {
      paths,
      teamName: TEAM,
      leadSessionId: LEAD_SESSION,
      leadName: 'team-lead',
      sweepIntervalMs: 0,
      tailPollMs: 0,
    });

  it('splits one drain into batches, marking only the first and only the last', async () => {
    const records = Array.from({ length: 450 }, (_, i) => assistant(i));
    await fs.mkdir(path.join(paths.projects, SLUG), { recursive: true });
    await fs.writeFile(leadTranscript(), records.map((r) => JSON.stringify(r)).join('\n') + '\n');

    const ingest = startLead();
    try {
      await ingest.sweep();
    } finally {
      ingest.close();
    }

    const events = of(store.replay(), 'transcript');
    expect(events).toHaveLength(Math.ceil(450 / INGEST_BATCH_RECORDS));
    const payloads = events.map((e) => e.payload as TranscriptPayload);
    expect(payloads.map((p) => p.records.length)).toEqual([200, 200, 50]);
    expect(payloads.map((p) => p.fromStart === true)).toEqual([true, false, false]);
    expect(payloads.map((p) => p.totals !== undefined)).toEqual([false, false, true]);
    // Reassembled, the batches are the file, in file order.
    expect(payloads.flatMap((p) => p.records.map((r) => r.uuid))).toEqual(records.map((r) => r.uuid));

    const expected = dedupeUsage(usageRecordsOf(records));
    expect(payloads.at(-1)!.totals!.costUsd).toBeCloseTo(totalCost(expected), 12);
    expect(payloads.at(-1)!.totals!.tokens).toBe(tokensOf(expected));
  });

  // The pending buffer is capped, so a teammate whose sidecar lands late loses
  // the front of its transcript. The records are gone from the store either way
  // — but the money must not be, or a slow sidecar silently discounts the team.
  it("keeps an agent's whole spend when the pending buffer drops the front of it", async () => {
    const records = Array.from({ length: 600 }, (_, i) => assistant(i));
    const agentDir = path.join(paths.projects, SLUG, LEAD_SESSION, 'subagents');
    await fs.mkdir(agentDir, { recursive: true });
    const stem = 'agent-alate-3333333333333333';
    await fs.writeFile(
      path.join(agentDir, `${stem}.jsonl`),
      records.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );

    const ingest = startLead();
    try {
      await ingest.sweep();
      expect(of(store.replay(), 'transcript')).toHaveLength(0);

      await fs.writeFile(
        path.join(agentDir, `${stem}.meta.json`),
        JSON.stringify({
          name: 'late',
          agentType: 'late',
          description: 'a teammate whose sidecar was slow',
          spawnDepth: 0,
          model: 'claude-opus-5',
          taskKind: 'in_process_teammate',
          teamName: TEAM,
        }),
      );
      await ingest.sweep();

      const stored = of(store.replay(), 'transcript').map((e) => e.payload as TranscriptPayload);
      expect(stored.length).toBeGreaterThan(0);
      const kept = stored.reduce((n, p) => n + p.records.length, 0);
      expect(kept).toBeLessThan(records.length);
      expect(stored.at(-1)!.totals!.costUsd).toBeCloseTo(
        totalCost(dedupeUsage(usageRecordsOf(records))),
        12,
      );
    } finally {
      ingest.close();
    }
  });

  it('reports the same cumulative spend when the same file is read again from byte 0', async () => {
    const raw = await fs.readFile(
      path.join(FIXTURES, 'transcript-agent-aprobe-alpha-84fd551b27de6433.jsonl'),
      'utf8',
    );
    const records = raw
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as TranscriptRecord);
    await fs.mkdir(path.join(paths.projects, SLUG), { recursive: true });
    await fs.writeFile(leadTranscript(), raw);

    const ingest = startLead();
    try {
      await ingest.sweep();
      const first = of(store.replay(), 'transcript');
      expect(first).toHaveLength(1);
      const truth = totalCost(dedupeUsage(usageRecordsOf(records)));
      expect((first[0].payload as TranscriptPayload).totals!.costUsd).toBeCloseTo(truth, 12);

      // A console restart loses the tail offset, so the whole file is read
      // again. The snapshot is cumulative, so it must not double.
      await fs.rm(leadTranscript());
      await fs.writeFile(leadTranscript(), raw);
      await ingest.drainAgent('team-lead');

      const all = of(store.replay(), 'transcript');
      expect(all.length).toBeGreaterThan(1);
      const reread = all.at(-1)!.payload as TranscriptPayload;
      expect(reread.fromStart).toBe(true);
      expect(reread.totals!.costUsd).toBeCloseTo(truth, 12);
    } finally {
      ingest.close();
    }
  });
});
