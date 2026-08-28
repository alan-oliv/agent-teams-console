// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TranscriptLine } from '../../shared/domain';
import { TranscriptFeed } from './TranscriptFeed';

afterEach(cleanup);

const LINES: TranscriptLine[] = [
  { id: 'alpha-0', marker: '❯', text: 'Spike probe alpha', ts: 1787843382976 },
  { id: 'alpha-1', marker: '⏺', text: 'Bash(sleep 10)', ts: 1787843383000 },
  { id: 'alpha-2', marker: '⏺', text: 'TaskUpdate(1) owner=probe-alpha status=in_progress', ts: 1787843399360 },
];

describe('TranscriptFeed', () => {
  it('is a bottom-anchored one-pixel-gap column that scrolls on its own', () => {
    render(<TranscriptFeed lines={LINES} size="wall" />);
    const feed = screen.getByTestId('transcript-feed');
    expect(feed.style.display).toBe('flex');
    expect(feed.style.flexDirection).toBe('column');
    // Anchoring is `margin-top: auto` on the first row, carried by .tscroll.
    // `justify-content: flex-end` looks the same and overflows past the top
    // edge, where no scrollbar can reach it.
    expect(feed.style.justifyContent).toBe('');
    expect(feed.style.overflow).toBe('');
    expect(feed.className).toBe('tscroll');
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
    { id: 'two', marker: '⏺', text: '## Result\n| what | n |\n| tests | 607 |', ts: 2 },
  ];
  const rows = () => screen.getAllByTestId('transcript-row');

  it('marks only the multi-line row as expandable', () => {
    render(<TranscriptFeed lines={MULTI} size="wall" />);
    expect(rows()[0].getAttribute('aria-expanded')).toBeNull();
    expect(rows()[1].getAttribute('aria-expanded')).toBe('false');
  });

  it('collapsed, a multi-line row is still one ellipsised line', () => {
    render(<TranscriptFeed lines={MULTI} size="wall" />);
    expect(rows()[1].style.whiteSpace).toBe('nowrap');
  });

  it('expands on click, showing the structure the author wrote', () => {
    render(<TranscriptFeed lines={MULTI} size="wall" />);
    fireEvent.click(rows()[1]);
    expect(rows()[1].getAttribute('aria-expanded')).toBe('true');
    expect(rows()[1].style.whiteSpace).toBe('pre-wrap');
    expect(within(rows()[1]).getByTestId('transcript-text').textContent).toBe(MULTI[1].text);
  });

  it('collapses again on a second click', () => {
    render(<TranscriptFeed lines={MULTI} size="wall" />);
    fireEvent.click(rows()[1]);
    fireEvent.click(rows()[1]);
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
