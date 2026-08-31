import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Diff, DiffHunk, DiffLine } from '../../shared/domain';
import { clockLabel, diffStat } from '../format';
import { useCast } from '../state/useCast';

const GUTTER_W = 44;
const SIGN_W = 16;

/**
 * Add and delete are tinted OVERLAYS, not fixed inks: Nocturne is a mono
 * palette carrying neither a green nor a red, and two of the six themes are
 * light. Composited over every theme's `--term` these stay visible (ΔE2000 4.3
 * at the weakest, Organic's delete) and stay apart from each other (9.4 at the
 * weakest), so all four survive as measured.
 */
const ADD_ROW = 'rgba(126,196,146,.13)';
const ADD_GUTTER = 'rgba(126,196,146,.10)';
const DEL_ROW = 'rgba(200,141,141,.13)';
const DEL_GUTTER = 'rgba(200,141,141,.10)';

/**
 * The sign glyph needs a green, and the prototype's literal `#7fb98d` was only
 * ever run on Nocturne: on the two light themes it lands at 1.9:1 against its
 * own row, which is unreadable. `--json-string` is the one green the palette
 * already tunes per theme — picked at each theme's own text lightness — and it
 * holds from 5.0:1 (Organic) to 10.1:1 (Phosphor). Delete needs no such rescue;
 * `--fail` is already per-theme.
 */
const ADD_SIGN = 'var(--json-string)';
const DEL_SIGN = 'var(--fail)';

const GUTTER: CSSProperties = {
  width: `${GUTTER_W}px`,
  flex: 'none',
  textAlign: 'right',
  paddingRight: '9px',
  // Not -700: measured 1.53–2.35:1 against the gutter's own add/delete tint,
  // which is a legibility defect rather than the restraint it looked like.
  color: 'var(--color-neutral-500)',
  fontSize: '10px',
};

function HunkRow({ line }: { line: DiffLine }) {
  const add = line.sign === '+';
  const del = line.sign === '-';
  const gutterBg = add ? ADD_GUTTER : del ? DEL_GUTTER : 'transparent';
  return (
    <div
      data-testid="diff-row"
      data-sign={line.sign}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        background: add ? ADD_ROW : del ? DEL_ROW : 'transparent',
        fontSize: '11.5px',
        lineHeight: '1.72',
        whiteSpace: 'pre',
      }}
    >
      <span style={{ ...GUTTER, background: gutterBg }}>{line.oldLineNo ?? ''}</span>
      <span style={{ ...GUTTER, background: gutterBg }}>{line.newLineNo ?? ''}</span>
      <span
        style={{
          width: `${SIGN_W}px`,
          flex: 'none',
          textAlign: 'center',
          fontSize: '11px',
          color: add ? ADD_SIGN : del ? DEL_SIGN : 'var(--color-neutral-700)',
        }}
      >
        {line.sign.trim()}
      </span>
      <span
        style={{
          color: add || del ? 'var(--color-text)' : 'var(--color-neutral-400)',
          paddingRight: '16px',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {/* An empty span collapses to no height, which would break the run of
            gutter numbers below it. */}
        {line.text === '' ? ' ' : line.text}
      </span>
    </div>
  );
}

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
 * Where each run of changed lines starts, as an index into the flattened row
 * list. A four-line replacement is ONE change, not four — stepping per line
 * would take four presses to cross it. A hunk boundary always ends a run: two
 * hunks are different regions of the file however their lines happen to sign.
 */
function changeRuns(hunks: DiffHunk[]): number[] {
  const starts: number[] = [];
  let row = 0;
  for (const hunk of hunks) {
    let inRun = false;
    for (const line of hunk.lines) {
      const changed = line.sign !== ' ';
      if (changed && !inRun) starts.push(row);
      inRun = changed;
      row++;
    }
  }
  return starts;
}

/** Changed rows that survived the caps — what the toolbar chip counts. */
function shownChangedLines(diff: Diff): number {
  return diff.hunks.reduce((n, h) => n + h.lines.filter((l) => l.sign !== ' ').length, 0);
}

/**
 * The patch as `git apply` would take it. A truncated payload is short by
 * however many lines the caps dropped and cannot apply, so it says so on a
 * leading comment line — `git apply` skips anything before the `---`, and a
 * patch that announces itself as partial beats one that just fails.
 */
function unifiedPatch(diff: Diff): string {
  const out: string[] = [];
  if (diff.truncated) {
    out.push(`# truncated: ${shownChangedLines(diff)} of ${diff.added + diff.removed} changed lines — incomplete, will not apply`);
  }
  out.push(`--- a/${diff.path}`, `+++ b/${diff.path}`);
  for (const hunk of diff.hunks) {
    out.push(hunk.header);
    for (const line of hunk.lines) out.push(`${line.sign}${line.text}`);
  }
  return `${out.join('\n')}\n`;
}

/**
 * Who made the edit, when, and (if it landed) at what sha. `diff.ts` is
 * epoch ms like every other `ts` in the domain, formatted here rather than
 * carried as a display string. An uncommitted edit has no sha, so it drops
 * out rather than rendering as "undefined".
 */
