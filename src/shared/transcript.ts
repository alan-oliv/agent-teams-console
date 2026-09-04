import type { Diff, DiffHunk, DiffLine, DiffSign, Marker, TranscriptLine } from './domain';
import { DIFF_LINES_CAP, DIFF_LINE_TEXT_CAP } from './domain';
import { splitTeammateDelivery } from './mailbox';
import type { Usage } from './usage';

export interface TranscriptRecord {           // one parsed JSONL line, loosely typed
  type?: string; uuid?: string; timestamp?: string; isSidechain?: boolean;
  isApiErrorMessage?: boolean; agentId?: string; subtype?: string;
  compactMetadata?: { postTokens?: number };
  message?: { id?: string; model?: string; role?: string; usage?: Usage; content?: unknown };
  toolUseResult?: unknown;
  /**
   * A turn the harness queued rather than delivered — `type: 'attachment'`, no
   * `message` at all. A background subagent's completion arrives this way as
   * often as it arrives as an ordinary user turn, so both forms have to be read
   * to see one finish. See subagents.ts.
   */
  attachment?: { type?: string; prompt?: string };
}

/**
 * Hard cap on the length of a projected `TranscriptLine.text` (and of the
 * `currentTool` string built from the same helper). The widest real render is
 * the Overview feed on a 5120px 1x panel at 849 characters — JetBrains Mono
 * advances exactly 0.6em — so 1000 stays lossless up to a 6033px window while
 * cutting the worst observed line (21,071 chars of raw tool-result JSON,
 * shipped to draw one ellipsised row) by 95%. The store keeps the raw record,
 * so raising this brings the text back.
 */
export const TRANSCRIPT_TEXT_CAP = 1000;

const TOOL_INPUT_KEYS = [
  'command', 'file_path', 'path', 'pattern', 'query', 'url',
  'prompt', 'message', 'subject', 'description', 'taskId',
];

const INDENT = /^[^\S\n]*/;

/**
 * Squashes a body to what a feed row can use, but KEEPS the line breaks. 37% of a lead's messages are
 * multi-line and 42% carry markdown structure — headings, tables, fenced code —
 * and flattening turned all of it into one run-on line of markdown SOURCE. A
 * row is still one line when collapsed (CSS `white-space: nowrap` folds the
 * newlines away), so this costs nothing to render and is what lets a view
 * expand a row into the shape the author wrote. Measured on 413 real messages:
 * +0.4% characters against `flatten`.
 *
 * Runs of horizontal space WITHIN a line still collapse, trailing space goes,
 * and three or more blank lines become one: none of that survives a
 * 47-character column, and all of it is pure bulk.
 *
 * Leading indentation is the exception, and it is the same argument as the
 * newlines: a teammate reporting a type or a command indents it rather than
 * fencing it, and the indent is the whole difference between a code block and a
 * run-on paragraph — code.ts reads a block back out of it. A collapsed row
 * never shows it either way. Measured on the same corpus: +0.8% characters
 * against collapsing it, +1.0% on the rows a poll actually ships.
 */
function tidy(s: string): string {
  return s
    .split('\n')
    .map((line) => {
      const indent = INDENT.exec(line)![0];
      const body = line.slice(indent.length).replace(/[^\S\n]+/g, ' ').trimEnd();
      return body ? indent + body : '';
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// `cd <somewhere> && ` / `cd <somewhere>; ` at the head of a command. Measured
// on a live console: 18 of 18 Bash lines opened with the same 43 characters, so
// three different commands rendered as the same 47-character row. The directory
// is constant context the header already carries; the command is the signal.
// A NEWLINE separates the two as often as `;` or `&&` does — measured on this
// machine's own transcripts, where every multi-line command opens that way.
// Anchored, and `cd` and its path must share a line and be ONE token, so `cd`
// alone, `cdk deploy`, `echo "cd /tmp"` and `git log | grep cd` all survive.
const LEADING_CD = /^cd[^\S\n]+("[^"]*"|'[^']*'|\S+)[^\S\n]*(?:&&|;|\n)\s*/;

function capText(s: string): string {
  if (s.length <= TRANSCRIPT_TEXT_CAP) return s;
  // A bare slice can leave a lone high surrogate, which JSON.stringify escapes
  // faithfully and the browser then paints as U+FFFD.
  return `${s.slice(0, TRANSCRIPT_TEXT_CAP - 1).replace(/[\uD800-\uDBFF]$/, '')}…`;
}

export function parseLine(raw: string): TranscriptRecord | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as TranscriptRecord;
}

function describeTool(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return name;
  const fields = input as Record<string, unknown>;
  for (const key of TOOL_INPUT_KEYS) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim()) {
      const shown = name === 'Bash' ? value.replace(LEADING_CD, '') : value;
      return capText(`${name}(${tidy(shown)})`);
    }
  }
  return name;
}

