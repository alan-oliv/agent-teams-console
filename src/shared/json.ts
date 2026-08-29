/**
 * Pretty-printing for the JSON payloads that arrive as tool results. A row
 * carrying one collapses like any other long row, but its drawer renders the
 * structure rather than the prose treatment, which turns a nested object into
 * one unreadable run of braces.
 */
export type JsonTokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct';

export interface JsonToken {
  text: string;
  kind: JsonTokenKind;
}

export interface JsonRow {
  indent: number;            // depth, rendered at two spaces each
  tokens: JsonToken[];
}

/**
 * The payload a row carries, or undefined when it is prose. Transcript text is
 * capped (TRANSCRIPT_TEXT_CAP), so a payload longer than the cap arrives
 * truncated and fails to parse — it falls back to the prose drawer rather than
 * rendering half an object as if it were whole.
 */
export function parseJsonPayload(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  return parsed !== null && typeof parsed === 'object' ? parsed : undefined;
}

function literal(value: unknown): JsonToken {
  if (value === null) return { text: 'null', kind: 'null' };
  if (typeof value === 'string') return { text: JSON.stringify(value), kind: 'string' };
  if (typeof value === 'number') return { text: String(value), kind: 'number' };
  if (typeof value === 'boolean') return { text: String(value), kind: 'boolean' };
  // undefined and functions cannot survive JSON.parse, so this is unreachable
  // for parsed payloads and only guards a hand-built value.
  return { text: String(value), kind: 'punct' };
}

/** One entry per rendered line, so the line-number gutter is just the index. */
export function jsonRows(value: unknown): JsonRow[] {
  const out: JsonRow[] = [];

  const walk = (val: unknown, indent: number, key: string | undefined, trailing: string) => {
    const head: JsonToken[] =
      key === undefined
        ? []
        : [
            { text: JSON.stringify(key), kind: 'key' },
            { text: ': ', kind: 'punct' },
          ];
    const push = (tokens: JsonToken[]) => out.push({ indent, tokens });

    if (Array.isArray(val)) {
      if (val.length === 0) {
        push([...head, { text: `[]${trailing}`, kind: 'punct' }]);
        return;
      }
      push([...head, { text: '[', kind: 'punct' }]);
      val.forEach((v, i) => walk(v, indent + 1, undefined, i < val.length - 1 ? ',' : ''));
      push([{ text: `]${trailing}`, kind: 'punct' }]);
      return;
    }

    if (val !== null && typeof val === 'object') {
      const keys = Object.keys(val as Record<string, unknown>);
      if (keys.length === 0) {
        push([...head, { text: `{}${trailing}`, kind: 'punct' }]);
        return;
      }
      push([...head, { text: '{', kind: 'punct' }]);
      keys.forEach((k, i) =>
        walk((val as Record<string, unknown>)[k], indent + 1, k, i < keys.length - 1 ? ',' : ''),
      );
      push([{ text: `}${trailing}`, kind: 'punct' }]);
      return;
    }

    const lit = literal(val);
    push(trailing ? [...head, lit, { text: trailing, kind: 'punct' }] : [...head, lit]);
  };

  walk(value, 0, undefined, '');
  return out;
}

export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * The drawer's header badge. Derived, never carried alongside the payload: it
 * sits beside a live line-number gutter, so a stale figure contradicts itself
 * on screen. An array's keys are its indices, which is what `N keys` counts.
 */
export function jsonSummary(value: unknown): { keys: number; lines: number; bytes: number } {
  return {
    keys: Object.keys(value as object).length,
    lines: jsonRows(value).length,
    bytes: new TextEncoder().encode(JSON.stringify(value)).length,
  };
}
