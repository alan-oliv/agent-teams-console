// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TranscriptLine } from '../../shared/domain';
import { TRANSCRIPT_TEXT_CAP } from '../../shared/transcript';
import { TranscriptFeed } from './TranscriptFeed';

afterEach(cleanup);

const LINES: TranscriptLine[] = [
  { id: 'alpha-0', marker: '❯', text: 'Spike probe alpha', ts: 1787843382976 },
  { id: 'alpha-1', marker: '⏺', text: 'Bash(sleep 10)', ts: 1787843383000 },
  { id: 'alpha-2', marker: '⏺', text: 'TaskUpdate(1) owner=probe-alpha status=in_progress', ts: 1787843399360 },
];

describe('TranscriptFeed', () => {
  it('is a bottom-anchored column that scrolls on its own', () => {
    render(<TranscriptFeed lines={LINES} size="wall" />);
    const feed = screen.getByTestId('transcript-feed');
    expect(feed.style.display).toBe('flex');
    expect(feed.style.flexDirection).toBe('column');
    // Anchoring is `margin-top: auto` on the first row, carried by .tscroll.tail.
    // `justify-content: flex-end` looks the same and overflows past the top
    // edge, where no scrollbar can reach it.
    expect(feed.style.justifyContent).toBe('');
    expect(feed.style.overflow).toBe('');
    expect(feed.className).toBe('tscroll tail');
  });

  it('gives the lines room to read: 10px apart in a wall column, 11 in the rail', () => {
    const { rerender } = render(<TranscriptFeed lines={LINES} size="wall" />);
    expect(screen.getByTestId('transcript-feed').style.gap).toBe('10px');
    rerender(<TranscriptFeed lines={LINES} size="rail" />);
    expect(screen.getByTestId('transcript-feed').style.gap).toBe('11px');
    rerender(<TranscriptFeed lines={LINES} size="overview" />);
    expect(screen.getByTestId('transcript-feed').style.gap).toBe('8px');
  });

  it('fades each line by its age so the newest reads as current', () => {
    render(<TranscriptFeed lines={LINES} size="wall" />);
    const rows = screen.getAllByTestId('transcript-row');
    expect(rows[2].style.opacity).toBe('1');
    expect(rows[1].style.opacity).toBe('0.72');
    expect(rows[0].style.opacity).toBe('0.5');
  });

  it('drops the whole ladder a step on an agent that is not working', () => {
    render(<TranscriptFeed lines={LINES} size="wall" working={false} />);
    const rows = screen.getAllByTestId('transcript-row');
    expect(rows[2].style.opacity).toBe('0.72');
    expect(Number(rows[1].style.opacity)).toBeCloseTo(0.72 * 0.72, 5);
  });

  it('ellipsises every line: nowrap row, hidden overflow, ellipsis text', () => {
    render(<TranscriptFeed lines={LINES} size="wall" />);
    const rows = screen.getAllByTestId('transcript-row');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.style.whiteSpace).toBe('nowrap');

    const texts = screen.getAllByTestId('transcript-text');
    for (const text of texts) {
      expect(text.style.overflow).toBe('hidden');
      expect(text.style.textOverflow).toBe('ellipsis');
    }
  });

  it('uses the wall marker column of 9px at 11px', () => {
    render(<TranscriptFeed lines={LINES} size="wall" />);
    const markers = screen.getAllByTestId('transcript-marker');
    expect(markers[0].textContent).toBe('❯');
    expect(markers[0].style.width).toBe('9px');
    expect(markers[0].style.fontSize).toBe('11px');
    expect(screen.getAllByTestId('transcript-text')[1].style.fontSize).toBe('11.5px');
  });

  it('uses the overview marker column of 8px at 9.5px with 10px text', () => {
    render(<TranscriptFeed lines={LINES} size="overview" />);
    const marker = screen.getAllByTestId('transcript-marker')[0];
    expect(marker.style.width).toBe('8px');
    expect(marker.style.fontSize).toBe('9.5px');
    expect(screen.getAllByTestId('transcript-text')[0].style.fontSize).toBe('10px');
  });

  it('uses the grid marker column of 8px at 10px with 11px text', () => {
    render(<TranscriptFeed lines={LINES} size="grid" />);
    const marker = screen.getAllByTestId('transcript-marker')[0];
    expect(marker.style.width).toBe('8px');
    expect(marker.style.fontSize).toBe('10px');
    expect(screen.getAllByTestId('transcript-text')[0].style.fontSize).toBe('11px');
  });

  it('uses the rail marker column of 10px at 11px and inherits the text size', () => {
    render(<TranscriptFeed lines={LINES} size="rail" />);
    const marker = screen.getAllByTestId('transcript-marker')[0];
    expect(marker.style.width).toBe('10px');
    expect(marker.style.fontSize).toBe('11px');
    expect(screen.getAllByTestId('transcript-text')[0].style.fontSize).toBe('');
  });
});