type DiffOp = { sign: DiffSign; text: string };

// Line-level LCS between an Edit's old_string and new_string. Ordinary DP: the
// inputs are one tool call's worth of text, not a file, so O(n*m) is cheap —
// except when it isn't, which the guard in diffOfToolUse below covers.
function lineDiff(oldText: string, newText: string): DiffOp[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const n = oldLines.length;
  const m = newLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ sign: ' ', text: oldLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ sign: '-', text: oldLines[i] });
      i++;
    } else {
      ops.push({ sign: '+', text: newLines[j] });
      j++;
    }
  }
  while (i < n) ops.push({ sign: '-', text: oldLines[i++] });
  while (j < m) ops.push({ sign: '+', text: newLines[j++] });
  return ops;
}

// Above this, the DP table itself (not just its output) is the cost, so an
// unusually large Edit falls back to the un-aligned "all old lines gone, all
// new lines arrived" shape rather than spending O(n*m) on it.
const LCS_CELL_BUDGET = 500_000;

/**
 * The hunk an Edit or Write's tool_use input carries, before either DIFF_*
 * cap is applied. There is no file position in this input — old_string and
 * new_string are a substring, not an offset — so line numbers are relative to
 * the snippet (both sides start at 1). They stay correct under duplicate
 * lines in the snippet regardless: numbering walks OPS IN ORDER, never by
 * matching content, so it does not depend on which of several equally valid
 * LCS alignments a repeated line landed in.
 */
function diffOfToolUse(name: string, input: unknown, agent: string, ts: number): Diff | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const fields = input as Record<string, unknown>;
  const filePath = fields.file_path;
  if (typeof filePath !== 'string' || !filePath) return undefined;

  let ops: DiffOp[];
  if (name === 'Edit' && typeof fields.old_string === 'string' && typeof fields.new_string === 'string') {
    const oldText = fields.old_string;
    const newText = fields.new_string;
    ops =
      (oldText.split('\n').length + 1) * (newText.split('\n').length + 1) <= LCS_CELL_BUDGET
        ? lineDiff(oldText, newText)
        : [
            ...oldText.split('\n').map((text): DiffOp => ({ sign: '-', text })),
            ...newText.split('\n').map((text): DiffOp => ({ sign: '+', text })),
          ];
  } else if (name === 'Write' && typeof fields.content === 'string') {
    // No prior content is available for a Write — not from this input, and
    // not by reading the file or shelling to git — so the whole thing shows
    // as added rather than guessing at what it replaced.
    ops = fields.content.split('\n').map((text): DiffOp => ({ sign: '+', text }));
  } else {
    return undefined;
  }

  const added = ops.filter((o) => o.sign === '+').length;
  const removed = ops.filter((o) => o.sign === '-').length;

  const lineCapped = ops.length > DIFF_LINES_CAP;
  const kept = lineCapped ? ops.slice(0, DIFF_LINES_CAP) : ops;

  let textCapped = false;
  let oldLine = 1;
  let newLine = 1;
  const lines: DiffLine[] = kept.map(({ sign, text }) => {
    const oldLineNo = sign === '+' ? null : oldLine;
    const newLineNo = sign === '-' ? null : newLine;
    if (sign !== '+') oldLine++;
    if (sign !== '-') newLine++;
    let shown = text;
    if (shown.length > DIFF_LINE_TEXT_CAP) {
      textCapped = true;
      shown = `${shown.slice(0, DIFF_LINE_TEXT_CAP - 1)}…`;
    }
    return { sign, oldLineNo, newLineNo, text: shown };
  });

  const oldCount = lines.filter((l) => l.sign !== '+').length;
  const newCount = lines.filter((l) => l.sign !== '-').length;
  const hunk: DiffHunk = { header: `@@ -1,${oldCount} +1,${newCount} @@`, lines };

  const diff: Diff = { path: filePath, added, removed, agent, ts, hunks: [hunk] };
  if (lineCapped || textCapped) diff.truncated = true;
  return diff;
}

