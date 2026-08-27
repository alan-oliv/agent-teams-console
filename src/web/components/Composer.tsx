import { useState, type KeyboardEvent } from 'react';
import type { Agent } from '../../shared/domain';

interface Variant {
  padding: string;
  gap: string;
  promptColor: string;
  promptSize: string;
  placeholder: (name: string) => string;
  placeholderColor: string;
}

const VARIANT: Record<'wall' | 'rail', Variant> = {
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
};

export function Composer({ agent, variant }: { agent: Agent; variant: 'wall' | 'rail' }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const v = VARIANT[variant];
  const departed = agent.status === 'departed';

  async function send() {
    const body = text.trim();
    if (!body || busy || departed) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.name)}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: body }),
      });
      if (res.ok) setText('');
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
        placeholder={v.placeholder(agent.name)}
        disabled={departed}
        onChange={(e) => setText(e.target.value)}
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
      {variant === 'rail' && text === '' && (
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
