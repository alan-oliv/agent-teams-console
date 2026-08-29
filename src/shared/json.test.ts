import { describe, expect, it } from 'vitest';
import { jsonRows, jsonSummary, jsonText, parseJsonPayload } from './json';

const PAYLOAD = {
  success: true,
  message: "Message sent to baseline-2's inbox",
  recipient: 'baseline-2',
  inbox: { unread: 3, size_bytes: 4192 },
  tokens: { prompt: 1284, completion: null },
  warnings: [],
};

/** The rendered text of one row, indent included — what the pane actually shows. */
function render(row: { indent: number; tokens: Array<{ text: string }> }): string {
  return '  '.repeat(row.indent) + row.tokens.map((t) => t.text).join('');
}

describe('parseJsonPayload', () => {
  it('accepts an object or an array', () => {
    expect(parseJsonPayload('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonPayload('  [1, 2]  ')).toEqual([1, 2]);
  });

  it('rejects prose, a bare literal and a payload the text cap truncated', () => {
    expect(parseJsonPayload('port free · GET / → 200')).toBeUndefined();
    expect(parseJsonPayload('42')).toBeUndefined();
    expect(parseJsonPayload('null')).toBeUndefined();
    expect(parseJsonPayload('"a string"')).toBeUndefined();
    // A row longer than TRANSCRIPT_TEXT_CAP arrives cut; half an object must
    // fall back to the prose drawer rather than render as if it were whole.
    expect(parseJsonPayload('{"success":true,"message":"Message sent to b…')).toBeUndefined();
  });
});

describe('jsonRows', () => {
  it('pretty-prints at two-space indent, one entry per rendered line', () => {
    expect(jsonRows(PAYLOAD).map(render)).toEqual([
      '{',
      '  "success": true,',
      '  "message": "Message sent to baseline-2\'s inbox",',
      '  "recipient": "baseline-2",',
      '  "inbox": {',
      '    "unread": 3,',
      '    "size_bytes": 4192',
      '  },',
      '  "tokens": {',
      '    "prompt": 1284,',
      '    "completion": null',
      '  },',
      '  "warnings": []',
      '}',
    ]);
  });

  it('renders the same text JSON.stringify does at the same indent', () => {
    expect(jsonRows(PAYLOAD).map(render).join('\n')).toBe(jsonText(PAYLOAD));
  });

  it('colours each token by what it is', () => {
    const rows = jsonRows({ k: 'v', n: 1, b: false, z: null });
    const kinds = rows.flatMap((r) => r.tokens.map((t) => [t.text, t.kind]));
    expect(kinds).toContainEqual(['"k"', 'key']);
    expect(kinds).toContainEqual(['"v"', 'string']);
    expect(kinds).toContainEqual(['1', 'number']);
    expect(kinds).toContainEqual(['false', 'boolean']);
    expect(kinds).toContainEqual(['null', 'null']);
    expect(kinds).toContainEqual([': ', 'punct']);
  });

  it('opens an array one element per line and keeps an empty one inline', () => {
    expect(jsonRows({ ids: ['T-03', 'T-07'], none: [] }).map(render)).toEqual([
      '{',
      '  "ids": [',
      '    "T-03",',
      '    "T-07"',
      '  ],',
      '  "none": []',
      '}',
    ]);
  });

  it('keeps an empty object inline too', () => {
    expect(jsonRows({ meta: {} }).map(render)).toEqual(['{', '  "meta": {}', '}']);
  });
});

describe('jsonSummary', () => {
  it('derives every figure in the header badge from the payload', () => {
    const summary = jsonSummary(PAYLOAD);
    expect(summary.keys).toBe(Object.keys(PAYLOAD).length);
    // The badge sits beside a live line-number gutter, so `lines` has to be the
    // number of rows the gutter will actually number.
    expect(summary.lines).toBe(jsonRows(PAYLOAD).length);
    expect(summary.bytes).toBe(new TextEncoder().encode(JSON.stringify(PAYLOAD)).length);
  });

  it('counts an array element as a key, because an index is what its keys are', () => {
    expect(jsonSummary(['a', 'b', 'c']).keys).toBe(3);
  });

  it('counts bytes, not characters', () => {
    expect(jsonSummary({ a: '€' }).bytes).toBe(JSON.stringify({ a: '€' }).length + 2);
  });
});
