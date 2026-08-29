import { useMemo, useState, type CSSProperties } from 'react';
import { CONSOLE_SENDER, type Agent, type MailMessage, type Task } from '../../shared/domain';
import {
  composingIn,
  everyoneThread,
  readTurnOf,
  roomLines,
  roomRecipients,
  stateOf,
  taskIdsOf,
  THREAD_STATE,
  threadsOf,
  type RoomLine,
  type Thread,
} from '../../shared/threads';
import { Composer } from '../components/Composer';
import { Portrait } from '../components/Portrait';
import { briefAge, clockLabel } from '../format';

const PANE_HEAD: CSSProperties = {
  padding: '10px 14px 8px',
  color: 'var(--color-neutral-700)',
  fontSize: '10.5px',
  letterSpacing: '.12em',
  borderBottom: '1px solid var(--color-neutral-900)',
  display: 'flex',
};

const FOOT_NOTE: CSSProperties = {
  borderTop: '1px solid var(--color-neutral-900)',
  padding: '9px 14px',
  color: 'var(--color-neutral-700)',
  fontSize: '10px',
  lineHeight: 1.5,
};

// The thread list overlaps the pair's two faces rather than putting them side by
// side, so a row reads as one conversation instead of two agents.
const PORTRAIT_PX = 20;
const OVERLAP_PX = 14;

/** Portraits key off the roster; a departed agent config no longer lists still has mail. */
function agentFor(name: string, agents: Agent[]): { name: string; agentType: string; isLead: boolean } {
  return agents.find((a) => a.name === name) ?? { name, agentType: '', isLead: false };
}

/**
 * Which agent a thread hands to the shared focus. The wall pins the lead, so
 * focusing it navigates nowhere — the teammate is the half of the pair the
 * other views can actually move to.
 */
function focusTargetOf(thread: Thread, agents: Agent[]): string {
  // The room has no pair to pick from, so it points at whoever spoke last —
  // the operator is not a column, so their own line is skipped.
  if (thread.kind === 'everyone') {
    const spoken = [...thread.messages].reverse().find((m) => m.from !== CONSOLE_SENDER);
    return spoken?.from ?? thread.messages[thread.messages.length - 1]?.to ?? '';
  }
  return agentFor(thread.a, agents).isLead ? thread.b : thread.a;
}

function Pair({ thread, agents }: { thread: Thread; agents: Agent[] }) {
  return (
    <div
      data-testid="thread-portraits"
      style={{
        width: PORTRAIT_PX + OVERLAP_PX,
        height: PORTRAIT_PX,
        position: 'relative',
        flex: 'none',
      }}
    >
      {[thread.a, thread.b].map((name, i) => (
        <div key={name} style={{ position: 'absolute', top: 0, left: i * OVERLAP_PX }}>
          <Portrait agent={agentFor(name, agents)} size={PORTRAIT_PX} />
        </div>
      ))}
    </div>
  );
}

/**
 * One line of the team-wide room. Unlike a pair bubble it names the RECIPIENT
 * under the text: the room is every direct message read end to end, so without
 * "who it went to" it would look like a group channel the team does not have.
 */
function RoomBubble({ line, agents, now }: { line: RoomLine; agents: Agent[]; now: number }) {
  const mine = line.from === CONSOLE_SENDER;
  const recipient = agents.find((a) => a.name === line.to[0]);
  const turn = line.read && line.to.length === 1
    ? readTurnOf(line.ts, recipient?.transcript ?? [])
    : undefined;
  const message = line.message;

  return (
    <div
      data-testid="room-line"
      style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', gap: '4px' }}
    >
      <span data-testid="room-from" style={{ color: 'var(--color-neutral-600)', fontSize: '10px', padding: '0 32px' }}>
        {mine ? 'you' : line.from}
      </span>
      <div
        style={{
          display: 'flex',
          flexDirection: mine ? 'row-reverse' : 'row',
          gap: '9px',
          alignItems: 'flex-end',
          maxWidth: '78%',
        }}
      >
        {/* The operator has no portrait: they are not a team member. */}
        {!mine && (
          <div style={{ marginBottom: '2px' }}>
            <Portrait agent={agentFor(line.from, agents)} size={22} />
          </div>
        )}
        <div
          style={{
            background: mine ? 'var(--color-accent-700)' : 'var(--color-neutral-900)',
            border: `1px solid ${mine ? 'var(--color-accent-600)' : 'var(--color-neutral-800)'}`,
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            minWidth: 0,
          }}
        >
          <span
            data-testid="room-body"
            style={{
              color: mine ? 'var(--color-text)' : 'var(--color-neutral-300)',
              fontSize: '11.5px',
              lineHeight: 1.55,
              textWrap: 'pretty',
            }}
          >
            {message.protocol ? message.protocol.type.replace(/_/g, ' ') : message.text}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '7px', alignItems: 'baseline', padding: '0 32px' }}>
        <span data-testid="room-to" style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}>
          {roomRecipients(line, agents)}
        </span>
        <span
          data-testid="room-ts"
          title={message.tsIsDelivery ? 'delivery time — send time unknown' : undefined}
          style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}
        >
          {`${message.tsIsDelivery ? '~' : ''}${clockLabel(line.ts)}`}
        </span>
        <span
          data-testid="room-receipt"
          style={{ color: line.read ? 'var(--color-neutral-700)' : 'var(--attention)', fontSize: '10px' }}
        >
          {line.read
            ? turn === undefined
              ? 'read'
              : `read at turn ${turn}`
            : `delivered · unread ${briefAge(now - line.ts)}`}
        </span>
      </div>
    </div>
  );
}

