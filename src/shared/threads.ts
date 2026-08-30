import type { Cast } from './cast';
import { CONSOLE_SENDER, type Agent, type MailMessage, type Task, type TranscriptLine } from './domain';

/**
 * A conversation between two agents. Not a channel: teammates write straight
 * into each other's inbox files and the lead does not relay, so what looks like
 * one thread is a PAIR OF INBOXES read together. Participants are therefore
 * unordered — `perf → security` and `security → perf` are the same thread.
 */
export interface Thread {
  id: string;                // `${a}\u0000${b}`, participants sorted
  /**
   * `pair` is two inboxes read together. `everyone` is the whole team's traffic
   * in one room — still not a channel: nothing is addressed to the room, it is
   * every direct message laid end to end, which is why each line in it goes on
   * naming the one agent it was actually sent to.
   */
  kind: 'pair' | 'everyone';
  a: string;                 // first participant, alphabetically; '' for everyone
  b: string;
  pair: string;              // `perf ⇄ security`, or `everyone`
  topic: string;             // newest message's summary, else its body
  messages: MailMessage[];   // oldest first
  unread: number;
  lastTs: number;
}

/** How the team-wide room is addressed. A pair id joins two names with a NUL, so it cannot collide. */
export const EVERYONE_ID = 'everyone';

export type ThreadState = 'live' | 'unread' | 'settled';

export const THREAD_STATE: Record<ThreadState, { glyph: string; color: string }> = {
  live: { glyph: '●', color: 'var(--color-accent-400)' },
  unread: { glyph: '◆', color: 'var(--warn)' },
  settled: { glyph: '·', color: 'var(--color-neutral-700)' },
};

function topicOf(newest: MailMessage): string {
  if (newest.summary) return newest.summary;
  if (newest.protocol) return newest.protocol.type.replace(/_/g, ' ');
  return newest.text;
}

/**
 * Groups mail into threads, newest exchange first. A message with no
 * counterpart — an agent writing to itself — is not a conversation and is left
 * out rather than given a thread whose two sides are the same inbox.
 *
 * The operator is left out too. Their messages to the lead arrive stamped
 * `console` (a message to the lead cannot arrive as the lead), and pairing on
 * that name produces a `console ⇄ team-lead` row that reads as a sixth agent
 * having joined the team. The operator is not a member and has no face; the
 * room already renders those messages, as `you`.
 */
export function threadsOf(mail: MailMessage[]): Thread[] {
  const byPair = new Map<string, MailMessage[]>();
  for (const m of mail) {
    if (m.from === m.to) continue;
    if (m.from === CONSOLE_SENDER || m.to === CONSOLE_SENDER) continue;
    const [a, b] = [m.from, m.to].sort();
    const id = `${a}\u0000${b}`;
    const list = byPair.get(id);
    if (list) list.push(m);
    else byPair.set(id, [m]);
  }

  const threads: Thread[] = [];
  for (const [id, unsorted] of byPair) {
    const messages = [...unsorted].sort((x, y) => x.ts - y.ts);
    const [a, b] = id.split('\u0000');
    const newest = messages[messages.length - 1];
    threads.push({
      id,
      kind: 'pair',
      a,
      b,
      pair: `${a} ⇄ ${b}`,
      topic: topicOf(newest),
      messages,
      unread: messages.filter((m) => !m.read).length,
      lastTs: newest.ts,
    });
  }
  return threads.sort((x, y) => y.lastTs - x.lastTs || x.id.localeCompare(y.id));
}

/**
 * Every message the team has exchanged, in one room, newest last.
 *
 * Deliberately NOT a seventh inbox: the team has no group channel, so this is
 * the same direct messages the pair threads hold, re-read end to end. Each line
 * keeps its `→ recipient`, because "who it was sent to" is the thing a single
 * room would otherwise throw away.
 *
 * Null when there is nothing to show, so the list does not offer an empty room.
 */
export function everyoneThread(mail: MailMessage[]): Thread | null {
  const messages = mail.filter((m) => m.from !== m.to).sort((x, y) => x.ts - y.ts);
  if (messages.length === 0) return null;
  return {
    id: EVERYONE_ID,
    kind: 'everyone',
    a: '',
    b: '',
    pair: 'all messages',
    topic: 'every inbox, merged',
    messages,
    unread: messages.filter((m) => !m.read).length,
    lastTs: messages[messages.length - 1].ts,
  };
}

/** One send as the room shows it, after the copies of a broadcast are folded back together. */
export interface RoomLine {
  key: string;
  from: string;
  to: string[];              // every inbox this one send reached
  message: MailMessage;      // representative copy — text, protocol, timestamp
  read: boolean;             // only once EVERY copy has been drained
  ts: number;
}

/** Copies of one broadcast land in separate inboxes microseconds apart. */
const BROADCAST_WINDOW_MS = 2000;

