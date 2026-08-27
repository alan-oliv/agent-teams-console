import type { MailMessage, ProtocolFrameType } from './domain';

export interface InboxEntry {
  from: string; text: string; summary?: string; timestamp: string;
  color?: string; msgV?: number; msg_id?: string; type?: string; read?: boolean;
}

const PROTOCOL_TYPES = new Set<string>([
  'task_assignment', 'task_completed', 'idle_notification',
  'plan_approval_request', 'plan_approval_response',
  'permission_request', 'permission_response',
  'shutdown_request', 'shutdown_approved', 'shutdown_rejected',
  'mode_set_request', 'teammate_terminated',
] satisfies ProtocolFrameType[]);

const FRAME_RE = /<teammate-message\s+([^>]*?)>\r?\n?([\s\S]*?)\r?\n?<\/teammate-message>/g;
const ATTR_RE = /(\w+)="([^"]*)"/g;

function fnv1a32(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Backfilled frames carry no msg_id, so one is synthesised from the content the
// transcript does preserve. It is stable across re-reads of the same transcript.
function synthMsgId(from: string, text: string, ts: number): string {
  return `bk-${fnv1a32(`${from}\u0000${text}\u0000${ts}`)}`;
}

function detectProtocol(text: string): MailMessage['protocol'] {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const data = parsed as Record<string, unknown>;
  const type = data.type;
  if (typeof type !== 'string' || !PROTOCOL_TYPES.has(type)) return undefined;
  return { type: type as ProtocolFrameType, data };
}

export function parseInboxEntry(e: InboxEntry, to: string): MailMessage {
  const parsedTs = Date.parse(e.timestamp);
  const ts = Number.isNaN(parsedTs) ? 0 : parsedTs;
  return {
    msgId: e.msg_id ?? synthMsgId(e.from, e.text, ts),
    from: e.from,
    to,
    text: e.text,
    summary: e.summary,
    ts,
    tsIsDelivery: false,
    color: e.color,
    protocol: detectProtocol(e.text),
  };
}

export function parseTeammateFrames(text: string, deliveredAt: number, to: string): MailMessage[] {
  const out: MailMessage[] = [];
  FRAME_RE.lastIndex = 0;
  let frame: RegExpExecArray | null;
  while ((frame = FRAME_RE.exec(text)) !== null) {
    const attrs: Record<string, string> = {};
    ATTR_RE.lastIndex = 0;
    let attr: RegExpExecArray | null;
    while ((attr = ATTR_RE.exec(frame[1])) !== null) attrs[attr[1]] = attr[2];

    const from = attrs.teammate_id;
    if (!from) continue;
    const body = frame[2];
    out.push({
      msgId: synthMsgId(from, body, deliveredAt),
      from,
      to,
      text: body,
      summary: attrs.summary,
      ts: deliveredAt,
      tsIsDelivery: true,
      color: attrs.color,
      protocol: detectProtocol(body),
    });
  }
  return out;
}

function contentKey(m: MailMessage): string {
  return `${m.from}\u0000${m.to}\u0000${m.text}`;
}

export function mergeMail(existing: MailMessage[], incoming: MailMessage[]): MailMessage[] {
  const all = [...existing, ...incoming];
  // Inbox entries are folded first so their real msg_id becomes the canonical id
  // for a message the transcript also backfilled under a synthesised one.
  const ordered = [...all.filter((m) => !m.tsIsDelivery), ...all.filter((m) => m.tsIsDelivery)];

  const canonicalId = new Map<string, string>();
  const kept = new Map<string, MailMessage>();
  for (const message of ordered) {
    const key = contentKey(message);
    const id = canonicalId.get(key) ?? message.msgId;
    canonicalId.set(key, id);
    const previous = kept.get(id);
    if (!previous) {
      kept.set(id, { ...message, msgId: id });
      continue;
    }
    if (previous.tsIsDelivery && !message.tsIsDelivery) kept.set(id, { ...message, msgId: id });
  }
  return [...kept.values()].sort((a, b) => a.ts - b.ts);
}
