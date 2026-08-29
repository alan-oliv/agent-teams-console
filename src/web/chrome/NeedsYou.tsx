import type { NeedsYouItem } from '../../shared/domain';
import { postJson } from '../api';

export interface NeedsYouProps {
  items: NeedsYouItem[];
  readOnly: boolean;
  now: number;
}

const CARD_BASE = {
  borderRadius: 'var(--radius-sm)',
  padding: '6px 10px',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
} as const;

const DETAIL = { fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

function Action({
  label,
  tone,
  readOnly,
  onClick,
}: {
  label: string;
  tone: 'accent' | 'neutral';
  readOnly: boolean;
  onClick(): void;
}) {
  const accent = tone === 'accent';
  return (
    <button
      type="button"
      className={accent ? 'btn-approve' : 'btn-neutral'}
      disabled={readOnly}
      onClick={onClick}
      style={{
        border: `1px solid var(--color-${accent ? 'accent-700' : 'neutral-800'})`,
        color: `var(--color-${accent ? 'accent-300' : 'neutral-500'})`,
        borderRadius: 'var(--radius-sm)',
        padding: '1px 8px',
        fontSize: 10.5,
        whiteSpace: 'nowrap',
        opacity: readOnly ? 0.45 : 1,
        cursor: readOnly ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function Card({ item, readOnly, now }: { item: NeedsYouItem; readOnly: boolean; now: number }) {
  if (item.kind === 'failure') {
    return (
      <div
        data-testid="card-failure"
        style={{ ...CARD_BASE, flex: 'none', border: '1px solid var(--color-neutral-800)' }}
      >
        <span style={{ color: 'var(--fail)', fontSize: 11, whiteSpace: 'nowrap' }}>
          {`${item.agent} · ${item.reason}`}
        </span>
        <span style={{ ...DETAIL, color: 'var(--color-neutral-600)' }}>{item.detail}</span>
        <Action
          label="respawn"
          tone="accent"
          readOnly={readOnly}
          onClick={() => void postJson(`/api/agents/${item.agent}/respawn`)}
        />
      </div>
    );
  }

  const permission = item.kind === 'permission';
  return (
    <div
      data-testid={permission ? 'card-permission' : 'card-plan'}
      style={{ ...CARD_BASE, flex: 1, minWidth: 0, border: '1px solid var(--warn-edge)' }}
    >
      <span style={{ color: 'var(--warn)', fontSize: 11, whiteSpace: 'nowrap' }}>
        {`${item.agent} · ${item.reason}`}
      </span>
      <span style={{ ...DETAIL, color: 'var(--color-neutral-500)' }}>{item.detail}</span>
      <span style={{ flex: 1 }} />
      {permission && item.expiresAt !== undefined && (
        <span
          data-testid="permit-countdown"
          style={{ color: 'var(--color-neutral-600)', fontSize: 10.5, whiteSpace: 'nowrap' }}
        >
          {`${Math.max(0, Math.ceil((item.expiresAt - now) / 1000))}s`}
        </span>
      )}
      {permission ? (
        <>
          <Action
            label="allow"
            tone="accent"
            readOnly={readOnly}
            onClick={() => void postJson(`/api/permits/${item.id}/allow`)}
          />
          <Action
            label="deny with reason"
            tone="neutral"
            readOnly={readOnly}
            onClick={() => {
              const reason = window.prompt(`reason for denying ${item.agent}`);
              if (reason === null) return;
              void postJson(`/api/permits/${item.id}/deny`, { reason });
            }}
          />
        </>
      ) : (
        <>
          <Action
            label="approve"
            tone="accent"
            readOnly={readOnly}
            onClick={() => void postJson(`/api/plans/${item.id}/approve`)}
          />
          <Action
            label="reject with feedback"
            tone="neutral"
            readOnly={readOnly}
            onClick={() => {
              const feedback = window.prompt(`feedback for ${item.agent}`);
              if (feedback === null) return;
              void postJson(`/api/plans/${item.id}/reject`, { feedback });
            }}
          />
        </>
      )}
    </div>
  );
}

export function NeedsYou({ items, readOnly, now }: NeedsYouProps) {
  return (
    <div
      style={{
        borderTop: '1px solid var(--color-neutral-900)',
        background: 'var(--color-bg)',
        padding: '9px 14px',
        display: 'flex',
        alignItems: 'stretch',
        gap: 10,
      }}
    >
      <span
        style={{
          color: 'var(--warn)',
          fontSize: 10.5,
          letterSpacing: '.12em',
          alignSelf: 'center',
          whiteSpace: 'nowrap',
        }}
      >
        {`NEEDS YOU · ${items.length}`}
      </span>
      <div style={{ flex: 1, display: 'flex', gap: 8, minWidth: 0, alignItems: 'center' }}>
        {items.length === 0 ? (
          <span style={{ color: 'var(--color-neutral-700)', fontSize: 11 }}>nothing waiting</span>
        ) : (
          items.map((item) => <Card key={item.id} item={item} readOnly={readOnly} now={now} />)
        )}
      </div>
    </div>
  );
}
