// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CONSOLE_SENDER, type Agent, type MailMessage, type Task, type TranscriptLine } from '../../shared/domain';
import { Comms } from './Comms';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const T0 = Date.parse('2026-08-27T15:10:00.000Z');
const NOW = T0 + 600_000;

function agent(name: string, over: Partial<Agent> = {}): Agent {
  return {
    name,
    agentId: `${name}@session-98b0b4a7`,
    isLead: name === 'team-lead',
    agentType: name === 'team-lead' ? 'team-lead' : 'general-purpose',
    model: 'claude-opus-5',
    role: 'role',
    status: 'idle',
    contextTokens: 1_000,
    contextLimit: 200_000,
    compactAt: 167_000,
    costUsd: 0.1,
    startedAt: T0,
    transcript: [],
    unread: 0,
    ...over,
  };
}

function line(marker: TranscriptLine['marker'], ts: number): TranscriptLine {
  return { id: `${marker}-${ts}`, marker, text: 'x', ts };
}

const AGENTS: Agent[] = [
  agent('team-lead', { status: 'working' }),
  agent('perf', {
    status: 'working',
    // m3 is still sitting in this inbox; everything older has been drained.
    unread: 1,
    transcript: [line('❯', T0 + 30_000), line('❯', T0 + 90_000)],
  }),
  agent('security'),
];

const MAIL: MailMessage[] = [
  {
    msgId: 'm1',
    from: 'perf',
    to: 'security',
    text: 'Does per-request rotation depend on the lookup being per-session?',
    summary: 'batching vs rotation',
    ts: T0,
    tsIsDelivery: false,
    read: true,
  },
  {
    msgId: 'm2',
    from: 'security',
    to: 'perf',
    text: 'Rotation is keyed on the session row. Batching T-07 is fine.',
    ts: T0 + 60_000,
    tsIsDelivery: false,
    read: true,
  },
  {
    msgId: 'm3',
    from: 'security',
    to: 'perf',
    text: 'Marking finding 1 resolved.',
    ts: NOW - 34_000,
    tsIsDelivery: false,
    read: false,
  },
  {
    msgId: 'm4',
    from: 'team-lead',
    to: 'security',
    text: 'roll the findings up when you are done',
    summary: 'findings roll-up',
    ts: T0 + 10_000,
    tsIsDelivery: false,
    read: true,
  },
];

// Stamped `console` server-side: a message to the LEAD cannot arrive as the lead.
const OPERATOR_TO_LEAD: MailMessage = {
  msgId: 'm5',
  from: CONSOLE_SENDER,
  to: 'team-lead',
  text: 'ship what you have',
  ts: T0 + 20_000,
  tsIsDelivery: false,
  read: true,
};

const TASKS: Task[] = [
  { id: 'T-07', subject: 'batch the lookup', description: '', state: 'pending', blocks: [], blockedBy: [] },
];

function renderComms(over: Partial<Parameters<typeof Comms>[0]> = {}) {
  const props = {
    agents: AGENTS,
    mail: MAIL,
    tasks: TASKS,
    openThread: null as string | null,
    onFocus: vi.fn(),
    onShowInWall: vi.fn(),
    now: NOW,
    ...over,
  };
  render(<Comms {...props} />);
  return props;
}