describe('expanding a row that has more to show', () => {
  const MULTI: TranscriptLine[] = [
    { id: 'one', marker: '⏺', text: 'single line', ts: 1 },
    { id: 'two', marker: '⏺', text: '## Result\n| what | n |\n| tests | 607 |\n\nall green', ts: 2 },
  ];
  const rows = () => screen.getAllByTestId('transcript-row');
  const open = () => fireEvent.click(screen.getByTestId('transcript-more'));

  it('marks only the multi-line row as expandable', () => {
    render(<TranscriptFeed lines={MULTI} size="wall" />);
    expect(rows()[0].getAttribute('aria-expanded')).toBeNull();
    expect(rows()[1].getAttribute('aria-expanded')).toBe('false');
  });

  it('collapsed, a multi-line row is one ellipsised line ending in a caret', () => {
    render(<TranscriptFeed lines={MULTI} size="wall" />);
    expect(rows()[1].style.whiteSpace).toBe('nowrap');
    expect(within(rows()[1]).getByTestId('transcript-text').textContent).toBe('## Result');
    expect(within(rows()[1]).getByTestId('transcript-more').textContent).toBe('▸');
  });

  it('opens as a drawer on the lighter ground, with its own edge', () => {
    render(<TranscriptFeed lines={MULTI} size="wall" />);
    open();
    const drawer = rows()[1];
    expect(drawer.getAttribute('aria-expanded')).toBe('true');
    expect(drawer.style.background).toBe('var(--color-bg)');
    expect(drawer.style.border).toBe('1px solid var(--color-neutral-900)');
    expect(within(drawer).getByTestId('transcript-more').textContent).toBe('▾');
  });

  it('keeps the header on one line and puts the rest in the body', () => {
    render(<TranscriptFeed lines={MULTI} size="wall" />);
    open();
    const drawer = rows()[1];
    expect(within(drawer).getByTestId('transcript-text').textContent).toBe('## Result');
    const body = within(drawer).getByTestId('transcript-drawer-body');
    // Split on the blank line; the table's own breaks survive inside its block.
    expect([...body.children].map((c) => c.textContent)).toEqual([
      '| what | n |\n| tests | 607 |',
      'all green',
    ]);
  });

  it('exempts the drawer from the age fade — an open row is being read', () => {
    render(<TranscriptFeed lines={MULTI} size="wall" working={false} />);
    open();
    expect(rows()[1].style.opacity).toBe('');
  });

  it('counts the lines it is holding', () => {
    render(<TranscriptFeed lines={MULTI} size="wall" />);
    open();
    expect(screen.getByTestId('transcript-drawer-count').textContent).toBe('5 lines');
  });

  it('copies the whole output, not the one line the row showed', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<TranscriptFeed lines={MULTI} size="wall" />);
    open();
    fireEvent.click(screen.getByTestId('transcript-copy'));
    expect(writeText).toHaveBeenCalledWith(MULTI[1].text);
    vi.unstubAllGlobals();
  });

  it('collapses again from the drawer action', () => {
    render(<TranscriptFeed lines={MULTI} size="wall" />);
    open();
    fireEvent.click(screen.getByTestId('transcript-collapse'));
    expect(rows()[1].getAttribute('aria-expanded')).toBe('false');
    expect(rows()[1].style.whiteSpace).toBe('nowrap');
  });

  it('does not let the click reach the column behind it', () => {
    const onParent = vi.fn();
    render(
      <div onClick={onParent}>
        <TranscriptFeed lines={MULTI} size="wall" />
      </div>,
    );
    fireEvent.click(rows()[1]);
    expect(onParent).not.toHaveBeenCalled();
    // Nor may selecting text inside the open drawer re-target the column.
    fireEvent.click(screen.getByTestId('transcript-drawer-body'));
    expect(onParent).not.toHaveBeenCalled();
  });

  it('leaves a single-line row inert, so the column still takes the click', () => {
    const onParent = vi.fn();
    render(
      <div onClick={onParent}>
        <TranscriptFeed lines={MULTI} size="wall" />
      </div>,
    );
    fireEvent.click(rows()[0]);
    expect(onParent).toHaveBeenCalledTimes(1);
  });
});

