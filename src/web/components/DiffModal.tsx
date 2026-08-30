import { useState, type CSSProperties } from 'react';
import type { Diff } from '../../shared/domain';
import { clockLabel, diffStat } from '../format';

type Layout = 'unified' | 'split';

const SEGMENT: CSSProperties = {
  cursor: 'pointer',
  fontSize: '10.5px',
  padding: '2px 9px',
  borderRadius: 'var(--radius-sm)',
  boxShadow: 'inset 0 0 0 1px var(--color-neutral-800)',
  border: 'none',
};

const OUTLINE_ACTION: CSSProperties = {
  borderRadius: 'var(--radius-sm)',
  padding: '1px 8px',
  fontSize: '10px',
  cursor: 'pointer',
  background: 'transparent',
};

function hunkLabel(count: number): string {
  return `${count} hunk${count === 1 ? '' : 's'} · whitespace shown`;
}

/**
 * Who made the edit, when, and (if it landed) at what sha. `diff.ts` is
 * epoch ms like every other `ts` in the domain, formatted here rather than
 * carried as a display string. An uncommitted edit has no sha, so it drops
 * out rather than rendering as "undefined".
 */
function metaLabel(diff: Diff): string {
  const parts = [diff.agent, clockLabel(diff.ts)];
  if (diff.commit) parts.push(diff.commit);
  return parts.join(' · ');
}

/**
 * The patch a diff-bearing transcript row opens, over the whole console.
 * Chrome only: header, toolbar, footer, and an empty scroll container sized
 * to hold the hunk rows — a later teammate renders those and picks their
 * tint colours.
 */
export function DiffModal({ diff, onClose }: { diff: Diff | null; onClose(): void }) {
  const [layout, setLayout] = useState<Layout>('unified');
  const [closeHover, setCloseHover] = useState(false);

  if (!diff) return null;

  return (
    <div
      data-testid="diff-modal"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '28px',
        background: 'rgba(0,0,0,.62)',
      }}
    >
      <div
        data-testid="diff-card"
        style={{
          width: '1020px',
          maxWidth: '100%',
          maxHeight: '600px',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-neutral-800)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 30px 80px rgba(0,0,0,.7)',
          overflow: 'hidden',
        }}
      >
        <div
          data-testid="diff-header"
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--color-neutral-900)',
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
            flex: 'none',
          }}
        >
          <span style={{ color: 'var(--color-neutral-600)', fontSize: '10px', letterSpacing: '.12em', flex: 'none' }}>
            DIFF
          </span>
          <span
            data-testid="diff-path"
            style={{
              color: 'var(--color-text)',
              fontSize: '12.5px',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {diff.path}
          </span>
          <span data-testid="diff-stat" style={{ color: '#7fb98d', fontSize: '11px', flex: 'none' }}>
            {diffStat(diff.added, diff.removed)}
          </span>
          <span style={{ flex: 1 }} />
          <span
            data-testid="diff-meta"
            style={{ color: 'var(--color-neutral-600)', fontSize: '10.5px', whiteSpace: 'nowrap', flex: 'none' }}
          >
            {metaLabel(diff)}
          </span>
          <button
            type="button"
            data-testid="diff-close"
            aria-label="close"
            onClick={onClose}
            onMouseEnter={() => setCloseHover(true)}
            onMouseLeave={() => setCloseHover(false)}
            style={{
              color: closeHover ? 'var(--color-accent-300)' : 'var(--color-neutral-500)',
              background: closeHover ? 'var(--color-accent-900)' : 'transparent',
              border: 'none',
              fontSize: '12px',
              cursor: 'pointer',
              padding: '0 5px',
              borderRadius: 'var(--radius-sm)',
              flex: 'none',
            }}
          >
            ✕
          </button>
        </div>

        <div
          data-testid="diff-toolbar"
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid var(--color-neutral-900)',
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            flex: 'none',
          }}
        >
          <button
            type="button"
            data-testid="diff-layout-unified"
            aria-pressed={layout === 'unified'}
            onClick={() => setLayout('unified')}
            style={{
              ...SEGMENT,
              color: layout === 'unified' ? 'var(--color-accent-300)' : 'var(--color-neutral-500)',
              background: layout === 'unified' ? 'var(--color-accent-900)' : 'transparent',
            }}
          >
            unified
          </button>
          <button
            type="button"
            data-testid="diff-layout-split"
            aria-pressed={layout === 'split'}
            onClick={() => setLayout('split')}
            style={{
              ...SEGMENT,
              color: layout === 'split' ? 'var(--color-accent-300)' : 'var(--color-neutral-500)',
              background: layout === 'split' ? 'var(--color-accent-900)' : 'transparent',
            }}
          >
            split
          </button>
          <span style={{ flex: 1 }} />
          <span data-testid="diff-hunk-count" style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}>
            {hunkLabel(diff.hunks.length)}
          </span>
          <button
            type="button"
            className="btn-neutral"
            data-testid="diff-copy"
            style={{ ...OUTLINE_ACTION, border: '1px solid var(--color-neutral-800)', color: 'var(--color-neutral-500)' }}
          >
            copy patch
          </button>
          <button
            type="button"
            className="btn-approve"
            data-testid="diff-open-editor"
            style={{ ...OUTLINE_ACTION, border: '1px solid var(--color-accent-700)', color: 'var(--color-accent-300)' }}
          >
            open in editor
          </button>
        </div>

        <div
          className="tscroll"
          data-testid="diff-body"
          style={{ flex: 1, background: 'var(--term)', display: 'flex', flexDirection: 'column' }}
        />

        <div
          data-testid="diff-footer"
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--color-neutral-900)',
            display: 'flex',
            gap: '14px',
            alignItems: 'center',
            color: 'var(--color-neutral-600)',
            fontSize: '10px',
            flex: 'none',
          }}
        >
          <span>esc close</span>
          <span>j/k next change</span>
          <span>⌘⏎ open in editor</span>
          <span style={{ flex: 1 }} />
          <span>the transcript keeps its one line — the patch lives here</span>
        </div>
      </div>
    </div>
  );
}