function Bubble({
  message, thread, agents, now,
}: {
  message: MailMessage;
  thread: Thread;
  agents: Agent[];
  now: number;
}) {
  // Sides are fixed to the pair, not to the operator: the first participant is
  // always left, so a thread does not flip when a different message arrives.
  const mine = message.from === thread.b;
  const recipient = agents.find((a) => a.name === message.to);
  const turn = message.read ? readTurnOf(message.ts, recipient?.transcript ?? []) : undefined;

  return (
    <div
      data-testid="bubble"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: mine ? 'flex-end' : 'flex-start',
        gap: '4px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: mine ? 'row-reverse' : 'row',
          gap: '9px',
          alignItems: 'flex-end',
          maxWidth: '78%',
        }}
      >
        <div style={{ marginBottom: '2px' }}>
          <Portrait agent={agentFor(message.from, agents)} size={22} />
        </div>
        <div
          style={{
            background: mine ? 'var(--color-accent-900)' : 'var(--color-bg)',
            border: `1px solid ${mine ? 'var(--color-accent-700)' : 'var(--color-neutral-900)'}`,
            borderRadius: 'var(--radius-md)',
            padding: '9px 12px',
            minWidth: 0,
          }}
        >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginBottom: '5px' }}>
            <span data-testid="bubble-from" style={{ color: 'var(--color-accent-400)', fontSize: '10.5px' }}>
              {message.from}
            </span>
            <span
              data-testid="bubble-ts"
              title={message.tsIsDelivery ? 'delivery time — send time unknown' : undefined}
              style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}
            >
              {`${message.tsIsDelivery ? '~' : ''}${clockLabel(message.ts)}`}
            </span>
          </div>
          <span
            data-testid="bubble-body"
            style={{
              color: 'var(--color-neutral-300)',
              fontSize: '11.5px',
              lineHeight: 1.6,
              textWrap: 'pretty',
            }}
          >
            {message.protocol ? message.protocol.type.replace(/_/g, ' ') : message.text}
          </span>
        </div>
      </div>

      <span
        data-testid="bubble-delivery"
        style={{
          color: message.read ? 'var(--color-neutral-700)' : 'var(--attention)',
          fontSize: '10px',
          padding: '0 32px',
        }}
      >
        {message.read
          ? turn === undefined
            ? 'read'
            : `read at turn ${turn}`
          : `delivered · unread ${briefAge(now - message.ts)}`}
      </span>
    </div>
  );
}