// jsdom gives every element zero layout, so the pane's scroll geometry is stubbed
// on the prototype — it has to be in place before the first effect runs.
describe('TranscriptFeed follow-on-append', () => {
  const box = { scrollHeight: 900, clientHeight: 300 };

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      get: () => box.scrollHeight,
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      get: () => box.clientHeight,
      configurable: true,
    });
    box.scrollHeight = 900;
    box.clientHeight = 300;
  });

  // Both live on Element.prototype; the stubs above shadow them, so dropping the
  // own properties uncovers the originals.
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
    Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
  });

  const more: TranscriptLine[] = [
    ...LINES,
    { id: 'alpha-3', marker: '✓', text: 'done', ts: 1787843400000 },
  ];

  it('pins a fresh pane to the bottom', () => {
    render(<TranscriptFeed lines={LINES} size="wall" />);
    expect(screen.getByTestId('transcript-feed').scrollTop).toBe(900);
  });

  it('follows new output when the operator is already within 64px of the bottom', () => {
    const { rerender } = render(<TranscriptFeed lines={LINES} size="wall" />);
    const feed = screen.getByTestId('transcript-feed');

    feed.scrollTop = 670; // 1000 - 300 - 670 = 30px of slack — still reading the tail
    box.scrollHeight = 1000;
    rerender(<TranscriptFeed lines={more} size="wall" />);
    expect(feed.scrollTop).toBe(1000);
  });

  it('leaves the position alone once the operator has scrolled up to read', () => {
    const { rerender } = render(<TranscriptFeed lines={LINES} size="wall" />);
    const feed = screen.getByTestId('transcript-feed');

    feed.scrollTop = 120; // 480px of slack — reading history
    box.scrollHeight = 1000;
    rerender(<TranscriptFeed lines={more} size="wall" />);
    expect(feed.scrollTop).toBe(120);
  });
});

