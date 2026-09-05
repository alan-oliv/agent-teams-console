// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Diff, Subagent, TranscriptLine } from '../../shared/domain';
import { TRANSCRIPT_TEXT_CAP } from '../../shared/transcript';
import { DiffContext } from '../state/useTeamState';
import { DEFAULT_SETTINGS, SettingsContext } from '../state/useSettings';
import { buildCast } from '../../shared/cast';
import { CastContext } from '../state/useCast';
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

  // The setting used to stop at the wall and the rail, so choosing compact left
  // the overview and grid feeds untouched — a control that visibly does nothing
  // in two of the four views that draw a transcript.
  describe('line density reaches every feed', () => {
    const atDensity = (density: 'compact' | 'roomy', size: 'wall' | 'overview' | 'grid') =>
      render(
        <SettingsContext.Provider value={{ ...DEFAULT_SETTINGS, density }}>
          <TranscriptFeed lines={LINES} size={size} />
        </SettingsContext.Provider>,
      );

    it('drives the wall and rail from the setting directly', () => {
      atDensity('compact', 'wall');
      expect(screen.getByTestId('transcript-feed').style.gap).toBe('5px');
      cleanup();
      atDensity('roomy', 'wall');
      expect(screen.getByTestId('transcript-feed').style.gap).toBe('16px');
    });

    // A condensed pane runs 3px tighter than a full one at the same setting,
    // floored at 3px so compact cannot close the rows up entirely.
    it('gives the condensed feeds the tighter step of the same setting', () => {
      atDensity('roomy', 'overview');
      expect(screen.getByTestId('transcript-feed').style.gap).toBe('13px');
      cleanup();
      atDensity('compact', 'grid');
      expect(screen.getByTestId('transcript-feed').style.gap).toBe('3px');
    });

    // `default` still means each view keeps its own tuning rather than
    // collapsing to one number.
    it('leaves every feed on its own tuning at the default', () => {
      render(
        <SettingsContext.Provider value={DEFAULT_SETTINGS}>
          <TranscriptFeed lines={LINES} size="overview" />
        </SettingsContext.Provider>,
      );
      expect(screen.getByTestId('transcript-feed').style.gap).toBe('8px');
    });
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

  // A long one-liner has no newline to split a header from, so it needs its
  // own length-based trigger — and its drawer must show the text once, not
  // duplicate it into a "body" that is just the same line again.
  describe('a long single-line row, with no newline at all', () => {
    const long = 'x'.repeat(140);
    const LONG: TranscriptLine[] = [{ id: 'long', marker: '⏺', text: long, ts: 3 }];

    it('is expandable past the length threshold', () => {
      render(<TranscriptFeed lines={LONG} size="wall" />);
      expect(rows()[0].getAttribute('aria-expanded')).toBe('false');
    });

    it('opens to the full text with no separate drawer body', () => {
      render(<TranscriptFeed lines={LONG} size="wall" />);
      open();
      const drawer = rows()[0];
      expect(within(drawer).getByTestId('transcript-text').textContent).toBe(long);
      expect(within(drawer).queryByTestId('transcript-drawer-body')).toBeNull();
    });

    it('counts it as "1 line", not "1 lines"', () => {
      render(<TranscriptFeed lines={LONG} size="wall" />);
      open();
      expect(screen.getByTestId('transcript-drawer-count').textContent).toBe('1 line');
    });
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

  it('follows a burst taller than 64px when the operator was already at the bottom', () => {
    const { rerender } = render(<TranscriptFeed lines={LINES} size="wall" />);
    const feed = screen.getByTestId('transcript-feed');

    // Bottomed out BEFORE the burst lands — this is what the follow decision
    // must be based on.
    feed.scrollTop = 600; // 900 - 300 - 600 = 0px of slack
    fireEvent.scroll(feed);

    // The burst itself adds more than 64px in one commit. Measuring slack from
    // post-append geometry (the bug) sees >64px of "slack" here and gives up on
    // following, even though the operator never moved.
    box.scrollHeight = 990;
    rerender(<TranscriptFeed lines={more} size="wall" />);
    expect(feed.scrollTop).toBe(990);
  });

  it('leaves the position alone once the operator has scrolled up to read', () => {
    const { rerender } = render(<TranscriptFeed lines={LINES} size="wall" />);
    const feed = screen.getByTestId('transcript-feed');

    feed.scrollTop = 120; // 480px of slack — reading history
    fireEvent.scroll(feed);
    box.scrollHeight = 1000;
    rerender(<TranscriptFeed lines={more} size="wall" />);
    expect(feed.scrollTop).toBe(120);
  });

  it('re-pins once the operator scrolls back within 64px, so the next append follows', () => {
    const { rerender } = render(<TranscriptFeed lines={LINES} size="wall" />);
    const feed = screen.getByTestId('transcript-feed');

    feed.scrollTop = 120; // scrolled up to read — unpinned
    fireEvent.scroll(feed);

    feed.scrollTop = 560; // scrolled back down — 40px of slack, within 64px
    fireEvent.scroll(feed);

    box.scrollHeight = 1000;
    rerender(<TranscriptFeed lines={more} size="wall" />);
    expect(feed.scrollTop).toBe(1000);
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
    // All four value roles resolve through the JSON palette. --warn and --fail
    // are semantic tokens, and a number is not a warning nor null a failure, so
    // a theme has to be able to retune one without moving the other.
    expect(colorOf('number')).toBe('var(--json-number)');
    expect(colorOf('boolean')).toBe('var(--json-boolean)');
    expect(colorOf('null')).toBe('var(--json-null)');
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
    const lang = within(block).getByTestId('code-lang');
    expect(lang.textContent).toBe('js');
    // No 9.5px text at neutral-700 (2.69-2.80:1): that register is
    // neutral-600 at 10px everywhere in the console.
    expect(lang.style.fontSize).toBe('10px');
    expect(lang.style.color).toBe('var(--color-neutral-600)');
    expect(block.textContent).toContain('const a = 1;');
    // Markdown is rendered, not shown as source.
    expect(screen.getByTestId('transcript-drawer-body').textContent).not.toContain('**');
    // The fence markers are structure, not content.
    expect(screen.getByTestId('transcript-drawer-body').textContent).not.toContain('```');
    // And the prose around it survives.
    expect(screen.getByTestId('transcript-drawer-body').textContent).toContain('that is all');
  });
});

describe('a row carrying a diff payload', () => {
  const DIFF: Diff = {
    path: 'src/web/state/useTeamState.ts',
    added: 14,
    removed: 2,
    agent: 'lead',
    ts: 1787843425000,
    commit: '9be5ee0',
    hunks: [],
  };
  const DIFF_LINES: TranscriptLine[] = [
    { id: 'plain', marker: '⏺', text: 'Bash(sleep 20)', ts: 1 },
    { id: 'edit', marker: '⎿', text: 'Update(src/web/state/useTeamState.ts)', ts: 2, diff: DIFF },
  ];
  const rows = () => screen.getAllByTestId('transcript-row');

  it('leaves a row without a payload untouched', () => {
    render(<TranscriptFeed lines={DIFF_LINES} size="wall" />);
    expect(rows()[0].style.cursor).toBe('');
    expect(screen.queryAllByTestId('diff-chip')).toHaveLength(1);
  });

  it('shows the stat chip pinned to the right edge', () => {
    render(<TranscriptFeed lines={DIFF_LINES} size="wall" />);
    const chip = screen.getByTestId('diff-chip');
    expect(chip.textContent).toBe('+14 −2 ▸');
    expect(chip.style.color).toBe('var(--color-accent-300)');
    expect(chip.style.border).toBe('1px solid var(--color-accent-700)');
    expect(chip.style.borderRadius).toBe('8px');
    expect(chip.style.fontSize).toBe('10px');
    expect(chip.style.flex).toBe('0 0 auto');
  });

  it('makes the whole row clickable', () => {
    render(<TranscriptFeed lines={DIFF_LINES} size="wall" />);
    const row = rows()[1];
    expect(row.style.cursor).toBe('pointer');
    expect(row.style.margin).toBe('0px -6px');
    expect(row.style.padding).toBe('2px 6px');
    expect(row.style.borderRadius).toBe('var(--radius-sm)');
  });

  it('sets the open diff in the shared store on click, not local state', () => {
    const onOpen = vi.fn();
    render(
      <DiffContext.Provider value={onOpen}>
        <TranscriptFeed lines={DIFF_LINES} size="wall" />
      </DiffContext.Provider>,
    );
    fireEvent.click(rows()[1]);
    expect(onOpen).toHaveBeenCalledWith(DIFF);
  });

  it('does nothing on click when no diff store is provided', () => {
    render(<TranscriptFeed lines={DIFF_LINES} size="wall" />);
    expect(() => fireEvent.click(rows()[1])).not.toThrow();
  });
});

// "Received messages carry attribution" (design CHANGELOG): the envelope's
// teammate_id on an accent-900 pill before the body, ✉ in the glyph column.
// Stripping the envelope was right; dropping the attribution with it was not.
describe('sender chip', () => {
  const DELIVERED: TranscriptLine[] = [
    { id: 'lead-0', marker: '❯', text: 'Another Claude session sent a message:', ts: 1787843537951 },
    {
      id: 'lead-1',
      marker: '✉',
      text: 'probe-charlie reporting: running on a different model.',
      ts: 1787843537951,
      sender: 'probe-charlie',
    },
    {
      id: 'lead-2',
      marker: '✉',
      text: 'probe-alpha reporting: I claimed task 1.',
      ts: 1787843537951,
      sender: 'probe-alpha',
    },
  ];

  // The pill is an agent name, so a theme casts it. The row text itself is the
  // agent's own words and is never rewritten.
  it('casts the sender pill under a theme, and leaves the row text alone', () => {
    const roster = [
      { name: 'team-lead', agentType: 'team-lead', isLead: true },
      { name: 'probe-charlie', agentType: 'general-purpose', isLead: false },
      { name: 'probe-alpha', agentType: 'general-purpose', isLead: false },
    ];
    render(
      <CastContext.Provider value={buildCast(roster, 'inception')}>
        <TranscriptFeed lines={DELIVERED} size="wall" />
      </CastContext.Provider>,
    );
    expect(screen.getAllByTestId('transcript-sender').map((c) => c.textContent)).toEqual([
      'Saito',
      'Mal',
    ]);
    expect(screen.getAllByTestId('transcript-row')[1].textContent).toContain(
      'probe-charlie reporting',
    );
  });

  it('names the sender of every delivered row, and only those', () => {
    render(<TranscriptFeed lines={DELIVERED} size="wall" />);
    const chips = screen.getAllByTestId('transcript-sender');
    expect(chips.map((c) => c.textContent)).toEqual(['probe-charlie', 'probe-alpha']);
  });

  it('draws the ✉ marker in the glyph column beside the chip', () => {
    render(<TranscriptFeed lines={DELIVERED} size="wall" />);
    const rows = screen.getAllByTestId('transcript-row');
    expect(within(rows[1]).getByTestId('transcript-marker').textContent).toBe('✉');
    expect(within(rows[0]).queryByTestId('transcript-sender')).toBeNull();
  });

  it('puts the chip before the body, not after it', () => {
    render(<TranscriptFeed lines={DELIVERED} size="wall" />);
    const row = screen.getAllByTestId('transcript-row')[1];
    const chip = within(row).getByTestId('transcript-sender');
    const text = within(row).getByTestId('transcript-text');
    expect(chip.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // The row is `white-space: nowrap` with the body ellipsised, and the ladder
  // can put it at 0.38. A filled pill still reads at that strength where a
  // hairline border would dissolve, and `flex: none` keeps the name whole while
  // the body is what gives way.
  it('survives the nowrap row and the opacity ladder', () => {
    render(<TranscriptFeed lines={DELIVERED} size="wall" />);
    const chip = screen.getAllByTestId('transcript-sender')[0];
    expect(chip.style.background).toBe('var(--color-accent-900)');
    expect(chip.style.color).toBe('var(--color-accent-300)');
    expect(chip.style.flex).toBe('0 0 auto');
    expect(chip.style.whiteSpace).toBe('nowrap');
  });

  it('keeps the chip when the row is expanded to read', () => {
    const long: TranscriptLine[] = [
      { ...DELIVERED[1], text: 'probe-charlie reporting:\nthe long body it sent', },
    ];
    render(<TranscriptFeed lines={long} size="wall" />);
    fireEvent.click(screen.getByTestId('transcript-row'));
    expect(screen.getByTestId('transcript-sender').textContent).toBe('probe-charlie');
  });
});

describe('Task rows and fan-out', () => {
  const T = 1787843382976;

  function subagent(over: Partial<Subagent> = {}): Subagent {
    return {
      toolUseId: 'toolu_1',
      name: 'scout',
      agent: 'probe-alpha',
      parent: 'probe-alpha',
      depth: 1,
      spawnIndex: 0,
      siblingGroup: 'rec-1',
      state: 'returned',
      queuedAt: T,
      children: [],
      ...over,
    };
  }

  it('collapses a single Task call to one line: text, type badge, tokens · duration, caret', () => {
    const lines: TranscriptLine[] = [{ id: 'rec-1#0', marker: '⏺', text: 'Task(scout)', ts: T }];
    render(
      <TranscriptFeed
        lines={lines}
        size="wall"
        subagents={[subagent({ agentType: 'general-purpose', tokens: 4200, durationMs: 65_000 })]}
      />,
    );
    const row = screen.getByTestId('transcript-row');
    expect(within(row).getByTestId('transcript-text').textContent).toBe('Task(scout)');
    expect(within(row).getByTestId('subagent-type').textContent).toBe('general-purpose');
    expect(within(row).getByTestId('subagent-summary').textContent).toBe('4.2k · 1m 05s');
    expect(within(row).getByTestId('transcript-more').textContent).toBe('▸');
  });

  // Absent means not-landed-yet — a queued call has genuinely nothing to show,
  // and a zero would claim it spent no tokens rather than saying it hasn't run.
  it('shows em-dashes for a queued call with nothing measured yet', () => {
    const lines: TranscriptLine[] = [{ id: 'rec-1#0', marker: '⏺', text: 'Task(scout)', ts: T }];
    render(
      <TranscriptFeed lines={lines} size="wall" subagents={[subagent({ state: 'queued' })]} />,
    );
    expect(screen.getByTestId('subagent-summary').textContent).toBe('— · —');
  });

  it('expands into the same drawer container the other expandable rows use', () => {
    const lines: TranscriptLine[] = [{ id: 'rec-1#0', marker: '⏺', text: 'Task(scout)', ts: T }];
    render(<TranscriptFeed lines={lines} size="wall" subagents={[subagent()]} />);
    fireEvent.click(screen.getByTestId('transcript-row'));
    const drawer = screen.getByTestId('transcript-row');
    expect(drawer.getAttribute('aria-expanded')).toBe('true');
    expect(drawer.style.background).toBe('var(--color-bg)');
    expect(drawer.style.border).toBe('1px solid var(--color-neutral-900)');
    expect(drawer.style.borderRadius).toBe('var(--radius-md)');
    expect(drawer.style.boxShadow).toBe('var(--shadow-sm)');
  });

  it('orders the open drawer: header, the result at full opacity, then the footer', () => {
    const lines: TranscriptLine[] = [{ id: 'rec-1#0', marker: '⏺', text: 'Task(scout)', ts: T }];
    render(
      <TranscriptFeed
        lines={lines}
        size="wall"
        subagents={[subagent({ model: 'claude-sonnet-5', returnedSummary: 'found the bug' })]}
      />,
    );
    fireEvent.click(screen.getByTestId('transcript-row'));
    const drawer = screen.getByTestId('transcript-row');
    const testids = [...drawer.querySelectorAll('[data-testid]')].map((el) =>
      el.getAttribute('data-testid'),
    );
    const order = ['subagent-header', 'subagent-result', 'subagent-footer'].map((id) =>
      testids.indexOf(id),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i !== -1)).toBe(true);
    expect(screen.getByTestId('subagent-result').textContent).toContain('found the bug');
    expect(screen.getByTestId('subagent-result').style.opacity).toBe('');
    expect(screen.getByTestId('subagent-footer').textContent).toContain(
      'no reply channel — a subagent returns once and is gone',
    );
  });

  it('dims nested children to 0.62 opacity behind a left rule, badged with type · depth N', () => {
    const lines: TranscriptLine[] = [{ id: 'rec-1#0', marker: '⏺', text: 'Task(scout)', ts: T }];
    render(
      <TranscriptFeed
        lines={lines}
        size="wall"
        subagents={[
          subagent({
            children: [
              subagent({
                toolUseId: 'toolu_2',
                name: 'grepper',
                agentType: 'Explore',
                depth: 2,
                parent: 'toolu_1',
              }),
            ],
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId('transcript-row'));
    const children = screen.getByTestId('subagent-children');
    expect(children.style.opacity).toBe('0.62');
    expect(children.style.borderLeft).toBe('1px solid var(--color-neutral-900)');
    expect(within(children).getByTestId('subagent-depth').textContent).toBe('Explore · depth 2');
  });

  it('truncates a long chain of nested calls rather than growing the drawer without bound', () => {
    const lines: TranscriptLine[] = [{ id: 'rec-1#0', marker: '⏺', text: 'Task(scout)', ts: T }];
    const children = Array.from({ length: 9 }, (_, i) =>
      subagent({ toolUseId: `toolu_child_${i}`, name: `child-${i}`, depth: 2, parent: 'toolu_1' }),
    );
    render(
      <TranscriptFeed lines={lines} size="wall" subagents={[subagent({ children })]} />,
    );
    fireEvent.click(screen.getByTestId('transcript-row'));
    expect(screen.getByTestId('subagent-truncated').textContent).toBe('⋯ 3 more calls');
  });

  it('draws a fan-out as one dispatched-in-parallel line with a chip strip, never as columns', () => {
    const lines: TranscriptLine[] = [
      { id: 'rec-2#0', marker: '⏺', text: 'Task(scout)', ts: T },
      { id: 'rec-2#1', marker: '⏺', text: 'Task(auditor)', ts: T },
    ];
    render(
      <TranscriptFeed
        lines={lines}
        size="wall"
        subagents={[
          subagent({ toolUseId: 't1', siblingGroup: 'rec-2', name: 'scout', state: 'returned' }),
          subagent({ toolUseId: 't2', siblingGroup: 'rec-2', name: 'auditor', state: 'running' }),
        ]}
      />,
    );
    // Both lines collapse into the one compound row — never two, never columns.
    expect(screen.queryAllByTestId('transcript-row')).toHaveLength(0);
    expect(screen.getByTestId('fanout-header').textContent).toBe('Task ×2 dispatched in parallel');
    const chips = screen.getAllByTestId('fanout-chip');
    expect(chips).toHaveLength(2);
    expect(screen.getByTestId('fanout-pending').textContent).toContain('1 of 2 still running');
  });
});

// Canvas 8b reads `Task(explore-auth)`. The dispatch line's own text comes from
// the tool's first argument — for a Task or Agent call, the whole prompt — so
// labelling from it put a paragraph across the row.
it('labels a dispatch row with the subagent name, not the prompt it was given', () => {
  const prompt =
    'You are auditing GIT HYGIENE for a set of local git repos. STRICTLY READ-ONLY.';
  render(
    <TranscriptFeed
      lines={[
        { id: 'rec-1#0', marker: '\u23fa', text: `Agent(${prompt})`, ts: 1787843382976 },
      ]}
      size="wall"
      subagents={[
        {
          toolUseId: 'toolu_1',
          name: 'Git hygiene: hatch core repos',
          agent: 'lead',
          parent: 'lead',
          depth: 1,
          spawnIndex: 0,
          siblingGroup: 'rec-1',
          state: 'running',
          queuedAt: 1787843382976,
          children: [],
        },
      ]}
    />,
  );
  const row = screen.getByTestId('transcript-text');
  expect(row.textContent).toBe('Task(Git hygiene: hatch core repos)');
  expect(row.textContent).not.toContain('STRICTLY READ-ONLY');
});

// The solo/subagents stream takes the whole frame, so it is drawn from the
// canvas's own `saIsStream` metrics rather than the wall column's, which are
// measured against a 366px pane.
describe('the stream size', () => {
  const LONG = 'x'.repeat(400);
  const SUB_LINE: TranscriptLine = {
    id: 'rec-9#0', marker: '⏺', text: 'Task(explore-auth)', ts: 1787843382976,
  };
  const SUB: Subagent = {
    toolUseId: 'toolu_9',
    name: 'explore-auth',
    agent: 'probe-alpha',
    parent: 'probe-alpha',
    depth: 1,
    spawnIndex: 0,
    siblingGroup: 'rec-9',
    state: 'returned',
    queuedAt: 1787843382976,
    agentType: 'Explore',
    returnedSummary: '34 sites, 4 of them read expires_at directly',
    tokens: 24100,
    durationMs: 96000,
    children: [],
  };

  it('takes the canvas stream metrics, not the wall column ones', () => {
    const { rerender } = render(<TranscriptFeed lines={LINES} size="stream" />);
    const feed = screen.getByTestId('transcript-feed');
    expect(feed.style.gap).toBe('9px');
    expect(feed.style.padding).toBe('15px 16px 10px');

    rerender(<TranscriptFeed lines={LINES} size="wall" />);
    expect(screen.getByTestId('transcript-feed').style.padding).toBe('13px 12px');
  });

  it('wraps a long line instead of clipping it to one', () => {
    render(<TranscriptFeed lines={[{ ...LINES[1], text: LONG }]} size="stream" />);
    const row = screen.getByTestId('transcript-row');
    expect(row.style.whiteSpace).toBe('');
    const text = screen.getByTestId('transcript-text');
    expect(text.style.textOverflow).toBe('');
    expect(text.style.lineHeight).toBe('1.6');
    // The whole line, not the first 120 characters of it.
    expect(text.textContent).toBe(LONG);
  });

  // Length alone earns a caret only where the row would be clipped. Opening a
  // drawer onto text already fully on screen is a control that changes nothing.
  it('does not make a long line expandable on its length alone', () => {
    const { rerender } = render(<TranscriptFeed lines={[{ ...LINES[1], text: LONG }]} size="stream" />);
    expect(screen.queryByTestId('transcript-more')).toBeNull();

    rerender(<TranscriptFeed lines={[{ ...LINES[1], text: LONG }]} size="wall" />);
    expect(screen.getByTestId('transcript-more')).toBeTruthy();
  });

  // A row with real hidden content still opens — the author's own line breaks.
  // Bare, per the `5b` rule: the chip belongs to the Task row, which is what
  // the canvas's `subShow` gates it on.
  it('still carries a caret on a row with more behind it, drawn bare', () => {
    render(<TranscriptFeed lines={[{ ...LINES[1], text: 'first\nsecond' }]} size="stream" />);
    const caret = screen.getByTestId('transcript-more');
    expect(caret.style.border).toBe('');
  });

  it('draws the Task row caret as a chip', () => {
    render(<TranscriptFeed lines={[SUB_LINE]} size="stream" subagents={[SUB]} />);
    const caret = screen.getByTestId('transcript-more');
    expect(caret.style.border).toBe('1px solid var(--color-neutral-800)');
    expect(caret.style.padding).toBe('0px 6px');
    expect(caret.className).toBe('stream-more');
  });

  // Canvas `8a`: `Task(Explore, grep-callsites)` — type inside the parens, no
  // badge after it. The badge is the wall column's treatment, where the label
  // has to stay short.
  it('names a Task row by type and name, with no badge beside it', () => {
    render(<TranscriptFeed lines={[SUB_LINE]} size="stream" subagents={[SUB]} />);
    expect(screen.getByTestId('transcript-text').textContent).toBe('Task(Explore, explore-auth)');
    expect(screen.queryByTestId('subagent-type')).toBeNull();
  });

  it('keeps the badge and the short label in a wall column', () => {
    render(<TranscriptFeed lines={[SUB_LINE]} size="wall" subagents={[SUB]} />);
    expect(screen.getByTestId('transcript-text').textContent).toBe('Task(explore-auth)');
    expect(screen.getByTestId('subagent-type').textContent).toBe('Explore');
  });

  // The stream reports what the PARENT got out of the call; the wall column
  // reports what the call cost. Same data, the question each view is asking.
  it('reads a returned call in words, tokens and fan-out', () => {
    render(<TranscriptFeed lines={[SUB_LINE]} size="stream" subagents={[SUB]} />);
    expect(screen.getByTestId('subagent-summary').textContent).toBe(
      'returned 8 words · 24.1k used',
    );
  });

  it('counts a call that fanned out again', () => {
    const parent: Subagent = {
      ...SUB,
      children: [{ ...SUB, toolUseId: 'k1' }, { ...SUB, toolUseId: 'k2' }],
    };
    render(<TranscriptFeed lines={[SUB_LINE]} size="stream" subagents={[parent]} />);
    expect(screen.getByTestId('subagent-summary').textContent).toBe(
      'returned 8 words · 24.1k used · spawned 2',
    );
  });

  it('reads a call still going as what it has spent so far', () => {
    const running: Subagent = { ...SUB, state: 'running', tokens: 6200, returnedSummary: undefined };
    render(<TranscriptFeed lines={[SUB_LINE]} size="stream" subagents={[running]} />);
    expect(screen.getByTestId('subagent-summary').textContent).toBe('running · 6.2k so far');
  });

  it('keeps cost-and-duration on the wall column row', () => {
    render(<TranscriptFeed lines={[SUB_LINE]} size="wall" subagents={[SUB]} />);
    expect(screen.getByTestId('subagent-summary').textContent).toBe('24.1k · 1m 36s');
  });

  it('leaves the Task row caret bare in a wall column, where the border costs label width', () => {
    render(<TranscriptFeed lines={[SUB_LINE]} size="wall" subagents={[SUB]} />);
    const caret = screen.getByTestId('transcript-more');
    expect(caret.style.border).toBe('');
    expect(caret.className).toBe('');
  });

  // The canvas draws the prompt row on a bar reading `working · 4m 08s`, so it
  // is the terminal's own cursor rather than a readout of whether a turn runs.
  it('closes the stream with a prompt cursor at any status', () => {
    const { rerender } = render(<TranscriptFeed lines={LINES} size="stream" working={false} />);
    expect(screen.getByTestId('stream-prompt').textContent).toBe('❯');

    rerender(<TranscriptFeed lines={LINES} size="stream" working />);
    expect(screen.getByTestId('stream-prompt').textContent).toBe('❯');
  });

  it('leaves the wall column without a prompt cursor at any status', () => {
    render(<TranscriptFeed lines={LINES} size="wall" working={false} />);
    expect(screen.queryByTestId('stream-prompt')).toBeNull();
  });
});
