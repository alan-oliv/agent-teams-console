import { promises as fs } from 'node:fs';
import path from 'node:path';
import { watchAppendOnly } from '../watch/tail';
import { readJsonSafe, watchJsonTree } from '../watch/jsonfile';
import type { Store } from '../store';
import type { AgentUsageTotals, SubagentPayload, TaskPayload, TranscriptPayload } from '../project';
import {
  digestOf,
  emptySubagentFold,
  foldSubagentRecords,
  type SubagentFold,
} from '../../shared/subagents';
import { createWorkflowUsageIngest, workflowAgentClaimOf } from './workflow-agents';
import { parseLine, type TranscriptRecord } from '../../shared/transcript';
import { tokensOf, totalCost, usageRecordsOf, type UsageRecord } from '../../shared/usage';
import { splitTok } from '../../shared/cost';
import type { TeamConfig, Sidecar } from '../../shared/roster';
import type { InboxEntry } from '../../shared/mailbox';
import { logError } from '../log';
import { leanRun, parseWorkflowJournal, parseWorkflowRun } from '../workflow';

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
/**
 * A subagent transcript and the agentId it is named for. `SUBAGENT_FILE` above
 * only matches a NAMED one, because it splits the name back out; an `Agent`
 * call made without a `name` lands as `agent-a<16 hex>.jsonl`, which has no
 * name to split and is the shape most subagents on a real machine take.
 */
const SUBAGENT_TRANSCRIPT = /^agent-(a(?:.+-)?[0-9a-f]{16})\.jsonl$/;

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
  /**
   * The lead's REAL session id, learned from a teammate's sidecar rather than
   * from config.json — which names a session that does not exist once a team
   * has been re-keyed. The SessionEnd hook compares the ending session against
   * this, so without it the console never stops when its lead exits.
   */
  onLeadSession?: (sessionId: string) => void;
  /**
   * Scoped to one session and to nothing else. An unset `teamName` means "no
   * team YET" — the config.json this is waiting for may still be written — so
   * without this flag a console pointed at a session that never formed a team
   * adopts the first team config on the machine and reseeds its lead chain to
   * that team's lead, which drops the session's own transcript from scope.
   */
  sessionOnly?: boolean;
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
 * A single session id, or every session id `/branch` has ever forked from our
 * lead — see `growForkChain` below. `claimOfTranscript` accepts either so
 * every existing caller (a bare leadSessionId) still type-checks unchanged.
 */
export type LeadChain = string | ReadonlySet<string> | undefined;

function chainHas(chain: LeadChain, sessionId: string): boolean {
  if (!chain) return false;
  return typeof chain === 'string' ? chain === sessionId : chain.has(sessionId);
}

// An EMPTY Set is a truthy object, unlike an empty leadSessionId string — so
// "no lead session known yet" has to be tested by size, not by `!chain`, or
// the unresolved-team window below falls through to the wrong branch.
function chainKnown(chain: LeadChain): boolean {
  if (!chain) return false;
  return typeof chain === 'string' || chain.size > 0;
}

/**
 * SCOPE RULE: the console covers agent TEAMS only. Ordinary Agent-tool
 * subagents and workflow fan-outs are not team members and must never be
 * ingested — verified in the capture spike, where six workflow subagents were
 * live and config.json members[] still held only the lead.
 *
 * Two exclusions are decidable from the path alone, before anything is parsed:
 *   - workflow fan-outs live under <session>/subagents/workflows/<runId>/
 *   - another session's subagents are not under our leadSessionId CHAIN — the
 *     lead session itself, plus every session `/branch` has forked from it,
 *     transitively (see `growForkChain`)
 * The third case — an Agent-tool subagent spawned by the lead, which lands in
 * the SAME directory as a teammate — is only decidable from its .meta.json
 * taskKind, so it is resolved by the pending buffer in handleLines.
 */
