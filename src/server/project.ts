import type { StoredEvent } from './store';
import type {
  Agent,
  AgentStatus,
  MailMessage,
  NeedsYouItem,
  RateLimits,
  Task,
  TeamState,
  TranscriptLine,
} from '../shared/domain';
import { buildRoster, type Sidecar, type TeamConfig } from '../shared/roster';
import { resolveModel } from '../shared/catalog';
import { contextOccupancy, dedupeUsage, totalCost, type UsageRecord } from '../shared/usage';
import { currentToolOf, toTranscriptLines, type TranscriptRecord } from '../shared/transcript';
import {
  mergeMail,
  parseInboxEntry,
  parseTeammateFrames,
  type InboxEntry,
} from '../shared/mailbox';
import { deriveTaskState } from '../shared/status';

export const TRANSCRIPT_CAP = 2000;

// ---------------------------------------------------------------------------
// Event payload shapes. The pinned contract fixes `EventKind` but not what each
// kind carries, so these are defined here and consumed by src/server/ingest/*.
// ---------------------------------------------------------------------------
export interface RosterPayload {
  config: TeamConfig | null;
  sidecars: Array<{ meta: Sidecar; transcriptPath: string }>;
}
export interface TranscriptPayload {
  agent: string;
  records: TranscriptRecord[];
}
export interface TaskPayload {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  owner?: string;
  status: 'pending' | 'in_progress' | 'completed';
  blocks: string[];
  blockedBy: string[];
}
export type MailPayload =
  | { source: 'inbox'; to: string; entries: InboxEntry[] }
  | { source: 'transcript'; to: string; text: string; deliveredAt: number };
export interface HookPayload {
  event: string;
  agent: string;
  toolName?: string;
  text?: string;
  error?: string;
}
export interface StatuslinePayload {
  totalCostUsd?: number;
  contextTokens?: number;
  contextWindow?: number;
  branch?: string;
  fiveHourPct?: number;
  sevenDayPct?: number;
  resetsAt?: string;
}
export interface SubstatusPayload {
  agent: string;
  tokenCount?: number;
  contextWindowSize?: number;
  status?: string;
  model?: string;
}
export interface NeedsYouResolvedPayload {
  id: string;
}

function usageRecordsOf(records: TranscriptRecord[]): UsageRecord[] {
  const out: UsageRecord[] = [];
  for (const r of records) {
    if (r.type !== 'assistant') continue;
    const usage = r.message?.usage;
    if (!usage) continue;
    out.push({
      messageId: r.message?.id ?? r.uuid ?? '',
      model: r.message?.model ?? '',
      usage,
    });
  }
  return out;
}

/**
 * Tokens the team actually put through the model. `cache_read_input_tokens` is
 * the whole prefix re-read on every turn, so summing it counts the same tokens
 * once per message — on a real session that reached 1.8 billion, which is not a
 * number anyone can act on. Context occupancy is a separate measure and lives
 * on each Agent as `contextTokens`.
 */
function tokensOf(records: UsageRecord[]): number {
  let sum = 0;
  for (const r of records) {
    sum +=
      (r.usage.input_tokens ?? 0) +
      (r.usage.output_tokens ?? 0) +
      (r.usage.cache_creation_input_tokens ?? 0);
  }
  return sum;
}

function lastAssistantModel(records: TranscriptRecord[]): string | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const m = records[i].message?.model;
    if (records[i].type === 'assistant' && m) return m;
  }
  return undefined;
}