describe('Comms — thread list', () => {
  it('lists one row per pair of inboxes, newest exchange first', () => {
    renderComms();
    const rows = screen.getAllByTestId('thread-row');
    expect(rows.map((r) => within(r).getByTestId('thread-pair').textContent)).toEqual([
      'perf ⇄ security',
      'security ⇄ team-lead',
    ]);
  });

  it('holds the list to 296px and does not bottom-anchor it', () => {
    renderComms();
    expect(screen.getByTestId('thread-list').style.width).toBe('296px');
    const list = screen.getAllByTestId('thread-row')[0].parentElement!;
    // `.tail` is for streams. A top-down list anchored to the bottom opens with
    // dead space above its first row.
    expect(list.className).toBe('tscroll');
  });

  it('draws both faces of the pair, overlapped', () => {
    renderComms();
    const first = screen.getAllByTestId('thread-portraits')[0];
    const faces = within(first).getAllByTestId('portrait');
    expect(faces).toHaveLength(2);
    // Scaled whole, not shrunk pixel by pixel — the sprite is one SVG viewBox.
    expect(faces[0].style.width).toBe('20px');
    expect(faces[1].parentElement!.style.left).toBe('14px');
  });

  it('shows the unread count as a pill and totals it in the header', () => {
    renderComms();
    expect(screen.getByText('1 unread')).toBeTruthy();
    const rows = screen.getAllByTestId('thread-row');
    expect(within(rows[0]).getByTestId('thread-unread').textContent).toBe('1');
    expect(within(rows[1]).queryByTestId('thread-unread')).toBeNull();
  });

  it('glyphs a thread live while either agent is taking turns', () => {
    renderComms();
    const rows = screen.getAllByTestId('thread-row');
    // perf is working, so its thread is live even though a message is unread.
    expect(within(rows[0]).getByTestId('thread-glyph').textContent).toBe('●');
    // team-lead is working too.
    expect(within(rows[1]).getByTestId('thread-glyph').textContent).toBe('●');
  });

  it('glyphs a thread nobody is left to drain as needing attention', () => {
    renderComms({ agents: [agent('perf', { unread: 1 }), agent('security')] });
    const rows = screen.getAllByTestId('thread-row');
    const glyph = within(rows[0]).getByTestId('thread-glyph');
    expect(glyph.textContent).toBe('◆');
    expect(glyph.style.color).toBe('var(--warn)');
  });

  it('states the model in the footer', () => {
    renderComms();
    expect(screen.getByText('a thread is two inboxes · the lead does not relay')).toBeTruthy();
  });

  it('says so rather than showing an empty pane when nobody has written', () => {
    renderComms({ mail: [] });
    expect(screen.getByTestId('threads-empty').textContent).toBe(
      'no threads — nobody on this team has written to anybody',
    );
    expect(screen.queryByTestId('thread-head')).toBeNull();
  });
});


// The room is what opens on its own, so a test about the PAIR pane has to say
// which pair it means. The in-flight badge's open-this-thread intent is how the
// app asks for one, and it survives a re-render where a click would not.
function renderPair(over: Partial<Parameters<typeof Comms>[0]> = {}) {
  return renderComms({ openThread: 'perf', ...over });
}

describe('Comms — thread pane', () => {
  it('opens the newest thread and marks its row selected', () => {
    renderPair();
    expect(within(screen.getByTestId('thread-head')).getByText('perf ⇄ security')).toBeTruthy();
    expect(screen.getAllByTestId('thread-row')[0].getAttribute('aria-selected')).toBe('true');
  });

  it('heads the pane with the topic and the task ids the exchange concerns', () => {
    renderPair();
    const head = screen.getByTestId('thread-head');
    // The topic is what the exchange is about NOW, so it tracks the newest
    // message rather than freezing on whatever opened the thread.
    expect(within(head).getByTestId('thread-head-topic').textContent).toBe(
      'Marking finding 1 resolved.',
    );
    expect(within(head).getByTestId('thread-tasks').textContent).toBe('T-07');
  });

  it('bottom-anchors the chat and puts each side on its own edge', () => {
    renderPair();
    const body = screen.getByTestId('thread-body');
    expect(body.className).toBe('tscroll tail');

    const bubbles = screen.getAllByTestId('bubble');
    expect(bubbles).toHaveLength(3);
    // perf is the first participant alphabetically, so it stays on the left
    // however the conversation goes.
    expect(bubbles[0].style.alignItems).toBe('flex-start');
    expect(bubbles[1].style.alignItems).toBe('flex-end');
  });

  it('caps a bubble at 64% and puts the sender face on the outer edge', () => {
    renderPair();
    const bubbles = screen.getAllByTestId('bubble');
    const left = bubbles[0].firstElementChild as HTMLElement;
    const right = bubbles[1].firstElementChild as HTMLElement;
    expect(left.style.maxWidth).toBe('64%');
    expect(left.style.flexDirection).toBe('row');
    expect(right.style.flexDirection).toBe('row-reverse');
    expect(within(bubbles[0]).getByTestId('portrait').style.width).toBe('22px');
  });

  it('names the sender and clocks the message', () => {
    renderPair();
    const first = screen.getAllByTestId('bubble')[0];
    expect(within(first).getByTestId('bubble-from').textContent).toBe('perf');
    expect(within(first).getByTestId('bubble-ts').textContent).toBe('15:10:00');
    expect(within(first).getByTestId('bubble-body').textContent).toBe(
      'Does per-request rotation depend on the lookup being per-session?',
    );
  });
});