describe('TranscriptFeed scrollback', () => {
  const live: TranscriptLine[] = [
    { id: 'n-8', marker: '⏺', text: 'newest but one', ts: 1787843400000 },
    { id: 'n-9', marker: '✓', text: 'newest', ts: 1787843401000 },
  ];
  const history: TranscriptLine[] = [
    { id: 'h-0', marker: '❯', text: 'session preamble', ts: 1787843000000 },
    { id: 'h-1', marker: '⏺', text: 'older work', ts: 1787843001000 },
    // Overlaps the live tail: the server sends everything it retains, and the
    // newest of those are already on screen.
    { id: 'n-8', marker: '⏺', text: 'newest but one', ts: 1787843400000 },
  ];

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => ({ agent: 'probe-alpha', lines: history }),
        url,
      })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const texts = () =>
    screen.getAllByTestId('transcript-text').map((n) => n.textContent);

  it('shows only the live tail before the operator scrolls up', () => {
    render(<TranscriptFeed lines={live} size="wall" agent="probe-alpha" />);
    expect(texts()).toEqual(['newest but one', 'newest']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('pulls older lines in when the pane is scrolled to the top', async () => {
    render(<TranscriptFeed lines={live} size="wall" agent="probe-alpha" />);
    const feed = screen.getByTestId('transcript-feed');
    feed.scrollTop = 0;
    fireEvent.scroll(feed);
    await waitFor(() => expect(texts().length).toBe(4));
    expect(texts()).toEqual(['session preamble', 'older work', 'newest but one', 'newest']);
    expect(fetch).toHaveBeenCalledWith('/api/history?agent=probe-alpha');
  });

  it('asks for a given agent history only once', async () => {
    render(<TranscriptFeed lines={live} size="wall" agent="probe-alpha" />);
    const feed = screen.getByTestId('transcript-feed');
    feed.scrollTop = 0;
    fireEvent.scroll(feed);
    await waitFor(() => expect(texts().length).toBe(4));
    fireEvent.scroll(feed);
    fireEvent.scroll(feed);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never asks when no agent is given, so digest views stay static', () => {
    render(<TranscriptFeed lines={live} size="overview" />);
    const feed = screen.getByTestId('transcript-feed');
    feed.scrollTop = 0;
    fireEvent.scroll(feed);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('a row carrying a JSON payload opens formatted', () => {
  const PAYLOAD = {
    success: true,
    message: "Message sent to baseline-2's inbox",
    inbox: { unread: 3, size_bytes: 4192 },
    completion: null,
    warnings: [],
  };
  const RAW = JSON.stringify(PAYLOAD);
  const JSON_LINES: TranscriptLine[] = [
    { id: 'prose', marker: '⏺', text: 'Bash(curl -sS http://127.0.0.1:4823/api/teams)', ts: 1 },
    { id: 'payload', marker: '⎿', text: RAW, ts: 2 },
  ];
  const rows = () => screen.getAllByTestId('transcript-row');
  const open = () => fireEvent.click(screen.getByTestId('transcript-more'));

  it('is expandable on its structure alone, with no line break to go on', () => {
    render(<TranscriptFeed lines={JSON_LINES} size="wall" />);
    expect(rows()[0].getAttribute('aria-expanded')).toBeNull();
    expect(rows()[1].getAttribute('aria-expanded')).toBe('false');
    // Collapsed it is the row as it arrived, not a line short of it.
    expect(within(rows()[1]).getByTestId('transcript-text').textContent).toBe(RAW);
    expect(within(rows()[1]).getByTestId('transcript-more').textContent).toBe('▸');
  });

  it('renders the payload pretty-printed on the terminal ground, one row per line', () => {
    render(<TranscriptFeed lines={JSON_LINES} size="wall" />);
    open();
    const body = screen.getByTestId('json-body');
    expect(body.style.background).toBe('var(--term)');
    expect(body.style.border).toBe('1px solid var(--color-neutral-900)');
    expect(screen.getAllByTestId('json-line')).toHaveLength(
      JSON.stringify(PAYLOAD, null, 2).split('\n').length,
    );
    expect(screen.getAllByTestId('json-line')[1].textContent).toContain('"success": true,');
  });

  it('caps the pane at 210px and scrolls it WITHOUT bottom-anchoring', () => {
    render(<TranscriptFeed lines={JSON_LINES} size="wall" />);
    open();
    const body = screen.getByTestId('json-body');
    expect(body.style.maxHeight).toBe('210px');
    // JSON reads top-down. `.tail` would open the payload on its closing brace.
    expect(body.className).toBe('tscroll');
  });

  it('numbers the lines in a right-aligned gutter', () => {
    render(<TranscriptFeed lines={JSON_LINES} size="wall" />);
    open();
    const gutter = screen.getAllByTestId('json-gutter');
    expect(gutter.map((g) => g.textContent).slice(0, 3)).toEqual(['1', '2', '3']);
    expect(gutter[0].style.textAlign).toBe('right');
    expect(gutter[0].style.color).toBe('var(--color-neutral-800)');
  });

  it('colours each token from the JSON palette', () => {
    render(<TranscriptFeed lines={JSON_LINES} size="wall" />);
    open();
    // Filtered rather than selected by attribute value: jsdom's selector engine
    // resolves `[data-json-token="null"]` to <html>.
    const tokens = [...document.querySelectorAll('[data-json-token]')] as HTMLElement[];
    const colorOf = (kind: string) =>
      tokens.find((t) => t.dataset.jsonToken === kind)!.style.color;
    expect(colorOf('key')).toBe('var(--color-accent-400)');
    expect(colorOf('string')).toBe('var(--json-string)');
    expect(colorOf('number')).toBe('var(--warn)');
    expect(colorOf('boolean')).toBe('var(--json-boolean)');
    expect(colorOf('null')).toBe('var(--fail)');
    expect(colorOf('punct')).toBe('var(--color-neutral-600)');
  });

  it('derives the header badge from the payload, never from a stored figure', () => {
    render(<TranscriptFeed lines={JSON_LINES} size="wall" />);
    open();
    const lines = JSON.stringify(PAYLOAD, null, 2).split('\n').length;
    const bytes = new TextEncoder().encode(RAW).length;
    // It sits next to a live line-number gutter, which would contradict it.
    expect(screen.getByTestId('json-meta').textContent).toBe(
      `${Object.keys(PAYLOAD).length} keys · ${lines} lines · ${bytes} B`,
    );
  });

  it('copies the pretty-printed payload, and the wire text once raw is showing', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      render(<TranscriptFeed lines={JSON_LINES} size="wall" />);
      open();
      fireEvent.click(screen.getByTestId('json-copy'));
      expect(writeText).toHaveBeenLastCalledWith(JSON.stringify(PAYLOAD, null, 2));

      fireEvent.click(screen.getByTestId('json-raw-toggle'));
      expect(screen.getByTestId('json-raw').textContent).toBe(RAW);
      expect(screen.queryByTestId('json-body')).toBeNull();
      fireEvent.click(screen.getByTestId('json-copy'));
      expect(writeText).toHaveBeenLastCalledWith(RAW);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to the prose drawer for a payload the text cap truncated', () => {
    const cut: TranscriptLine[] = [
      { id: 'cut', marker: '⎿', text: '{"success":true,"message":"Message sent to b…\nrest', ts: 1 },
    ];
    render(<TranscriptFeed lines={cut} size="wall" />);
    fireEvent.click(screen.getByTestId('transcript-more'));
    expect(screen.queryByTestId('json-body')).toBeNull();
    expect(screen.getByTestId('transcript-drawer-body')).toBeTruthy();
  });
});

// The frame ships every line capped at TRANSCRIPT_TEXT_CAP so a poll stays
// small. That is right for a collapsed one-line row and wrong for a drawer, so
// an opened row fetches its own uncapped body.
describe('an opened row fetches its full text', () => {
  const CUT = `${'x'.repeat(TRANSCRIPT_TEXT_CAP - 1)}…`;
  const cutLines: TranscriptLine[] = [{ id: 'rec#0', marker: '⎿', text: CUT, ts: 1 }];

  function stubLine(body: unknown, status = 200) {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return { ok: status === 200, status, json: async () => body, url };
      }),
    );
    return calls;
  }
  afterEach(() => vi.unstubAllGlobals());

  it('makes a row the cap cut expandable, with or without a line break', () => {
    stubLine({ id: 'rec#0', text: CUT });
    render(<TranscriptFeed lines={cutLines} size="wall" agent="probe-alpha" />);
    // Without this the 21k-char tool-result JSON — the row a drawer exists to
    // open — arrives as one unbroken line and offers no caret at all.
    expect(screen.getByTestId('transcript-row').getAttribute('aria-expanded')).toBe('false');
  });

  it('asks for the uncapped body by the row id, url-encoded', async () => {
    const calls = stubLine({ id: 'rec#0', text: '{"ok":true}' });
    render(<TranscriptFeed lines={cutLines} size="wall" agent="probe-alpha" />);
    fireEvent.click(screen.getByTestId('transcript-more'));
    await waitFor(() => expect(screen.queryByTestId('json-body')).toBeTruthy());
    expect(calls).toEqual(['/api/line?agent=probe-alpha&id=rec%230']);
  });

  it('opens on the capped text at once and swaps when the body lands', async () => {
    let release: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      release = r;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await pending;
        return { ok: true, status: 200, json: async () => ({ id: 'rec#0', text: 'the whole body' }) };
      }),
    );
    render(<TranscriptFeed lines={cutLines} size="wall" agent="probe-alpha" />);
    fireEvent.click(screen.getByTestId('transcript-more'));
    // Opening never waits on the network.
    expect(screen.getByTestId('transcript-row').getAttribute('aria-expanded')).toBe('true');
    release(null);
    await waitFor(() =>
      expect(screen.getByTestId('transcript-text').textContent).toBe('the whole body'),
    );
  });

  it('turns a cut payload into the JSON drawer once its whole text arrives', async () => {
    const payload = { success: true, recipient: 'baseline-2' };
    stubLine({ id: 'rec#0', text: JSON.stringify(payload) });
    render(<TranscriptFeed lines={cutLines} size="wall" agent="probe-alpha" />);
    // Cut, it does not parse, so it opens as prose.
    fireEvent.click(screen.getByTestId('transcript-more'));
    await waitFor(() => expect(screen.queryByTestId('json-body')).toBeTruthy());
    // Re-derived from the string now on screen, which is what the gutter numbers.
    expect(screen.getByTestId('json-meta').textContent).toBe(
      `2 keys · ${JSON.stringify(payload, null, 2).split('\n').length} lines · ${
        new TextEncoder().encode(JSON.stringify(payload)).length
      } B`,
    );
  });

  it('keeps the capped text and says nothing when the record has aged out', async () => {
    const calls = stubLine({ error: 'not found' }, 404);
    render(<TranscriptFeed lines={cutLines} size="wall" agent="probe-alpha" />);
    fireEvent.click(screen.getByTestId('transcript-more'));
    await waitFor(() => expect(calls).toHaveLength(1));
    // A record aging out of the store is ordinary, not a fault to report.
    expect(screen.getByTestId('transcript-text').textContent).toBe(CUT);
    expect(screen.getByTestId('transcript-row').getAttribute('aria-expanded')).toBe('true');
  });

  it('asks once per row however often it is opened and closed', async () => {
    const calls = stubLine({ id: 'rec#0', text: 'the whole body' });
    render(<TranscriptFeed lines={cutLines} size="wall" agent="probe-alpha" />);
    fireEvent.click(screen.getByTestId('transcript-more'));
    await waitFor(() => expect(calls).toHaveLength(1));
    fireEvent.click(screen.getByTestId('transcript-more'));
    fireEvent.click(screen.getByTestId('transcript-more'));
    expect(calls).toHaveLength(1);
  });

  it('never asks when no agent is given, so digest views stay static', () => {
    const calls = stubLine({ id: 'rec#0', text: 'the whole body' });
    render(<TranscriptFeed lines={cutLines} size="overview" />);
    fireEvent.click(screen.getByTestId('transcript-more'));
    expect(calls).toEqual([]);
    expect(screen.getByTestId('transcript-text').textContent).toBe(CUT);
  });
});

