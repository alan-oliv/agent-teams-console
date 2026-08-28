import { promises as fs } from 'node:fs';
import path from 'node:path';
import { watchAppendOnly } from '../watch/tail';
import { readJsonSafe, watchJsonTree } from '../watch/jsonfile';
import type { Store } from '../store';
import type { AgentUsageTotals, TaskPayload, TranscriptPayload } from '../project';
import { parseLine, type TranscriptRecord } from '../../shared/transcript';
import { tokensOf, totalCost, usageRecordsOf, type UsageRecord } from '../../shared/usage';
import type { TeamConfig, Sidecar } from '../../shared/roster';
import type { InboxEntry } from '../../shared/mailbox';
import { logError } from '../log';

export const DEFAULT_SWEEP_MS = 5000;
/**
 * How often the transcripts we already know about are re-read. The sweep above
 * walks every file under all four roots (measured: 9ms on a 389-file ~/.claude,
 * 244ms on a 10,000-file one), so it cannot run at this rate — but re-reading a
 * handful of known files is one stat each, 0.1ms for eleven agents. That makes
 * the transcript's worst-case latency this interval instead of the sweep's,
 * whether or not fs.watch delivered. Matched to stream.ts's COALESCE_MS: a
 * faster poll cannot produce a faster frame.
 */
export const TAIL_POLL_MS = 250;
/**
 * Records per stored transcript event. The store bounds transcript history by
 * RECORD count per agent, and it can only drop whole events, so without a split
 * the tightest bound it could reach would be one whole file per agent — 2,630
 * records on the largest real transcript, ~10 ms a publish at 11 agents.
 * 200 is the window at which the projected 60 lines are still exact on every
 * real transcript, so the store's overshoot can never cut into what is drawn.
 */
export const INGEST_BATCH_RECORDS = 200;
const SUBAGENT_FILE = /^agent-a(.+)-[0-9a-f]{16}\.jsonl$/;

export interface IngestPaths {
  projects: string;
  teams: string;
  tasks: string;
  sessions: string;
}

export interface IngestConfig {
  paths: IngestPaths;
  teamName?: string;
  leadSessionId?: string;
  leadName?: string;
  sweepIntervalMs?: number;
  tailPollMs?: number;
  /**
   * Fires when config.json tells us which team this is. The console can be
   * started before any team exists (`npm start` by hand), so this is the only
   * point at which the store learns what to scope its log to.
   */
  onTeam?: (info: { teamName: string; leadSessionId: string }) => void;
}

export interface FileIngest {
  sweep(): Promise<void>;
  /**
   * Read that agent's transcript now, resolving once the read has landed. A
   * hook is proof the agent just did something, and the transcript is the one
   * thing hooks never carry. Unknown agent: a no-op.
   */
  drainAgent(agent: string): Promise<void>;
  close(): void;
}

const WORKFLOW_SEGMENT = `${path.sep}workflows${path.sep}`;

/**
 * SCOPE RULE: the console covers agent TEAMS only. Ordinary Agent-tool
 * subagents and workflow fan-outs are not team members and must never be
 * ingested — verified in the capture spike, where six workflow subagents were
 * live and config.json members[] still held only the lead.
 *
 * Two exclusions are decidable from the path alone, before anything is parsed:
 *   - workflow fan-outs live under <session>/subagents/workflows/<runId>/
 *   - another session's subagents are not under our leadSessionId
 * The third case — an Agent-tool subagent spawned by the lead, which lands in
 * the SAME directory as a teammate — is only decidable from its .meta.json
 * taskKind, so it is resolved by the pending buffer in handleLines.
 */
export function agentOfTranscript(
  file: string,
  leadSessionId: string | undefined,
  leadName: string,
): string | null {
  if (file.includes(WORKFLOW_SEGMENT)) return null;
  const base = path.basename(file);
  if (leadSessionId && base === `${leadSessionId}.jsonl`) return leadName;
  const m = SUBAGENT_FILE.exec(base);
  if (!m) return null;
  // <projects>/<slug>/<leadSessionId>/subagents/agent-<name>-<hex>.jsonl
  if (leadSessionId && path.basename(path.dirname(path.dirname(file))) !== leadSessionId) {
    return null;
  }
  return m[1];
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) out.push(full);
    }
  }
  // config.json first so the sweep learns the team before reading anything keyed on it.
  return out.sort(
    (a, b) =>
      (path.basename(a) === 'config.json' ? 0 : 1) - (path.basename(b) === 'config.json' ? 0 : 1) ||
      a.localeCompare(b),
  );
}