// The load-bearing part: a message lands in the recipient's inbox and is only
// read at that agent's next turn boundary. Without this the chat reads as
// instant delivery, which is not what happens.
describe('Comms — delivery state', () => {
  it('names the turn that read a message when the transcript places it', () => {
    renderPair();
    const deliveries = screen.getAllByTestId('bubble-delivery');
    // m2 went to perf at T0+60s; perf's turns opened at T0+30s and T0+90s, so
    // the second one is where it landed.
    expect(deliveries[1].textContent).toBe('read at turn 2');
    // Ruling 1: the read receipt is the quiet register, not README:105's -700.
    expect(deliveries[1].style.color).toBe('var(--color-neutral-600)');
  });

  it('says plainly `read` rather than guessing a turn the transcript cannot place', () => {
    renderPair();
    // m1 went to security, whose held transcript is empty.
    expect(screen.getAllByTestId('bubble-delivery')[0].textContent).toBe('read');
  });

  it('shows how long an unread message has been sitting in the inbox', () => {
    renderPair();
    const unread = screen.getAllByTestId('bubble-delivery')[2];
    expect(unread.textContent).toBe('delivered · unread 34s');
    expect(unread.style.color).toBe('var(--warn)');
  });

  it('ticks the unread age with the clock', () => {
    const props = renderPair();
    cleanup();
    render(<Comms {...props} now={NOW + 60_000} />);
    expect(screen.getAllByTestId('bubble-delivery')[2].textContent).toBe(
      'delivered · unread 1m',
    );
  });
});

// One bubble pair, both rooms (CONSOLE-DECISIONS ruling 7a): `accent-900` with
// an inset `accent-500` is the selected-row tint everywhere else in the console,
// so a bubble drawn on it reads as a selection.
describe('Comms — bubble grounds', () => {
  const groundOf = (bubble: HTMLElement) =>
    (bubble.firstElementChild!.lastElementChild as HTMLElement).style;

  it('draws the pair thread on the same two grounds as the room', () => {
    renderComms({ openThread: 'perf' });
    const [left, right] = screen.getAllByTestId('bubble');

    expect(groundOf(left).background).toBe('var(--color-neutral-900)');
    expect(groundOf(left).border).toBe('1px solid var(--color-neutral-800)');
    expect(within(left).getByTestId('bubble-body').style.color).toBe('var(--color-neutral-200)');

    expect(groundOf(right).background).toBe('var(--color-accent-700)');
    expect(groundOf(right).border).toBe('1px solid var(--color-accent-600)');
    expect(within(right).getByTestId('bubble-body').style.color).toBe('var(--color-text)');
  });

  it('holds a room line to the same text colour as a pair bubble', () => {
    renderComms();
    expect(screen.getAllByTestId('room-body')[0].style.color).toBe('var(--color-neutral-200)');
  });
});

