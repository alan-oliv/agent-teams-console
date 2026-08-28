import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, type Store, type StoredEvent } from '../store';
import {
  startFileIngest,
  agentOfTranscript,
  INGEST_BATCH_RECORDS,
  PENDING_RECORDS,
  type IngestPaths,
  type FileIngest,
} from './files';
import { dedupeUsage, tokensOf, totalCost, usageRecordsOf } from '../../shared/usage';
import { buildRoster } from '../../shared/roster';
import type { TranscriptRecord } from '../../shared/transcript';
import { project } from '../project';
import type { Agent } from '../../shared/domain';
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

// /branch moves the user's live conversation to a new session id without ever
// touching config.json, so the console has to accept more than one session as
// "the lead" — every session in the fork chain, not just the one config.json
// still names. See growForkChain in files.ts.
describe('agentOfTranscript with a lead session CHAIN', () => {
  const FORK_SESSION = '34d7d450-b74c-48d0-b909-a80188bf3387';
  const FOREIGN_SESSION = '5cd370e5-2d86-4b64-878e-095f726aea82';
  const chain = new Set([LEAD_SESSION, FORK_SESSION]);

  it('maps EITHER session in the chain to the lead name', () => {
    expect(agentOfTranscript(`/a/${LEAD_SESSION}.jsonl`, chain, 'team-lead')).toBe('team-lead');
    expect(agentOfTranscript(`/a/${FORK_SESSION}.jsonl`, chain, 'team-lead')).toBe('team-lead');
  });

  it('attributes a teammate spawned under the forked session, not just the original', () => {
    const f = `/a/${FORK_SESSION}/subagents/agent-anewmate-1111111111111111.jsonl`;
    expect(agentOfTranscript(f, chain, 'team-lead')).toBe('newmate');
  });

  it('still REJECTS a session that is not in the chain at all', () => {
    expect(agentOfTranscript(`/a/${FOREIGN_SESSION}.jsonl`, chain, 'team-lead')).toBeNull();
    const f = `/a/${FOREIGN_SESSION}/subagents/agent-astranger-2222222222222222.jsonl`;
    expect(agentOfTranscript(f, chain, 'team-lead')).toBeNull();
  });

  it('treats an empty chain exactly like an unresolved leadSessionId', () => {
    // The unresolved-team window (see the cross-team leak tests below) relies
    // on `undefined` and "known but empty" behaving identically: both must
    // fall back to an UNSCOPED claim on the bare name for a subagent file, and
    // both must refuse to claim any bare session transcript as the lead's.
    const empty = new Set<string>();
    const subagent = `/a/${LEAD_SESSION}/subagents/agent-aworker-1111111111111111.jsonl`;
    expect(agentOfTranscript(subagent, empty, 'team-lead')).toBe(
      agentOfTranscript(subagent, undefined, 'team-lead'),
    );
    expect(agentOfTranscript(`/a/${LEAD_SESSION}.jsonl`, empty, 'team-lead')).toBeNull();
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

// A NAME is not unique across teams: one ordinary machine holds 166 sidecars
// carrying 13 teammate names over two sessions, and a second run of the same
// workflow reuses them. So nothing keyed on a bare name may be dropped or
// credited on a stranger's say-so — the transcript FILE is the identity.
describe('a stranger that shares a teammate name', () => {
  const OTHER_SLUG = `${SLUG}-other`;
  const OTHER_SESSION = '5cd370e5-2d86-4b64-878e-095f726aea82';
  const ourDir = () => path.join(paths.projects, SLUG, LEAD_SESSION, 'subagents');
  const theirDir = () => path.join(paths.projects, OTHER_SLUG, OTHER_SESSION, 'subagents');
  const stem = 'agent-atwin-1111111111111111';

  const assistant = (i: number) => ({
    type: 'assistant',
    uuid: `twin-${i}`,
    timestamp: new Date(1787843400000 + i * 1000).toISOString(),
    message: {
      id: `msg_twin_${i}`,
      model: 'claude-sonnet-4-5-20250929',
      role: 'assistant',
      usage: {
        input_tokens: 4,
        output_tokens: 100,
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 500,
      },
      content: [{ type: 'text', text: `turn ${i}` }],
    },
  });

  const sidecar = (name: string, teamName: string, taskKind: string) =>
    JSON.stringify({
      name,
      agentType: name,
      description: 'd',
      spawnDepth: 0,
      model: 'claude-sonnet-4-5-20250929',
      taskKind,
      teamName,
    });

  const write = (dir: string, file: string, records: unknown[]) =>
    fs.writeFile(path.join(dir, file), records.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const start = () =>
    startFileIngest(store, {
      paths,
      teamName: TEAM,
      leadSessionId: LEAD_SESSION,
      leadName: 'team-lead',
      sweepIntervalMs: 0,
      tailPollMs: 0,
    });

  const storedTotals = () =>
    of(store.replay(), 'transcript')
      .map((e) => e.payload as TranscriptPayload)
      .filter((p) => p.agent === 'twin' && p.totals)
      .at(-1)!.totals!;

  const storedRecords = () =>
    of(store.replay(), 'transcript').reduce(
      (n, e) => n + (e.payload as TranscriptPayload).records.length,
      0,
    );

  beforeEach(async () => {
    await fs.mkdir(ourDir(), { recursive: true });
    await fs.mkdir(theirDir(), { recursive: true });
    await fs.mkdir(path.join(paths.teams, TEAM), { recursive: true });
    await fs.copyFile(
      path.join(FIXTURES, 'config-4-members.json'),
      path.join(paths.teams, TEAM, 'config.json'),
    );
  });

  // Phased sweeps on purpose: one sweep over a pre-laid tree decides nothing,
  // because walk()'s ordering puts `<slug>-other` before `<slug>` and the
  // stranger would be judged before our own lines were ever read.
  it("does not empty a teammate's spend", async () => {
    const records = Array.from({ length: 40 }, (_, i) => assistant(i));
    await write(ourDir(), `${stem}.jsonl`, records);
    await fs.writeFile(
      path.join(ourDir(), `${stem}.meta.json`),
      sidecar('twin', TEAM, 'in_process_teammate'),
    );

    const ingest = start();
    try {
      await ingest.sweep(); // our teammate, running normally

      await fs.writeFile(
        path.join(theirDir(), 'agent-atwin-2222222222222222.meta.json'),
        sidecar('twin', 'session-5cd370e5', 'in_process_teammate'),
      );
      await fs.writeFile(
        path.join(theirDir(), 'agent-atwin-3333333333333333.meta.json'),
        sidecar('twin', TEAM, 'subagent'),
      );
      await ingest.sweep(); // both strangers are discovered

      const all = Array.from({ length: 42 }, (_, i) => assistant(i));
      await fs.appendFile(
        path.join(ourDir(), `${stem}.jsonl`),
        all
          .slice(40)
          .map((r) => JSON.stringify(r))
          .join('\n') + '\n',
      );
      await ingest.sweep(); // and our teammate says one more thing

      expect(storedTotals().costUsd).toBeCloseTo(totalCost(dedupeUsage(usageRecordsOf(all))), 12);
    } finally {
      ingest.close();
    }
  });

  it("does not drop a teammate's buffered lines", async () => {
    await write(
      ourDir(),
      `${stem}.jsonl`,
      Array.from({ length: 40 }, (_, i) => assistant(i)),
    );

    const ingest = start();
    try {
      await ingest.sweep(); // buffered: our own sidecar has not landed yet
      expect(of(store.replay(), 'transcript')).toHaveLength(0);

      await fs.writeFile(
        path.join(theirDir(), 'agent-atwin-2222222222222222.meta.json'),
        sidecar('twin', 'session-5cd370e5', 'in_process_teammate'),
      );
      await ingest.sweep(); // a stranger of the same name is discovered

      await fs.writeFile(
        path.join(ourDir(), `${stem}.meta.json`),
        sidecar('twin', TEAM, 'in_process_teammate'),
      );
      await ingest.sweep(); // and only now does our own sidecar land

      expect(storedRecords()).toBe(40);
    } finally {
      ingest.close();
    }
  });

  it("does not credit a stranger's spend to a teammate read before config.json landed", async () => {
    // The launcher starts the console before the team exists, so the boot sweep
    // runs with no leadSessionId and every subagent transcript on the machine is
    // attributable by its bare name.
    await write(
      theirDir(),
      'agent-atwin-2222222222222222.jsonl',
      Array.from({ length: 40 }, (_, i) => assistant(i)),
    );
    await fs.rm(path.join(paths.teams, TEAM, 'config.json'));

    const ingest = startFileIngest(store, { paths, sweepIntervalMs: 0, tailPollMs: 0 });
    try {
      await ingest.sweep();

      await fs.copyFile(
        path.join(FIXTURES, 'config-4-members.json'),
        path.join(paths.teams, TEAM, 'config.json'),
      );
      const ours = [assistant(100), assistant(101)];
      await write(ourDir(), `${stem}.jsonl`, ours);
      await fs.writeFile(
        path.join(ourDir(), `${stem}.meta.json`),
        sidecar('twin', TEAM, 'in_process_teammate'),
      );
      await ingest.sweep();

      expect(storedTotals().costUsd).toBeCloseTo(totalCost(dedupeUsage(usageRecordsOf(ours))), 12);
      expect(storedRecords()).toBe(2);
    } finally {
      ingest.close();
    }
  });
  // The scope rule is what keeps a stranger off the console at all, and keying
  // the buffers by file must tighten it, never relax it.
  it('never puts a foreign agent in the roster or its spend in the team total', async () => {
    const ours = [assistant(100), assistant(101)];
    await write(ourDir(), `${stem}.jsonl`, ours);
    await fs.writeFile(
      path.join(ourDir(), `${stem}.meta.json`),
      sidecar('twin', TEAM, 'in_process_teammate'),
    );
    const theirs = Array.from({ length: 40 }, (_, i) => assistant(i));
    await write(theirDir(), 'agent-atwin-2222222222222222.jsonl', theirs);
    await fs.writeFile(
      path.join(theirDir(), 'agent-atwin-2222222222222222.meta.json'),
      sidecar('twin', 'session-5cd370e5', 'in_process_teammate'),
    );
    await write(theirDir(), 'agent-aghost-4444444444444444.jsonl', theirs);
    await fs.writeFile(
      path.join(theirDir(), 'agent-aghost-4444444444444444.meta.json'),
      sidecar('ghost', 'session-5cd370e5', 'in_process_teammate'),
    );

    const ingest = start();
    try {
      await ingest.sweep();
      await ingest.sweep();
    } finally {
      ingest.close();
    }

    const state = project(store.replay(), false);
    expect(state.agents.map((a) => a.name)).toEqual([
      'team-lead',
      'probe-alpha',
      'probe-bravo',
      'probe-charlie',
      'twin',
    ]);
    const truth = totalCost(dedupeUsage(usageRecordsOf(ours)));
    expect(state.agents.find((a) => a.name === 'twin')!.costUsd).toBeCloseTo(truth, 12);
    expect(state.totalCostUsd!).toBeCloseTo(truth, 12);
    expect(storedRecords()).toBe(ours.length);
  });
});

// A NAME is not a key. The same ordinary machine that holds 13 teammate names
// holds 165 sidecars carrying them, spread over several sessions, and a respawn
// reuses the name again inside one session. The only thing that names ONE RUN is
// its transcript FILE, so admission, ownership and the pump target are keyed on
// the file here — and a name that has nothing to check it against is a claim,
// not a proof.
describe('a transcript FILE is the identity, not the name it carries', () => {
  const FOREIGN_SESSION = 'ffffffff-0000-0000-0000-000000000000';
  const ourDir = () => path.join(paths.projects, SLUG, LEAD_SESSION, 'subagents');
  const foreignDir = () => path.join(paths.projects, SLUG, FOREIGN_SESSION, 'subagents');
  const leadTranscript = () => path.join(paths.projects, SLUG, `${LEAD_SESSION}.jsonl`);
  const jsonl = (hex: string, name = 'worker') => path.join(ourDir(), `agent-a${name}-${hex}.jsonl`);
  const meta = (hex: string, name = 'worker') => path.join(ourDir(), `agent-a${name}-${hex}.meta.json`);

  // 1,000 in / 1,000 out / 5,000 cache read / 500 cache write on claude-opus-5
  // is exactly $0.035625 and 2,500 tokens a record — the shape round 4's
  // reproduction was measured on, so its numbers are reproducible to the digit.
  const rec = (i: number, tag: string) => ({
    type: 'assistant',
    uuid: `${tag}-${i}`,
    isSidechain: true,
    timestamp: new Date(1787843382976 + i * 1000).toISOString(),
    message: {
      id: `${tag}-msg-${i}`,
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'text', text: `${tag} ${i}` }],
      usage: {
        input_tokens: 1000,
        output_tokens: 1000,
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 500,
      },
    },
  });
  const many = (n: number, tag: string, from = 0) =>
    Array.from({ length: n }, (_, i) => rec(from + i, tag));

  const sidecar = (name: string, taskKind = 'in_process_teammate', teamName = TEAM) =>
    JSON.stringify({
      agentType: name,
      description: `desc ${name}`,
      name,
      spawnDepth: 0,
      model: 'claude-opus-5',
      taskKind,
      teamName,
    });

  const write = (file: string, records: unknown[]) =>
    fs.writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const append = (file: string, records: unknown[]) =>
    fs.appendFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const writeConfig = () =>
    fs.writeFile(
      path.join(paths.teams, TEAM, 'config.json'),
      JSON.stringify({
        name: TEAM,
        createdAt: 1787798107581,
        leadAgentId: `team-lead@${TEAM}`,
        leadSessionId: LEAD_SESSION,
        members: [
          { agentId: `team-lead@${TEAM}`, name: 'team-lead', joinedAt: 1, tmuxPaneId: 'lead', subscriptions: [] },
          { agentId: `worker@${TEAM}`, name: 'worker', joinedAt: 2, tmuxPaneId: 'in-process', subscriptions: [], model: 'claude-opus-5' },
        ],
      }),
    );

  const costOf = (records: unknown[]) =>
    totalCost(dedupeUsage(usageRecordsOf(records as TranscriptRecord[])));
  const worker = () => project(store.replay(), false).agents.find((a) => a.name === 'worker')!;
  const storedRecords = () =>
    of(store.replay(), 'transcript').reduce(
      (n, e) => n + (e.payload as TranscriptPayload).records.length,
      0,
    );

  const start = (over: { teamName?: string; leadSessionId?: string } = {}) =>
    startFileIngest(store, {
      paths,
      teamName: TEAM,
      leadSessionId: LEAD_SESSION,
      leadName: 'team-lead',
      sweepIntervalMs: 0,
      tailPollMs: 0,
      ...over,
    });

  // fs.watch cannot register on a root that is not there, so hiding `projects`
  // across startFileIngest degrades the transcript watcher to sweep-only. What
  // is under test here is which file the ingest DECIDES to read; a live FSEvents
  // delivery reads the same files by another route and masks the decision.
  const startSweepOnly = async (over: { teamName?: string; leadSessionId?: string } = {}) => {
    const hidden = `${paths.projects}.hidden`;
    await fs.rename(paths.projects, hidden);
    const ingest = start(over);
    await fs.rename(hidden, paths.projects);
    return ingest;
  };

  beforeEach(async () => {
    await fs.mkdir(ourDir(), { recursive: true });
    await fs.mkdir(path.join(paths.teams, TEAM), { recursive: true });
    await writeConfig();
  });

  // Round 4's IMPORTANT, to the digit: a non-teammate transcript in OUR lead
  // session's subagents directory under a teammate's name was admitted on
  // `sidecars.has('worker')` and its whole spend billed to the teammate —
  // costUsd 4.274999999999999 against a truth of 3.5625000000000013 (+20.0%),
  // totalTokens 302500 against 252500, and 20 of the 60 drawn lines the
  // stranger's.
  it('never bills a teammate for a stranger transcript that shares its name', async () => {
    const ours = many(100, 'OURS');
    const lead = many(1, 'LEAD');
    await write(jsonl('2222222222222222'), ours);
    await fs.writeFile(meta('2222222222222222'), sidecar('worker'));
    await write(jsonl('1111111111111111'), many(20, 'STRANGER'));
    await fs.writeFile(meta('1111111111111111'), sidecar('worker', 'subagent'));
    await write(leadTranscript(), lead);

    const ingest = await startSweepOnly();
    try {
      await ingest.sweep();
      await settle(20);
      await append(jsonl('1111111111111111'), many(20, 'STRANGER', 20));
      await ingest.sweep();
    } finally {
      ingest.close();
    }

    const state = project(store.replay(), false);
    const w = state.agents.find((a) => a.name === 'worker')!;
    expect(w.costUsd).toBeCloseTo(costOf(ours), 12);
    expect(state.totalCostUsd!).toBeCloseTo(costOf(ours) + costOf(lead), 12);
    expect(state.totalTokens).toBe(252_500);
    expect(w.transcript.filter((l) => l.text.includes('STRANGER'))).toHaveLength(0);
    expect(w.transcript).toHaveLength(60);
    expect(w.transcript.at(-1)!.text).toBe('OURS 99');
  });

  // The other read ordering, which is worse: our sidecar is accepted first, so
  // the stranger's very first batch arrives as `fromStart` under the teammate's
  // name and the fold's clear DESTROYS the teammate's stored transcript — and
  // with one slot per name in transcriptPaths, drainAgent then pumps the
  // stranger and the teammate's cost freezes.
  it("keeps a teammate's transcript and cost when a stranger is read after its sidecar", async () => {
    const ours = many(100, 'OURS');
    await write(jsonl('0000000000000000'), ours);
    await fs.writeFile(meta('0000000000000000'), sidecar('worker'));
    await write(jsonl('1111111111111111'), many(20, 'STRANGER'));
    await fs.writeFile(meta('1111111111111111'), sidecar('worker', 'subagent'));

    const ingest = await startSweepOnly();
    try {
      await ingest.sweep();
      await settle(20);
      await append(jsonl('0000000000000000'), many(1, 'OURS', 100));
      await ingest.drainAgent('worker');
    } finally {
      ingest.close();
    }

    const w = worker();
    expect(w.transcript.filter((l) => l.text.includes('STRANGER'))).toHaveLength(0);
    expect(w.transcript).toHaveLength(60);
    expect(w.transcript.at(-1)!.text).toBe('OURS 100');
    expect(w.costUsd).toBeCloseTo(costOf([...ours, ...many(1, 'OURS', 100)]), 12);
  });

  // A respawn gives one name two transcript files. drainAgent is the
  // hook-triggered pull, and pollTails reads the same map, so one slot per name
  // sends both at the dead run and reverts the live one to the 5s sweep.
  it('pumps every transcript file an agent owns, not just the last one seen', async () => {
    await write(jsonl('ffffffffffffffff'), many(10, 'DEAD'));
    await fs.writeFile(meta('ffffffffffffffff'), sidecar('worker'));
    await write(jsonl('aaaaaaaaaaaaaaaa'), many(10, 'LIVE'));
    await fs.writeFile(meta('aaaaaaaaaaaaaaaa'), sidecar('worker'));

    const ingest = await startSweepOnly();
    try {
      await ingest.sweep();
      // Neither run's first read may clear the other's stored records.
      expect(worker().transcript).toHaveLength(20);

      await settle(20);
      await append(jsonl('aaaaaaaaaaaaaaaa'), many(1, 'LIVE', 100));
      await ingest.drainAgent('worker');
      expect(worker().transcript.some((l) => l.text === 'LIVE 100')).toBe(true);
    } finally {
      ingest.close();
    }
  });

  it('shows two runs of one name as one agent carrying both transcripts', async () => {
    await write(jsonl('ffffffffffffffff'), many(10, 'DEAD'));
    await fs.writeFile(meta('ffffffffffffffff'), sidecar('worker'));
    await write(jsonl('aaaaaaaaaaaaaaaa'), many(10, 'LIVE'));
    await fs.writeFile(meta('aaaaaaaaaaaaaaaa'), sidecar('worker'));

    const ingest = await startSweepOnly();
    try {
      await ingest.sweep();
    } finally {
      ingest.close();
    }

    const roster = of(store.replay(), 'roster').at(-1)!.payload as RosterPayload;
    // One row per accepted FILE on the wire; buildRoster collapses them by name.
    expect(roster.sidecars).toHaveLength(2);
    expect(buildRoster(roster.config, roster.sidecars).filter((a) => a.name === 'worker')).toHaveLength(1);
    const state = project(store.replay(), false);
    expect(state.agents.map((a) => a.name)).toEqual(['team-lead', 'worker']);
    expect(state.agents.find((a) => a.name === 'worker')!.transcript).toHaveLength(20);
  });

  // currentTool and error are last-arrival-wins, so the order two runs are read
  // in is not cosmetic: a dead run read last puts its final tool call and its
  // failure on a live agent.
  it('lets the newest run decide currentTool and status when two runs disagree', async () => {
    const dead = [
      { type: 'assistant', uuid: 'd1', timestamp: '2026-08-27T10:00:00.000Z', message: { id: 'dm1', role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'dead 1' }], usage: { input_tokens: 1, output_tokens: 1 } } },
      { type: 'assistant', uuid: 'd2', timestamp: '2026-08-27T10:00:01.000Z', message: { id: 'dm2', role: 'assistant', model: 'claude-opus-5', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'rm -rf /dead' } }], usage: { input_tokens: 1, output_tokens: 1 } } },
      { type: 'assistant', uuid: 'd3', isApiErrorMessage: true, timestamp: '2026-08-27T10:00:02.000Z', message: { id: 'dm3', role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'API Error: overloaded' }], usage: { input_tokens: 1, output_tokens: 1 } } },
    ];
    const live = [
      { type: 'assistant', uuid: 'l1', timestamp: '2026-08-27T11:00:00.000Z', message: { id: 'lm1', role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'live 1' }], usage: { input_tokens: 1, output_tokens: 1 } } },
      { type: 'user', uuid: 'l2', timestamp: '2026-08-27T11:00:01.000Z', toolUseResult: { ok: true }, message: { role: 'user', content: 'done' } },
      { type: 'assistant', uuid: 'l3', timestamp: '2026-08-27T11:00:02.000Z', message: { id: 'lm3', role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'live 3' }], usage: { input_tokens: 1, output_tokens: 1 } } },
    ];
    await write(jsonl('ffffffffffffffff'), dead);
    await fs.writeFile(meta('ffffffffffffffff'), sidecar('worker'));
    await write(jsonl('aaaaaaaaaaaaaaaa'), live);
    await fs.writeFile(meta('aaaaaaaaaaaaaaaa'), sidecar('worker'));
    // The dead run sorts LAST by name and is OLDER by mtime: only the mtime
    // order can put the live run's records last.
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(jsonl('ffffffffffffffff'), old, old);

    const ingest = await startSweepOnly();
    try {
      await ingest.sweep();
    } finally {
      ingest.close();
    }

    const w = worker();
    expect(w.transcript).toHaveLength(6);
    expect(w.transcript.at(-1)!.text).toBe('live 3');
    expect(w.status).toBe('working');
    expect(w.currentTool).toBeUndefined();
    expect(w.error).toBeUndefined();
  });

  it('keeps another session sidecar off the roster even when it carries our team name', async () => {
    const ours = many(20, 'OURS');
    await write(jsonl('0000000000000000'), ours);
    await fs.writeFile(meta('0000000000000000'), sidecar('worker'));
    await fs.mkdir(foreignDir(), { recursive: true });
    await write(path.join(foreignDir(), 'agent-aghost-9999999999999999.jsonl'), many(20, 'GHOST'));
    await fs.writeFile(
      path.join(foreignDir(), 'agent-aghost-9999999999999999.meta.json'),
      sidecar('ghost'),
    );

    const ingest = await startSweepOnly();
    try {
      await ingest.sweep();
    } finally {
      ingest.close();
    }

    const state = project(store.replay(), false);
    expect(state.agents.map((a) => a.name)).toEqual(['team-lead', 'worker']);
    expect(state.agents.flatMap((a) => a.transcript).filter((l) => l.text.includes('GHOST'))).toHaveLength(0);
    expect(state.agents.find((a) => a.name === 'worker')!.costUsd).toBeCloseTo(costOf(ours), 12);
    expect(state.totalCostUsd!).toBeCloseTo(costOf(ours), 12);
    expect(state.totalTokens).toBe(50_000);
  });

  // The `--team`-before-config.json window: the launcher names the team on
  // PreToolUse, i.e. before the spawn that writes config.json, so leadSessionId
  // is unknown and a bare name is all any transcript has. Attributing on it puts
  // another session's records under our teammate and doubles its cost, and for a
  // teammate that then goes quiet the wrong snapshot is the newest one forever.
  it('discards a foreign transcript read before config.json and replays our own', async () => {
    await fs.rm(path.join(paths.teams, TEAM, 'config.json'));
    const ours = many(20, 'OURS');
    await write(jsonl('0000000000000000'), ours);
    await fs.writeFile(meta('0000000000000000'), sidecar('worker'));
    await fs.mkdir(foreignDir(), { recursive: true });
    await write(path.join(foreignDir(), 'agent-aworker-7777777777777777.jsonl'), many(20, 'FOREIGN'));

    const ingest = await startSweepOnly({ leadSessionId: undefined });
    try {
      await ingest.sweep();
      expect(of(store.replay(), 'transcript')).toHaveLength(0);

      // config.json lands and NOTHING else on disk is touched, so only the
      // held buffers can produce a transcript from here.
      await writeConfig();
      await settle(20);
      await ingest.sweep();
    } finally {
      ingest.close();
    }

    const state = project(store.replay(), false);
    const w = state.agents.find((a) => a.name === 'worker')!;
    expect(state.agents.flatMap((a) => a.transcript).filter((l) => l.text.includes('FOREIGN'))).toHaveLength(0);
    expect(w.transcript).toHaveLength(20);
    expect(w.costUsd).toBeCloseTo(costOf(ours), 12);
    expect(state.totalCostUsd!).toBeCloseTo(costOf(ours), 12);
    expect(state.totalTokens).toBe(50_000);
    expect(storedRecords()).toBe(20);
  });

  it('holds a teammate until config.json arrives, then replays it on the teams watcher', async () => {
    await fs.rm(path.join(paths.teams, TEAM, 'config.json'));
    const ours = many(20, 'OURS');
    await write(jsonl('0000000000000000'), ours);
    await fs.writeFile(meta('0000000000000000'), sidecar('worker'));

    const ingest = start({ leadSessionId: undefined });
    try {
      await ingest.sweep();
      // Nothing may be attributed on a name the directory check cannot test.
      expect(project(store.replay(), false).agents).toHaveLength(0);
      expect(of(store.replay(), 'transcript')).toHaveLength(0);

      // There is no sweep timer here, so only the teams watcher can land this.
      // FSEventStreamStart returns before the stream is armed and a write in
      // that window is never reported at all, so the stimulus is REWRITTEN
      // until it is seen: waiting longer cannot recover a dropped event. Same
      // argument as arming.testkit.ts, against the ingest's own watcher.
      let w: Agent | undefined;
      const deadline = Date.now() + 3000;
      do {
        await writeConfig();
        for (let i = 0; i < 8 && !w; i++) {
          await settle(25);
          w = project(store.replay(), false).agents.find((a) => a.name === 'worker');
        }
      } while (!w && Date.now() < deadline);

      expect(w!.transcript).toHaveLength(20);
      expect(w!.costUsd).toBeCloseTo(costOf(ours), 12);
    } finally {
      ingest.close();
    }
  });

  // The sweep drains transcripts AFTER its walk, so a sidecar's verdict normally
  // lands before its transcript is ever read — and a file proven not to be a
  // teammate's would then be buffered afresh on every append it makes, spending
  // a budget that belongs to real teammates whose sidecars are merely late.
  it("never lets a proven stranger's lines displace a teammate's buffered ones", async () => {
    const STRANGERS = 13;
    const hex = (i: number) => i.toString(16).padStart(16, '0');
    // Ours is written first, so it is both the oldest buffer and the first file
    // the mtime-ordered drain reads.
    await write(jsonl('0000000000000000'), many(40, 'OURS'));
    for (let i = 0; i < STRANGERS; i++) {
      await write(jsonl(hex(i), `zstr${i}`), many(600, `Z${i}`));
      await fs.writeFile(meta(hex(i), `zstr${i}`), sidecar(`zstr${i}`, 'subagent'));
    }

    const ingest = await startSweepOnly();
    try {
      await ingest.sweep();
      expect(of(store.replay(), 'transcript')).toHaveLength(0);

      // Our own sidecar finally lands — a median of 10.7 minutes after the
      // first transcript byte on this machine, which is why the buffer exists.
      await fs.writeFile(meta('0000000000000000'), sidecar('worker'));
      await ingest.sweep();
    } finally {
      ingest.close();
    }

    expect(worker().transcript).toHaveLength(40);
    expect(storedRecords()).toBe(40);
  });

  // The same displacement in the window before config.json. A teamName we
  // already have refuses a sidecar on its own — only the DIRECTORY half of the
  // test needs the lead session id — so a sidecar that is plainly another
  // team's must not be held, and must not carry its transcript's lines into the
  // budget with it.
  it('refuses another team sidecar before config.json rather than holding it', async () => {
    await fs.rm(path.join(paths.teams, TEAM, 'config.json'));
    const STRANGERS = 13;
    const hex = (i: number) => i.toString(16).padStart(16, '0');
    await write(jsonl('0000000000000000'), many(40, 'OURS'));
    await fs.writeFile(meta('0000000000000000'), sidecar('worker'));
    for (let i = 0; i < STRANGERS; i++) {
      await write(jsonl(hex(i), `zstr${i}`), many(600, `Z${i}`));
      await fs.writeFile(
        meta(hex(i), `zstr${i}`),
        sidecar(`zstr${i}`, 'in_process_teammate', 'session-5cd370e5'),
      );
    }

    const ingest = await startSweepOnly({ leadSessionId: undefined });
    try {
      await ingest.sweep();
      expect(of(store.replay(), 'transcript')).toHaveLength(0);

      await writeConfig();
      await settle(20);
      await ingest.sweep();
    } finally {
      ingest.close();
    }

    expect(worker().transcript).toHaveLength(40);
    expect(storedRecords()).toBe(40);
  });

  // PENDING_CAP is a per-FILE bound, and the number of files that can be held is
  // the number of subagent transcripts on the machine, not the size of the team:
  // 165 buffered files retained 309.7 MB of heap against 24.6 MB for 13 —
  // 12.6x = 165/13, the file-to-name ratio. PENDING_RECORDS is the bound that
  // does not move with the file count.
  it('bounds the pre-attribution buffers across files, not just per file', async () => {
    const FILES = 30;
    const hex = (i: number) => i.toString(16).padStart(16, '0');
    for (let i = 0; i < FILES; i++) {
      await write(jsonl(hex(i), `buf${i}`), many(600, `B${i}`));
    }

    const ingest = await startSweepOnly();
    try {
      await ingest.sweep();
      expect(of(store.replay(), 'transcript')).toHaveLength(0);

      for (let i = 0; i < FILES; i++) {
        await fs.writeFile(meta(hex(i), `buf${i}`), sidecar(`buf${i}`));
      }
      await ingest.sweep();
    } finally {
      ingest.close();
    }

    // Everything still held flushes the moment its sidecar lands, so what
    // reaches the store IS what the buffers were holding.
    expect(storedRecords()).toBeGreaterThan(0);
    expect(storedRecords()).toBeLessThanOrEqual(PENDING_RECORDS);
  });
});