export function claimOfTranscript(
  file: string,
  leadSessionId: LeadChain,
  leadName: string,
): TranscriptClaim | null {
  if (file.includes(WORKFLOW_SEGMENT)) return null;
  const base = path.basename(file);
  const known = chainKnown(leadSessionId);
  if (known && base.endsWith('.jsonl') && chainHas(leadSessionId, base.slice(0, -'.jsonl'.length))) {
    return { agent: leadName, scoped: true };
  }
  const m = SUBAGENT_FILE.exec(base);
  if (!m) return null;
  if (!known) return { agent: m[1], scoped: false };
  // <projects>/<slug>/<sessionId>/subagents/agent-<name>-<hex>.jsonl
  if (!chainHas(leadSessionId, path.basename(path.dirname(path.dirname(file))))) return null;
  return { agent: m[1], scoped: true };
}

export function agentOfTranscript(
  file: string,
  leadSessionId: LeadChain,
  leadName: string,
): string | null {
  return claimOfTranscript(file, leadSessionId, leadName)?.agent ?? null;
}

/**
 * The agentId a subagent transcript under OUR session chain is named for.
 *
 * Deliberately not part of `claimOfTranscript`: that function answers "which
 * team member is this", and the answer for a subagent is none — the scope rule
 * above stands. This answers a different question, "is this a subagent of a
 * session we are watching", and its result never reaches the roster, the team's
 * spend or `members[]`. Workflow fan-outs are excluded here as they are there.
 */
export function subagentIdOf(file: string, leadSessionId: LeadChain): string | null {
  if (file.includes(WORKFLOW_SEGMENT)) return null;
  const m = SUBAGENT_TRANSCRIPT.exec(path.basename(file));
  if (!m) return null;
  // <projects>/<slug>/<sessionId>/subagents/agent-<agentId>.jsonl
  if (!chainHas(leadSessionId, path.basename(path.dirname(path.dirname(file))))) return null;
  return m[1];
}

/** Which of a workflow run's two files this is, and the run it belongs to. */
export interface WorkflowClaim {
  kind: 'snapshot' | 'journal';
  runId: string;
  sessionId: string;
}

const RUN_ID = /^wf_.+$/;

/**
 * Routing only: is this file SHAPED like one of a run's two files, whoever it
 * belongs to. Deliberately chain-free, because routing has to happen before the
 * lead session is known — `workflowClaimOf` is what applies the scope, and a
 * path that gets here and fails that check is simply held or dropped, never
 * handed on to the team-mode handlers that would misread it.
 */
export function isWorkflowPath(file: string): boolean {
  const base = path.basename(file);
  const dir = path.dirname(file);
  if (base === 'journal.jsonl') return path.basename(path.dirname(dir)) === 'workflows';
  return (
    base.endsWith('.json') &&
    path.basename(dir) === 'workflows' &&
    RUN_ID.test(base.slice(0, -'.json'.length))
  );
}

/**
 * The OTHER half of the scope rule. `claimOfTranscript` above rejects these
 * paths and must keep doing so — a workflow subagent is not a team member. But
 * "not a teammate" is not "not interesting", and the two files below are the
 * whole of what a run leaves on disk:
 *
 *   <slug>/<sessionId>/workflows/wf_<runId>.json                 the snapshot
 *   <slug>/<sessionId>/subagents/workflows/wf_<runId>/journal.jsonl   live
 *
 * They sit in two DIFFERENT subtrees of one session, which is why a sweep of
 * `subagents/workflows/` alone never saw the snapshot. Both are matched from
 * the path alone, before anything is read.
 */
