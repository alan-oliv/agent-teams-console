import { describe, expect, it } from 'vitest';
import { CONSOLE_SENDER, type Agent, type MailMessage, type Task, type TranscriptLine } from './domain';
import {
  composingIn,
  everyoneThread,
  readTurnOf,
  resolveDelivery,
  roomLines,
  roomRecipients,
  stateOf,
  taskIdsOf,
  THREAD_STATE,
  threadsOf,
  type Thread,
} from './threads';

const T0 = Date.parse('2026-08-27T15:10:00.000Z');

function mail(over: Partial<MailMessage> & Pick<MailMessage, 'from' | 'to'>): MailMessage {
  return {
    msgId: `${over.from}-${over.to}-${over.ts ?? T0}`,
    text: 'body',
    ts: T0,
    tsIsDelivery: false,
    read: true,
    ...over,
  };
}

function agent(name: string, over: Partial<Agent> = {}): Agent {
  return {
    name,
    agentId: `${name}@team`,
    isLead: name === 'team-lead',
    agentType: 'general-purpose',
    model: 'claude-opus-5',
    role: 'role',
    status: 'idle',
    contextTokens: 0,
    contextLimit: 200_000,
    compactAt: 167_000,
    costUsd: 0,
    startedAt: T0,
    transcript: [],
    unread: 0,
    ...over,
  };
}

