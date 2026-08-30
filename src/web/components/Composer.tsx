import { createContext, useContext, useState, type KeyboardEvent } from 'react';
import type { Agent } from '../../shared/domain';
import { AGENT_STATUS } from '../../shared/status';
import { postJson } from '../api';

interface Variant {
  padding: string;
  gap: string;
  promptColor: string;
  promptSize: string;
  placeholder: (name: string) => string;
  placeholderColor: string;
}

const VARIANT: Record<'wall' | 'rail' | 'thread' | 'everyone', Variant> = {
  wall: {
    padding: '8px 12px', gap: '7px',
    promptColor: 'var(--color-accent-600)', promptSize: '11px',
    placeholder: (n) => `message ${n}`,
    placeholderColor: 'var(--color-neutral-700)',
  },
  rail: {
    padding: '11px 18px', gap: '9px',
    promptColor: 'var(--color-accent)', promptSize: '12px',
    placeholder: (n) => `message ${n} directly`,
    placeholderColor: 'var(--color-neutral-600)',
  },
  thread: {
    padding: '10px 16px', gap: '9px',
    promptColor: 'var(--color-accent)', promptSize: '12px',
    placeholder: () => 'join as the operator — both agents see it',
    placeholderColor: 'var(--color-neutral-600)',
  },
  everyone: {
    padding: '10px 16px', gap: '9px',
    promptColor: 'var(--color-accent)', promptSize: '12px',
    placeholder: () => 'message the team — everyone sees it',
    placeholderColor: 'var(--color-neutral-600)',
  },
};

/**
 * The roster the routed composer can address. A context rather than a prop for
 * the same reason NowContext is one: the roster changes on every frame, and
 * threading it through the memoised Column would re-render that whole column —
 * transcript included — every time any agent anywhere changed.
 */
export const RosterContext = createContext<Agent[]>([]);

function routeState(a: Agent): string {
  if (a.status === 'idle') return 'idle · a message wakes it';
  if (a.status === 'failed') return 'failed · still reachable';
  return AGENT_STATUS[a.status].label;
}