export function workflowClaimOf(file: string, leadSessionId: LeadChain): WorkflowClaim | null {
  const base = path.basename(file);
  const dir = path.dirname(file);
  const up = (n: number) => {
    let at = dir;
    for (let i = 0; i < n; i++) at = path.dirname(at);
    return path.basename(at);
  };

  if (base === 'journal.jsonl' && up(1) === 'workflows' && up(2) === 'subagents') {
    const runId = path.basename(dir);
    if (!RUN_ID.test(runId)) return null;
    const sessionId = up(3);
    return chainHas(leadSessionId, sessionId) ? { kind: 'journal', runId, sessionId } : null;
  }

  if (base.endsWith('.json') && path.basename(dir) === 'workflows' && up(1) !== 'subagents') {
    const runId = base.slice(0, -'.json'.length);
    if (!RUN_ID.test(runId)) return null;
    const sessionId = up(1);
    return chainHas(leadSessionId, sessionId) ? { kind: 'snapshot', runId, sessionId } : null;
  }

  return null;
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

const FIRST_LINE_BYTES = 64 * 1024;

/**
 * Just the first line of a transcript file. Chain discovery only needs the
 * `forkedFrom` header Claude Code writes as the very first record, and these
 * files run into the megabytes — reading the whole thing to find one field on
 * line 1 would cost real time for every sibling session that turns out not to
 * be one of ours. 64 KiB is generous over any real header line (the largest
 * observed carries a full hook payload) while still bounding a read that
 * lands mid-write to something JSON.parse can only ever reject, not hang on.
 */
async function readFirstLine(file: string): Promise<string | null> {
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(FIRST_LINE_BYTES);
    const { bytesRead } = await fh.read(buf, 0, FIRST_LINE_BYTES, 0);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    const nl = text.indexOf('\n');
    return nl === -1 ? text : text.slice(0, nl);
  } finally {
    await fh.close();
  }
}

