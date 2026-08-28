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
/**
 * Records held across ALL pre-attribution buffers. PENDING_CAP is a per-FILE
 * bound and the number of files that can be buffered is the number of subagent
 * transcripts on the machine, not the size of the team — measured 309.7 MB of
 * heap for 165 buffered files against 24.6 MB for 13, a 12.6x that is exactly
 * the file-to-name ratio. This is the bound that does not move with the file
 * count: 12 full PENDING_CAP buffers, one more than the eleven agents the
 * store's record budget is tuned for, and 23.6 MB at the measured 3.94 KB of
 * heap a record.
 */
export const PENDING_RECORDS = 6_000;
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

export interface TranscriptClaim {
  /** The bare name this path claims. */
  agent: string;
  /**
   * Whether the directory check was actually MADE. With no leadSessionId there
   * is nothing to check the path against, so the name is a claim and not a
   * proof — and nothing may be attributed on it.
   */
  scoped: boolean;
}

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
export function claimOfTranscript(
  file: string,
  leadSessionId: string | undefined,
  leadName: string,
): TranscriptClaim | null {
  if (file.includes(WORKFLOW_SEGMENT)) return null;
  const base = path.basename(file);
  if (leadSessionId && base === `${leadSessionId}.jsonl`) return { agent: leadName, scoped: true };
  const m = SUBAGENT_FILE.exec(base);
  if (!m) return null;
  if (!leadSessionId) return { agent: m[1], scoped: false };
  // <projects>/<slug>/<leadSessionId>/subagents/agent-<name>-<hex>.jsonl
  if (path.basename(path.dirname(path.dirname(file))) !== leadSessionId) return null;
  return { agent: m[1], scoped: true };
}