export function project(events: StoredEvent[], readOnly: boolean): TeamState {
  let config: TeamConfig | null = null;
  let sidecars: Array<{ meta: Sidecar; transcriptPath: string }> = [];
  let branch: string | undefined;
  let rateLimits: RateLimits | undefined;

  const records = new Map<string, TranscriptRecord[]>();
  const seenRecords = new Map<string, Set<string>>();
  const tasksRaw = new Map<string, TaskPayload>();
  const unread = new Map<string, number>();
  const substatus = new Map<string, SubstatusPayload>();
  const currentTool = new Map<string, string | undefined>();
  const errors = new Map<string, string>();
  const lastActivity = new Map<string, number>();
  const needsYou = new Map<string, NeedsYouItem>();
  let mail: MailMessage[] = [];

  const bump = (agent: string, ts: number) => {
    if (ts > (lastActivity.get(agent) ?? -1)) lastActivity.set(agent, ts);
  };

  for (const ev of events) {
    switch (ev.kind) {
      case 'roster': {
        const p = ev.payload as RosterPayload;
        if (p.config) config = p.config;
        if (p.sidecars && p.sidecars.length > 0) sidecars = p.sidecars;
        break;
      }
      case 'transcript': {
        const p = ev.payload as TranscriptPayload;
        const list = records.get(p.agent) ?? [];
        const seen = seenRecords.get(p.agent) ?? new Set<string>();
        for (const rec of p.records) {
          // The 5s reconciliation sweep deliberately re-reads files, so the same
          // record can arrive twice; the record uuid is the dedupe key.
          const key = rec.uuid ?? '';
          if (key && seen.has(key)) continue;
          if (key) seen.add(key);
          list.push(rec);

          const tool = currentToolOf(rec);
          if (tool) currentTool.set(p.agent, tool);
          else if (rec.type === 'user' && rec.toolUseResult !== undefined) {
            currentTool.set(p.agent, undefined);
          }
          if (rec.type === 'assistant') {
            if (rec.isApiErrorMessage) {
              errors.set(p.agent, toTranscriptLines(rec)[0]?.text ?? 'api error');
            } else {
              errors.delete(p.agent);
            }
          }
          const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
          if (!Number.isNaN(ts)) bump(p.agent, ts);
        }
        records.set(p.agent, list);
        seenRecords.set(p.agent, seen);
        break;
      }
      case 'task': {
        const p = ev.payload as TaskPayload;
        tasksRaw.set(p.id, p);
        break;
      }
      case 'mail': {
        const p = ev.payload as MailPayload;
        if (p.source === 'inbox') {
          mail = mergeMail(mail, p.entries.map((e) => parseInboxEntry(e, p.to)));
          unread.set(p.to, p.entries.filter((e) => e.read === false).length);
        } else {
          mail = mergeMail(mail, parseTeammateFrames(p.text, p.deliveredAt, p.to));
        }
        break;
      }
      case 'hook': {
        const p = ev.payload as HookPayload;
        if (p.event === 'PreToolUse' && p.toolName) currentTool.set(p.agent, p.toolName);
        if (p.event === 'PostToolUse') currentTool.set(p.agent, undefined);
        if (p.error) errors.set(p.agent, p.error);
        bump(p.agent, ev.ts);
        break;
      }
      case 'statusline': {
        const p = ev.payload as StatuslinePayload;
        if (p.branch) branch = p.branch;
        if (p.fiveHourPct !== undefined || p.sevenDayPct !== undefined) {
          rateLimits = {
            fiveHourPct: p.fiveHourPct ?? 0,
            sevenDayPct: p.sevenDayPct ?? 0,
            resetsAt: p.resetsAt,
          };
        }
        break;
      }
      case 'substatus': {
        const p = ev.payload as SubstatusPayload;
        substatus.set(p.agent, { ...substatus.get(p.agent), ...p });
        break;
      }
      case 'needsyou': {
        const item = ev.payload as NeedsYouItem;
        needsYou.set(item.id, item);
        break;
      }
      case 'needsyou-resolved': {
        needsYou.delete((ev.payload as NeedsYouResolvedPayload).id);
        break;
      }
    }
  }

  const lastIdle = new Map<string, number>();
  for (const m of mail) {
    if (m.protocol?.type === 'idle_notification' && m.ts > (lastIdle.get(m.from) ?? -1)) {
      lastIdle.set(m.from, m.ts);
    }
  }

  // A permission card outlives the permit it stands for when the process that
  // held it is gone, and `allow` then 404s forever. Expiry is the only thing
  // that can retire one, so it is enforced here rather than trusted to arrive.
  const cards = [...needsYou.values()].filter(
    (c) => c.expiresAt === undefined || c.expiresAt > Date.now(),
  );
  let totalTokens = 0;

  // Liveness comes ONLY from config.json membership. The sidecars survive a
  // teammate's exit on purpose (§2.2), so an agent present there but no longer
  // in `members[]` has finished, not gone idle — and a null config (lead
  // exited, team dir gone) means nobody is live.
  const liveMembers = config ? new Set(config.members.map((m) => m.name)) : null;

  const agents: Agent[] = buildRoster(config, sidecars).map((id) => {
    const recs = records.get(id.name) ?? [];
    const sub = substatus.get(id.name);
    const resolved = resolveModel(lastAssistantModel(recs) ?? sub?.model ?? id.rawModel);
    const usage = dedupeUsage(usageRecordsOf(recs));
    totalTokens += tokensOf(usage);

    const lines: TranscriptLine[] = [];
    for (const rec of recs) for (const l of toTranscriptLines(rec)) lines.push(l);

    let status: AgentStatus = 'working';
    if (!liveMembers || !liveMembers.has(id.name)) status = 'departed';
    else if (errors.has(id.name)) status = 'failed';
    else if (cards.some((c) => c.agent === id.name && c.kind === 'plan')) status = 'plan_pending';
    else {
      const act = lastActivity.get(id.name) ?? -1;
      const idle = lastIdle.get(id.name) ?? -1;
      if (act < 0 || idle >= act) status = 'idle';
    }

    return {
      name: id.name,
      agentId: id.agentId,
      isLead: id.isLead,
      agentType: id.agentType,
      model: resolved.canonical,
      role: id.role,
      color: id.color,
      status,
      currentTool: currentTool.get(id.name),
      contextTokens: sub?.tokenCount ?? contextOccupancy(recs),
      contextLimit: resolved.window,
      compactAt: resolved.compactAt,
      costUsd: totalCost(usage),
      startedAt: id.joinedAt,
      transcript: lines.slice(-TRANSCRIPT_CAP),
      unread: unread.get(id.name) ?? 0,
      error: errors.get(id.name),
    };
  });

  const tasks: Task[] = [...tasksRaw.values()].map((t) => ({
    id: t.id,
    subject: t.subject,
    description: t.description,
    activeForm: t.activeForm,
    owner: t.owner,
    state: deriveTaskState(t.status, { owner: t.owner, blockedBy: t.blockedBy ?? [] }, agents),
    blocks: t.blocks ?? [],
    blockedBy: t.blockedBy ?? [],
  }));

  // Agent 'blocked' needs the derived task states, so it is a second pass.
  for (const agent of agents) {
    if (agent.status !== 'working') continue;
    if (tasks.some((t) => t.owner === agent.name && t.state === 'blocked')) agent.status = 'blocked';
  }

  return {
    teamName: config?.name ?? '',
    leadSessionId: config?.leadSessionId ?? '',
    branch,
    startedAt: config?.createdAt ?? 0,
    totalTokens,
    totalCostUsd: agents.reduce((sum, a) => sum + a.costUsd, 0),
    rateLimits,
    agents,
    tasks,
    mail,
    needsYou: cards,
    readOnly,
  };
}