/**
 * One row per delivered message. A record is not a message: a lead's queued
 * mail all drains at one turn boundary, so a real delivery carries as many
 * frames as were waiting — six from three different teammates, in the corpus —
 * and a single row could not say who any of it came from. The recipient's own
 * prose around the frames keeps its own rows.
 *
 * The line the marker draws is authorship, not shape: `❯` is what the operator
 * typed, which reaches here as bare content with no envelope, and `✉` is what
 * another agent sent. That covers the spawn prompt too — it is genuinely a
 * message from whoever spawned this agent, wrapped in the same envelope, and
 * naming that sender says more than an anonymous prompt glyph did. No
 * bare-frame heuristic can separate the two: `probe-bravo`'s own transcript
 * carries a single unwrapped frame that is an ordinary delivery.
 */
function deliveryDrafts(content: string): Draft[] {
  const drafts: Draft[] = [];
  for (const part of splitTeammateDelivery(content)) {
    const text = tidy(part.text);
    if (!text) continue;
    const marker = markerForUserText(part.text);
    if (part.from === undefined) {
      drafts.push({ marker, text });
      continue;
    }
    // A protocol frame keeps the marker that says what it wants from the
    // operator; ✉ only replaces the ❯ an ordinary message would have taken.
    drafts.push({ marker: marker === '❯' ? '✉' : marker, text, sender: part.from });
  }
  return drafts;
}

/**
 * Whether this record is one of the operator's own prompts — a `❯` line, and so
 * one TURN of the session.
 *
 * Deliberately structural rather than `toTranscriptLines(rec).some(...)`: the
 * fold derives lines only for the records it actually projects, and forcing a
 * full derivation over every stored record to count turns would undo that. The
 * two agree by construction — both route the user text through
 * {@link markerForUserText} — and a test pins them together.
 */
export function isPromptTurn(rec: TranscriptRecord): boolean {
  // No `isSidechain` guard: the fold's record sets are already per-agent, so a
  // subagent's records are filed under the subagent and never reach a lead's
  // count. Adding one here would only make this disagree with the derivation.
  if (rec.type !== 'user') return false;
  const content = rec.message?.content;
  if (typeof content === 'string') {
    return splitTeammateDelivery(content).some(
      (part) => part.from === undefined && tidy(part.text) !== '' && markerForUserText(part.text) === '\u276f',
    );
  }
  if (!Array.isArray(content)) return false;
  return content.some((block) => {
    if (!block || typeof block !== 'object') return false;
    const b = block as { type?: string; text?: string };
    return b.type === 'text' && typeof b.text === 'string' && tidy(b.text) !== '';
  });
}

function markerForUserText(body: string): Marker {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    try {
      const frame = JSON.parse(trimmed) as { type?: unknown };
      if (frame.type === 'idle_notification') return '○';
      if (typeof frame.type === 'string' && frame.type.endsWith('_request')) return '▲';
    } catch {
      // plain prose that merely starts with a brace
    }
  }
  return '❯';
}

function markerForResult(text: string, isError: boolean): Marker {
  if (isError) return '✗';
  if (/\b\d+ insertions?\(\+\)|\b\d+ deletions?\(-\)/.test(text)) return '+';
  if (/^(error|warning|failed|found \d+)/i.test(text)) return '!';
  if (/^(updated|created|wrote|applied|added|completed|done|success)/i.test(text)) return '✓';
  return '⎿';
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return tidy(content);
  if (Array.isArray(content)) {
    return tidy(
      content
        .map((block) => {
          if (block && typeof block === 'object') {
            const text = (block as { text?: unknown }).text;
            if (typeof text === 'string') return text;
          }
          return JSON.stringify(block);
        })
        .join(' '),
    );
  }
  return tidy(JSON.stringify(content ?? ''));
}