export function agentOfTranscript(
  file: string,
  leadSessionId: string | undefined,
  leadName: string,
): string | null {
  return claimOfTranscript(file, leadSessionId, leadName)?.agent ?? null;
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
  // Keyed by the TRANSCRIPT FILE each sidecar describes, never by the name it
  // carries: one ordinary machine holds 165 sidecars over 13 teammate names, so
  // the file is the only key that names ONE RUN.
  const sidecars = new Map<string, Sidecar>();
  // agent -> the transcript files a sidecar has PROVEN are that agent's. This is
  // the admission key for records, and the only files totalsFor may bill.
  const ownedFiles = new Map<string, Set<string>>();
  const marks = new Map<string, number>();
  // Sidecars read while the team was still unknown, held until config.json can
  // judge them. See handleProjectsJson.
  const unresolvedSidecars = new Map<string, Sidecar>();
  // Every transcript this ingest has attributed to an agent, so the tail poll
  // and drainAgent can reach a file without walking the tree to find it. A
  // respawn under one name has two, and pumping only the last one seen reverts
  // that agent to the 5s sweep.
  const transcriptPaths = new Map<string, Set<string>>();
  const notePath = (agent: string, file: string) => {
    const files = transcriptPaths.get(agent) ?? new Set<string>();
    files.add(file);
    transcriptPaths.set(agent, files);
  };
  const own = (agent: string, file: string) => {
    const files = ownedFiles.get(agent) ?? new Set<string>();
    files.add(file);
    ownedFiles.set(agent, files);
    notePath(agent, file);
  };
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
    // buildRoster keys by meta.name and takes the last entry, so two runs of one
    // name still collapse to one agent — the contract it already had.
    store.append('roster', {
      config: lastConfig,
      sidecars: [...sidecars].map(([transcriptPath, meta]) => ({ meta, transcriptPath })),
    });
  };

  // A teammate's transcript can be appended before its .meta.json sidecar lands
  // (observed in the spike: sidecars appeared 22-33s in). We cannot tell a
  // teammate from an ordinary subagent until the sidecar arrives, so hold the
  // lines in a bounded buffer instead of guessing — and drop them outright once
  // a sidecar proves the agent is not a teammate.
  const pending = new Map<string, { agent: string; records: TranscriptRecord[] }>();
  const PENDING_CAP = 500;
  let pendingRecords = 0;
  const dropPending = (file: string) => {
    const buf = pending.get(file);
    if (!buf) return;
    pendingRecords -= buf.records.length;
    pending.delete(file);
  };
  // Least-recently-appended file first: Map keeps insertion order and every
  // append re-inserts, so the first key is the coldest buffer.
  const evictPending = () => {
    while (pendingRecords > PENDING_RECORDS) {
      const oldest = pending.keys().next();
      if (oldest.done) return;
      dropPending(oldest.value);
    }
  };

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
    // OWNERSHIP, not path shape. noteUsage runs before the admission test by
    // design (see its comment), so a stranger that merely shares this agent's
    // name is in `candidates` even though its records were refused — and
    // `agentOfTranscript(f) === agent` is true for every such file.
    const owned = ownedFiles.get(agent);
    const attributable = candidates.filter((f) => owned?.has(f) === true);
    // A snapshot is only ever taken for a file whose records we are storing, so
    // an empty filter means we are storing a file that is no longer the agent's
    // — a team name reused under a new lead session. Publishing 0 there would
    // overwrite a correct total with a number the stored records contradict.
    // Close to dead code now that admission and attribution share one key.
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

  // Transcripts a sidecar has proven are not a teammate's. The sweep drains
  // transcripts AFTER its walk, so the verdict normally lands BEFORE the file is
  // ever read and there is no buffer for forget() to clear — without this, a
  // stranger's lines would be buffered again on every append it makes, spending
  // a budget that belongs to teammates whose sidecars are merely late. Emptied
  // when config.json changes what "ours" means; every held file is re-judged in
  // the same breath.
  const disowned = new Set<string>();

  // A TRANSCRIPT this run has proven is not a teammate's keeps nothing. Keyed by
  // the file the sidecar describes, never by the name it carries: a name is not
  // unique across teams (166 sidecars on one ordinary machine, 13 teammate names
  // over two sessions), so a stranger that merely shares a teammate's name would
  // otherwise empty that teammate's buffer and its spend.
  const forget = (transcript: string) => {
    disowned.add(transcript);
    dropPending(transcript);
    usageLedger.delete(transcript);
    for (const files of ledgerFiles.values()) files.delete(transcript);
    for (const files of transcriptPaths.values()) files.delete(transcript);
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

  const flushPending = (agent: string, transcript: string) => {
    const buf = pending.get(transcript);
    dropPending(transcript);
    // Never `fromStart`: PENDING_CAP may already have dropped the front of the
    // buffer, so this is not provably the file from its first byte.
    if (buf && buf.records.length > 0) appendTranscript(agent, buf.records, false);
  };

  const handleLines = (file: string, lines: string[], fromStart: boolean) => {
    const claim = claimOfTranscript(file, leadSessionId, leadName);
    if (!claim) return;
    if (disowned.has(file)) return;
    // The sidecar's own `name` is the roster's join key, so it decides the
    // identity of the file it describes; the path-derived name is a fallback for
    // lines read before any sidecar landed.
    const meta = sidecars.get(file);
    const agent = meta?.name ?? claim.agent;
    notePath(agent, file);
    const records: TranscriptRecord[] = [];
    for (const l of lines) {
      const rec = parseLine(l);
      if (rec) records.push(rec);
    }
    if (records.length === 0) return;
    noteUsage(file, agent, records);

    // ADMISSION IS PER FILE. Records enter the store when a sidecar under our
    // lead session proved THIS FILE is that teammate's, or when it is the lead's
    // own session transcript — one exact path. Sharing a registered teammate's
    // NAME proves nothing, and a name with no leadSessionId to check it against
    // is not even a claim we can test.
    const lead = claim.scoped && claim.agent === leadName;
    if (lead) own(leadName, file);
    if (meta || lead) {
      flushPending(agent, file);
      // A second file for one name must never clear the first: the fold's
      // `fromStart` clear is scoped to the AGENT, not to the file, so it would
      // destroy the other run's stored history. The uuid dedupe and the store's
      // per-agent record bound carry a re-read instead.
      appendTranscript(agent, records, fromStart && (ownedFiles.get(agent)?.size ?? 1) <= 1);
      return;
    }
    // Drop BEFORE the push: `buf` is the array the buffer already holds, so
    // dropping after it would discount the new records from the running total.
    const buf = pending.get(file)?.records ?? [];
    dropPending(file);
    buf.push(...records);
    const kept = buf.slice(-PENDING_CAP);
    pending.set(file, { agent, records: kept });
    pendingRecords += kept.length;
    evictPending();
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
      // Everything held before this moment was held on a NAME, because there was
      // no lead session id to check its directory against. Re-judge it here —
      // before the sidecars replay, or a sidecar would flush a buffer this is
      // about to disown — and free whatever no longer qualifies.
      if (learned) {
        disowned.clear();
        for (const f of [...pending.keys()]) {
          if (claimOfTranscript(f, leadSessionId, leadName)?.scoped !== true) forget(f);
        }
        for (const f of [...usageLedger.keys()]) {
          if (claimOfTranscript(f, leadSessionId, leadName)?.scoped !== true) forget(f);
        }
      }
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
    // The same scope rule the transcript reader applies: a sidecar in ANOTHER
    // session's subagents directory is not ours however its teamName reads, and
    // a teamName is only the first 8 hex of a lead session id. `scoped !== true`
    // covers the wrong directory, a workflow fan-out, and the window before
    // config.json in one clause.
    const claim = claimOfTranscript(transcriptPath, leadSessionId, leadName);
    if (meta.teamName !== teamName || claim?.scoped !== true) {
      // Not ours — discard anything buffered for the transcript it describes.
      forget(transcriptPath);
      return false;
    }
    sidecars.set(transcriptPath, meta);
    disowned.delete(transcriptPath);
    own(meta.name, transcriptPath);
    flushPending(meta.name, transcriptPath);
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
    if (!teamName || !leadSessionId) {
      // A teamName we already have refuses a sidecar on its own; only the
      // DIRECTORY half of the test needs the lead session id. Judging that half
      // here is what keeps another team's sidecar — and the transcript it
      // describes — out of the buffers for the whole window.
      if (teamName && meta.teamName !== teamName) {
        forget(transcriptOfSidecar(file));
        return;
      }
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
    const claim = claimOfTranscript(file, leadSessionId, leadName);
    if (!claim || disowned.has(file)) return;
    notePath(sidecars.get(file)?.name ?? claim.agent, file);
    await transcripts.pump(file);
  };

  const drainAgent = async (agent: string): Promise<void> => {
    for (const file of transcriptPaths.get(agent) ?? []) await transcripts.pump(file);
  };

  const pollTails = async (): Promise<void> => {
    const files = new Set<string>();
    for (const set of transcriptPaths.values()) for (const file of set) files.add(file);
    await Promise.all([...files].map((file) => transcripts.pump(file)));
  };

  const sweep = async (): Promise<void> => {
    for (const root of [paths.teams, paths.projects, paths.tasks, paths.sessions]) {
      // Transcripts are drained after the walk, OLDEST mtime first. Two runs of
      // one name land under one agent, and the fold takes the last record's
      // currentTool and the last assistant row's error — so a dead run read
      // after the live one shows a live agent failed, with a stale command in
      // flight. Free at boot: index.ts awaits this sweep before it listens.
      const drains: Array<{ file: string; mtimeMs: number }> = [];
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
        if (file.endsWith('.jsonl')) drains.push({ file, mtimeMs: st.mtimeMs });
        else if (file.endsWith('.json')) await dispatchJson(file, root);
      }
      drains.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const drain of drains) {
        if (closed) return;
        await sweepTranscript(drain.file);
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