function metaLabel(diff: Diff, agent: string = diff.agent): string {
  const parts = [agent, clockLabel(diff.ts)];
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
  const [closeHover, setCloseHover] = useState(false);
  const { asChar } = useCast();
  const body = useRef<HTMLDivElement>(null);
  const runs = useMemo(() => (diff ? changeRuns(diff.hunks) : []), [diff]);
  // A ref, not state: which change you are on drives a scroll, and nothing on
  // screen reads it — the patch moving under you IS the feedback.
  const at = useRef(-1);

  useEffect(() => {
    at.current = -1;
  }, [diff]);

  const step = useCallback(
    (delta: number) => {
      if (runs.length === 0) return;
      at.current = Math.min(runs.length - 1, Math.max(0, at.current + delta));
      const rows = body.current?.querySelectorAll<HTMLElement>('[data-testid="diff-row"]');
      // jsdom has no scrollIntoView, and neither does a row that scrolled out
      // of the DOM between keypresses.
      rows?.[runs[at.current]]?.scrollIntoView?.({ block: 'center' });
    },
    [runs],
  );

  useEffect(() => {
    if (!diff) return;
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'j') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'k') {
        e.preventDefault();
        step(-1);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [diff, onClose, step]);

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
          <span data-testid="diff-stat" style={{ color: ADD_SIGN, fontSize: '11px', flex: 'none' }}>
            {diffStat(diff.added, diff.removed)}
          </span>
          <span style={{ flex: 1 }} />
          <span
            data-testid="diff-meta"
            style={{ color: 'var(--color-neutral-600)', fontSize: '10.5px', whiteSpace: 'nowrap', flex: 'none' }}
          >
            {metaLabel(diff, asChar(diff.agent).display)}
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
          {/* No unified/split segments: there is one layout. The prototype
              tracks a `diffSplit` flag and derives a column width from it, but
              nothing reads either — a side-by-side view would be a screen the
              design never specifies. The pair changed only their own highlight,
              and a control that does not change the render is worse than none.

              Removing them, and `open in editor` with them, left the row empty
              on its left. It is rebalanced around what is left: what the patch
              IS on the left, the one thing you can DO with it on the right. */}
          <span
            data-testid="diff-hunk-count"
            style={{ color: 'var(--color-neutral-600)', fontSize: '10px', flex: 'none', whiteSpace: 'nowrap' }}
          >
            {hunkLabel(diff.hunks.length)}
          </span>
          {/* The hunks come from the Edit tool's own old_string/new_string,
              which carry no position in the file, so the numbers start at 1 and
              count the snippet. Unsaid, they read as file lines and are wrong. */}
          <span
            data-testid="diff-relative-note"
            style={{ color: 'var(--color-neutral-600)', fontSize: '10px', flex: 'none', whiteSpace: 'nowrap' }}
          >
            line numbers are snippet-relative
          </span>
          {diff.truncated && (
            <span
              data-testid="diff-truncation"
              style={{
                color: 'var(--warn)',
                border: '1px solid var(--warn-edge)',
                borderRadius: 'var(--radius-sm)',
                padding: '0 6px',
                fontSize: '10px',
                flex: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {`${shownChangedLines(diff)} of ${diff.added + diff.removed} changed lines shown`}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {/* No "open in editor" beside it: the server exposes select,
              shutdown, agent message/interrupt/stop/respawn, plans, permits
              and history, and none of them can reach an editor. A control that
              cannot do what it says is worse than one that is not there — the
              call `respawn` and the in-flight badge already make. */}
          <button
            type="button"
            className="btn-neutral"
            data-testid="diff-copy"
            onClick={() => void navigator.clipboard?.writeText(unifiedPatch(diff))}
            style={{
              ...OUTLINE_ACTION,
              border: '1px solid var(--color-neutral-800)',
              color: 'var(--color-neutral-500)',
              flex: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            copy patch
          </button>
        </div>

        {/* No `.tail`: bottom-anchoring belongs to streams, and a patch reads
            top-down — the same call the JSON drawer makes. */}
        <div
          ref={body}
          className="tscroll"
          data-testid="diff-body"
          style={{ flex: 1, background: 'var(--term)', display: 'flex', flexDirection: 'column' }}
        >
          {diff.hunks.map((hunk, i) => (
            <Fragment key={`${hunk.header}#${i}`}>
              <div
                data-testid="diff-hunk-header"
                style={{
                  background: 'var(--color-accent-900)',
                  color: 'var(--color-accent-300)',
                  fontSize: '11px',
                  lineHeight: '1.72',
                  paddingLeft: `${GUTTER_W * 2 + SIGN_W}px`,
                  whiteSpace: 'pre',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {hunk.header}
              </div>
              {hunk.lines.map((line, j) => (
                <HunkRow key={j} line={line} />
              ))}
            </Fragment>
          ))}
        </div>

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
          <span style={{ flex: 'none', whiteSpace: 'nowrap' }}>esc close</span>
          <span style={{ flex: 'none', whiteSpace: 'nowrap' }}>j/k next change</span>
          <span style={{ flex: 'none', whiteSpace: 'nowrap' }}>wall keys suspended while open</span>
          {/* The chip above says the patch is short; this says what that costs
              you, at the one moment it matters — the button that copies it. */}
          {diff.truncated && (
            <span
              data-testid="diff-truncated-note"
              style={{ color: 'var(--warn)', flex: 'none', whiteSpace: 'nowrap' }}
            >
              the copied patch is incomplete — it will not apply
            </span>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ flex: 'none', whiteSpace: 'nowrap' }}>
            the transcript keeps its one line — the patch lives here
          </span>
        </div>
      </div>
    </div>
  );
}