export function Composer({
  agent,
  alsoTo,
  routed = false,
  variant,
  readOnly = false,
  teamLive = true,
}: {
  agent: Agent;
  /**
   * Further equal recipients. There is no relay and no group inbox in this
   * model, so one send addressed to a pair is two direct messages, and one
   * addressed to the room is a direct message to every member.
   */
  alsoTo?: Agent[];
  /**
   * Turns this into the console's ONE composer: it addresses any agent in
   * RosterContext rather than the column it sits in. A composer per column
   * implied a channel this model does not have — every send is a direct inbox
   * write, so the target belongs to the message, not to where you typed it.
   */
  routed?: boolean;
  variant: 'wall' | 'rail' | 'thread' | 'everyone';
  readOnly?: boolean;
  /**
   * Whether any teammate is still alive. A teammate drains its OWN inbox, so a
   * message to one is delivered whenever that one is running. The lead's inbox
   * is drained by the agent-teams loop instead, and that loop stops with the
   * last teammate — so a message to the lead with nobody left sits in the file
   * unread, which looked exactly like the console being broken.
   */
  teamLive?: boolean;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // A send used to leave no trace anywhere the sender could see: the wall has no
  // mailbox, so a delivered message and one queued against a stopped reader
  // looked identical — an empty box either way.
  const [ack, setAck] = useState<'sent' | 'queued' | 'not sent' | null>(null);
  const [highlight, setHighlight] = useState(0);
  const v = VARIANT[variant];

  const roster = useContext(RosterContext);
  // A departed agent has no reader left, so it is not offered.
  const routable = routed ? roster.filter((a) => a.status !== 'departed') : [];

  /**
   * @-routing, Slack-style. At rest there is no chip and no picker: with no `@`
   * the message goes to the lead, which is the common case, and the composer
   * stays a prompt. An `@` still being typed opens the list and filters it; an
   * `@name ` followed by a space is resolved and becomes a chip.
   */
  const at = text.lastIndexOf('@');
  const frag = at < 0 ? null : text.slice(at + 1);
  const typing = routed && frag !== null && !/\s/.test(frag);
  const chipName = routed && at === 0 && !typing ? text.slice(1).trim().split(' ')[0] : '';
  const chip = routable.find((a) => a.name === chipName);
  const body = chip ? text.slice(chip.name.length + 1).replace(/^\s/, '') : text;
  const lead = routable.find((a) => a.isLead);
  // Prefix match, and the first row is what Enter takes.
  const options = typing
    ? routable.filter((a) => !frag || a.name.startsWith(frag))
    : [];
  // Clamped rather than reset in an effect: narrowing the filter can drop the
  // row under the cursor, and an out-of-range index would send to nobody.
  const active = options.length > 0 ? Math.min(highlight, options.length - 1) : 0;

  const target = chip ?? lead;

  // Read-only 409s every control route, so an enabled composer would look live
  // and swallow the rejection. Departed teammates have no inbox reader left —
  // in a thread only one of the two has to still be there.
  const recipients = routed
    ? target
      ? [target]
      : []
    : [agent, ...(alsoTo ?? [])].filter((a) => a.status !== 'departed');
  const outgoing = routed ? body : text;
  const disabled = readOnly || recipients.length === 0;

  async function send() {
    const body = outgoing.trim();
    if (!body || busy || disabled) return;
    setBusy(true);
    try {
      const results = await Promise.all(
        recipients.map((to) =>
          postJson(`/api/agents/${encodeURIComponent(to.name)}/message`, { text: body }),
        ),
      );
      const delivered = results.every((res) => res.ok);
      if (delivered) setText('');
      // A teammate drains its own inbox, so a live one has it already. The
      // lead's is drained by the team loop, which needs a teammate alive.
      setAck(
        !delivered ? 'not sent' : recipients.some((to) => to.isLead) && !teamLive ? 'queued' : 'sent',
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Enter sends; Shift+Enter is the newline.
   *
   * Enter used to fall through to the textarea's own handling, which put a
   * newline in a `rows={1}` box — the typed message scrolled out of sight, the
   * send never happened, and no ack appeared. Typing a message and pressing the
   * key every chat client sends with was indistinguishable from a console that
   * had stopped working, which is exactly how it was reported.
   */
  const named = routed ? (target?.name ?? agent.name) : agent.name;

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const picking = typing && options.length > 0;

    if (picking && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      // Wraps: the list is short enough that running off either end and
      // reappearing is quicker than stopping dead.
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : options.length - 1;
      // Functional, and re-clamped inside: two presses inside one render batch
      // would otherwise both start from the same render-time index and land one
      // step apart instead of two.
      setHighlight((h) => (Math.min(h, options.length - 1) + step) % options.length);
      return;
    }

    // Backspace against an empty box takes the chip off, the way it removes any
    // other token — otherwise the mention is only clearable by clearing the
    // whole message, which is the text you actually wanted to keep.
    if (e.key === 'Backspace' && chip && body === '') {
      e.preventDefault();
      setText('');
      return;
    }

    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    // The highlighted row of an open picker is the ⏎ default, so Enter resolves
    // the mention rather than sending a message still addressed to nobody.
    if (picking) {
      setText(`@${options[active].name} `);
      return;
    }
    void send();
  }

  return (
    <div
      style={{
        borderTop: '1px solid var(--color-neutral-900)',
        background: 'var(--color-bg)',
        padding: v.padding,
        display: 'flex',
        alignItems: 'center',
        gap: v.gap,
        position: 'relative',
      }}
    >
      <span style={{ color: v.promptColor, fontSize: v.promptSize }}>❯</span>
      {chip && (
        <span
          data-testid="route-chip"
          style={{
            flex: 'none',
            padding: '1px 6px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-accent-700)',
            background: 'var(--color-accent-900)',
            color: 'var(--color-accent-300)',
            fontSize: '10.5px',
          }}
        >
          {`@${chip.name}`}
        </span>
      )}

      {typing && options.length > 0 && (
        <div
          data-testid="route-menu"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: '10px',
            zIndex: 25,
            display: 'flex',
            flexDirection: 'column',
            width: '262px',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-neutral-800)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 -14px 34px rgba(0,0,0,.6)',
            overflow: 'hidden',
          }}
        >
          <div
            data-testid="route-filter"
            style={{
              padding: '7px 11px',
              borderBottom: '1px solid var(--color-neutral-900)',
              color: 'var(--color-neutral-600)',
              fontSize: '9.5px',
              letterSpacing: '.12em',
            }}
          >
            {frag ? `@${frag}` : 'type to filter'}
          </div>
          {options.map((a, i) => (
            <div
              key={a.name}
              data-testid="route-option"
              onMouseDown={(e) => {
                // mousedown, not click: a click would blur the textarea first
                // and the picker would close before the pick landed.
                e.preventDefault();
                setText(`@${a.name} `);
              }}
              style={{
                padding: '7px 11px',
                cursor: 'pointer',
                display: 'flex',
                gap: '7px',
                alignItems: 'baseline',
                background: i === active ? 'var(--color-accent-900)' : 'transparent',
                borderBottom: '1px solid var(--color-neutral-900)',
              }}
            >
              <span
                style={{
                  color: i === active ? 'var(--color-accent-300)' : 'var(--color-text)',
                  fontSize: '11px',
                }}
              >
                {`@${a.name}`}
              </span>
              <span
                style={{
                  color: 'var(--color-neutral-600)',
                  fontSize: '9.5px',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {routeState(a)}
              </span>
              <span style={{ flex: 1 }} />
              {/* The highlighted row is what Enter takes. */}
              <span style={{ color: 'var(--color-accent-400)', fontSize: '9.5px' }}>
                {i === active ? '⏎' : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      <textarea
        data-testid="composer-input"
        rows={1}
        value={routed ? body : text}
        placeholder={
          readOnly
            ? 'read-only — control routes are disabled'
            // Disabled rather than removed, so the box has to say why: every
            // reader has departed and nothing is left to collect a message.
            : recipients.length === 0
            ? 'nobody is left to read it'
            : recipients.some((to) => to.isLead) && !teamLive
              ? `${v.placeholder(named)} · queued until a teammate is live`
              : routed && !chip
                ? 'message the lead · @ to reach a teammate'
                : v.placeholder(named)
        }
        disabled={disabled}
        onChange={(e) => {
          setText(chip ? `@${chip.name} ${e.target.value}` : e.target.value);
          setHighlight(0); // a changed filter starts at the top again
          setAck(null); // typing again is the operator moving on from the last result
        }}
        onKeyDown={onKeyDown}
        style={{
          flex: 1,
          minWidth: 0,
          resize: 'none',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          font: 'inherit',
          fontSize: '11px',
          lineHeight: '15px',
          padding: 0,
          color: 'var(--color-text)',
        }}
      />
      {ack && (
        <span
          data-testid="composer-ack"
          style={{
            flex: 'none',
            fontSize: '10px',
            color: ack === 'not sent' ? 'var(--fail)' : 'var(--color-neutral-600)',
          }}
        >
          {ack}
        </span>
      )}
      {variant !== 'wall' && text === '' && (
        <span
          data-testid="composer-caret"
          style={{
            width: '7px',
            height: '15px',
            flex: 'none',
            background: 'var(--color-accent-400)',
            animation: 'blink 1.1s step-end infinite',
          }}
        />
      )}
      {variant === 'wall' ? (
        // `⌘⏎` still sends, but naming it here taught the one key that did NOT.
        <span style={{ color: 'var(--color-neutral-800)', fontSize: '10px' }}>⏎</span>
      ) : variant === 'thread' || variant === 'everyone' ? (
        <span
          data-testid="composer-note"
          style={{ color: 'var(--color-neutral-700)', fontSize: '10px', whiteSpace: 'nowrap' }}
        >
          a message wakes an idle recipient
        </span>
      ) : (
        <span
          data-testid="composer-tool"
          style={{
            color: 'var(--color-neutral-700)',
            fontSize: '11px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {agent.currentTool ?? ''}
        </span>
      )}
    </div>
  );
}
