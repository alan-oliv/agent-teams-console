import type { Marker, TranscriptLine } from './domain';
import type { Usage } from './usage';

export interface TranscriptRecord {           // one parsed JSONL line, loosely typed
  type?: string; uuid?: string; timestamp?: string; isSidechain?: boolean;
  isApiErrorMessage?: boolean; agentId?: string; subtype?: string;
  compactMetadata?: { postTokens?: number };
  message?: { id?: string; model?: string; role?: string; usage?: Usage; content?: unknown };
  toolUseResult?: unknown;
}

const TEAMMATE_OPEN = /^<teammate-message\s[^>]*>\r?\n?/;
const TEAMMATE_CLOSE = /\r?\n?<\/teammate-message>\s*$/;

const TOOL_INPUT_KEYS = [
  'command', 'file_path', 'path', 'pattern', 'query', 'url',
  'prompt', 'message', 'subject', 'description', 'taskId',
];

function flatten(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
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
    if (typeof value === 'string' && value.trim()) return `${name}(${flatten(value)})`;
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
  if (typeof content === 'string') return flatten(content);
  if (Array.isArray(content)) {
    return flatten(
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
  return flatten(JSON.stringify(content ?? ''));
}

export function toTranscriptLines(rec: TranscriptRecord): TranscriptLine[] {
  if (!rec.uuid || !rec.timestamp) return [];
  const ts = Date.parse(rec.timestamp);
  if (Number.isNaN(ts)) return [];

  const drafts: Array<{ marker: Marker; text: string }> = [];
  const content = rec.message?.content;

  if (rec.type === 'user') {
    if (typeof content === 'string') {
      const body = content.replace(TEAMMATE_OPEN, '').replace(TEAMMATE_CLOSE, '');
      const text = flatten(body);
      if (text) drafts.push({ marker: markerForUserText(body), text });
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as { type?: string; content?: unknown; is_error?: boolean; text?: string };
        if (b.type === 'tool_result') {
          const text = resultText(b.content);
          if (text) drafts.push({ marker: markerForResult(text, b.is_error === true), text });
        } else if (b.type === 'text' && typeof b.text === 'string') {
          const text = flatten(b.text);
          if (text) drafts.push({ marker: '❯', text });
        }
      }
    }
  } else if (rec.type === 'assistant' && Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as { type?: string; text?: string; name?: string; input?: unknown };
      if (b.type === 'text' && typeof b.text === 'string') {
        const text = flatten(b.text);
        if (text) drafts.push({ marker: '⏺', text });
      } else if (b.type === 'tool_use' && typeof b.name === 'string') {
        drafts.push({ marker: '⏺', text: describeTool(b.name, b.input) });
      }
    }
  }

  return drafts.map((draft, i) => ({
    id: `${rec.uuid}#${i}`,
    marker: draft.marker,
    text: draft.text,
    ts,
  }));
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
