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
  /** Between lines. 1px leading made a live stream unreadable. */
  rowGap: number;
  /** Marker column to text. */
  gap: number;
  markerWidth: string;
  markerSize: string;
  textColor: string;
  textSize?: string;
}

const FEED: Record<FeedSize, FeedStyle> = {
  wall: {
    padding: '13px 12px', rowGap: 10, gap: 7,
    markerWidth: '9px', markerSize: '11px',
    textColor: 'var(--color-neutral-300)', textSize: '11.5px',
  },
  overview: {
    padding: '10px 10px', rowGap: 8, gap: 5,
    markerWidth: '8px', markerSize: '9.5px',
    textColor: 'var(--color-neutral-400)', textSize: '10px',
  },
  grid: {
    padding: '10px 11px', rowGap: 8, gap: 6,
    markerWidth: '8px', markerSize: '10px',
    textColor: 'var(--color-neutral-400)', textSize: '11px',
  },
  rail: {
    padding: '15px 18px', rowGap: 11, gap: 9,
    markerWidth: '10px', markerSize: '11px',
    textColor: 'var(--color-neutral-300)',
  },
};

const MARKER_COLOR = 'var(--color-accent-500)';

// The live frame already carries only PROJECTED_TRANSCRIPT_LINES per agent, so
// this bounds the merged list once scrollback has been pulled in.
const RENDER_LIMIT = 1_200;

/**
 * How strongly a line reads, by its distance back from the newest. The current
 * command has to look current; a flat colour down the whole ladder does not
 * rank anything, and the operator ends up rereading the column to find where it
 * is. `back` is 0 for the newest line.
 */
function fade(back: number): number {
  if (back === 0) return 1;
  if (back === 1) return 0.72;
  return back < 5 ? 0.5 : 0.38;
}

// An agent that is not working has no "current" line at all, so its whole
// ladder sits back a step from a column that does.
const RESTING = 0.72;

const ACTION: CSSProperties = {
  borderRadius: 'var(--radius-sm)',
  padding: '1px 7px',
  fontSize: '10px',
  flex: 'none',
};

export function TranscriptFeed({
  lines,
  size,
  agent,
  working = true,
}: {
  lines: TranscriptLine[];
  size: FeedSize;
  /** Omit to disable scrollback — views that show a digest, not a transcript. */
  agent?: string;
  /** Dims the whole ladder when this agent is not the one working. */
  working?: boolean;
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
    gap: `${s.rowGap}px`,
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
      className="tscroll tail"
      data-testid="transcript-feed"
      style={container}
      onScroll={onScroll}
    >
      {shown.map((line, i) => {
        // The projection keeps the author's line breaks, so a row that has any
        // is a row with more to show than the column can hold.
        const more = line.text.includes('\n');
        const isOpen = more && open.has(line.id);
        const opacity = (working ? 1 : RESTING) * fade(shown.length - 1 - i);

        // An open row is being read, not skimmed — it stays at full strength
        // however old it is, while the collapsed rows around it keep the ladder.
        if (isOpen) {
          return (
            <div
              key={line.id}
              data-testid="transcript-row"
              aria-expanded
              onClick={(e: MouseEvent) => e.stopPropagation()}
              style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-neutral-900)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-sm)',
                padding: '10px 12px 11px',
                margin: '4px 0',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div
                data-testid="transcript-drawer-head"
                onClick={(e: MouseEvent) => toggle(e, line.id)}
                style={{ display: 'flex', gap: `${s.gap}px`, alignItems: 'baseline', cursor: 'pointer' }}
              >
                <span
                  data-testid="transcript-marker"
                  style={{
                    color: 'var(--color-accent-400)',
                    width: s.markerWidth,
                    flex: 'none',
                    fontSize: s.markerSize,
                  }}
                >
                  {line.marker}
                </span>
                <span
                  data-testid="transcript-text"
                  style={{
                    color: 'var(--color-text)',
                    textWrap: 'pretty',
                    ...(s.textSize ? { fontSize: s.textSize } : {}),
                  }}
                >
                  {headOf(line.text)}
                </span>
                <span style={{ flex: 1 }} />
                <span
                  data-testid="transcript-more"
                  aria-hidden
                  style={{ color: 'var(--color-accent-400)', flex: 'none', fontSize: '10px' }}
                >
                  ▾
                </span>
              </div>

              <div style={{ height: '1px', background: 'var(--color-neutral-900)' }} />

              <div
                data-testid="transcript-drawer-body"
                style={{ display: 'flex', flexDirection: 'column', gap: '11px', paddingLeft: '16px' }}
              >
                {blocksOf(line.text).map((block, b) => (
                  <span
                    key={b}
                    style={{
                      color: 'var(--color-neutral-300)',
                      whiteSpace: 'pre-wrap',
                      textWrap: 'pretty',
                      lineHeight: 1.65,
                    }}
                  >
                    {block}
                  </span>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', paddingLeft: '16px' }}>
                <span
                  data-testid="transcript-drawer-count"
                  style={{ color: 'var(--color-neutral-700)', fontSize: '10px' }}
                >
                  {`${line.text.split('\n').length} lines`}
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="btn-neutral"
                  data-testid="transcript-copy"
                  onClick={(e: MouseEvent) => {
                    e.stopPropagation();
                    void navigator.clipboard?.writeText(line.text);
                  }}
                  style={{
                    ...ACTION,
                    border: '1px solid var(--color-neutral-800)',
                    color: 'var(--color-neutral-500)',
                  }}
                >
                  copy
                </button>
                <button
                  type="button"
                  className="btn-approve"
                  data-testid="transcript-collapse"
                  onClick={(e: MouseEvent) => toggle(e, line.id)}
                  style={{
                    ...ACTION,
                    border: '1px solid var(--color-accent-700)',
                    color: 'var(--color-accent-300)',
                  }}
                >
                  collapse
                </button>
              </div>
            </div>
          );
        }

        return (
          <div
            key={line.id}
            data-testid="transcript-row"
            {...(more
              ? { 'aria-expanded': false, onClick: (e: MouseEvent) => toggle(e, line.id) }
              : {})}
            style={{
              display: 'flex',
              gap: `${s.gap}px`,
              alignItems: 'baseline',
              whiteSpace: 'nowrap',
              opacity,
              ...(more ? { cursor: 'pointer' } : {}),
            }}
          >
            <span
              data-testid="transcript-marker"
              style={{ color: MARKER_COLOR, width: s.markerWidth, flex: 'none', fontSize: s.markerSize }}
            >
              {line.marker}
            </span>
            <span
              data-testid="transcript-text"
              style={{
                color: s.textColor,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                ...(s.textSize ? { fontSize: s.textSize } : {}),
              }}
            >
              {more ? headOf(line.text) : line.text}
            </span>
            {more && (
              <>
                <span style={{ flex: 1 }} />
                <span
                  data-testid="transcript-more"
                  aria-hidden
                  style={{ color: 'var(--color-neutral-700)', flex: 'none', fontSize: '10px' }}
                >
                  ▸
                </span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The one line a collapsed row shows, and the drawer's header once it opens. */
function headOf(text: string): string {
  return text.slice(0, text.indexOf('\n'));
}

/**
 * The rest of the output, split on blank lines so prose gets paragraph rhythm.
 * Line breaks WITHIN a block survive (`pre-wrap`), because most of what lands
 * here is a table or a diff, where they carry the meaning.
 */
function blocksOf(text: string): string[] {
  return text
    .slice(text.indexOf('\n') + 1)
    .split(/\n{2,}/)
    .map((b) => b.replace(/\s+$/, ''))
    .filter((b) => b !== '');
}