describe('threadsOf', () => {
  it('reads a pair of inboxes as one thread, whichever way a message went', () => {
    const threads = threadsOf([
      mail({ from: 'perf', to: 'security', ts: T0 }),
      mail({ from: 'security', to: 'perf', ts: T0 + 1000 }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].pair).toBe('perf ⇄ security');
    expect(threads[0].a).toBe('perf');
    expect(threads[0].b).toBe('security');
    expect(threads[0].messages.map((m) => m.from)).toEqual(['perf', 'security']);
  });

  it('orders messages oldest first however the mail arrived', () => {
    const threads = threadsOf([
      mail({ from: 'perf', to: 'security', ts: T0 + 2000, text: 'third' }),
      mail({ from: 'security', to: 'perf', ts: T0, text: 'first' }),
      mail({ from: 'perf', to: 'security', ts: T0 + 1000, text: 'second' }),
    ]);
    expect(threads[0].messages.map((m) => m.text)).toEqual(['first', 'second', 'third']);
  });

  it('puts the thread that moved most recently at the top', () => {
    const threads = threadsOf([
      mail({ from: 'perf', to: 'security', ts: T0 }),
      mail({ from: 'tests', to: 'team-lead', ts: T0 + 5000 }),
    ]);
    expect(threads.map((t) => t.pair)).toEqual(['team-lead ⇄ tests', 'perf ⇄ security']);
  });

  it('counts the messages still sitting in an inbox', () => {
    const threads = threadsOf([
      mail({ from: 'perf', to: 'security', ts: T0, read: true }),
      mail({ from: 'perf', to: 'security', ts: T0 + 1000, read: false }),
      mail({ from: 'security', to: 'perf', ts: T0 + 2000, read: false }),
    ]);
    expect(threads[0].unread).toBe(2);
  });

  it('drops a message an agent sent to itself — that is not a conversation', () => {
    expect(threadsOf([mail({ from: 'perf', to: 'perf' })])).toEqual([]);
  });

  it('takes the topic from the newest message summary, then its protocol, then its body', () => {
    const [summarised] = threadsOf([
      mail({ from: 'perf', to: 'security', summary: 'batching vs rotation' }),
    ]);
    expect(summarised.topic).toBe('batching vs rotation');

    const [protocol] = threadsOf([
      mail({
        from: 'perf',
        to: 'security',
        protocol: { type: 'task_assignment', data: {} },
      }),
    ]);
    expect(protocol.topic).toBe('task assignment');

    const [prose] = threadsOf([mail({ from: 'perf', to: 'security', text: 'plain words' })]);
    expect(prose.topic).toBe('plain words');
  });
});

describe('stateOf', () => {
  const thread = threadsOf([mail({ from: 'perf', to: 'security', read: false })])[0];

  it('is live while either agent is still taking turns, unread or not', () => {
    expect(stateOf(thread, [agent('perf', { status: 'working' }), agent('security')])).toBe('live');
  });

  it('is unread when nobody is left to drain the inbox', () => {
    expect(stateOf(thread, [agent('perf'), agent('security')])).toBe('unread');
  });

  it('is settled once everything has been read', () => {
    const settled = threadsOf([mail({ from: 'perf', to: 'security', read: true })])[0];
    expect(stateOf(settled, [agent('perf'), agent('security')])).toBe('settled');
  });

  it('gives the three states the design glyphs', () => {
    expect(THREAD_STATE.live.glyph).toBe('●');
    expect(THREAD_STATE.unread.glyph).toBe('◆');
    expect(THREAD_STATE.unread.color).toBe('var(--warn)');
    expect(THREAD_STATE.settled.glyph).toBe('·');
  });
});

describe('readTurnOf', () => {
  function line(marker: TranscriptLine['marker'], ts: number, id = `${marker}${ts}`): TranscriptLine {
    return { id, marker, text: 'x', ts };
  }

  it('is the recipient turn that opened at or after the send time', () => {
    const transcript = [
      line('❯', T0),
      line('⏺', T0 + 100),
      line('❯', T0 + 2000),
      line('⏺', T0 + 2100),
      line('❯', T0 + 4000),
    ];
    // Sent between the first and second turn, so the second one read it.
    expect(readTurnOf(T0 + 1000, transcript)).toBe(2);
    expect(readTurnOf(T0 + 3000, transcript)).toBe(3);
  });

  it('counts protocol frames as turn boundaries too', () => {
    const transcript = [line('○', T0), line('▲', T0 + 1000)];
    expect(readTurnOf(T0 + 500, transcript)).toBe(2);
  });

  it('says nothing rather than guessing when the boundary is outside the held window', () => {
    // The store bounds history per agent, so a number here would be an ordinal
    // counted from an arbitrary start sitting next to the transcript itself.
    expect(readTurnOf(T0 + 9000, [line('❯', T0)])).toBeUndefined();
    expect(readTurnOf(T0, [])).toBeUndefined();
  });
});

describe('taskIdsOf', () => {
  const tasks: Task[] = [
    { id: 'T-03', subject: 'a', description: '', state: 'completed', blocks: [], blockedBy: [] },
    { id: 'T-07', subject: 'b', description: '', state: 'pending', blocks: [], blockedBy: [] },
    { id: 'T-11', subject: 'c', description: '', state: 'pending', blocks: [], blockedBy: [] },
  ];

  it('collects ids a protocol frame names and ids the prose mentions', () => {
    const thread: Thread = threadsOf([
      mail({
        from: 'perf',
        to: 'security',
        ts: T0,
        text: 'does T-03 still hold?',
      }),
      mail({
        from: 'security',
        to: 'perf',
        ts: T0 + 1000,
        text: '{}',
        protocol: { type: 'task_assignment', data: { taskId: 'T-07' } },
      }),
    ])[0];
    expect(taskIdsOf(thread, tasks)).toEqual(['T-03', 'T-07']);
  });

  it('cannot invent a task the shared list does not have', () => {
    const thread = threadsOf([mail({ from: 'perf', to: 'security', text: 'see T-99' })])[0];
    expect(taskIdsOf(thread, tasks)).toEqual([]);
  });
});

describe('composingIn', () => {
  const thread = threadsOf([mail({ from: 'perf', to: 'security' })])[0];

  it('names the participant whose current turn is mid-SendMessage', () => {
    const agents = [
      agent('perf', { status: 'working', currentTool: 'SendMessage(rotation is fine)' }),
      agent('security'),
    ];
    expect(composingIn(thread, agents)).toBe('perf');
  });

  it('ignores a SendMessage from an agent outside the thread', () => {
    const agents = [
      agent('perf'),
      agent('security'),
      agent('tests', { currentTool: 'SendMessage(hello)' }),
    ];
    expect(composingIn(thread, agents)).toBeUndefined();
  });

  it('ignores any other tool', () => {
    expect(composingIn(thread, [agent('perf', { currentTool: 'Bash(ls)' })])).toBeUndefined();
  });
});

describe('everyoneThread', () => {
  const mail = (over: Partial<MailMessage> & { msgId: string }): MailMessage => ({
    from: 'perf', to: 'security', text: 't', ts: 0, tsIsDelivery: false, read: true, ...over,
  });

  it('is every exchange in one room, oldest first', () => {
    const room = everyoneThread([
      mail({ msgId: 'b', from: 'security', to: 'perf', ts: 20 }),
      mail({ msgId: 'a', ts: 10 }),
      mail({ msgId: 'c', from: 'lead', to: 'tests', ts: 30, read: false }),
    ])!;
    expect(room.kind).toBe('everyone');
    expect(room.messages.map((m) => m.msgId)).toEqual(['a', 'b', 'c']);
    expect(room.unread).toBe(1);
  });

  it('is nothing at all when nobody has written, so the list offers no empty room', () => {
    expect(everyoneThread([])).toBeNull();
  });

  it('leaves out an agent writing to itself, exactly as the pair threads do', () => {
    expect(everyoneThread([mail({ msgId: 'self', from: 'perf', to: 'perf' })])).toBeNull();
  });
});

describe('roomLines', () => {
  const bcast = (msgId: string, to: string, ts: number, read = true): MailMessage => ({
    msgId, from: CONSOLE_SENDER, to, text: 'hold the batch', ts, tsIsDelivery: false, read,
  });

  // "message the team" is N direct messages; raw, the room repeats it N times.
  it('folds the copies of one broadcast back into a single line', () => {
    const lines = roomLines([bcast('1', 'perf', 100), bcast('2', 'security', 101), bcast('3', 'tests', 102)]);
    expect(lines).toHaveLength(1);
    expect(lines[0].to).toEqual(['perf', 'security', 'tests']);
  });

  it('holds a broadcast unread until every copy has been drained', () => {
    const lines = roomLines([bcast('1', 'perf', 100), bcast('2', 'security', 101, false)]);
    expect(lines[0].read).toBe(false);
  });

  it('keeps the same text sent much later as its own line', () => {
    const lines = roomLines([bcast('1', 'perf', 100), bcast('2', 'security', 100_000)]);
    expect(lines).toHaveLength(2);
  });

  it('never folds two different senders together', () => {
    const lines = roomLines([
      bcast('1', 'perf', 100),
      { ...bcast('2', 'security', 101), from: 'tests' },
    ]);
    expect(lines).toHaveLength(2);
  });
});

describe('roomRecipients', () => {
  const agents = [agent('perf'), agent('security'), agent('tests')];
  const line = (to: string[]) => ({
    key: 'k', from: CONSOLE_SENDER, to, read: true, ts: 0,
    message: { msgId: 'k', from: CONSOLE_SENDER, to: to[0], text: '', ts: 0, tsIsDelivery: false, read: true },
  });

  it('says `to everyone` once a send reached every other member', () => {
    expect(roomRecipients(line(['perf', 'security', 'tests']), agents)).toBe('to everyone');
  });

  it('names the inboxes it actually reached when it did not reach all of them', () => {
    expect(roomRecipients(line(['perf']), agents)).toBe('→ perf');
    expect(roomRecipients(line(['perf', 'security']), agents)).toBe('→ perf, security');
  });
});

// A recipient does not flip `read` on an entry — it REMOVES it. Measured on a
// live team: a two-entry inbox went to `[]` at the recipient's next turn
// boundary, and nothing in Claude Code or this repo ever writes `read: true`.
describe('resolveDelivery', () => {
  const to = 'security';
  const older = mail({ from: 'perf', to, ts: T0, read: false });
  const newer = mail({ from: 'perf', to, ts: T0 + 1000, read: false });

  it('marks everything read once the recipient inbox is empty', () => {
    const out = resolveDelivery([older, newer], [agent(to, { unread: 0 })]);
    expect(out.map((m) => m.read)).toEqual([true, true]);
  });

  it('keeps the newest N pending, because an inbox drains oldest first', () => {
    const out = resolveDelivery([older, newer], [agent(to, { unread: 1 })]);
    expect(out.map((m) => [m.ts - T0, m.read])).toEqual([[0, true], [1000, false]]);
  });

  it('holds every message pending while none has been drained', () => {
    const out = resolveDelivery([older, newer], [agent(to, { unread: 2 })]);
    expect(out.map((m) => m.read)).toEqual([false, false]);
  });

  it('counts each recipient inbox separately', () => {
    const toPerf = mail({ from: 'security', to: 'perf', ts: T0 + 500, read: false });
    const out = resolveDelivery(
      [older, toPerf, newer],
      [agent(to, { unread: 1 }), agent('perf', { unread: 0 })],
    );
    expect(out.map((m) => [m.to, m.read])).toEqual([
      [to, true],
      ['perf', true],
      [to, false],
    ]);
  });

  it('says nothing about a recipient the roster no longer lists', () => {
    // No inbox count to reason from, so the parsed flag stands rather than
    // every message to a departed agent silently reporting delivered.
    const out = resolveDelivery([older, newer], []);
    expect(out.map((m) => m.read)).toEqual([false, false]);
  });

  it('never un-reads a message already known read', () => {
    const proven = mail({ from: 'perf', to, ts: T0 + 2000, read: true });
    const out = resolveDelivery([older, newer, proven], [agent(to, { unread: 3 })]);
    expect(out.map((m) => m.read)).toEqual([false, false, true]);
  });

  it('leaves a thread unread count that is not just every message ever sent', () => {
    const threads = threadsOf(resolveDelivery([older, newer], [agent(to, { unread: 1 })]));
    expect(threads[0].unread).toBe(1);
  });
});
