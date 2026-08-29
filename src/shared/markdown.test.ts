import { describe, expect, it } from 'vitest';
import { blocks, inlines } from './markdown';

describe('inlines', () => {
  it('marks bold and inline code', () => {
    expect(inlines('a **b** and `c`')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'strong', text: 'b' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'c' },
    ]);
  });

  // Backticks around an asterisk, or bold around a backtick, must not let one
  // construct split the other.
  it('does not let code and bold split each other', () => {
    expect(inlines('`a * b`')).toEqual([{ kind: 'code', text: 'a * b' }]);
    expect(inlines('**a `b` c**')).toEqual([{ kind: 'strong', text: 'a `b` c' }]);
  });

  it('leaves a lone asterisk and an unclosed backtick as text', () => {
    expect(inlines('2 * 3')).toEqual([{ kind: 'text', text: '2 * 3' }]);
    expect(inlines('a `b')).toEqual([{ kind: 'text', text: 'a `b' }]);
  });

  it('round-trips the visible characters', () => {
    const spans = inlines('x **y** `z` w');
    expect(spans.map((s) => s.text).join('')).toBe('x y z w');
  });
});

describe('blocks', () => {
  it('reads a heading with its level', () => {
    expect(blocks('## What changed')).toEqual([
      { kind: 'heading', level: 2, spans: [{ kind: 'text', text: 'What changed' }] },
    ]);
  });

  // A hard-wrapped sentence is one sentence, not one line per screen row.
  it('joins consecutive prose lines into one paragraph', () => {
    const out = blocks('one line\nand its continuation\n\na second para');
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      kind: 'para',
      spans: [{ kind: 'text', text: 'one line and its continuation' }],
    });
  });

  it('reads bullets and numbered items', () => {
    const out = blocks('- first\n2. second');
    expect(out.map((b) => b.kind)).toEqual(['item', 'item']);
    expect(out.map((b) => (b.kind === 'item' ? b.ordered : null))).toEqual([false, true]);
  });

  // Monospace already aligns a pipe table; a real one would fight the width.
  it('keeps a table verbatim', () => {
    const out = blocks('| what | n |\n| tests | 607 |');
    expect(out).toEqual([{ kind: 'table', lines: ['| what | n |', '| tests | 607 |'] }]);
  });

  it('separates a table from the prose around it', () => {
    expect(blocks('before\n| a |\nafter').map((b) => b.kind)).toEqual(['para', 'table', 'para']);
  });
});
