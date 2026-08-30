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
    read: e.read === true,
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
      // A frame in the recipient's own transcript is the message inside its
      // context window: it was drained at that turn boundary by definition.
      read: true,
      color: attrs.color,
      protocol: detectProtocol(body),
    });
  }
  return out;
}

/**
 * The same text with each frame replaced by the message inside it. A delivery
 * carries as many frames as drained at that turn boundary, from as many
 * senders, and any prose around them is the recipient's own context.
 *
 * It does NOT reliably open with a preamble line, and it is NOT reliably more
 * than a bare frame — this comment used to claim both, and the fixtures
 * disprove each. `probe-bravo` record 22 is one frame with nothing around it
 * and is an ordinary delivery; `probe-alpha` record 0 is one frame with nothing
 * around it and is a spawn prompt. Identical shape, opposite meaning. So shape
 * cannot tell a delivery from a prompt, and nothing here should try: what
 * discriminates is AUTHORSHIP, and only the envelope carries it. Content that
 * arrives with no frame at all is the operator's own typing; a frame is another
 * agent's message, whoever that agent is. See `deliveryDrafts` in
 * shared/transcript.ts, which is where that rule lives.
 */
export function unwrapTeammateFrames(text: string): string {
  FRAME_RE.lastIndex = 0;
  return text.replace(FRAME_RE, (_frame, _attrs: string, body: string) => body);
}

/** One delivered message, or a run of the recipient's own prose between two. */
export interface DeliveryPart {
  /** The teammate that sent this part. Absent on the surrounding prose. */
  from?: string;
  text: string;
}

/**
 * The same unwrapping, but keeping who sent what. A record is not a message:
 * the real lead delivery in the corpus carries six frames from three teammates,
 * because a lead's queued mail all drains at one turn boundary. Concatenating
 * the parts' text reproduces {@link unwrapTeammateFrames} exactly, so the two
 * cannot drift.
 */
export function splitTeammateDelivery(text: string): DeliveryPart[] {
  const parts: DeliveryPart[] = [];
  FRAME_RE.lastIndex = 0;
  let at = 0;
  let frame: RegExpExecArray | null;
  while ((frame = FRAME_RE.exec(text)) !== null) {
    const attrs: Record<string, string> = {};
    ATTR_RE.lastIndex = 0;
    let attr: RegExpExecArray | null;
    while ((attr = ATTR_RE.exec(frame[1])) !== null) attrs[attr[1]] = attr[2];

    if (frame.index > at) parts.push({ text: text.slice(at, frame.index) });
    // An unattributable frame still has to contribute its body, or the parts
    // stop rejoining to the unwrapped text.
    parts.push(attrs.teammate_id ? { from: attrs.teammate_id, text: frame[2] } : { text: frame[2] });
    at = frame.index + frame[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts.length > 0 ? parts : [{ text }];
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
    // Read is monotonic and the two sources disagree in one direction only: the
    // inbox flag can still say false on a copy the recipient's transcript has
    // already proved it consumed, and this fold prefers the inbox copy.
    const read = previous.read || message.read;
    if (previous.tsIsDelivery && !message.tsIsDelivery) kept.set(id, { ...message, msgId: id, read });
    else if (read !== previous.read) kept.set(id, { ...previous, read });
  }
  return [...kept.values()].sort((a, b) => a.ts - b.ts);
}