interface Draft {
  marker: Marker;
  text: string;
  diff?: Diff;
  sender?: string;
}

/**
 * The rows one record projects to, before capText. Split out of
 * toTranscriptLines so an expanded row can ask for the text it was cut from
 * without a second copy of the projection rules to drift against.
 *
 * `agent` has no source inside the record itself — a lead's own transcript
 * carries no agentId at all, and a teammate's is the transcript FILENAME's id
 * (`aprobe-alpha-<hex>`), not the bare roster name `Diff.agent` needs — so it
 * is the caller's job to pass the name it already resolved the record's file
 * to. Defaulted rather than required so a caller that has none still compiles;
 * such a caller gets a diff with an empty `agent`.
 */
function draftsOf(rec: TranscriptRecord, agent = ''): { ts: number; drafts: Draft[] } | null {
  if (!rec.uuid || !rec.timestamp) return null;
  const ts = Date.parse(rec.timestamp);
  if (Number.isNaN(ts)) return null;

  const drafts: Draft[] = [];
  const content = rec.message?.content;

  if (rec.type === 'user') {
    if (typeof content === 'string') {
      for (const draft of deliveryDrafts(content)) drafts.push(draft);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as { type?: string; content?: unknown; is_error?: boolean; text?: string };
        if (b.type === 'tool_result') {
          const text = resultText(b.content);
          if (text) drafts.push({ marker: markerForResult(text, b.is_error === true), text });
        } else if (b.type === 'text' && typeof b.text === 'string') {
          const text = tidy(b.text);
          if (text) drafts.push({ marker: '❯', text });
        }
      }
    }
  } else if (rec.type === 'assistant' && Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as { type?: string; text?: string; name?: string; input?: unknown };
      if (b.type === 'text' && typeof b.text === 'string') {
        const text = tidy(b.text);
        if (text) drafts.push({ marker: '⏺', text });
      } else if (b.type === 'tool_use' && typeof b.name === 'string') {
        const diff = diffOfToolUse(b.name, b.input, agent, ts);
        const draft: Draft = { marker: '⏺', text: describeTool(b.name, b.input) };
        if (diff) draft.diff = diff;
        drafts.push(draft);
      }
    }
  }

  return { ts, drafts };
}

export function toTranscriptLines(rec: TranscriptRecord, agent = ''): TranscriptLine[] {
  const built = draftsOf(rec, agent);
  if (!built) return [];
  return built.drafts.map((draft, i) => ({
    id: `${rec.uuid}#${i}`,
    marker: draft.marker,
    text: capText(draft.text),
    ts: built.ts,
    ...(draft.diff ? { diff: draft.diff } : {}),
    ...(draft.sender ? { sender: draft.sender } : {}),
  }));
}

/**
 * The uncapped text behind one projected line, addressed by its index within
 * the record — the `#N` half of a TranscriptLine id.
 *
 * `TranscriptLine.text` is capped so that every poll stays small for every
 * agent; that bound was sized for a COLLAPSED row, where 1000 characters is
 * already more than one line can show. An expanded row is a different question,
 * and it is asked by hand, one row at a time, so it can afford the whole thing.
 * Undefined when the index names no row of this record.
 */
export function fullLineText(rec: TranscriptRecord, index: number): string | undefined {
  return draftsOf(rec)?.drafts[index]?.text;
}

export function currentToolOf(rec: TranscriptRecord): string | undefined {
  const content = rec.message?.content;
  if (rec.type !== 'assistant' || !Array.isArray(content)) return undefined;
  let found: string | undefined;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: string; name?: string; input?: unknown };
    if (b.type === 'tool_use' && typeof b.name === 'string') found = describeTool(b.name, b.input);
  }
  return found;
}
