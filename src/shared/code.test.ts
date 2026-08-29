import { describe, expect, it } from 'vitest';
import { codeTokens, segments, toolCodeLang } from './code';

describe('segments', () => {
  it('splits a fenced block out of the prose around it', () => {
    const out = segments('before\n```js\nconst a = 1;\n```\nafter');
    expect(out.map((s) => s.kind)).toEqual(['prose', 'code', 'prose']);
    expect(out[1]).toEqual({ kind: 'code', lang: 'js', lines: ['const a = 1;'] });
  });

  it('keeps a message with no fence as a single prose segment', () => {
    expect(segments('just a sentence')).toEqual([{ kind: 'prose', text: 'just a sentence' }]);
  });

  // The transcript cap cuts long messages mid-block, so this is the common case
  // rather than the odd one.
  it('still opens a block when the closing fence was cut off', () => {
    const out = segments('intro\n```sh\nnpm test');
    expect(out[1]).toEqual({ kind: 'code', lang: 'sh', lines: ['npm test'] });
  });

  it('carries an unlabelled fence', () => {
    expect(segments('```\nplain\n```')[0]).toEqual({ kind: 'code', lang: '', lines: ['plain'] });
  });
});

describe('codeTokens', () => {
  const kindOf = (line: string, text: string) =>
    codeTokens(line).find((t) => t.text === text)?.kind;

  it('marks keywords, strings and numbers', () => {
    expect(kindOf('const a = 1;', 'const')).toBe('keyword');
    expect(kindOf("const a = 'hi';", "'hi'")).toBe('string');
    expect(kindOf('const a = 42;', '42')).toBe('number');
  });

  it('takes a comment to the end of the line', () => {
    const out = codeTokens('const a = 1; // why');
    expect(out.at(-1)).toEqual({ kind: 'comment', text: '// why' });
  });

  // The two mistakes a regex-replace highlighter always makes.
  it('leaves a # inside a string alone', () => {
    expect(codeTokens('echo "a # b"').some((t) => t.kind === 'comment')).toBe(false);
  });

  it('leaves a quote inside a comment alone', () => {
    const out = codeTokens("// it's fine");
    expect(out.filter((t) => t.kind === 'string')).toHaveLength(0);
  });

  it('round-trips the line exactly, so nothing is dropped on screen', () => {
    for (const line of ['const x = "a b";', '  if (a >= 2) { return; }', '# shell', '']) {
      expect(codeTokens(line).map((t) => t.text).join('')).toBe(line);
    }
  });
});

describe('toolCodeLang', () => {
  // A tool row has no prose to fence code off from: the whole body is the
  // command or the file, and it arrives with no fence at all.
  it('reads a Bash row as shell', () => {
    expect(toolCodeLang("Bash(cat > src/shared/code.test.ts <<'TS'")).toBe('sh');
  });

  it('takes the language of a file a tool opened', () => {
    expect(toolCodeLang('Read(/Users/x/src/web/App.tsx)')).toBe('ts');
    expect(toolCodeLang('Edit(/Users/x/plugin/hooks/hooks.json)')).toBe('json');
  });

  // A README rendered as code is worse than a README rendered plainly.
  it('leaves markdown and unknown extensions as prose', () => {
    expect(toolCodeLang('Read(/Users/x/README.md)')).toBeUndefined();
    expect(toolCodeLang('Read(/Users/x/notes.weird)')).toBeUndefined();
  });

  it('is not fooled by an ordinary sentence that mentions a tool', () => {
    expect(toolCodeLang('the Bash (not a row) output')).toBeUndefined();
    expect(toolCodeLang('see this:')).toBeUndefined();
  });
});
