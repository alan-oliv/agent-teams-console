import {
  useCallback,
  useContext,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type UIEvent,
} from 'react';
import type { Subagent, TranscriptLine } from '../../shared/domain';
import { TRANSCRIPT_TEXT_CAP } from '../../shared/transcript';
import { resolveModel } from '../../shared/catalog';
import { contextBar, diffStat, formatElapsed, formatTokens } from '../format';
import { DiffContext } from '../state/useTeamState';
import { useAppearance } from '../state/useSettings';
import { useCast } from '../state/useCast';
import { DENSITY } from '../themes';
import { codeTokens, segments, toolCodeLang, type CodeTokenKind } from '../../shared/code';
import { blocks as mdBlocks, type Inline } from '../../shared/markdown';
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

// A row with no newline otherwise has no expandability trigger at all, so a
// long one-liner just ellipsises with no way to read the rest. The wall
// column's minimum width is 232px; a monospaced line comfortably overflows
// that well before 120 characters.
const LONG_LINE_CHARS = 120;

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

// Nothing on a real machine nests past depth 1 (CONSOLE-NOTES.md §25), so this
// is a floor against a pathological case rather than a tuned number.
const MAX_CHAIN_ROWS = 6;

// Matches the "json" pill on the payload drawer head — the console's one
// small-pill treatment, reused rather than invented again for subagent badges.
const TYPE_BADGE: CSSProperties = {
  border: '1px solid var(--color-neutral-800)',
  color: 'var(--color-neutral-600)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 5px',
  fontSize: '9.5px',
  flex: 'none',
};

/** A Task/Agent dispatch line, as `describeTool` renders it — never any other tool call. */
function isSubagentCall(text: string): boolean {
  return text === 'Task' || text === 'Agent' || text.startsWith('Task(') || text.startsWith('Agent(');
}

/**
 * What a subagent's row reads: `Task(explore-auth)`, per canvas `8b`.
 *
 * The subagent's NAME, never the dispatch line's own text. `describeTool`
 * renders that line from the tool's first argument, which for a Task or Agent
 * call is the whole prompt — so the row read `Agent(You are auditing GIT
 * HYGIENE for a set of local git repos. STRICTLY READ-ONLY: do not run…)`
 * across the full width. The trace view has always used the name; this is the
 * same label in the same shape.
 */
function taskLabelOf(subagent: Subagent): string {
  const inner = subagent.name ?? subagent.description;
  return inner ? `Task(${inner})` : 'Task';
}

/**
 * A depth-1 row folds the type into the parens — `Task(Explore, grep-callsites)`
 * — per the canvas's stream mock (§8), which draws no pill there. The drawer's
 * children keep {@link taskLabelOf} plus the pill: only `8b` draws that far in.
 */
function streamTaskLabelOf(subagent: Subagent): string {
  const inner = subagent.name ?? subagent.description;
  return subagent.agentType && inner ? `Task(${subagent.agentType}, ${inner})` : taskLabelOf(subagent);
}

/**
 * The collapsed row's right-aligned figure, state first — the canvas's stream
 * mock reads returns, not spend: `returned 41 words · 6.3k used · spawned 2`,
 * `running · 6.2k so far`. A figure not yet measured is omitted rather than
 * zeroed or dashed; `queued` alone is a gap-fill, the canvas never draws one.
 */
function subagentSummary(subagent: Subagent): string {
  const tokens = subagent.tokens !== undefined ? formatTokens(subagent.tokens) : undefined;
  const spawned = subagent.children.length > 0 ? ` · spawned ${subagent.children.length}` : '';
  if (subagent.state === 'queued') return 'queued';
  if (subagent.state === 'running') return `running${tokens ? ` · ${tokens} so far` : ''}${spawned}`;
  const opening =
    subagent.state === 'failed'
      ? 'failed'
      : subagent.returnedWords !== undefined
        ? `returned ${subagent.returnedWords} word${subagent.returnedWords === 1 ? '' : 's'}`
        : 'returned';
  return `${opening}${tokens ? ` · ${tokens} used` : ''}${spawned}`;
}

/**
 * One Task call, collapsed to a line or expanded into the same inset drawer
 * container every other expandable row uses. Recursive: a subagent's own
 * dispatches nest inside its drawer as further `SubagentRow`s, dimmed and
 * ruled off — "reads as nested chain, not another agent's pane" — and expand
 * identically at any depth.
 */