describe('markdown in an expanded row', () => {
  const RICH: TranscriptLine[] = [
    {
      id: 'm',
      marker: '\u23fa',
      text: 'summary\n## What changed\nplain **bold** and `code`\n- one bullet',
      ts: 1,
    },
  ];

  it('renders headings, bold, inline code and bullets rather than their source', () => {
    render(<TranscriptFeed lines={RICH} size="wall" />);
    fireEvent.click(screen.getByTestId('transcript-more'));

    expect(screen.getByTestId('md-heading').textContent).toBe('What changed');
    expect(screen.getByTestId('md-code').textContent).toBe('code');
    expect(screen.getByTestId('md-item').textContent).toContain('one bullet');

    const body = screen.getByTestId('transcript-drawer-body').textContent!;
    for (const marker of ['##', '**', '`']) expect(body).not.toContain(marker);
  });
});

describe('code in an expanded row', () => {
  // 42% of a lead's messages carry markdown structure, and tidy() keeps their
  // newlines precisely so a drawer can show it. A fence rendered as prose loses
  // it twice: literal backticks, and code the colour of the sentence around it.
  const FENCED: TranscriptLine[] = [
    {
      id: 'f',
      marker: '\u23fa',
      text: 'see this:\n```js\nconst a = 1; // why\n```\nthat is all',
      ts: 1,
    },
  ];

  it('renders a fenced block as a highlighted block, not as prose', () => {
    render(<TranscriptFeed lines={FENCED} size="wall" />);
    fireEvent.click(screen.getByTestId('transcript-more'));

    const block = screen.getByTestId('code-block');
    expect(within(block).getByTestId('code-lang').textContent).toBe('js');
    expect(block.textContent).toContain('const a = 1;');
    // Markdown is rendered, not shown as source.
    expect(screen.getByTestId('transcript-drawer-body').textContent).not.toContain('**');
    // The fence markers are structure, not content.
    expect(screen.getByTestId('transcript-drawer-body').textContent).not.toContain('```');
    // And the prose around it survives.
    expect(screen.getByTestId('transcript-drawer-body').textContent).toContain('that is all');
  });
});
