import {
  useCallback,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type UIEvent,
} from 'react';
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

// The live frame already carries only PROJECTED_TRANSCRIPT_LINES per agent, so
// this bounds the merged list once scrollback has been pulled in.
const RENDER_LIMIT = 1_200;

export function TranscriptFeed({
  lines,
  size,
  agent,
}: {
  lines: TranscriptLine[];
  size: FeedSize;
  /** Omit to disable scrollback — views that show a digest, not a transcript. */
  agent?: string;
}) {
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
    padding: s.padding,
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
  };

  // Older lines, fetched once on the first scroll to the top. The live frame
  // carries only the newest 60 per agent so it stays small; this is the rest.
  const [older, setOlder] = useState<TranscriptLine[]>([]);
  const asked = useRef(false);
  const loadOlder = useCallback(async () => {
    if (!agent || asked.current) return;
    asked.current = true;
    anchor.current = pane.current?.scrollHeight ?? 0;
    try {
      const res = await fetch(`/api/history?agent=${encodeURIComponent(agent)}`);
      if (!res.ok) return;
      const body = (await res.json()) as { lines?: TranscriptLine[] };
      setOlder(body.lines ?? []);
    } catch {
      // Scrollback is an enhancement; the live tail is already on screen.
      asked.current = false;
    }
  }, [agent]);

  const pane = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  // Prepending history moves everything down by the height it added; without
  // this the operator is thrown back to the top the instant it lands.
  const anchor = useRef(0);
  useLayoutEffect(() => {
    const el = pane.current;
    if (!el || anchor.current === 0) return;
    el.scrollTop += el.scrollHeight - anchor.current;
    anchor.current = 0;
  }, [older]);

  useLayoutEffect(() => {
    const el = pane.current;
    if (!el) return;
    const slack = el.scrollHeight - el.clientHeight - el.scrollTop;
    // Follow new output only when the operator is already at the bottom. If they
    // have scrolled up to read, appending a line must not yank them back down.
    if (!pinned.current || (slack > 0 && slack < 64)) {
      el.scrollTop = el.scrollHeight;
      pinned.current = true;
    }
  }, [lines]);

  // The live tail wins: history is only what precedes its first line, so a line
  // present in both keeps the fresher copy and cannot render twice.
  const shown = useMemo(() => {
    if (older.length === 0) return lines.slice(-RENDER_LIMIT);
    const live = new Set(lines.map((l) => l.id));
    return [...older.filter((l) => !live.has(l.id)), ...lines].slice(-RENDER_LIMIT);
  }, [older, lines]);

  const onScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      if (e.currentTarget.scrollTop < 48) void loadOlder();
    },
    [loadOlder],
  );

  return (
    <div
      ref={pane}
      className="tscroll"
      data-testid="transcript-feed"
      style={container}
      onScroll={onScroll}
    >
      {shown.map((line) => {
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
