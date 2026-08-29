/**
 * The markdown an expanded row actually contains.
 *
 * `tidy()` keeps a message's newlines precisely so a drawer can show "the shape
 * the author wrote" — headings, tables, fenced code, in 42% of a lead's
 * messages. Fences are handled in code.ts; this is the rest of that shape.
 *
 * A deliberate subset, not a markdown implementation. Rendering the constructs
 * that appear and leaving the rest as literal text is better than half-parsing
 * everything: an unrendered `~~strike~~` still reads, a mangled one does not.
 * Tables stay verbatim — the console is monospace, so a pipe table already
 * aligns, and a real table would fight the drawer's width for nothing.
 */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string };

export type Block =
  | { kind: 'heading'; level: number; spans: Inline[] }
  | { kind: 'para'; spans: Inline[] }
  | { kind: 'item'; spans: Inline[]; ordered: boolean }
  | { kind: 'table'; lines: string[] };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
// `**bold**` and `` `code` ``, in one pass so neither can split the other.
const INLINE = /(\*\*)(?=\S)([\s\S]*?\S)\1|`([^`]+)`/g;

export function inlines(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  INLINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ kind: 'strong', text: m[2] });
    else out.push({ kind: 'code', text: m[3] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out.length > 0 ? out : [{ kind: 'text', text }];
}

/**
 * Consecutive prose lines join into one paragraph, the way markdown reads them
 * — a hard-wrapped sentence is one sentence, not one line per screen row.
 * Headings, list items and table rows each stand alone.
 */
export function blocks(text: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let table: string[] = [];

  const flushPara = () => {
    if (para.length > 0) out.push({ kind: 'para', spans: inlines(para.join(' ')) });
    para = [];
  };
  const flushTable = () => {
    if (table.length > 0) out.push({ kind: 'table', lines: table });
    table = [];
  };
  const flush = () => {
    flushPara();
    flushTable();
  };

  for (const line of text.split('\n')) {
    if (line.trim().startsWith('|')) {
      flushPara();
      table.push(line);
      continue;
    }
    flushTable();

    if (line.trim() === '') {
      flushPara();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushPara();
      out.push({ kind: 'heading', level: heading[1].length, spans: inlines(heading[2]) });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushPara();
      out.push({ kind: 'item', spans: inlines(bullet[1]), ordered: false });
      continue;
    }
    const ordered = ORDERED.exec(line);
    if (ordered) {
      flushPara();
      out.push({ kind: 'item', spans: inlines(ordered[1]), ordered: true });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}
