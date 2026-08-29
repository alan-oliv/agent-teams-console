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
import { TRANSCRIPT_TEXT_CAP } from '../../shared/transcript';
import {
  jsonRows,
  jsonSummary,
  jsonText,
  parseJsonPayload,
  type JsonTokenKind,
} from '../../shared/json';

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

const NEUTRAL_ACTION: CSSProperties = {
  ...ACTION,
  border: '1px solid var(--color-neutral-800)',
  color: 'var(--color-neutral-500)',
};

const JSON_COLOR: Record<JsonTokenKind, string> = {
  key: 'var(--color-accent-400)',
  string: 'var(--json-string)',
  number: 'var(--attention)',
  boolean: 'var(--json-boolean)',
  null: 'var(--failure-rose)',
  punct: 'var(--color-neutral-600)',
};

/**
 * The pretty-printed payload. Capped and scrolling on its own, and pointedly
 * NOT `.tail`: bottom-anchoring belongs to streams, and JSON reads top-down —
 * anchored, a payload opens showing its closing brace.
 */
function JsonBody({ value }: { value: unknown }) {
  const rows = jsonRows(value);
  return (
    <div
      className="tscroll"
      data-testid="json-body"
      style={{
        maxHeight: '210px',
        background: 'var(--terminal-ground)',
        border: '1px solid var(--color-neutral-900)',
        borderRadius: 'var(--radius-sm)',
        padding: '9px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      }}
    >
      {rows.map((row, i) => (
        <div
          key={i}
          data-testid="json-line"
          style={{
            display: 'flex',
            gap: '10px',
            alignItems: 'baseline',
            whiteSpace: 'pre',
            padding: '0 11px 0 0',
            fontSize: '11px',
            lineHeight: 1.5,
          }}
        >
          <span
            data-testid="json-gutter"
            style={{
              color: 'var(--color-neutral-800)',
              flex: 'none',
              width: '34px',
              textAlign: 'right',
              fontSize: '10px',
            }}
          >
            {i + 1}
          </span>
          <span style={{ minWidth: 0 }}>
            {'  '.repeat(row.indent)}
            {row.tokens.map((token, t) => (
              <span key={t} data-json-token={token.kind} style={{ color: JSON_COLOR[token.kind] }}>
                {token.text}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

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
  // Which open payloads are showing the wire text instead of the formatted one.
  const [raw, setRaw] = useState<ReadonlySet<string>>(() => new Set());
  const toggleRaw = useCallback((e: MouseEvent, id: string) => {
    e.stopPropagation();
    setRaw((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  // Uncapped bodies, keyed by line id. The frame ships every line capped at
  // TRANSCRIPT_TEXT_CAP so a poll stays small, which is fine for a collapsed
  // one-line row and not fine for a drawer — the worst observed row is a
  // 21k-char tool-result JSON, exactly what a drawer exists to open.
  const [full, setFull] = useState<ReadonlyMap<string, string>>(() => new Map());
  const fetched = useRef<Set<string>>(new Set());
  const loadFull = useCallback(
    async (id: string) => {
      if (!agent || fetched.current.has(id)) return;
      fetched.current.add(id);
      try {
        const res = await fetch(
          `/api/line?agent=${encodeURIComponent(agent)}&id=${encodeURIComponent(id)}`,
        );
        // 404 is the record aging out of the store, which is ordinary. The
        // capped text is already on screen and stays; there is nothing to say.
        if (!res.ok) return;
        const body = (await res.json()) as { text?: string };
        if (typeof body.text === 'string') setFull((prev) => new Map(prev).set(id, body.text!));
      } catch {
        fetched.current.delete(id);
      }
    },
    [agent],
  );

  const toggle = useCallback(
    (e: MouseEvent, id: string) => {
      // The whole column is a click target that focuses the agent; opening a row
      // is not that.
      e.stopPropagation();
      const opening = !open.has(id);
      setOpen((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      });
      // Alongside the open, never blocking it: the drawer shows the capped text
      // at once and swaps when the full body lands.
      if (opening) void loadFull(id);
    },
    [open, loadFull],
  );
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

  // Parsed once per list change rather than per render: the cheap prefix test
  // rejects almost every line, but the ones it accepts run a JSON.parse. Reruns
  // when a full body lands, because a payload the cap cut does not parse and
  // the same row becomes a JSON one the moment its whole text arrives.
  const payloads = useMemo(() => {
    const out = new Map<string, unknown>();
    for (const line of shown) {
      const value = parseJsonPayload(full.get(line.id) ?? line.text);
      if (value !== undefined) out.set(line.id, value);
    }
    return out;
  }, [shown, full]);

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
        const text = full.get(line.id) ?? line.text;
        // Three ways a row has more to show than a column can hold: the author's
        // own line breaks, which the projection keeps; a payload, whose
        // structure is the thing worth opening; and a row the cap cut, which
        // may be either once its full body arrives. The cut test reads the
        // PROJECTED text so the caret cannot vanish under the swap it triggers.
        const payload = payloads.get(line.id);
        const more =
          text.includes('\n') ||
          payload !== undefined ||
          (line.text.length === TRANSCRIPT_TEXT_CAP && line.text.endsWith('…'));
        const isOpen = more && open.has(line.id);
        const opacity = (working ? 1 : RESTING) * fade(shown.length - 1 - i);

        if (isOpen && payload !== undefined) {
          // Derived from the string on screen, and re-derived after the swap:
          // a figure that disagrees with the gutter beside it is visibly wrong.
          const meta = jsonSummary(payload);
          const pretty = jsonText(payload);
          const showRaw = raw.has(line.id);
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
                    color: 'var(--color-neutral-500)',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: '10.5px',
                  }}
                >
                  {text}
                </span>
                <span
                  style={{
                    border: '1px solid var(--color-neutral-800)',
                    color: 'var(--color-neutral-600)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0 5px',
                    fontSize: '9.5px',
                    flex: 'none',
                  }}
                >
                  json
                </span>
                <span style={{ flex: 1 }} />
                <span
                  data-testid="json-meta"
                  style={{ color: 'var(--color-neutral-700)', fontSize: '10px', flex: 'none' }}
                >
                  {`${meta.keys} keys · ${meta.lines} lines · ${meta.bytes} B`}
                </span>
                <span
                  data-testid="transcript-more"
                  aria-hidden
                  style={{ color: 'var(--color-accent-400)', flex: 'none', fontSize: '10px' }}
                >
                  ▾
                </span>
              </div>

              {showRaw ? (
                <div
                  className="tscroll"
                  data-testid="json-raw"
                  style={{
                    maxHeight: '210px',
                    background: 'var(--terminal-ground)',
                    border: '1px solid var(--color-neutral-900)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '9px 11px',
                    color: 'var(--color-neutral-300)',
                    fontSize: '11px',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {text}
                </div>
              ) : (
                <JsonBody value={payload} />
              )}

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span style={{ color: 'var(--color-neutral-700)', fontSize: '10px' }}>
                  click the row again to collapse
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="btn-neutral"
                  data-testid="json-copy"
                  onClick={(e: MouseEvent) => {
                    e.stopPropagation();
                    void navigator.clipboard?.writeText(showRaw ? text : pretty);
                  }}
                  style={NEUTRAL_ACTION}
                >
                  {showRaw ? 'copy raw' : 'copy json'}
                </button>
                <button
                  type="button"
                  className="btn-neutral"
                  data-testid="json-raw-toggle"
                  aria-pressed={showRaw}
                  onClick={(e: MouseEvent) => toggleRaw(e, line.id)}
                  style={NEUTRAL_ACTION}
                >
                  {showRaw ? 'formatted' : 'raw'}
                </button>
              </div>
            </div>
          );
        }

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
                  {headOf(text)}
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
                {blocksOf(text).map((block, b) => (
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
                  {`${text.split('\n').length} lines`}
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="btn-neutral"
                  data-testid="transcript-copy"
                  onClick={(e: MouseEvent) => {
                    e.stopPropagation();
                    void navigator.clipboard?.writeText(text);
                  }}
                  style={NEUTRAL_ACTION}
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
              {more ? headOf(text) : text}
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
  const nl = text.indexOf('\n');
  // A payload row is expandable on its structure alone, so it reaches here with
  // no newline at all — where a bare slice to -1 would eat its last character.
  return nl === -1 ? text : text.slice(0, nl);
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