// Nothing ever writes `read: true` into an inbox and an entry is DELETED when
// the recipient takes it, so an empty inbox is not proof that any particular
// message was read. The one artefact that proves it is a <teammate-message>
// frame in the recipient's own transcript, which the server has already folded
// into `read` by the time mail reaches this view.
describe('Comms — what proves a read', () => {
  it('leaves a message unread when no frame proved it, however empty the inbox is', () => {
    renderComms({
      agents: [agent('perf', { unread: 0 }), agent('security')],
      mail: [{
        msgId: 'u1',
        from: 'security',
        to: 'perf',
        text: 'took the batch',
        ts: NOW - 34_000,
        tsIsDelivery: false,
        read: false,
      }],
      openThread: 'perf',
    });
    expect(screen.getByTestId('bubble-delivery').textContent).toBe('delivered · unread 34s');
  });
});

describe('Comms — composing indicator', () => {
  it('shows a participant whose current turn is mid-SendMessage', () => {
    renderPair({
      agents: [
        agent('perf', { status: 'working', currentTool: 'SendMessage(one more thing)' }),
        agent('security'),
      ],
    });
    const composing = screen.getByTestId('composing');
    expect(within(composing).getByText('perf')).toBeTruthy();
    expect(within(composing).getByText('composing a reply')).toBeTruthy();
  });

  it('shows nothing while both agents are between messages', () => {
    renderPair();
    expect(screen.queryByTestId('composing')).toBeNull();
  });
});