// Claude Code's `/branch` moves the user's live conversation to a brand new
// session id but never touches config.json's leadSessionId — config.json
// keeps naming the ORIGINAL session forever. Confirmed live against a real
// 98b0b4a7 -> 34d7d450 pair: the forked session's first line carries
// `forkedFrom.sessionId` pointing at the original, and its own transcript is a
// full copy of every record before the fork (identical uuids) plus whatever
// came after. growForkChain in files.ts is what keeps the console's feed, and
// any teammate spawned after the branch, from going stale at the fork point.
describe('lead session chain (/branch)', () => {
  const FORK_SESSION = '34d7d450-b74c-48d0-b909-a80188bf3387';
  const FOREIGN_SESSION = '5cd370e5-2d86-4b64-878e-095f726aea82';

  const leadTranscript = () => path.join(paths.projects, SLUG, `${LEAD_SESSION}.jsonl`);
  const forkTranscript = () => path.join(paths.projects, SLUG, `${FORK_SESSION}.jsonl`);
  const foreignTranscript = () => path.join(paths.projects, SLUG, `${FOREIGN_SESSION}.jsonl`);
  const forkSubagentDir = () => path.join(paths.projects, SLUG, FORK_SESSION, 'subagents');
  const foreignSubagentDir = () => path.join(paths.projects, SLUG, FOREIGN_SESSION, 'subagents');

  const assistant = (tag: string, i: number, tsBase: number): TranscriptRecord => ({
    type: 'assistant',
    uuid: `${tag}-${i}`,
    timestamp: new Date(tsBase + i * 1000).toISOString(),
    message: {
      id: `msg-${tag}-${i}`,
      model: 'claude-opus-5',
      role: 'assistant',
      usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 },
      content: [{ type: 'text', text: `${tag} ${i}` }],
    },
  });

  // The real first line carries far more (attachment payload, cwd, version…),
  // but forkedFrom.sessionId is the only field growForkChain reads.
  const forkHeader = (parent: string) => ({
    parentUuid: null,
    isSidechain: false,
    type: 'attachment',
    uuid: 'fork-header',
    timestamp: new Date(1787843300000).toISOString(),
    forkedFrom: { sessionId: parent, messageUuid: 'whatever' },
  });

  const write = async (file: string, records: unknown[]) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  };

  const sidecar = (name: string, teamName: string) => ({
    agentType: name,
    description: `desc ${name}`,
    name,
    spawnDepth: 0,
    model: 'claude-opus-5',
    taskKind: 'in_process_teammate',
    teamName,
  });

  const start = () =>
    startFileIngest(store, {
      paths,
      teamName: TEAM,
      leadSessionId: LEAD_SESSION,
      leadName: 'team-lead',
      sweepIntervalMs: 0,
      tailPollMs: 0,
    });

  beforeEach(async () => {
    await fs.mkdir(path.join(paths.teams, TEAM), { recursive: true });
    await fs.copyFile(
      path.join(FIXTURES, 'config-4-members.json'),
      path.join(paths.teams, TEAM, 'config.json'),
    );
  });

  it("keeps the lead's transcript and cost live across a /branch instead of freezing at the fork point", async () => {
    const before = Array.from({ length: 3 }, (_, i) => assistant('pre', i, 1787843400000));
    await write(leadTranscript(), before);

    const ingest = start();
    try {
      await ingest.sweep();
      const first = project(store.replay(), false).agents.find((a) => a.name === 'team-lead')!;
      expect(first.transcript.map((l) => l.text)).toEqual(['pre 0', 'pre 1', 'pre 2']);
      const preCost = first.costUsd;
      expect(preCost).toBeGreaterThan(0);

      // The fork: a full copy of everything before it (same uuids), plus new
      // content the ORIGINAL session file will never see.
      const after = Array.from({ length: 2 }, (_, i) => assistant('post', i, 1787843500000));
      await write(forkTranscript(), [forkHeader(LEAD_SESSION), ...before, ...after]);
      await ingest.sweep();

      const lead = project(store.replay(), false).agents.find((a) => a.name === 'team-lead')!;
      // The pre-fork lines are not duplicated (uuid dedupe), and the post-fork
      // lines — which only the forked session ever carries — now show up.
      expect(lead.transcript.map((l) => l.text)).toEqual(['pre 0', 'pre 1', 'pre 2', 'post 0', 'post 1']);
      // Cost grows by exactly the new content — the shared prefix's message
      // ids collide across the two files, so totalsFor's merge cannot double them.
      const expected = totalCost(dedupeUsage(usageRecordsOf([...before, ...after])));
      expect(lead.costUsd).toBeCloseTo(expected, 9);
      expect(lead.costUsd).toBeGreaterThan(preCost);
    } finally {
      ingest.close();
    }
  });

  it('admits a teammate spawned under the FORKED session, not just the original leadSessionId', async () => {
    await write(leadTranscript(), [assistant('pre', 0, 1787843400000)]);
    await write(forkTranscript(), [forkHeader(LEAD_SESSION), assistant('pre', 0, 1787843400000)]);

    const mateRecords = Array.from({ length: 5 }, (_, i) => assistant('mate', i, 1787843600000));
    await write(path.join(forkSubagentDir(), 'agent-anewmate-1111111111111111.jsonl'), mateRecords);
    await fs.writeFile(
      path.join(forkSubagentDir(), 'agent-anewmate-1111111111111111.meta.json'),
      JSON.stringify(sidecar('newmate', TEAM)),
    );

    const ingest = start();
    try {
      // One pass: growForkChain runs before this same pass's file dispatch, so
      // the fork it just found is already in scope for the sidecar and
      // transcript this very sweep goes on to read.
      await ingest.sweep();
    } finally {
      ingest.close();
    }

    const mate = project(store.replay(), false).agents.find((a) => a.name === 'newmate');
    expect(mate).toBeDefined();
    expect(mate!.transcript.length).toBeGreaterThan(0);
    expect(mate!.costUsd).toBeCloseTo(totalCost(dedupeUsage(usageRecordsOf(mateRecords))), 9);
  });

  it('PROOF: a session not forked from ours stays out of the roster, the feed and totalCostUsd', async () => {
    const leadRecords = [assistant('pre', 0, 1787843400000)];
    await write(leadTranscript(), leadRecords);

    // A foreign session sitting beside ours in the SAME project directory,
    // carrying our own team name in its sidecar and NO forkedFrom link back to
    // us at all — the exact shape the scope rule exists to keep out, now that
    // "ours" is a chain instead of one exact id.
    const foreignRecords = Array.from({ length: 5 }, (_, i) => assistant('stranger', i, 1787843700000));
    await write(foreignTranscript(), foreignRecords);
    await write(path.join(foreignSubagentDir(), 'agent-astranger-2222222222222222.jsonl'), foreignRecords);
    await fs.writeFile(
      path.join(foreignSubagentDir(), 'agent-astranger-2222222222222222.meta.json'),
      JSON.stringify(sidecar('stranger', TEAM)),
    );

    const ingest = start();
    try {
      await ingest.sweep();
      await ingest.sweep();
    } finally {
      ingest.close();
    }

    const state = project(store.replay(), false);
    expect(state.agents.map((a) => a.name)).not.toContain('stranger');
    expect(state.agents.flatMap((a) => a.transcript).some((l) => l.text.includes('stranger'))).toBe(false);
    expect(state.totalCostUsd).toBeCloseTo(totalCost(dedupeUsage(usageRecordsOf(leadRecords))), 9);
  });
});