export function Comms({
  agents, mail, tasks, focused, onFocus, onShowInWall, now, readOnly = false,
}: {
  agents: Agent[];
  mail: MailMessage[];
  tasks: Task[];
  focused: string | null;
  onFocus: (name: string) => void;
  onShowInWall: (name: string) => void;
  now: number;
  readOnly?: boolean;
}) {
  const threads = useMemo(() => threadsOf(mail), [mail]);
  // The whole team's traffic, pinned above the pairs. Not a seventh inbox — the
  // same messages, read end to end instead of two at a time.
  const room = useMemo(() => everyoneThread(mail), [mail]);
  const [picked, setPicked] = useState<string | null>(null);

  // The room holds every agent, so a focused agent never pulls the view off it.
  const holds = (t: Thread, name: string) =>
    t.kind === 'everyone' || t.a === name || t.b === name;
  // Derived rather than cleared in an effect, like the focused agent in
  // useTeamState: a thread stays open until the focused agent moves somewhere
  // it has no part in — the panel, the rail, the wall — and comms follows it.
  const all = room ? [room, ...threads] : threads;
  const pickedThread = all.find((t) => t.id === picked);
  const open =
    pickedThread && (!focused || holds(pickedThread, focused))
      ? pickedThread
      : (focused ? threads.find((t) => t.a === focused || t.b === focused) : undefined) ?? all[0];

  function openThread(thread: Thread) {
    setPicked(thread.id);
    onFocus(focusTargetOf(thread, agents));
  }

  const unread = room?.unread ?? threads.reduce((n, t) => n + t.unread, 0);

  return (
    <div data-testid="comms" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div
        data-testid="thread-list"
        style={{
          width: '296px',
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          borderRight: '1px solid var(--color-neutral-900)',
        }}
      >
        <div style={PANE_HEAD}>
          <span>THREADS</span>
          <span style={{ flex: 1 }} />
          <span>{`${unread} unread`}</span>
        </div>

        <div
          className="tscroll"
          role="listbox"
          aria-label="threads"
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            padding: '6px 8px',
          }}
        >
          {room && (
            <div
              className="thread-row"
              data-testid="room-row"
              role="option"
              aria-selected={room.id === open?.id}
              onClick={() => setPicked(room.id)}
              style={{
                padding: '8px 9px',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                display: 'flex',
                gap: '9px',
                alignItems: 'center',
                background: room.id === open?.id ? 'var(--color-accent-900)' : 'transparent',
                boxShadow: room.id === open?.id ? 'inset 2px 0 0 var(--color-accent-500)' : 'none',
              }}
            >
              {/* A hash, not the pair's two portraits: the room has no two sides. */}
              <span
                data-testid="room-glyph"
                style={{ width: '22px', textAlign: 'center', color: 'var(--color-neutral-600)', fontSize: '13px' }}
              >
                #
              </span>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ color: 'var(--color-text)', fontSize: '11.5px' }}>{room.pair}</span>
                <span style={{ color: 'var(--color-neutral-600)', fontSize: '10.5px' }}>{room.topic}</span>
              </div>
              {room.unread > 0 && (
                <span
                  data-testid="room-unread"
                  style={{
                    flex: 'none',
                    fontSize: '9.5px',
                    padding: '0 5px',
                    borderRadius: '8px',
                    background: 'var(--color-accent-600)',
                    color: 'var(--color-bg)',
                  }}
                >
                  {room.unread}
                </span>
              )}
            </div>
          )}

          {room && threads.length > 0 && (
            <span
              data-testid="pairs-label"
              style={{
                padding: '8px 9px 2px',
                color: 'var(--color-neutral-700)',
                fontSize: '10px',
                letterSpacing: '.12em',
              }}
            >
              PAIRS
            </span>
          )}

          {threads.map((thread) => {
            const state = THREAD_STATE[stateOf(thread, agents)];
            const selected = thread.id === open?.id;
            return (
              <div
                key={thread.id}
                className="thread-row"
                data-testid="thread-row"
                role="option"
                aria-selected={selected}
                onClick={() => openThread(thread)}
                style={{
                  padding: '8px 9px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  display: 'flex',
                  gap: '9px',
                  alignItems: 'center',
                  background: selected ? 'var(--color-accent-900)' : 'transparent',
                  boxShadow: selected ? 'inset 2px 0 0 var(--color-accent-500)' : 'none',
                }}
              >
                <Pair thread={thread} agents={agents} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline' }}>
                    <span data-testid="thread-glyph" style={{ fontSize: '9px', color: state.color }}>
                      {state.glyph}
                    </span>
                    <span
                      data-testid="thread-pair"
                      style={{
                        color: 'var(--color-text)',
                        fontSize: '11.5px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {thread.pair}
                    </span>
                  </div>
                  <span
                    data-testid="thread-topic"
                    style={{
                      color: 'var(--color-neutral-600)',
                      fontSize: '10.5px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {thread.topic}
                  </span>
                </div>
                {thread.unread > 0 && (
                  <span
                    data-testid="thread-unread"
                    style={{
                      flex: 'none',
                      fontSize: '9.5px',
                      padding: '0 5px',
                      borderRadius: '8px',
                      background: 'var(--color-accent-600)',
                      color: 'var(--color-bg)',
                    }}
                  >
                    {thread.unread}
                  </span>
                )}
              </div>
            );
          })}

          {threads.length === 0 && (
            <div
              data-testid="threads-empty"
              style={{ padding: '8px 9px', color: 'var(--color-neutral-700)', fontSize: '11px' }}
            >
              no threads — nobody on this team has written to anybody
            </div>
          )}
        </div>

        <div style={FOOT_NOTE}>a thread is two inboxes · the lead does not relay</div>
      </div>

      {open && (
        <ThreadPane
          thread={open}
          agents={agents}
          tasks={tasks}
          now={now}
          readOnly={readOnly}
          onShowInWall={() => onShowInWall(focusTargetOf(open, agents))}
        />
      )}
    </div>
  );
}

function ThreadPane({
  thread, agents, tasks, now, readOnly, onShowInWall,
}: {
  thread: Thread;
  agents: Agent[];
  tasks: Task[];
  now: number;
  readOnly: boolean;
  onShowInWall: () => void;
}) {
  const taskIds = taskIdsOf(thread, tasks);
  const composing = composingIn(thread, agents);
  // A thread outlives its participants: mail from an agent the config no longer
  // lists still reads, it just has nobody left to answer it.
  const [first, second] = [thread.a, thread.b]
    .map((name) => agents.find((a) => a.name === name))
    .filter((a): a is Agent => a !== undefined);
  // See Composer: the lead's inbox is drained by the team loop, not by the lead.
  const teamLive = agents.some((a) => !a.isLead && a.status !== 'departed');
  // Everyone still able to read an inbox — who "message the team" actually reaches.
  const members = agents.filter((a) => a.status !== 'departed');

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        data-testid="thread-head"
        style={{
          padding: '9px 16px',
          borderBottom: '1px solid var(--color-neutral-900)',
          background: 'var(--color-bg)',
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
          // One line, always — the status bar's rule. The topic gives way first
          // and the rest clips rather than widening the page behind it.
          overflow: 'hidden',
        }}
      >
        <span style={{ color: 'var(--color-text)', fontSize: '12.5px', flex: 'none' }}>
          {thread.pair}
        </span>
        {thread.kind === 'pair' && (
          <span
            data-testid="thread-head-topic"
            style={{
              color: 'var(--color-neutral-600)',
              fontSize: '11px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {thread.topic}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {thread.kind === 'everyone' && (
          <span
            data-testid="room-members"
            style={{ color: 'var(--color-neutral-600)', fontSize: '10.5px', flex: 'none' }}
          >
            {`${agents.length} members`}
          </span>
        )}
        {taskIds.length > 0 && (
          <span
            data-testid="thread-tasks"
            style={{ color: 'var(--color-neutral-700)', fontSize: '10.5px', flex: 'none' }}
          >
            {taskIds.join(' · ')}
          </span>
        )}
        <button
          type="button"
          className="btn-neutral"
          data-testid="show-in-wall"
          onClick={onShowInWall}
          style={{
            border: '1px solid var(--color-neutral-800)',
            color: 'var(--color-neutral-500)',
            borderRadius: 'var(--radius-sm)',
            padding: '1px 7px',
            fontSize: '10px',
            flex: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          show in wall
        </button>
      </div>

      <div
        className="tscroll tail"
        data-testid="thread-body"
        style={{
          flex: 1,
          minHeight: 0,
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        {thread.kind === 'everyone'
          ? roomLines(thread.messages).map((line) => (
              <RoomBubble key={line.key} line={line} agents={agents} now={now} />
            ))
          : thread.messages.map((message) => (
              <Bubble key={message.msgId} message={message} thread={thread} agents={agents} now={now} />
            ))}

        {composing && (
          <div
            data-testid="composing"
            style={{ display: 'flex', gap: '9px', alignItems: 'center', paddingLeft: '31px', opacity: 0.6 }}
          >
            <span style={{ color: 'var(--color-accent-400)', fontSize: '10.5px' }}>{composing}</span>
            <span style={{ color: 'var(--color-neutral-600)', fontSize: '10.5px' }}>
              composing a reply
            </span>
            <span style={{ display: 'flex', gap: '3px' }}>
              {[0, 0.2, 0.4].map((delay) => (
                <span
                  key={delay}
                  style={{
                    width: '3px',
                    height: '3px',
                    borderRadius: '2px',
                    background: 'var(--color-accent-400)',
                    animation: `pulse 1.2s ease-in-out ${delay}s infinite`,
                  }}
                />
              ))}
            </span>
          </div>
        )}
      </div>

      {thread.kind === 'everyone'
        ? members.length > 0 && (
            <Composer
              agent={members[0]}
              alsoTo={members.slice(1)}
              variant="everyone"
              readOnly={readOnly}
              teamLive={teamLive}
            />
          )
        : first && (
            <Composer
              agent={first}
              alsoTo={second ? [second] : undefined}
              variant="thread"
              readOnly={readOnly}
              teamLive={teamLive}
            />
          )}
    </div>
  );
}