describe('Comms — the operator joins the thread', () => {
  it('writes into both inboxes, because there is no relay to write into', async () => {
    const posted: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) => {
        posted.push(path);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
    );
    renderPair();

    const input = screen.getByTestId('composer-input');
    fireEvent.change(input, { target: { value: 'both of you: land it' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    await screen.findByTestId('composer-ack');

    expect(posted).toEqual(['/api/agents/perf/message', '/api/agents/security/message']);
    expect(screen.getByTestId('composer-ack').textContent).toBe('sent');
  });

  it('notes that the message wakes an idle recipient', () => {
    renderPair();
    expect(screen.getByTestId('composer-note').textContent).toBe(
      'a message wakes an idle recipient',
    );
  });

  it('disables the composer when the console is read-only', () => {
    renderPair({ readOnly: true });
    expect((screen.getByTestId('composer-input') as HTMLTextAreaElement).disabled).toBe(true);
  });

  // A departed agent has no inbox reader left, so the composer is disabled
  // rather than accepting a message nothing will collect. Taking it away
  // instead reads as the console having lost the thread.
  it('disables rather than removes the room composer once everyone has departed', () => {
    renderComms({ agents: AGENTS.map((a) => ({ ...a, status: 'departed' as const })) });
    expect((screen.getByTestId('composer-input') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('disables rather than removes a pair composer once both sides have departed', () => {
    renderComms({
      openThread: 'perf',
      agents: AGENTS.map((a) => ({ ...a, status: 'departed' as const })),
    });
    expect((screen.getByTestId('composer-input') as HTMLTextAreaElement).disabled).toBe(true);
  });
});

// Entering comms is not a request for a particular conversation: the room is
// the default, and only an explicit open-this-thread intent — the wall's
// in-flight badge — asks for one agent's messages.
// Consecutive messages from one sender are one turn of the conversation, so
// the name is drawn once at the top of the run and the face once at the bottom.
describe('Comms — sender runs', () => {
  const run = (msgId: string, from: string, to: string, ts: number): MailMessage => ({
    msgId, from, to, text: msgId, ts, tsIsDelivery: false, read: true,
  });
  // Three from security, then one back from perf — the reply breaks the run.
  const RUN_MAIL = [
    run('r1', 'security', 'perf', T0),
    run('r2', 'security', 'perf', T0 + 5_000),
    run('r3', 'security', 'perf', T0 + 9_000),
    run('r4', 'perf', 'security', T0 + 20_000),
  ];
  const RUN_PROPS = { mail: RUN_MAIL, agents: [agent('perf'), agent('security')] };

  it('names the sender once at the top of a run, in the room', () => {
    renderComms(RUN_PROPS);
    const named = screen.getAllByTestId('room-line')
      .map((l) => within(l).queryByTestId('room-from')?.textContent ?? '');
    expect(named).toEqual(['security', '', '', 'perf']);
  });

  it('hangs the face off the last bubble of a run, in the room', () => {
    renderComms(RUN_PROPS);
    const faces = screen.getAllByTestId('face-slot');
    expect(faces.map((f) => within(f).queryAllByTestId('portrait').length)).toEqual([0, 0, 1, 1]);
    // The slot stays behind it, so the bubbles of a run keep one edge.
    expect(faces[0].style.width).toBe('22px');
  });

  it('tightens the gap inside a run and opens it when the speaker changes', () => {
    renderComms(RUN_PROPS);
    expect(screen.getAllByTestId('room-line').map((l) => l.style.marginTop)).toEqual([
      '10px', '3px', '3px', '10px',
    ]);
  });

  // A run is one sender, not one recipient: the room is every direct message
  // read end to end, and folding the recipients away would invent a channel.
  it('keeps naming who each line went to inside a run', () => {
    renderComms({
      agents: [agent('perf'), agent('security'), agent('tests')],
      mail: [run('a', 'security', 'perf', T0), run('b', 'security', 'tests', T0 + 5_000)],
    });
    expect(screen.getAllByTestId('room-to').map((n) => n.textContent)).toEqual(['→ perf', '→ tests']);
  });

  it('collapses a run the same way in a pair thread', () => {
    renderComms({ ...RUN_PROPS, openThread: 'perf' });
    const bubbles = screen.getAllByTestId('bubble');
    expect(bubbles.map((b) => within(b).queryByTestId('bubble-from')?.textContent ?? '')).toEqual([
      'security', '', '', 'perf',
    ]);
    expect(bubbles.map((b) => within(b).queryAllByTestId('portrait').length)).toEqual([0, 0, 1, 1]);
    expect(bubbles.map((b) => b.style.marginTop)).toEqual(['10px', '3px', '3px', '10px']);
  });

  it('still clocks every message in a run, since a run can span minutes', () => {
    renderComms({ ...RUN_PROPS, openThread: 'perf' });
    expect(screen.getAllByTestId('bubble-ts').map((n) => n.textContent)).toEqual([
      '15:10:00', '15:10:05', '15:10:09', '15:10:20',
    ]);
  });

  it('sets a room body on the same line-height as a pair bubble', () => {
    renderComms();
    expect(screen.getAllByTestId('room-body')[0].style.lineHeight).toBe('1.6');
  });
});

describe('Comms — which thread opens', () => {
  it('opens the room on a plain view switch', () => {
    renderComms();
    expect(within(screen.getByTestId('thread-head')).getByText('all messages')).toBeTruthy();
  });

  it('opens that agent thread when comms is asked for one agent messages', () => {
    renderComms({ openThread: 'team-lead' });
    expect(within(screen.getByTestId('thread-head')).getByText('security ⇄ team-lead')).toBeTruthy();
  });

  it('opens the room when the intent names an agent nobody has written to', () => {
    renderComms({ openThread: 'nobody' });
    expect(within(screen.getByTestId('thread-head')).getByText('all messages')).toBeTruthy();
  });
});

describe('Comms — shared state', () => {
  it('sets the focused agent when a thread is opened, and keeps it off the lead', () => {
    const props = renderComms();
    fireEvent.click(screen.getAllByTestId('thread-row')[1]);
    // The wall pins the lead, so focusing it navigates nowhere.
    expect(props.onFocus).toHaveBeenCalledWith('security');
    expect(within(screen.getByTestId('thread-head')).getByText('security ⇄ team-lead')).toBeTruthy();
  });

  it('jumps to the wall on show in wall', () => {
    const props = renderPair();
    fireEvent.click(screen.getByTestId('show-in-wall'));
    expect(props.onShowInWall).toHaveBeenCalledWith('perf');
  });
});

describe('Comms — the everyone room', () => {
  it('pins the room above the pairs, under its own heading', () => {
    renderComms();
    const room = screen.getByTestId('room-row');
    expect(within(room).getByTestId('room-glyph').textContent).toBe('⌗');
    expect(within(room).getByText('all messages')).toBeTruthy();
    expect(within(room).getByText('every inbox, merged')).toBeTruthy();
    expect(screen.getByTestId('pairs-label').textContent).toBe('PAIRS');
    // Pinned: the room's node precedes every pair row in the list.
    const list = screen.getByTestId('thread-list');
    const order = [...list.querySelectorAll('[data-testid="room-row"],[data-testid="thread-row"]')];
    expect(order[0].getAttribute('data-testid')).toBe('room-row');
  });

  it('marks its own row selected when it opens, and heads the pane with the membership', () => {
    renderComms();
    expect(screen.getByTestId('room-row').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('room-members').textContent).toBe('3 members');
  });

  // The operator is not a member of the team, so a `console ⇄ team-lead` row
  // would read as a sixth agent having joined it.
  it('is where the operator own messages live, never a pair row of their own', () => {
    renderComms({ mail: [...MAIL, OPERATOR_TO_LEAD] });
    expect(screen.getAllByTestId('thread-pair').map((n) => n.textContent)).toEqual([
      'perf ⇄ security',
      'security ⇄ team-lead',
    ]);
    expect(screen.getAllByTestId('room-from').map((n) => n.textContent)).toContain('you');
  });

  it('gives the operator line no face, on the side the operator writes from', () => {
    renderComms({ mail: [...MAIL, OPERATOR_TO_LEAD] });
    const mine = screen.getAllByTestId('room-line')
      .find((l) => within(l).getByTestId('room-from').textContent === 'you')!;
    expect(mine.style.alignItems).toBe('flex-end');
    expect(within(mine).queryByTestId('portrait')).toBeNull();
  });

  it('carries every message the team exchanged, not just one pair', () => {
    renderComms();
    // MAIL holds three perf/security messages and one lead→security.
    expect(screen.getAllByTestId('room-line')).toHaveLength(4);
    expect(screen.queryAllByTestId('bubble')).toHaveLength(0);
  });

  it('caps a room bubble at the same width as a pair bubble', () => {
    renderComms();
    const row = screen.getAllByTestId('room-line')[0].children[1] as HTMLElement;
    expect(row.style.maxWidth).toBe('64%');
  });

  // The room is every DIRECT message read end to end, so dropping the recipient
  // would make it look like a group channel the team does not have.
  it('keeps naming who each message was actually sent to', () => {
    renderComms();
    const tos = screen.getAllByTestId('room-to').map((n) => n.textContent);
    expect(tos).toContain('→ security');
    expect(tos).toContain('→ perf');
  });

  it('shows the unread count for the whole team once, not once per pair', () => {
    renderComms();
    expect(screen.getByTestId('room-unread').textContent).toBe('1');
    expect(screen.getByText('1 unread')).toBeTruthy();
  });

  it('offers to message the team, and writes into every live inbox', async () => {
    const fetchMock = vi.fn((_path: string) => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    renderComms();

    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
    expect(input.placeholder).toBe('message the team — everyone sees it');
    fireEvent.change(input, { target: { value: 'hold the batch' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/api/agents/perf/message',
      '/api/agents/security/message',
      '/api/agents/team-lead/message',
    ]);
  });

  // The composer's trailing slot is a three-way branch, and an unhandled
  // variant falls through to the rail's, which prints the agent's current tool
  // — a Bash command sat at the end of the room's composer.
  it('closes the composer with the delivery note, not with a tool name', () => {
    renderComms();
    expect(screen.getByTestId('composer-note').textContent).toBe(
      'a message wakes an idle recipient',
    );
    expect(screen.queryByTestId('composer-tool')).toBeNull();
  });

  it('does not offer a room when nobody has written', () => {
    renderComms({ mail: [] });
    expect(screen.queryByTestId('room-row')).toBeNull();
    expect(screen.queryByTestId('pairs-label')).toBeNull();
  });
});