function SubagentRow({
  subagent, label, depth, s, opacity, open, toggle,
}: {
  subagent: Subagent;
  label: string;
  depth: number;
  s: FeedStyle;
  opacity: number;
  open: ReadonlySet<string>;
  toggle: (e: MouseEvent, id: string) => void;
}) {
  const isOpen = open.has(subagent.toolUseId);
  // Depth 1 carries its type inside the label (`streamTaskLabelOf`), no pill.
  const badge = depth > 1 ? `${subagent.agentType ?? 'agent'} · depth ${depth}` : undefined;

  if (!isOpen) {
    return (
      <div
        data-testid="transcript-row"
        aria-expanded={false}
        onClick={(e: MouseEvent) => toggle(e, subagent.toolUseId)}
        style={{
          display: 'flex',
          gap: `${s.gap}px`,
          alignItems: 'baseline',
          whiteSpace: 'nowrap',
          opacity,
          cursor: 'pointer',
        }}
      >
        <span
          data-testid="transcript-marker"
          style={{ color: MARKER_COLOR, width: s.markerWidth, flex: 'none', fontSize: s.markerSize }}
        >
          ⏺
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
          {label}
        </span>
        {badge && (
          <span data-testid={depth > 1 ? 'subagent-depth' : 'subagent-type'} style={TYPE_BADGE}>
            {badge}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span
          data-testid="subagent-summary"
          style={{ color: 'var(--color-neutral-600)', fontSize: '10px', flex: 'none' }}
        >
          {subagentSummary(subagent)}
        </span>
        <span
          data-testid="transcript-more"
          aria-hidden
          style={{ color: 'var(--color-neutral-600)', flex: 'none', fontSize: '10px' }}
        >
          ▸
        </span>
      </div>
    );
  }

  const resolved = resolveModel(subagent.model);

  return (
    <div
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
        onClick={(e: MouseEvent) => toggle(e, subagent.toolUseId)}
        style={{ display: 'flex', gap: `${s.gap}px`, alignItems: 'baseline', cursor: 'pointer' }}
      >
        <span
          data-testid="transcript-marker"
          style={{ color: 'var(--color-accent-400)', width: s.markerWidth, flex: 'none', fontSize: s.markerSize }}
        >
          ⏺
        </span>
        <span
          data-testid="transcript-text"
          style={{ color: 'var(--color-text)', textWrap: 'pretty', ...(s.textSize ? { fontSize: s.textSize } : {}) }}
        >
          {label}
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
        data-testid="subagent-header"
        style={{
          display: 'flex',
          gap: '9px',
          alignItems: 'baseline',
          paddingLeft: '16px',
          color: 'var(--color-neutral-500)',
          fontSize: '10.5px',
        }}
      >
        <span>{subagent.model ?? '—'}</span>
        <span style={{ color: 'var(--color-accent-500)', letterSpacing: '-.5px' }}>
          {contextBar(subagent.contextTokens ?? 0, resolved.window)}
        </span>
        <span>{subagent.tokens !== undefined ? formatTokens(subagent.tokens) : '—'}</span>
        <span>{subagent.toolCalls !== undefined ? `${subagent.toolCalls} tool calls` : '— tool calls'}</span>
        <span>{subagent.durationMs !== undefined ? formatElapsed(subagent.durationMs) : '—'}</span>
      </div>

      {subagent.children.length > 0 && (
        <div
          data-testid="subagent-children"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            marginLeft: '16px',
            paddingLeft: '10px',
            borderLeft: '1px solid var(--color-neutral-900)',
            opacity: 0.62,
          }}
        >
          {subagent.children.slice(0, MAX_CHAIN_ROWS).map((child) => (
            <SubagentRow
              key={child.toolUseId}
              subagent={child}
              label={taskLabelOf(child)}
              depth={depth + 1}
              s={s}
              opacity={1}
              open={open}
              toggle={toggle}
            />
          ))}
          {subagent.children.length > MAX_CHAIN_ROWS && (
            <span data-testid="subagent-truncated" style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}>
              {`⋯ ${subagent.children.length - MAX_CHAIN_ROWS} more calls`}
            </span>
          )}
        </div>
      )}

      <div
        data-testid="subagent-result"
        style={{ display: 'flex', gap: `${s.gap}px`, alignItems: 'baseline', paddingLeft: '16px' }}
      >
        <span style={{ color: MARKER_COLOR, width: s.markerWidth, flex: 'none', fontSize: s.markerSize }}>
          ⎿
        </span>
        <span style={{ color: s.textColor, ...(s.textSize ? { fontSize: s.textSize } : {}) }}>
          {subagent.returnedSummary ?? subagent.state}
        </span>
      </div>

      <div
        data-testid="subagent-footer"
        style={{ display: 'flex', gap: '10px', alignItems: 'center', paddingLeft: '16px' }}
      >
        <span style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}>
          no reply channel — a subagent returns once and is gone
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn-neutral" data-testid="subagent-trace" style={NEUTRAL_ACTION}>
          trace
        </button>
        <button
          type="button"
          className="btn-approve"
          data-testid="subagent-collapse"
          onClick={(e: MouseEvent) => toggle(e, subagent.toolUseId)}
          style={{ ...ACTION, border: '1px solid var(--color-accent-700)', color: 'var(--color-accent-300)' }}
        >
          collapse
        </button>
      </div>
    </div>
  );
}

