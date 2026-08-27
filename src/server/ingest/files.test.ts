import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, type Store, type StoredEvent } from '../store';
import { startFileIngest, agentOfTranscript, type IngestPaths, type FileIngest } from './files';
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
      ingest = startFileIngest(store, { paths, leadSessionId: LEAD, leadName: 'team-lead', sweepIntervalMs: 0 });
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
    const ingest = startFileIngest(store, { paths, sweepIntervalMs: 0 });
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
    const ingest = startFileIngest(store, { paths, sweepIntervalMs: 0 });
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
});
