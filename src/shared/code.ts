/**
 * Fenced code blocks inside an expanded row, and enough tokenising to colour
 * them.
 *
 * `tidy()` keeps the newlines of a message precisely so a drawer can show "the
 * shape the author wrote" — 42% of a lead's messages carry markdown structure.
 * A fence rendered as prose loses that shape twice over: the backticks read as
 * literal text, and the code inside sits in the same colour as the sentence
 * around it.
 *
 * Deliberately NOT a language parser. It marks comments, strings, numbers and a
 * common keyword set, which is what separates code from prose at a glance in the
 * languages this console actually shows (js/ts, shell, json). Anything it cannot
 * classify stays plain, which is the honest failure: unhighlighted code still
 * reads as code, mis-highlighted code does not.
 */
export type CodeTokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'plain';

export interface CodeToken {
  kind: CodeTokenKind;
  text: string;
}

/** One segment of a message: either prose, or a fenced block with its language. */
export type Segment =
  | { kind: 'prose'; text: string }
  | { kind: 'code'; lang: string; lines: string[] };

const FENCE = /^```([A-Za-z0-9_+-]*)\s*$/;

/**
 * Splits on ``` fences. An unterminated fence — a message cut by the transcript
 * cap mid-block, which is common — still opens a code segment rather than
 * dumping the rest as prose with a stray fence in it.
 */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let prose: string[] = [];
  let code: string[] | null = null;
  let lang = '';

  const flushProse = () => {
    if (prose.length > 0) out.push({ kind: 'prose', text: prose.join('\n') });
    prose = [];
  };

  for (const line of text.split('\n')) {
    const fence = FENCE.exec(line.trim());
    if (fence) {
      if (code === null) {
        flushProse();
        code = [];
        lang = fence[1];
      } else {
        out.push({ kind: 'code', lang, lines: code });
        code = null;
        lang = '';
      }
      continue;
    }
    if (code === null) prose.push(line);
    else code.push(line);
  }

  if (code !== null) out.push({ kind: 'code', lang, lines: code });
  flushProse();
  return out;
}

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'break', 'continue', 'new', 'class', 'extends', 'import', 'export', 'from',
  'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof',
  'instanceof', 'interface', 'type', 'enum', 'implements', 'public', 'private',
  'readonly', 'true', 'false', 'null', 'undefined', 'this', 'echo', 'fi', 'then',
  'do', 'done', 'case', 'esac', 'exit', 'local',
]);

const WORD = /[A-Za-z_$][\w$]*/y;
const NUMBER = /\d[\w.]*/y;

/**
 * One line to coloured runs. Scans rather than splits, so a `#` inside a string
 * and a quote inside a comment are both left alone — the two mistakes a
 * regex-replace highlighter always makes.
 */
export function codeTokens(line: string): CodeToken[] {
  const out: CodeToken[] = [];
  let plain = '';
  const flush = () => {
    if (plain) out.push({ kind: 'plain', text: plain });
    plain = '';
  };

  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);

    if (rest.startsWith('//') || line[i] === '#') {
      flush();
      out.push({ kind: 'comment', text: rest });
      return out;
    }

    const quote = line[i];
    if (quote === '"' || quote === "'" || quote === '`') {
      let j = i + 1;
      while (j < line.length && line[j] !== quote) j += line[j] === '\\' ? 2 : 1;
      flush();
      out.push({ kind: 'string', text: line.slice(i, Math.min(j + 1, line.length)) });
      i = j + 1;
      continue;
    }

    WORD.lastIndex = i;
    const word = WORD.exec(line);
    if (word) {
      flush();
      out.push({ kind: KEYWORDS.has(word[0]) ? 'keyword' : 'plain', text: word[0] });
      i = WORD.lastIndex;
      continue;
    }

    NUMBER.lastIndex = i;
    const num = NUMBER.exec(line);
    if (num) {
      flush();
      out.push({ kind: 'number', text: num[0] });
      i = NUMBER.lastIndex;
      continue;
    }

    plain += line[i];
    i += 1;
  }
  flush();
  return out;
}

const EXT_LANG: Record<string, string> = {
  ts: 'ts', tsx: 'ts', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  json: 'json', sh: 'sh', bash: 'sh', zsh: 'sh', css: 'css', html: 'html',
  py: 'py', yml: 'yaml', yaml: 'yaml',
};

/**
 * The language of a TOOL row's body, from the one line the row leads with.
 *
 * A fence is how a person marks code inside prose; a tool row has no prose to
 * mark it off from — the whole body is a command or a file, and it arrives with
 * no fence at all. `Bash(...)` is always shell. A file-taking tool is whatever
 * its extension says, which is also how `.md` stays prose: a README rendered as
 * code would be worse than a README rendered plainly.
 *
 * Undefined means "not known to be code", and the body stays prose.
 */
export function toolCodeLang(header: string): string | undefined {
  const tool = /^([A-Z][A-Za-z]*)\(/.exec(header.trim());
  if (!tool) return undefined;
  if (tool[1] === 'Bash') return 'sh';
  if (!['Read', 'Edit', 'Write', 'NotebookEdit'].includes(tool[1])) return undefined;
  const ext = /\.([A-Za-z0-9]+)\b/g;
  let last: RegExpExecArray | null;
  let found: string | undefined;
  while ((last = ext.exec(header)) !== null) found = EXT_LANG[last[1].toLowerCase()] ?? found;
  return found;
}
