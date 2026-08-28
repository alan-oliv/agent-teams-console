import { useCallback, useState, type CSSProperties, type MouseEvent } from 'react';
import type { TranscriptLine } from '../../shared/domain';

export type FeedSize = 'wall' | 'overview' | 'grid' | 'rail';

interface FeedStyle {
  padding: string;
  gap: number;
  markerWidth: string;
  markerColor: string;
  markerSize: string;
  textColor: string;
  textSize?: string;
}

const FEED: Record<FeedSize, FeedStyle> = {
  wall: {
    padding: '9px 12px', gap: 7,
    markerWidth: '9px', markerColor: 'var(--color-accent-600)', markerSize: '11px',
    textColor: 'var(--color-neutral-500)', textSize: '11.5px',
  },
  overview: {
    padding: '8px 10px', gap: 5,
    markerWidth: '8px', markerColor: 'var(--color-accent-700)', markerSize: '9.5px',
    textColor: 'var(--color-neutral-600)', textSize: '10px',
  },
  grid: {
    padding: '8px 11px', gap: 6,
    markerWidth: '8px', markerColor: 'var(--color-accent-700)', markerSize: '10px',
    textColor: 'var(--color-neutral-600)', textSize: '11px',
  },
  rail: {
    padding: '12px 18px', gap: 9,
    markerWidth: '10px', markerColor: 'var(--color-accent-600)', markerSize: '11px',
    textColor: 'var(--color-neutral-400)',
  },
};

// No view shows more than ~20 rows; the store keeps 2000 per agent (spec §10).
const RENDER_LIMIT = 60;

export function TranscriptFeed({ lines, size }: { lines: TranscriptLine[]; size: FeedSize }) {
  const s = FEED[size];
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((e: MouseEvent, id: string) => {
    // The whole column is a click target that focuses the agent; opening a row
    // is not that.
    e.stopPropagation();
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const container: CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    padding: s.padding,
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    justifyContent: 'flex-end',
  };

  return (
    <div data-testid="transcript-feed" style={container}>
      {lines.slice(-RENDER_LIMIT).map((line) => {
        // The projection keeps the author's line breaks, so a row that has any
        // is a row with more to show than the column can hold.
        const more = line.text.includes('\n');
        const isOpen = more && open.has(line.id);
        return (
          <div
            key={line.id}
            data-testid="transcript-row"
            {...(more
              ? {
                  'aria-expanded': isOpen,
                  onClick: (e: MouseEvent) => toggle(e, line.id),
                  style: {
                    display: 'flex',
                    gap: `${s.gap}px`,
                    alignItems: 'baseline',
                    whiteSpace: isOpen ? ('pre-wrap' as const) : ('nowrap' as const),
                    cursor: 'pointer',
                  },
                }
              : {
                  style: {
                    display: 'flex',
                    gap: `${s.gap}px`,
                    alignItems: 'baseline',
                    whiteSpace: 'nowrap' as const,
                  },
                })}
          >
            <span
              data-testid="transcript-marker"
              style={{ color: s.markerColor, width: s.markerWidth, flex: 'none', fontSize: s.markerSize }}
            >
              {line.marker}
            </span>
            <span
              data-testid="transcript-text"
              style={{
                color: s.textColor,
                ...(isOpen
                  ? { minWidth: 0 }
                  : { overflow: 'hidden', textOverflow: 'ellipsis' }),
                ...(s.textSize ? { fontSize: s.textSize } : {}),
              }}
            >
              {line.text}
            </span>
            {more && (
              <span
                data-testid="transcript-more"
                aria-hidden
                style={{ color: s.markerColor, flex: 'none', fontSize: s.markerSize }}
              >
                {isOpen ? '▾' : '▸'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
