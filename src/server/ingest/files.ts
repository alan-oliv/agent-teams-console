import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drain, emptyTailState, watchAppendOnly, type TailState } from '../watch/tail';
import { readJsonSafe, watchJsonTree } from '../watch/jsonfile';
import type { Store } from '../store';
import type { TaskPayload } from '../project';
import { parseLine, type TranscriptRecord } from '../../shared/transcript';
import type { TeamConfig, Sidecar } from '../../shared/roster';
import type { InboxEntry } from '../../shared/mailbox';
import { logError } from '../log';

export const DEFAULT_SWEEP_MS = 5000;
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
  /**
   * Fires when config.json tells us which team this is. The console can be
   * started before any team exists (`npm start` by hand), so this is the only
   * point at which the store learns what to scope its log to.
   */
  onTeam?: (info: { teamName: string; leadSessionId: string }) => void;
}

export interface FileIngest {
  sweep(): Promise<void>;
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
  // The sweep keeps its own tail state because watchAppendOnly owns the primary
  // one. Both readers see every byte once; project.ts dedupes records by uuid,
  // so a re-read during a watcher gap is harmless rather than a duplicate line.
  const sweepTails = new Map<string, TailState>();
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
  const pending = new Map<string, TranscriptRecord[]>();
  const PENDING_CAP = 500;

  const flushPending = (agent: string) => {
    const buf = pending.get(agent);
    pending.delete(agent);
    if (buf && buf.length > 0) store.append('transcript', { agent, records: buf }, agent);
  };

  const handleLines = (file: string, lines: string[]) => {
    const agent = agentOfTranscript(file, leadSessionId, leadName);
    if (!agent) return;
    const records: TranscriptRecord[] = [];
    for (const l of lines) {
      const rec = parseLine(l);
      if (rec) records.push(rec);
    }
    if (records.length === 0) return;

    if (agent === leadName || sidecars.has(agent)) {
      flushPending(agent);
      store.append('transcript', { agent, records }, agent);
      return;
    }
    const buf = pending.get(agent) ?? [];
    buf.push(...records);
    pending.set(agent, buf.slice(-PENDING_CAP));
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
      appendRoster();
      return;
    }
    if (dirName !== 'inboxes') return;
    const to = base.replace(/\.json$/, '');
    const entries = await readJsonSafe<InboxEntry[]>(file);
    if (!Array.isArray(entries)) return;
    store.append('mail', { source: 'inbox', to, entries }, to);
  };

  const handleProjectsJson = async (file: string) => {
    if (!file.endsWith('.meta.json')) return;
    const meta = await readJsonSafe<Sidecar>(file);
    if (!meta) return;
    if (meta.taskKind !== 'in_process_teammate' || (teamName && meta.teamName !== teamName)) {
      // Proven NOT a teammate — discard anything buffered under that name.
      if (meta.name) pending.delete(meta.name);
      return;
    }
    sidecars.set(meta.name, { meta, transcriptPath: file.replace(/\.meta\.json$/, '.jsonl') });
    flushPending(meta.name);
    appendRoster();
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

  const sweepTranscript = async (file: string) => {
    const agent = agentOfTranscript(file, leadSessionId, leadName);
    if (!agent) return;
    const out = await drain(file, sweepTails.get(file) ?? emptyTailState());
    sweepTails.set(file, out.state);
    if (out.lines.length > 0) handleLines(file, out.lines);
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
    watchAppendOnly(paths.projects, (file, lines) => {
      try {
        handleLines(file, lines);
      } catch (err) {
        logError(`ingest ${file}`, err);
      }
      void fs.stat(file).then(
        (st) => {
          marks.set(file, st.mtimeMs);
          if (!sweepTails.has(file)) {
            sweepTails.set(file, { inode: st.ino, offset: st.size, partial: '' });
          }
        },
        () => undefined,
      );
    }),
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
  const timer =
    interval > 0
      ? setInterval(() => {
          void sweep().catch((err: unknown) => logError('reconciliation sweep', err));
        }, interval)
      : null;
  timer?.unref?.();

  return {
    sweep,
    close() {
      closed = true;
      if (timer) clearInterval(timer);
      for (const w of watchers) w.close();
    },
  };
}
