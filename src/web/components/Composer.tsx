import { useState, type KeyboardEvent } from 'react';
import type { Agent } from '../../shared/domain';
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

export function Composer({
  agent,
  alsoTo,
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
  const v = VARIANT[variant];
  // Read-only 409s every control route, so an enabled composer would look live
  // and swallow the rejection. Departed teammates have no inbox reader left —
  // in a thread only one of the two has to still be there.
  const recipients = [agent, ...(alsoTo ?? [])].filter((a) => a.status !== 'departed');
  const disabled = readOnly || recipients.length === 0;

  async function send() {
    const body = text.trim();
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

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault();
      void send();
    }
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
      }}
    >
      <span style={{ color: v.promptColor, fontSize: v.promptSize }}>❯</span>
      <textarea
        data-testid="composer-input"
        rows={1}
        value={text}
        placeholder={
          readOnly
            ? 'read-only — control routes are disabled'
            : recipients.some((to) => to.isLead) && !teamLive
              ? `${v.placeholder(agent.name)} · queued until a teammate is live`
              : v.placeholder(agent.name)
        }
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
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
            color: ack === 'not sent' ? 'var(--failure-rose)' : 'var(--color-neutral-600)',
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
        <span style={{ color: 'var(--color-neutral-800)', fontSize: '10px' }}>⌘⏎</span>
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