/**
 * N Task calls dispatched in one turn, drawn as one line and a chip strip —
 * NEVER as columns, which would read as N agents rather than one agent's fan-out.
 * No per-chip stop: esc still ends the whole parent turn.
 */
function FanOutRow({ group, s, opacity }: { group: Subagent[]; s: FeedStyle; opacity: number }) {
  const stillRunning = group.filter((g) => g.state === 'queued' || g.state === 'running').length;
  const results = group.filter((g) => g.returnedSummary !== undefined);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', opacity }}>
      <div style={{ display: 'flex', gap: `${s.gap}px`, alignItems: 'baseline' }}>
        <span
          data-testid="transcript-marker"
          style={{ color: MARKER_COLOR, width: s.markerWidth, flex: 'none', fontSize: s.markerSize }}
        >
          ⏺
        </span>
        <span
          data-testid="fanout-header"
          style={{ color: s.textColor, ...(s.textSize ? { fontSize: s.textSize } : {}) }}
        >
          {`Task ×${group.length} dispatched in parallel`}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          marginLeft: '4px',
          paddingLeft: '12px',
          borderLeft: '1px solid var(--color-neutral-900)',
        }}
      >
        {group.map((sub) => (
          <div
            key={sub.toolUseId}
            data-testid="fanout-chip"
            style={{
              display: 'flex',
              gap: '5px',
              alignItems: 'center',
              border: '1px solid var(--color-neutral-800)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 6px',
              fontSize: '10px',
            }}
          >
            <span
              aria-hidden
              style={{
                color:
                  sub.state === 'running'
                    ? 'var(--color-accent-400)'
                    : sub.state === 'returned'
                      ? 'var(--color-accent-600)'
                      : 'var(--color-neutral-600)',
              }}
            >
              ●
            </span>
            <span style={{ color: 'var(--color-neutral-300)' }}>
              {sub.name ?? sub.description ?? sub.toolUseId}
            </span>
            {sub.agentType && <span style={{ color: 'var(--color-neutral-600)' }}>{sub.agentType}</span>}
            <span style={{ color: 'var(--color-neutral-600)' }}>
              {sub.tokens !== undefined ? formatTokens(sub.tokens) : '—'}
            </span>
            <span style={{ color: 'var(--color-neutral-600)' }}>
              {sub.state === 'returned'
                ? 'returned'
                : sub.durationMs !== undefined
                  ? formatElapsed(sub.durationMs)
                  : '—'}
            </span>
          </div>
        ))}
      </div>

      {results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '12px' }}>
          {results.map((sub) => (
            <div
              key={sub.toolUseId}
              data-testid="fanout-result"
              style={{ display: 'flex', gap: '7px', alignItems: 'baseline' }}
            >
              <span style={{ color: MARKER_COLOR, fontSize: s.markerSize }}>⎿</span>
              <span style={{ color: 'var(--color-neutral-500)', fontSize: '10px' }}>
                {sub.name ?? sub.description}
              </span>
              <span style={{ color: s.textColor, ...(s.textSize ? { fontSize: s.textSize } : {}) }}>
                {sub.returnedSummary}
              </span>
            </div>
          ))}
        </div>
      )}

      {stillRunning > 0 && (
        <div
          data-testid="fanout-pending"
          style={{ color: 'var(--color-neutral-600)', fontSize: '10px', paddingLeft: '12px' }}
        >
          {`${stillRunning} of ${group.length} still running — the turn cannot continue until all return`}
        </div>
      )}
    </div>
  );
}

/**
 * Who sent a delivered message. Stripping the envelope off a teammate frame was
 * right; dropping the attribution with it left 121 of 121 real deliveries
 * anonymous. A filled pill rather than an outlined one because the row it sits
 * on can be at 0.38 down the fade ladder, where a hairline border dissolves;
 * `flex: none` because the row is nowrap and the body, not the name, is what
 * should give way when the column is narrow.
 */
