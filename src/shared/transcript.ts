import type { Marker, TranscriptLine } from './domain';
import type { Usage } from './usage';

export interface TranscriptRecord {           // one parsed JSONL line, loosely typed
  type?: string; uuid?: string; timestamp?: string; isSidechain?: boolean;
  isApiErrorMessage?: boolean; agentId?: string; subtype?: string;
  compactMetadata?: { postTokens?: number };
  message?: { id?: string; model?: string; role?: string; usage?: Usage; content?: unknown };
  toolUseResult?: unknown;
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

const TEAMMATE_OPEN = /^<teammate-message\s[^>]*>\r?\n?/;
const TEAMMATE_CLOSE = /\r?\n?<\/teammate-message>\s*$/;

const TOOL_INPUT_KEYS = [
  'command', 'file_path', 'path', 'pattern', 'query', 'url',
  'prompt', 'message', 'subject', 'description', 'taskId',
];

/**
 * Squashes a body to what a feed row can use, but KEEPS the line breaks. 37% of a lead's messages are
 * multi-line and 42% carry markdown structure — headings, tables, fenced code —
 * and flattening turned all of it into one run-on line of markdown SOURCE. A
 * row is still one line when collapsed (CSS `white-space: nowrap` folds the
 * newlines away), so this costs nothing to render and is what lets a view
 * expand a row into the shape the author wrote. Measured on 413 real messages:
 * +0.4% characters against `flatten`.
 *
 * Runs of horizontal space still collapse, and three or more blank lines become
 * one: neither survives a 47-character column, and both are pure bulk.
 */
function tidy(s: string): string {
  return s
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
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
}

/**
 * The rows one record projects to, before capText. Split out of
 * toTranscriptLines so an expanded row can ask for the text it was cut from
 * without a second copy of the projection rules to drift against.
 */
function draftsOf(rec: TranscriptRecord): { ts: number; drafts: Draft[] } | null {
  if (!rec.uuid || !rec.timestamp) return null;
  const ts = Date.parse(rec.timestamp);
  if (Number.isNaN(ts)) return null;

  const drafts: Draft[] = [];
  const content = rec.message?.content;

  if (rec.type === 'user') {
    if (typeof content === 'string') {
      const body = content.replace(TEAMMATE_OPEN, '').replace(TEAMMATE_CLOSE, '');
      const text = tidy(body);
      if (text) drafts.push({ marker: markerForUserText(body), text });
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
        drafts.push({ marker: '⏺', text: describeTool(b.name, b.input) });
      }
    }
  }

  return { ts, drafts };
}

export function toTranscriptLines(rec: TranscriptRecord): TranscriptLine[] {
  const built = draftsOf(rec);
  if (!built) return [];
  return built.drafts.map((draft, i) => ({
    id: `${rec.uuid}#${i}`,
    marker: draft.marker,
    text: capText(draft.text),
    ts: built.ts,
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
