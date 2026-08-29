// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Agent, MailMessage, Task, TranscriptLine } from '../../shared/domain';
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
  agent('perf', { status: 'working', transcript: [line('❯', T0 + 30_000), line('❯', T0 + 90_000)] }),
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

const TASKS: Task[] = [
  { id: 'T-07', subject: 'batch the lookup', description: '', state: 'pending', blocks: [], blockedBy: [] },
];

function renderComms(over: Partial<Parameters<typeof Comms>[0]> = {}) {
  const props = {
    agents: AGENTS,
    mail: MAIL,
    tasks: TASKS,
    focused: null as string | null,
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
    renderComms({ agents: [agent('perf'), agent('security')] });
    const rows = screen.getAllByTestId('thread-row');
    const glyph = within(rows[0]).getByTestId('thread-glyph');
    expect(glyph.textContent).toBe('◆');
    expect(glyph.style.color).toBe('var(--attention)');
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


// `everyone` is what opens with nothing focused, so a test about the PAIR pane
// has to say which pair it means. Focusing a participant is how every other
// view does it, and it survives a re-render where a click would not.
function renderPair(over: Partial<Parameters<typeof Comms>[0]> = {}) {
  return renderComms({ focused: 'perf', ...over });
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

  it('caps a bubble at 78% and puts the sender face on the outer edge', () => {
    renderPair();
    const bubbles = screen.getAllByTestId('bubble');
    const left = bubbles[0].firstElementChild as HTMLElement;
    const right = bubbles[1].firstElementChild as HTMLElement;
    expect(left.style.maxWidth).toBe('78%');
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
    expect(deliveries[1].style.color).toBe('var(--color-neutral-700)');
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
    expect(unread.style.color).toBe('var(--attention)');
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
});

describe('Comms — shared state', () => {
  it('opens the focused agent thread, so a pick made in another view carries', () => {
    renderComms({ focused: 'team-lead' });
    expect(within(screen.getByTestId('thread-head')).getByText('security ⇄ team-lead')).toBeTruthy();
  });

  it('sets the focused agent when a thread is opened, and keeps it off the lead', () => {
    const props = renderComms();
    fireEvent.click(screen.getAllByTestId('thread-row')[1]);
    // The wall pins the lead, so focusing it navigates nowhere.
    expect(props.onFocus).toHaveBeenCalledWith('security');
    expect(within(screen.getByTestId('thread-head')).getByText('security ⇄ team-lead')).toBeTruthy();
  });

  it('follows the focused agent away when it moves out of the open thread', () => {
    const props = renderComms({ focused: 'perf' });
    expect(within(screen.getByTestId('thread-head')).getByText('perf ⇄ security')).toBeTruthy();
    cleanup();
    render(<Comms {...props} focused="team-lead" />);
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
    expect(within(room).getByTestId('room-glyph').textContent).toBe('#');
    expect(within(room).getByText('everyone')).toBeTruthy();
    expect(within(room).getByText('every message, one room')).toBeTruthy();
    expect(screen.getByTestId('pairs-label').textContent).toBe('PAIRS');
    // Pinned: the room's node precedes every pair row in the list.
    const list = screen.getByTestId('thread-list');
    const order = [...list.querySelectorAll('[data-testid="room-row"],[data-testid="thread-row"]')];
    expect(order[0].getAttribute('data-testid')).toBe('room-row');
  });

  it('is what opens when no agent is focused', () => {
    renderComms();
    expect(screen.getByTestId('room-row').getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByTestId('thread-head')).getByText('everyone')).toBeTruthy();
    expect(screen.getByTestId('room-members').textContent).toBe('3 members');
  });

  it('carries every message the team exchanged, not just one pair', () => {
    renderComms();
    // MAIL holds three perf/security messages and one lead→security.
    expect(screen.getAllByTestId('room-line')).toHaveLength(4);
    expect(screen.queryAllByTestId('bubble')).toHaveLength(0);
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