export function startFileIngest(store: Store, config: IngestConfig): FileIngest {
  const { paths } = config;
  const leadName = config.leadName ?? 'team-lead';
  let teamName = config.teamName;
  let leadSessionId = config.leadSessionId;

  let lastConfig: TeamConfig | null = null;
  const sidecars = new Map<string, { meta: Sidecar; transcriptPath: string }>();
  const marks = new Map<string, number>();
  // Sidecars read while the team was still unknown, held until config.json can
  // judge them. See handleProjectsJson.
  const unresolvedSidecars = new Map<string, Sidecar>();
  // Every transcript this ingest has attributed to an agent, so the tail poll
  // and drainAgent can reach a file without walking the tree to find it.
  const transcriptPaths = new Map<string, string>();
  let closed = false;

  const mark = async (file: string) => {
    try {
      marks.set(file, (await fs.stat(file)).mtimeMs);
    } catch {
      /* file vanished between event and stat */
    }
  };

  // store.append can throw (a full disk, a read-only log directory), and an
  // unhandled rejection terminates the process by default — a silent-death
  // mode for a server started detached.
  const settle = (file: string) => (p: Promise<void>) =>
    p.then(() => mark(file)).catch((err: unknown) => logError(`ingest ${file}`, err));

  const appendRoster = () => {
    store.append('roster', { config: lastConfig, sidecars: [...sidecars.values()] });
  };

  // A teammate's transcript can be appended before its .meta.json sidecar lands
  // (observed in the spike: sidecars appeared 22-33s in). We cannot tell a
  // teammate from an ordinary subagent until the sidecar arrives, so hold the
  // lines in a bounded buffer instead of guessing — and drop them outright once
  // a sidecar proves the agent is not a teammate.
  const pending = new Map<string, { agent: string; records: TranscriptRecord[] }>();
  const PENDING_CAP = 500;

  /**
   * Per transcript FILE, the best usage record seen for each message id — the
   * same rule `dedupeUsage` applies, kept incrementally so the snapshot below is
   * exact however the file arrived: in one drain, in chunks, or read whole again
   * after a restart. Measured at ~21% of record count, which is ~100x cheaper
   * than holding the records themselves, but it does grow with the session.
   */
  const usageLedger = new Map<string, Map<string, UsageRecord>>();
  // The transcript files this run has read for each agent. A CANDIDATE set:
  // which of them actually count is re-decided in totalsFor against the
  // leadSessionId of the moment, because a file read before config.json landed
  // was attributed on its name alone.
  const ledgerFiles = new Map<string, Set<string>>();

  // Fed as lines are READ, not as they are stored, so nothing that drops records
  // downstream can discount an agent: PENDING_CAP truncates a late-sidecar
  // teammate's buffer, and the store bounds records per agent.
  const noteUsage = (file: string, agent: string, records: TranscriptRecord[]) => {
    const ledger = usageLedger.get(file) ?? new Map<string, UsageRecord>();
    for (const u of usageRecordsOf(records)) {
      const best = ledger.get(u.messageId);
      if (!best || u.usage.output_tokens > best.usage.output_tokens) ledger.set(u.messageId, u);
    }
    usageLedger.set(file, ledger);
    const files = ledgerFiles.get(agent) ?? new Set<string>();
    files.add(file);
    ledgerFiles.set(agent, files);
  };

  /**
   * What the agent has spent over everything this ingest has read — cumulative,
   * so the fold takes the newest snapshot whole and never adds two together.
   * Re-totalled from the live `usage` objects every time rather than cached, so
   * a catalog.json price edit takes effect on the next drain.
   */
  const totalsFor = (agent: string): AgentUsageTotals => {
    const candidates = [...(ledgerFiles.get(agent) ?? [])];
    const attributable = candidates.filter(
      (f) => agentOfTranscript(f, leadSessionId, leadName) === agent,
    );
    // A snapshot is only ever taken for a file whose records we are storing, so
    // an empty filter means we are storing a file that is no longer the agent's
    // — a team name reused under a new lead session. Publishing 0 there would
    // overwrite a correct total with a number the stored records contradict.
    const files = attributable.length > 0 ? attributable : candidates;
    let all: UsageRecord[];
    if (files.length === 1) {
      all = [...(usageLedger.get(files[0]) ?? new Map<string, UsageRecord>()).values()];
    } else {
      // An agent respawned under the same name has a second transcript file;
      // both are its spend, and a message id in both counts once.
      const best = new Map<string, UsageRecord>();
      for (const f of files) {
        for (const [id, u] of usageLedger.get(f) ?? []) {
          const prev = best.get(id);
          if (!prev || u.usage.output_tokens > prev.usage.output_tokens) best.set(id, u);
        }
      }
      all = [...best.values()];
    }
    return { costUsd: totalCost(all), tokens: tokensOf(all) };
  };

  const transcriptOfSidecar = (file: string) => file.replace(/\.meta\.json$/, '.jsonl');

  // A TRANSCRIPT this run has proven is not a teammate's keeps nothing. Keyed by
  // the file the sidecar describes, never by the name it carries: a name is not
  // unique across teams (166 sidecars on one ordinary machine, 13 teammate names
  // over two sessions), so a stranger that merely shares a teammate's name would
  // otherwise empty that teammate's buffer and its spend.
  const forget = (transcript: string) => {
    pending.delete(transcript);
    usageLedger.delete(transcript);
  };

  /**
   * SYNCHRONOUS ON PURPOSE. `fromStart` makes the fold drop everything it holds
   * for the agent, so between the first chunk and the last the projected
   * transcript is a truncated rebuild of the file. That is invisible only
   * because every chunk lands inside one call, well inside stream.ts's 250 ms
   * coalesce — an `await` in this loop would put a visibly-truncated transcript
   * on the wire. (At boot there is no client at all: index.ts awaits the sweep
   * before it creates the HTTP server.)
   */
  const appendTranscript = (agent: string, records: TranscriptRecord[], fromStart: boolean) => {
    const totals = totalsFor(agent);
    for (let i = 0; i < records.length; i += INGEST_BATCH_RECORDS) {
      const payload: TranscriptPayload = {
        agent,
        records: records.slice(i, i + INGEST_BATCH_RECORDS),
      };
      if (fromStart && i === 0) payload.fromStart = true;
      // Only the last chunk carries the snapshot, so a partial read of a drain
      // can never publish a partial total.
      if (i + INGEST_BATCH_RECORDS >= records.length) payload.totals = totals;
      store.append('transcript', payload, agent);
    }
  };

  const flushPending = (transcript: string) => {
    const buf = pending.get(transcript);
    pending.delete(transcript);
    // Never `fromStart`: PENDING_CAP may already have dropped the front of the
    // buffer, so this is not provably the file from its first byte.
    if (buf && buf.records.length > 0) appendTranscript(buf.agent, buf.records, false);
  };

  const handleLines = (file: string, lines: string[], fromStart: boolean) => {
    const agent = agentOfTranscript(file, leadSessionId, leadName);
    if (!agent) return;
    transcriptPaths.set(agent, file);
    const records: TranscriptRecord[] = [];
    for (const l of lines) {
      const rec = parseLine(l);
      if (rec) records.push(rec);
    }
    if (records.length === 0) return;
    noteUsage(file, agent, records);

    if (agent === leadName || sidecars.has(agent)) {
      flushPending(file);
      appendTranscript(agent, records, fromStart);
      return;
    }
    const buf = pending.get(file)?.records ?? [];
    buf.push(...records);
    pending.set(file, { agent, records: buf.slice(-PENDING_CAP) });
  };

  const handleTeamsJson = async (file: string) => {
    const base = path.basename(file);
    const dirName = path.basename(path.dirname(file));
    if (base === 'config.json') {
      if (teamName && dirName !== teamName) return;
      const cfg = await readJsonSafe<TeamConfig>(file);
      if (!cfg) return;
      lastConfig = cfg;
      const learned = teamName !== cfg.name || leadSessionId !== cfg.leadSessionId;
      teamName = cfg.name;
      leadSessionId = cfg.leadSessionId;
      if (learned) config.onTeam?.({ teamName: cfg.name, leadSessionId: cfg.leadSessionId });
      for (const [f, meta] of unresolvedSidecars) acceptSidecar(f, meta);
      unresolvedSidecars.clear();
      appendRoster();
      return;
    }
    if (dirName !== 'inboxes') return;
    const to = base.replace(/\.json$/, '');
    const entries = await readJsonSafe<InboxEntry[]>(file);
    if (!Array.isArray(entries)) return;
    store.append('mail', { source: 'inbox', to, entries }, to);
  };

  const acceptSidecar = (file: string, meta: Sidecar): boolean => {
    const transcriptPath = transcriptOfSidecar(file);
    if (meta.teamName !== teamName) {
      // Not ours — discard anything buffered for the transcript it describes.
      forget(transcriptPath);
      return false;
    }
    sidecars.set(meta.name, { meta, transcriptPath });
    transcriptPaths.set(meta.name, transcriptPath);
    flushPending(transcriptPath);
    return true;
  };

  const handleProjectsJson = async (file: string) => {
    if (!file.endsWith('.meta.json')) return;
    const meta = await readJsonSafe<Sidecar>(file);
    if (!meta) return;
    if (meta.taskKind !== 'in_process_teammate') {
      // Proven NOT a teammate — discard anything buffered for its transcript.
      forget(transcriptOfSidecar(file));
      return;
    }
    // Fail CLOSED while the team is unresolved: `teamName` unset must reject
    // every sidecar, not admit them all — otherwise a console started before
    // its team's config.json exists shows every in-process teammate on the
    // machine, including other sessions' (seen live: three agents from an
    // unrelated session, with the real teammates all shown as 'departed').
    if (!teamName) {
      // Rejected for want of a team, not on the file's own merits — and both
      // readers record its mtime either way, so the sweep's gate will never
      // offer this file again. Sidecars are written once, so dropping it here
      // strands the teammate for the whole run: hold it until config.json can
      // say whether it is ours.
      unresolvedSidecars.set(file, meta);
      return;
    }
    unresolvedSidecars.delete(file);
    if (acceptSidecar(file, meta)) appendRoster();
  };

  const handleTaskJson = async (file: string) => {
    if (teamName && path.basename(path.dirname(file)) !== teamName) return;
    const task = await readJsonSafe<TaskPayload>(file);
    if (!task || typeof task.id !== 'string') return;
    store.append('task', task, task.owner);
  };

  const handleSessionJson = async (file: string) => {
    if (leadSessionId && path.basename(file) !== `${leadSessionId}.json`) return;
    const doc = await readJsonSafe<{ gitBranch?: string; branch?: string }>(file);
    const branch = doc?.gitBranch ?? doc?.branch;
    if (!branch) return;
    store.append('statusline', { branch }, leadName);
  };

  const dispatchJson = async (file: string, root: string) => {
    if (root === paths.teams) await handleTeamsJson(file);
    else if (root === paths.projects) await handleProjectsJson(file);
    else if (root === paths.tasks) await handleTaskJson(file);
    else if (root === paths.sessions) await handleSessionJson(file);
  };

  const transcripts = watchAppendOnly(paths.projects, (file, lines, fromStart) => {
    try {
      handleLines(file, lines, fromStart);
    } catch (err) {
      logError(`ingest ${file}`, err);
    }
    // Keep the sweep's mtime gate in step so it does not re-dispatch a file the
    // watcher just consumed.
    void fs.stat(file).then(
      (st) => marks.set(file, st.mtimeMs),
      () => undefined,
    );
  });

  const sweepTranscript = async (file: string) => {
    const agent = agentOfTranscript(file, leadSessionId, leadName);
    if (!agent) return;
    transcriptPaths.set(agent, file);
    await transcripts.pump(file);
  };

  const drainAgent = async (agent: string): Promise<void> => {
    const file = transcriptPaths.get(agent);
    if (!file) return;
    await transcripts.pump(file);
  };

  const pollTails = async (): Promise<void> => {
    await Promise.all([...transcriptPaths.values()].map((file) => transcripts.pump(file)));
  };

  const sweep = async (): Promise<void> => {
    for (const root of [paths.teams, paths.projects, paths.tasks, paths.sessions]) {
      for (const file of await walk(root)) {
        if (closed) return;
        let st;
        try {
          st = await fs.stat(file);
        } catch {
          continue;
        }
        if ((marks.get(file) ?? -1) >= st.mtimeMs) continue;
        marks.set(file, st.mtimeMs);
        if (file.endsWith('.jsonl')) await sweepTranscript(file);
        else if (file.endsWith('.json')) await dispatchJson(file, root);
      }
    }
  };

  const watchers = [
    transcripts,
    watchJsonTree(paths.projects, (file) => {
      void settle(file)(handleProjectsJson(file));
    }),
    watchJsonTree(paths.teams, (file) => {
      void settle(file)(handleTeamsJson(file));
    }),
    watchJsonTree(paths.tasks, (file) => {
      void settle(file)(handleTaskJson(file));
    }),
    watchJsonTree(paths.sessions, (file) => {
      void settle(file)(handleSessionJson(file));
    }),
  ];

  const interval = config.sweepIntervalMs ?? DEFAULT_SWEEP_MS;
  // A sweep of a large or network-mounted ~/.claude can outlast its own
  // interval; without this the next one starts on top of it and walks the same
  // tree again.
  let sweeping: Promise<void> | null = null;
  const timer =
    interval > 0
      ? setInterval(() => {
          if (sweeping) return;
          sweeping = sweep()
            .catch((err: unknown) => logError('reconciliation sweep', err))
            .finally(() => {
              sweeping = null;
            });
        }, interval)
      : null;
  timer?.unref?.();

  const pollMs = config.tailPollMs ?? TAIL_POLL_MS;
  const poll =
    pollMs > 0
      ? setInterval(() => {
          void pollTails().catch((err: unknown) => logError('tail poll', err));
        }, pollMs)
      : null;
  poll?.unref?.();

  return {
    sweep,
    drainAgent,
    close() {
      closed = true;
      if (timer) clearInterval(timer);
      if (poll) clearInterval(poll);
      for (const w of watchers) w.close();
    },
  };
}