/**
 * Folds a broadcast back into one line. With no group inbox, "message the team"
 * is N direct messages with the same body — rendered raw, the room repeats the
 * operator N times. Same sender and same text inside a short window is that
 * fan-out; two agents happening to send identical prose is not a thing.
 *
 * `read` is the AND over the copies: the room may not call a broadcast read
 * while a member still has it sitting unopened.
 */
export function roomLines(messages: MailMessage[]): RoomLine[] {
  const lines: RoomLine[] = [];
  for (const m of messages) {
    const last = lines[lines.length - 1];
    if (
      last &&
      last.from === m.from &&
      last.message.text === m.text &&
      m.ts - last.ts <= BROADCAST_WINDOW_MS
    ) {
      last.to.push(m.to);
      last.read = last.read && m.read;
      continue;
    }
    lines.push({ key: m.msgId, from: m.from, to: [m.to], message: m, read: m.read, ts: m.ts });
  }
  return lines;
}

/**
 * `to everyone` once a send reached every other member, else the names it did
 * reach. The names are display, so a `cast` renames them; the `to` list it
 * reads stays the real inboxes, which is what `reached` is matched on.
 */
export function roomRecipients(line: RoomLine, agents: Agent[], cast?: Cast): string {
  const others = agents.filter((a) => a.name !== line.from).map((a) => a.name);
  const reached = new Set(line.to);
  if (others.length > 1 && others.every((n) => reached.has(n))) return 'to everyone';
  const shown = cast ? line.to.map((n) => cast.asChar(n).display) : line.to;
  return `→ ${shown.join(', ')}`;
}

/**
 * A thread's heading. `Thread.pair` is built from the real names, because that
 * is what threading itself works on; this is how it is SHOWN. The room's label
 * is not a pair of names at all, so it passes through unchanged.
 */
export function pairLabel(thread: Thread, cast: Cast): string {
  if (thread.kind === 'everyone') return thread.pair;
  return `${cast.asChar(thread.a).display} ⇄ ${cast.asChar(thread.b).display}`;
}

/**
 * `live` while either agent is still taking turns, so the exchange can move on
 * its own; `unread` is the one that needs the operator — a message sitting in
 * an inbox nobody is draining. A live thread's unread clears itself at the
 * recipient's next turn boundary, which is why live outranks it.
 */
export function stateOf(thread: Thread, agents: Agent[]): ThreadState {
  const working = (name: string) => agents.some((x) => x.name === name && x.status === 'working');
  // The room is live while ANY agent is still taking turns — it has no pair to ask.
  if (thread.kind === 'everyone') {
    if (agents.some((a) => a.status === 'working')) return 'live';
    return thread.unread > 0 ? 'unread' : 'settled';
  }
  if (working(thread.a) || working(thread.b)) return 'live';
  return thread.unread > 0 ? 'unread' : 'settled';
}

// Every user-role record opens a turn; `markerForUserText` in transcript.ts
// emits exactly these three for one.
const TURN_MARKERS = new Set(['❯', '▲', '○']);

/**
 * Which of the recipient's turns read a message. A message lands in the inbox
 * and is drained at the recipient's NEXT turn boundary, so that boundary is the
 * first one at or after the send time.
 *
 * Counted over the transcript the console holds, not over the session: the
 * store bounds history per agent and the projection trims it further, so an
 * absolute turn number is not derivable. Returns undefined when the boundary
 * falls outside that window — a plain `read` is honest, a fabricated ordinal
 * sitting next to the transcript that contradicts it is not.
 */
export function readTurnOf(sentAt: number, transcript: TranscriptLine[]): number | undefined {
  let turn = 0;
  for (const line of transcript) {
    if (!TURN_MARKERS.has(line.marker)) continue;
    turn += 1;
    if (line.ts >= sentAt) return turn;
  }
  return undefined;
}

const PROTOCOL_TASK_KEYS = ['taskId', 'task_id'];

/**
 * The tasks an exchange concerns: ones a protocol frame names outright, plus
 * ones the agents mention by id in prose. Matched against the real task list so
 * a `T-07` written into a sentence that is not a task id cannot invent a task.
 */
export function taskIdsOf(thread: Thread, tasks: Task[]): string[] {
  const known = new Set(tasks.map((t) => t.id));
  const found = new Set<string>();
  for (const m of thread.messages) {
    for (const key of PROTOCOL_TASK_KEYS) {
      const id = m.protocol?.data[key];
      if (typeof id === 'string' && known.has(id)) found.add(id);
    }
    for (const id of known) {
      if (m.text.includes(id)) found.add(id);
    }
  }
  return [...found].sort();
}

/**
 * A teammate mid-`SendMessage` has written the message but not yet handed it to
 * the tool, so it is in neither inbox — the one moment a chat can show that
 * something is coming without claiming it has arrived.
 */
export function composingIn(thread: Thread, agents: Agent[]): string | undefined {
  const inThread = (a: Agent) =>
    thread.kind === 'everyone' || a.name === thread.a || a.name === thread.b;
  return agents.find((a) => inThread(a) && a.currentTool?.startsWith('SendMessage'))?.name;
}
