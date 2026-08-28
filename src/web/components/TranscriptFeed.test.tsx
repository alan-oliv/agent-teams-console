// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { TranscriptLine } from '../../shared/domain';
import { TranscriptFeed } from './TranscriptFeed';

afterEach(cleanup);

const LINES: TranscriptLine[] = [
  { id: 'alpha-0', marker: '❯', text: 'Spike probe alpha', ts: 1787843382976 },
  { id: 'alpha-1', marker: '⏺', text: 'Bash(sleep 10)', ts: 1787843383000 },
  { id: 'alpha-2', marker: '⏺', text: 'TaskUpdate(1) owner=probe-alpha status=in_progress', ts: 1787843399360 },
];

describe('TranscriptFeed', () => {
  it('is a bottom-anchored one-pixel-gap column', () => {
    render(<TranscriptFeed lines={LINES} size="wall" />);
    const feed = screen.getByTestId('transcript-feed');
    expect(feed.style.display).toBe('flex');
    expect(feed.style.flexDirection).toBe('column');
    expect(feed.style.justifyContent).toBe('flex-end');
    expect(feed.style.overflow).toBe('hidden');
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