export function startFileIngest(store: Store, config: IngestConfig): FileIngest {
  const { paths } = config;
  const leadName = config.leadName ?? 'team-lead';
  let teamName = config.teamName;
  let leadSessionId = config.leadSessionId;

  // The lead session CHAIN: leadSessionId plus every session `/branch` has
  // forked from one already in it, transitively. `/branch` moves the user's
  // live conversation to a brand new session id but never touches
  // config.json, so leadSessionId alone goes stale the instant that happens —
  // this is what keeps the console's own feed, and any teammates spawned
  // after the branch, in scope. Grown by growForkChain, reseeded to just
  // leadSessionId whenever handleTeamsJson learns of an actual team change.
  const chain = new Set<string>(leadSessionId ? [leadSessionId] : []);
  // The one directory a fork of leadSessionId can appear in — every session in
  // a fork lineage lives beside its parent, under the same project slug.
  // Discovered once, from whichever sweep first sees leadSessionId's own file.
  let leadProjectDir: string | null = null;
  // sessionId -> the parent it was forked from, read once from its first line
  // and cached forever: a file's own forkedFrom link never changes once
  // Claude Code has written it.
  const forkParent = new Map<string, string>();
  // Session-root files beside leadSessionId whose first line has been fully
  // read, forked or not — so an unrelated sibling is never reopened every
  // sweep. A file is only added here once JSON.parse actually succeeds; a
  // read that lands mid-write must be retried, not given up on forever.
  const forkChecked = new Set<string>();

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
  // Transcripts a sidecar has proven belong to an ordinary Agent-tool subagent
  // dispatched from inside our own session. NOT teammates — they own no roster
  // row and no share of the team's spend — but their trees are what the Task
  // rows and the trace view read. Keyed by the transcript file, like `sidecars`.
  const subagentOf = new Map<string, { toolUseId: string; agentId: string; meta: Sidecar }>();
  const subagentFolds = new Map<string, SubagentFold>();
  // What a workflow run actually spent, read from its agents' own transcripts.
  // Scoped on the same session chain as the run's journal and snapshot, but at
  // the PUBLISH step rather than the read step — see workflow-agents.ts.
  const workflowUsage = createWorkflowUsageIngest(store, (sessionId) => chainHas(chain, sessionId));
  const unresolvedWorkflows = new Set<string>();
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
    return { costUsd: totalCost(all), tokens: tokensOf(all), split: splitTok(all) };
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

  // Files a watcher event reached before the lead's session chain could place
  // them. Their bytes were read and dropped, so the offset moved past content
  // nothing has stored — the next sweep that CAN place the file rewinds it and
  // reads it whole. Paths only, cleared as each one is recovered, and the
  // recovery costs one re-read of one file exactly once.
  const deferred = new Set<string>();

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
  const appendTranscript = (
    agent: string,
    records: TranscriptRecord[],
    fromStart: boolean,
    mtimeMs?: number,
  ) => {
    const totals = totalsFor(agent);
    for (let i = 0; i < records.length; i += INGEST_BATCH_RECORDS) {
      const payload: TranscriptPayload = {
        agent,
        records: records.slice(i, i + INGEST_BATCH_RECORDS),
      };
      if (fromStart && i === 0) payload.fromStart = true;
      // Only the last chunk carries the snapshot, so a partial read of a drain
      // can never publish a partial total. The file clock rides with it for the
      // same reason: it describes the whole file, not this slice of it.
      if (i + INGEST_BATCH_RECORDS >= records.length) {
        payload.totals = totals;
        if (mtimeMs !== undefined) payload.mtimeMs = mtimeMs;
      }
      store.append('transcript', payload, agent);
    }
    appendDrainedMail(agent, records);
  };

  /**
   * Mail the recipient has already drained, recovered from its own transcript.
   *
   * The inbox copy is written `read: false` and DELETED the moment the agent
   * takes it, so it can never report a message as read — leaving every message
   * in the console permanently `delivered · unread`, including ones acted on
   * seconds earlier. A `<teammate-message>` frame in the RECIPIENT's transcript
   * is the one artefact that proves delivery: the message is in that agent's
   * context window, at the turn boundary that pulled it in.
   *
   * Re-emitting on a re-read costs nothing — mergeMail folds by content and
   * `read` is monotonic, so the inbox copy and this one converge on the same
   * message.
   */
  const appendDrainedMail = (agent: string, records: TranscriptRecord[]) => {
    for (const rec of records) {
      if (rec.type !== 'user') continue;
      const content = rec.message?.content;
      // A frame arrives as the whole user turn, so the content is a bare
      // string; the array form is tool results, which never carries one.
      if (typeof content !== 'string' || !content.includes('<teammate-message')) continue;
      const deliveredAt = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
      if (Number.isNaN(deliveredAt)) continue;
      store.append('mail', { source: 'transcript', to: agent, text: content, deliveredAt }, agent);
    }
  };

  /**
   * The cumulative digest of one subagent's own transcript. Its RECORDS never
   * enter the store — a fan-out of twenty would put twenty whole transcripts
   * through the log to draw twenty rows — so the fold is kept here and only its
   * result travels, last-wins per toolUseId.
   */
  const appendSubagent = (transcript: string, records: TranscriptRecord[], fromStart = false) => {
    const known = subagentOf.get(transcript);
    if (!known) return;
    let fold = subagentFolds.get(transcript);
    if (!fold || fromStart) {
      fold = emptySubagentFold();
      subagentFolds.set(transcript, fold);
    }
    if (records.length > 0) foldSubagentRecords(fold, records);
    const payload: SubagentPayload = {
      toolUseId: known.toolUseId,
      agentId: known.agentId,
      meta: {
        name: known.meta.name,
        agentType: known.meta.agentType,
        model: known.meta.model,
        description: known.meta.description,
      },
      digest: digestOf(fold),
    };
    // No `agent`: the store's per-agent budgets are a roster device, and a
    // subagent must not spend a teammate's.
    store.append('subagent', payload);
  };

  /**
   * Registers a subagent from its sidecar. `toolUseId` is what makes it
   * placeable — it names the parent tool_use the tree hangs it off — so a
   * sidecar without one describes something this console cannot draw and is
   * left alone.
   */
  const adoptSubagent = (transcript: string, meta: Sidecar): void => {
    const toolUseId = meta.toolUseId;
    if (!toolUseId) return;
    const agentId = subagentIdOf(transcript, chain);
    if (!agentId) return; // another session's, or a workflow fan-out
    const first = !subagentOf.has(transcript);
    subagentOf.set(transcript, { toolUseId, agentId, meta });
    if (!first) return;
    // Whatever the pending buffer read before the sidecar could say what this
    // file was. Never `fromStart`: PENDING_CAP may have dropped its front.
    const buffered = pending.get(transcript)?.records ?? [];
    dropPending(transcript);
    appendSubagent(transcript, buffered);
    // The sweep records a file's mtime whether or not it read it, so a subagent
    // that had already finished when its sidecar was judged would never be
    // offered again — asking for it here is the only thing that reads it.
    void transcripts.pump(transcript);
  };

  const handleSubagentLines = (transcript: string, lines: string[], fromStart: boolean) => {
    const records: TranscriptRecord[] = [];
    for (const l of lines) {
      const rec = parseLine(l);
      if (rec) records.push(rec);
    }
    if (records.length === 0) return;
    appendSubagent(transcript, records, fromStart);
  };

  const flushPending = (agent: string, transcript: string) => {
    const buf = pending.get(transcript);
    dropPending(transcript);
    // Never `fromStart`: PENDING_CAP may already have dropped the front of the
    // buffer, so this is not provably the file from its first byte.
    if (buf && buf.records.length > 0) appendTranscript(agent, buf.records, false);
  };

  const handleLines = (file: string, lines: string[], fromStart: boolean, mtimeMs?: number) => {
    // Before the claim and before `disowned`: a subagent is deliberately BOTH
    // of those — no claim on a roster name, and forgotten as a teammate — and
    // it is still read, just into its own contract.
    if (subagentOf.has(file)) {
      handleSubagentLines(file, lines, fromStart);
      return;
    }
    const claim = claimOfTranscript(file, chain, leadName);
    // Not "not ours" — "not placeable YET". A subagent transcript whose session
    // has not joined the lead's chain, or the lead's own file seen before
    // config.json named the session, both land here and both become claimable
    // moments later. The drain that produced these lines already advanced the
    // offset, so returning without a note loses them permanently: the sweep's
    // own pump then reads zero new bytes and the agent stays empty forever.
    if (!claim) {
      deferred.add(file);
      return;
    }
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
      appendTranscript(agent, records, fromStart && (ownedFiles.get(agent)?.size ?? 1) <= 1, mtimeMs);
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

  const readOwnInboxes = async () => {
    if (!teamName) return;
    const dir = path.join(config.paths.teams, teamName, 'inboxes');
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return; // a team with no mailboxes yet is the ordinary case, not a fault
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const entries = await readJsonSafe<InboxEntry[]>(path.join(dir, name));
      if (!Array.isArray(entries)) continue;
      const to = name.replace(/\.json$/, '');
      store.append('mail', { source: 'inbox', to, entries }, to);
    }
  };

  const handleTeamsJson = async (file: string) => {
    const base = path.basename(file);
    const dirName = path.basename(path.dirname(file));
    if (base === 'config.json') {
      if (config.sessionOnly) return;
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
        // A genuine team change, not a /branch: reseed the chain to just the
        // new leadSessionId and forget everything growForkChain had cached
        // for the old one, or a fork of the PREVIOUS team could linger in scope.
        chain.clear();
        if (leadSessionId) chain.add(leadSessionId);
        leadProjectDir = null;
        forkParent.clear();
        forkChecked.clear();
        for (const f of [...pending.keys()]) {
          if (claimOfTranscript(f, chain, leadName)?.scoped !== true) forget(f);
        }
        for (const f of [...usageLedger.keys()]) {
          if (claimOfTranscript(f, chain, leadName)?.scoped !== true) forget(f);
        }
      }
      for (const [f, meta] of unresolvedSidecars) {
        if (meta.taskKind === 'in_process_teammate') acceptSidecar(f, meta);
        else adoptSubagent(transcriptOfSidecar(f), meta);
      }
      unresolvedSidecars.clear();
      for (const f of [...unresolvedWorkflows]) await handleWorkflowFile(f);
      // A run folded while its session was unknown has nothing left to publish
      // it — a finished run's files never move again, so no later drain would
      // ever come. This is the one moment that can.
      if (learned) workflowUsage.flush();
      // The inbox reader below fails closed while the team is unknown, and the
      // mtime gate would never offer those files again, so claim our own now
      // that we can tell which they are.
      if (learned) await readOwnInboxes();
      appendRoster();
      return;
    }
    if (dirName !== 'inboxes') return;
    // teams/<team>/inboxes/<agent>.json — the owning team is the GRANDparent,
    // so the config.json guard above never covered this path: an ingest scoped
    // to one team was reading every team's mail on the machine. Fails CLOSED
    // while the team is unknown, because a watcher event can arrive before
    // config.json is read and an append made then can never be retracted —
    // readOwnInboxes above picks ours back up the moment the team is known.
    if (!teamName || path.basename(path.dirname(path.dirname(file))) !== teamName) return;
    const to = base.replace(/\.json$/, '');
    const entries = await readJsonSafe<InboxEntry[]>(file);
    if (!Array.isArray(entries)) return;
    store.append('mail', { source: 'inbox', to, entries }, to);
  };

  /**
   * A team name is NOT the first 8 hex of its lead's session id. Claude Code
   * re-keys a team the moment it spawns its first real teammate: it deletes the
   * lead-only directory and writes `teams/session-<fresh id>/config.json` whose
   * `leadSessionId` belongs to no session on the machine — no session record,
   * no transcript. Observed on 2.1.231 across three consecutive spawns.
   *
   * So a chain seeded from config.json never contains the directory the
   * teammates actually write into, and every transcript was rejected on the
   * directory test while the roster rendered fine — a wall of named, idle
   * agents with empty panes.
   *
   * The way out needs TWO agreeing facts, not one. A sidecar naming our team is
   * not enough on its own — a foreign session's sidecar can carry any teamName
   * it likes, and admitting those is what once put three agents from an
   * unrelated session on the wall. So adopt a session directory only when the
   * sidecar names our team AND the agent it describes is in our own
   * config.json `members[]`. Both halves are written by the harness, and a
   * stranger satisfies neither: it is absent from our roster.
   */
  const isRosterMember = (name: string): boolean =>
    (lastConfig?.members ?? []).some((m) => m.name === name);

  const adoptLeadSessionOf = (transcriptPath: string): void => {
    const sessionDir = path.basename(path.dirname(path.dirname(transcriptPath)));
    if (sessionDir === '' || chain.has(sessionDir)) return;
    chain.add(sessionDir);
    // Tell the server too: this, not config.json's, is the session whose
    // SessionEnd means the console's work is over.
    config.onLeadSession?.(sessionDir);
  };

  const acceptSidecar = (file: string, meta: Sidecar): boolean => {
    const transcriptPath = transcriptOfSidecar(file);
    // Adopt BEFORE the claim: the directory test below is exactly what a
    // re-keyed team fails, and this sidecar is the proof that clears it.
    if (meta.teamName === teamName && isRosterMember(meta.name)) adoptLeadSessionOf(transcriptPath);
    // The same scope rule the transcript reader applies: a sidecar in ANOTHER
    // session's subagents directory is not ours however its teamName reads.
    // `scoped !== true` covers the wrong directory, a workflow fan-out, and the
    // window before config.json in one clause.
    const claim = claimOfTranscript(transcriptPath, chain, leadName);
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
      const transcript = transcriptOfSidecar(file);
      // Adopt BEFORE forgetting: `forget` empties the pending buffer, and those
      // lines are this subagent's own first records. A sidecar is written once,
      // so one held for want of a lead session has to be kept — the sweep's
      // mtime gate would never offer the file again.
      if (!chainKnown(chain)) unresolvedSidecars.set(file, meta);
      else adoptSubagent(transcript, meta);
      // Proven NOT a teammate: no roster row, no records under a teammate's
      // name, no share of the team's spend.
      forget(transcript);
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
    const doc = await readJsonSafe<{
      gitBranch?: string;
      branch?: string;
      name?: string;
      sessionId?: string;
    }>(file);
    // The file is named for the PID and carries the session id INSIDE it, so the
    // chain has to be tested against the document. Matching on the basename
    // compared a pid against session ids and never hit, which left this handler
    // dead on any real machine — the basename fallback is for the id-named
    // layout the fixtures use.
    const sid = typeof doc?.sessionId === 'string' ? doc.sessionId : path.basename(file, '.json');
    if (chain.size > 0 && !chain.has(sid)) return;
    // The NAME is identity, so it needs proof rather than the absence of a
    // contradiction: every session on the machine writes one of these files, and
    // with an unresolved chain the guard above lets all of them through. Naming
    // the console after a stranger's session is worse than not naming it, so an
    // unproven file contributes its branch and nothing else.
    const ours = chain.has(sid);
    const branch = doc?.gitBranch ?? doc?.branch;
    // The same file carries what the operator called the session, so the console
    // can name itself without a second read or a listing fetch.
    const sessionName = typeof doc?.name === 'string' && doc.name ? doc.name : undefined;
    if (!branch && !(ours && sessionName)) return;
    store.append('statusline', { branch, sessionName: ours ? sessionName : undefined }, leadName);
  };

  /**
   * A run's two files, whichever arrived. Held rather than dropped when the
   * lead session is not known yet: the sweep's mtime gate would never offer the
   * file a second time, so a console that starts before it has resolved its
   * session would otherwise miss every run that already existed.
   */
  const handleWorkflowFile = async (file: string): Promise<void> => {
    if (!chainKnown(chain)) {
      unresolvedWorkflows.add(file);
      return;
    }
    const claim = workflowClaimOf(file, chain);
    if (!claim) return;
    unresolvedWorkflows.delete(file);

    if (claim.kind === 'snapshot') {
      const run = parseWorkflowRun(await readJsonSafe(file));
      if (run) store.append('workflow', leanRun(run));
      return;
    }
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      return; // the run directory can vanish under us; the sweep will retry
    }
    store.append('workflow', parseWorkflowJournal(claim.runId, text.split('\n')));
  };

  const dispatchJson = async (file: string, root: string) => {
    if (root === paths.teams) await handleTeamsJson(file);
    else if (root === paths.projects) {
      if (isWorkflowPath(file)) await handleWorkflowFile(file);
      else await handleProjectsJson(file);
    }
    else if (root === paths.tasks) await handleTaskJson(file);
    else if (root === paths.sessions) await handleSessionJson(file);
  };

  const transcripts = watchAppendOnly(paths.projects, (file, lines, fromStart, mtimeMs) => {
    if (isWorkflowPath(file)) {
      void handleWorkflowFile(file).catch((err: unknown) => logError(`ingest ${file}`, err));
      return;
    }
    try {
      // Before the team-side handlers, and it can never reach `deferred`: a
      // workflow agent's transcript is not placeable as a teammate and never
      // becomes one, so it is taken here or not at all. Its own scope check
      // happens at the publish step — see createWorkflowUsageIngest.
      if (workflowUsage.handle(file, lines, fromStart)) return;
      handleLines(file, lines, fromStart, mtimeMs);
    } catch (err) {
      logError(`ingest ${file}`, err);
    }
    // Keep the sweep's mtime gate in step so it does not re-dispatch a file the
    // watcher just consumed. A file it could not PLACE was not consumed — it
    // was discarded — so that one stays off the gate: the sweep resolves the
    // session chain before it drains, and it is the only pass that can recover
    // the file. Closing the gate here is what used to strand it for good.
    if (deferred.has(file)) return;
    void fs.stat(file).then(
      (st) => marks.set(file, st.mtimeMs),
      () => undefined,
    );
  });

  const sweepTranscript = async (file: string) => {
    if (isWorkflowPath(file)) {
      await handleWorkflowFile(file);
      return;
    }
    if (subagentOf.has(file) || workflowAgentClaimOf(file)) {
      await transcripts.pump(file);
      return;
    }
    const claim = claimOfTranscript(file, chain, leadName);
    if (!claim || disowned.has(file)) return;
    notePath(sidecars.get(file)?.name ?? claim.agent, file);
    // The claim resolves now but did not when a watcher event got here first,
    // and those lines were dropped after their bytes were counted. This is the
    // first pass that can place the file, so put the whole thing back. Once
    // only: `delete` clears the note, and a re-read costs one file.
    if (deferred.delete(file)) await transcripts.forget(file);
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

  /**
   * Grows `chain` to include every session `/branch` has forked from one
   * already in it, using only the file list a sweep of paths.projects just
   * produced — no directory read of its own. Confined to leadProjectDir: the
   * console must never open the first line of every session on the machine
   * just to find its own forks, and a fork can only ever land beside its
   * parent, under the same project slug.
   */
  const growForkChain = async (files: string[]): Promise<void> => {
    if (!leadSessionId) return;
    if (!leadProjectDir) {
      const own = files.find((f) => path.basename(f) === `${leadSessionId}.jsonl`);
      if (own) leadProjectDir = path.dirname(own);
    }
    if (!leadProjectDir) return;

    for (const file of files) {
      if (!file.endsWith('.jsonl') || path.dirname(file) !== leadProjectDir) continue;
      const stem = path.basename(file, '.jsonl');
      if (forkChecked.has(stem) || SUBAGENT_FILE.test(path.basename(file))) continue;
      let firstLine: string | null;
      try {
        firstLine = await readFirstLine(file);
      } catch {
        continue; // vanished between the walk and this read — try again later
      }
      if (firstLine === null) continue;
      let parsed: { forkedFrom?: { sessionId?: string } };
      try {
        parsed = JSON.parse(firstLine) as { forkedFrom?: { sessionId?: string } };
      } catch {
        continue; // read landed mid-write; the line is not complete yet
      }
      forkChecked.add(stem);
      const parent = parsed.forkedFrom?.sessionId;
      if (parent) forkParent.set(stem, parent);
    }

    // Transitive closure: a branch of a branch joins once its own parent is
    // already in. `changed` only goes true when chain actually grows, so this
    // always halts — bounded by forkParent's size either way.
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, parent] of forkParent) {
        if (chain.has(parent) && !chain.has(id)) {
          chain.add(id);
          changed = true;
        }
      }
    }
  };

  const sweep = async (): Promise<void> => {
    for (const root of [paths.teams, paths.projects, paths.tasks, paths.sessions]) {
      // Transcripts are drained after the walk, OLDEST mtime first. Two runs of
      // one name land under one agent, and the fold takes the last record's
      // currentTool and the last assistant row's error — so a dead run read
      // after the live one shows a live agent failed, with a stale command in
      // flight. Free at boot: index.ts awaits this sweep before it listens.
      const files = await walk(root);
      // Before anything below is judged against `chain`, so a fork discovered
      // this pass is already in scope for the very same pass's drains — the
      // sweep that finds a branch is the sweep that starts reading it.
      if (root === paths.projects) await growForkChain(files);
      const drains: Array<{ file: string; mtimeMs: number }> = [];
      for (const file of files) {
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
      // Routed here as well as in the sweep, and not only for latency: `settle`
      // records the file's mtime, so a snapshot the live watcher saw first
      // would be gated out of every later sweep and never reach the run model.
      void settle(file)(isWorkflowPath(file) ? handleWorkflowFile(file) : handleProjectsJson(file));
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