function Sender({ name, size }: { name: string; size: string }) {
  // The pill is the only place a row carries a name of its own; the text is the
  // agent's own words and is left exactly as it arrived.
  const display = useCast().asChar(name).display;

  return (
    <span
      data-testid="transcript-sender"
      style={{
        background: 'var(--color-accent-900)',
        color: 'var(--color-accent-300)',
        borderRadius: 'var(--radius-sm)',
        padding: '0 5px',
        fontSize: size,
        whiteSpace: 'nowrap',
        flex: 'none',
      }}
    >
      {display}
    </span>
  );
}

function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((s, i) =>
        s.kind === 'strong' ? (
          <strong key={i} style={{ color: 'var(--color-text)', fontWeight: 700 }}>
            {s.text}
          </strong>
        ) : s.kind === 'code' ? (
          <span
            key={i}
            data-testid="md-code"
            style={{
              background: 'var(--term)',
              border: '1px solid var(--color-neutral-900)',
              borderRadius: '3px',
              padding: '0 3px',
              color: 'var(--json-string)',
            }}
          >
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The markdown a message carries, rendered rather than shown as source. Only
 * the constructs that actually appear — see shared/markdown.ts for why the
 * subset is deliberate.
 */
function Prose({ text }: { text: string }) {
  return (
    <>
      {mdBlocks(text).map((b, i) =>
        b.kind === 'heading' ? (
          <div
            key={i}
            data-testid="md-heading"
            style={{
              color: 'var(--color-text)',
              fontWeight: 700,
              fontSize: b.level <= 2 ? '12.5px' : '11.5px',
              marginTop: i === 0 ? 0 : '3px',
            }}
          >
            <Spans spans={b.spans} />
          </div>
        ) : b.kind === 'item' ? (
          <div key={i} data-testid="md-item" style={{ display: 'flex', gap: '7px', lineHeight: 1.65 }}>
            <span style={{ color: 'var(--color-neutral-600)', flex: 'none' }}>
              {b.ordered ? '·' : '–'}
            </span>
            <span style={{ color: 'var(--color-neutral-300)', minWidth: 0 }}>
              <Spans spans={b.spans} />
            </span>
          </div>
        ) : b.kind === 'table' ? (
          <div
            key={i}
            data-testid="md-table"
            style={{
              whiteSpace: 'pre',
              overflowX: 'auto',
              color: 'var(--color-neutral-400)',
              lineHeight: 1.5,
            }}
          >
            {b.lines.join('\n')}
          </div>
        ) : (
          <span
            key={i}
            style={{ color: 'var(--color-neutral-300)', textWrap: 'pretty', lineHeight: 1.65 }}
          >
            <Spans spans={b.spans} />
          </span>
        ),
      )}
    </>
  );
}

// A fenced block reads from the same palette as a payload — it already took
// its string colour from there — so `number` follows `--json-number` rather
// than staying pinned to the amber that means "wants attention". `comment`
// keeps neutral-700: a ramp step is per-theme already and carries no meaning
// of its own beyond "quiet", which is what a comment is.
const CODE_COLOR: Record<CodeTokenKind, string> = {
  comment: 'var(--color-neutral-700)',
  string: 'var(--json-string)',
  number: 'var(--json-number)',
  keyword: 'var(--color-accent-400)',
  plain: 'var(--color-neutral-300)',
};

/**
 * A fenced block, on the terminal ground so it reads as inset rather than as
 * more prose. No line-number gutter: unlike a JSON payload this is usually a
 * short excerpt, and the numbers would be counting the excerpt rather than
 * anything the reader can refer to.
 */
function CodeBlock({ lang, lines }: { lang: string; lines: string[] }) {
  return (
    <div
      data-testid="code-block"
      style={{
        background: 'var(--term)',
        border: '1px solid var(--color-neutral-900)',
        borderRadius: 'var(--radius-sm)',
        padding: '8px 10px',
        overflowX: 'auto',
      }}
    >
      {lang && (
        <div
          data-testid="code-lang"
          // Not 9.5px at neutral-700 (2.69-2.80:1): that register is
          // neutral-600 at 10px everywhere in the console.
          style={{ color: 'var(--color-neutral-600)', fontSize: '10px', marginBottom: '4px' }}
        >
          {lang}
        </div>
      )}
      {lines.map((line, i) => (
        <div key={i} style={{ whiteSpace: 'pre', fontSize: '11px', lineHeight: 1.5 }}>
          {codeTokens(line).map((tok, t) => (
            <span key={t} style={{ color: CODE_COLOR[tok.kind] }}>
              {tok.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// All four value roles resolve through the JSON palette. `--warn` and `--fail`
// are semantic tokens — a number is not a warning, null is not a failure — and
// borrowing them meant a theme could not retune its amber without retinting
// every number in every payload. Keys and punctuation carry no such meaning.
const JSON_COLOR: Record<JsonTokenKind, string> = {
  key: 'var(--color-accent-400)',
  string: 'var(--json-string)',
  number: 'var(--json-number)',
  boolean: 'var(--json-boolean)',
  null: 'var(--json-null)',
  punct: 'var(--color-neutral-600)',
};

/**
 * The pretty-printed payload. Capped and scrolling on its own, and pointedly
 * NOT `.tail`: bottom-anchoring belongs to streams, and JSON reads top-down —
 * anchored, a payload opens showing its closing brace.
 */
function JsonBody({ value, numbers }: { value: unknown; numbers: boolean }) {
  const rows = jsonRows(value);
  return (
    <div
      className="tscroll"
      data-testid="json-body"
      style={{
        maxHeight: '210px',
        background: 'var(--term)',
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
            padding: numbers ? '0 11px 0 0' : '0 11px',
            fontSize: '11px',
            lineHeight: 1.5,
          }}
        >
          {numbers && (
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
          )}
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
  subagents,
}: {
  lines: TranscriptLine[];
  size: FeedSize;
  /** Omit to disable scrollback — views that show a digest, not a transcript. */
  agent?: string;
  /** Dims the whole ladder when this agent is not the one working. */
  working?: boolean;
  /** This agent's own Task/Agent dispatches, in spawn order. */
  subagents?: Subagent[];
}) {
  const s = FEED[size];
  const appearance = useAppearance();
  const openDiff = useContext(DiffContext);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  // One turn's fan-out shares the record that dispatched it — see
  // Subagent.siblingGroup — so this is also how a lone dispatch is told apart
  // from a parallel one: a group of one, or of more than one.
  const groupedBySiblingGroup = useMemo(() => {
    const groups = new Map<string, Subagent[]>();
    for (const sub of subagents ?? []) {
      const list = groups.get(sub.siblingGroup);
      if (list) list.push(sub);
      else groups.set(sub.siblingGroup, [sub]);
    }
    return groups;
  }, [subagents]);
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
  // `default` means each view keeps its OWN tuning — the rail reads at 11px and
  // a wall column at 10, and flattening both to one number is a regression the
  // control is not meant to cause. Only a deliberate compact/roomy overrides.
  // A condensed feed then runs 3px tighter than a full one, floored at 3, so
  // the setting reaches every transcript rather than stopping at two of them.
  const condensed = size !== 'wall' && size !== 'rail';
  const density = appearance.density === 'default'
    ? s.rowGap
    : condensed
      ? Math.max(3, DENSITY[appearance.density] - 3)
      : DENSITY[appearance.density];
  const container: CSSProperties = {
    flex: 1,
    minHeight: 0,
    padding: s.padding,
    display: 'flex',
    flexDirection: 'column',
    gap: `${density}px`,
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
  // Whether the operator was within 64px of the bottom BEFORE the latest
  // append, kept current by onScroll rather than recomputed here: geometry
  // read after React has already committed new rows includes their height, so
  // a burst taller than 64px would wrongly read as "scrolled away" even though
  // the operator never moved. Starts true so a fresh pane opens at the tail.
  const pinned = useRef(true);
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
    // Follow new output only when the operator was already at the bottom. If
    // they have scrolled up to read, appending a line must not yank them back
    // down.
    if (!el || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
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
      const el = e.currentTarget;
      // Within 64px of the bottom: keep following. Further than that: hold
      // position through the next append, until the operator scrolls back
      // down close enough for this to re-pin.
      pinned.current = el.scrollHeight - el.clientHeight - el.scrollTop <= 64;
      if (el.scrollTop < 48) void loadOlder();
    },
    [loadOlder],
  );

  // A fan-out's several tool_use lines share one record (siblingGroup), so
  // only the first of them renders the group — this tracks which groups this
  // render pass already spent, ahead of the plain diff/drawer/text branches.
  const consumedGroups = new Set<string>();

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
          (line.text.length === TRANSCRIPT_TEXT_CAP && line.text.endsWith('…')) ||
          text.length > LONG_LINE_CHARS;
        const isOpen = more && open.has(line.id);
        const opacity = appearance.fade
          ? (working ? 1 : RESTING) * fade(shown.length - 1 - i)
          : 1;

        // A Task/Agent dispatch line is matched to its subagent(s) by the
        // record that carries it — TranscriptLine.id is `${record uuid}#${i}`,
        // and Subagent.siblingGroup IS that record uuid. A record with more than
        // one dispatch draws its whole fan-out on the first matching line and
        // the rest render nothing, since they are the same turn's other calls.
        const recordUuid = line.id.slice(0, line.id.lastIndexOf('#'));
        const subagentGroup = groupedBySiblingGroup.get(recordUuid);
        if (subagentGroup && isSubagentCall(text)) {
          if (consumedGroups.has(recordUuid)) return null;
          consumedGroups.add(recordUuid);
          return subagentGroup.length > 1 ? (
            <FanOutRow key={line.id} group={subagentGroup} s={s} opacity={opacity} />
          ) : (
            <SubagentRow
              key={line.id}
              subagent={subagentGroup[0]}
              label={streamTaskLabelOf(subagentGroup[0])}
              depth={1}
              s={s}
              opacity={opacity}
              open={open}
              toggle={toggle}
            />
          );
        }

        // A diff-bearing row opens the patch in the shared modal rather than
        // expanding in place — a hunk is too tall for a column, so it never
        // takes the `more` drawer path below.
        if (line.diff) {
          const diff = line.diff;
          return (
            <div
              key={line.id}
              data-testid="transcript-row"
              className="diff-row"
              onClick={() => openDiff?.(diff)}
              style={{
                display: 'flex',
                gap: `${s.gap}px`,
                alignItems: 'baseline',
                whiteSpace: 'nowrap',
                opacity,
                cursor: 'pointer',
                margin: '0 -6px',
                padding: '2px 6px',
                borderRadius: 'var(--radius-sm)',
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
                {text}
              </span>
              <span style={{ flex: 1 }} />
              <span
                data-testid="diff-chip"
                style={{
                  color: 'var(--color-accent-300)',
                  border: '1px solid var(--color-accent-700)',
                  borderRadius: '8px',
                  padding: '0 6px',
                  fontSize: '10px',
                  flex: 'none',
                }}
              >
                {`${diffStat(diff.added, diff.removed)} ▸`}
              </span>
            </div>
          );
        }

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
                {line.sender && <Sender name={line.sender} size={s.markerSize} />}
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
                  style={{ color: 'var(--color-neutral-600)', fontSize: '10px', flex: 'none' }}
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
                    background: 'var(--term)',
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
                <JsonBody value={payload} numbers={appearance.numbers} />
              )}

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}>
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
                {line.sender && <Sender name={line.sender} size={s.markerSize} />}
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

              {/* A one-liner has no "rest" after the header — the header already
                  shows it whole, so a body here would just repeat it. */}
              {text.includes('\n') && (
                <>
                  <div style={{ height: '1px', background: 'var(--color-neutral-900)' }} />

                  <div
                    data-testid="transcript-drawer-body"
                    style={{ display: 'flex', flexDirection: 'column', gap: '11px', paddingLeft: '16px' }}
                  >
                    {/* The first line is the row's own header; the body is the rest. */}
                    {toolCodeLang(text.split('\n')[0]) !== undefined ? (
                      // A tool row carries no prose to fence code off from — the
                      // whole body is the command or the file.
                      <CodeBlock
                        lang={toolCodeLang(text.split('\n')[0])!}
                        lines={text.slice(text.indexOf('\n') + 1).replace(/\s+$/, '').split('\n')}
                      />
                    ) : (
                    segments(text.slice(text.indexOf('\n') + 1)).map((seg, b) =>
                      seg.kind === 'code' ? (
                        <CodeBlock key={b} lang={seg.lang} lines={seg.lines} />
                      ) : (
                        <Prose key={b} text={seg.text} />
                      ),
                    ))}
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', paddingLeft: '16px' }}>
                <span
                  data-testid="transcript-drawer-count"
                  style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}
                >
                  {(() => {
                    const n = text.split('\n').length;
                    return `${n} line${n === 1 ? '' : 's'}`;
                  })()}
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
            {line.sender && <Sender name={line.sender} size={s.markerSize} />}
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
                  style={{ color: 'var(--color-neutral-600)', flex: 'none', fontSize: '10px' }}
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
