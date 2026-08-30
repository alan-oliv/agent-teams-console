// src/web/views/Grid.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FIXTURE_NOW, fixtureAgents, padAgents } from '../agents.fixture';
import { Grid } from './Grid';

afterEach(cleanup);

// Counts per-column renders: every column renders exactly one TranscriptFeed, and the
// real one is still rendered so the DOM assertions above are unaffected.
const feed = vi.hoisted(() => ({ renders: 0 }));
vi.mock('../components/TranscriptFeed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/TranscriptFeed')>();
  return {
    ...actual,
    TranscriptFeed(props: Parameters<typeof actual.TranscriptFeed>[0]) {
      feed.renders += 1;
      return <actual.TranscriptFeed {...props} />;
    },
  };
});


const four = fixtureAgents();
const six = padAgents(four, 6);
const seven = padAgents(four, 7);

describe('Grid', () => {
  it('is a 3 × 2 grid', () => {
    render(<Grid agents={six} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const root = screen.getByTestId('grid');
    expect(root.style.display).toBe('grid');
    expect(screen.getAllByTestId('grid-pane')).toHaveLength(6);
    expect(screen.queryByTestId('grid-overflow')).toBeNull();
  });

  it('renders six panes and an overflow count for a seven-agent team', () => {
    render(<Grid agents={seven} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    expect(screen.getAllByTestId('grid-pane')).toHaveLength(6);
    expect(screen.getByTestId('grid-overflow').textContent).toBe('+1 more');
    expect(screen.queryByText('probe-bravo-6')).toBeNull();
  });

  it('renders the two header rows for probe-alpha', () => {
    render(<Grid agents={four} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const alpha = within(screen.getAllByTestId('grid-pane')[1]);
    expect(alpha.getByTestId('grid-name').textContent).toBe('probe-alpha');
    expect(alpha.getByTestId('grid-name').style.fontSize).toBe('12.5px');
    expect(alpha.getByTestId('grid-model').textContent).toBe('claude-opus-5');
    expect(alpha.getByTestId('grid-model').style.fontSize).toBe('10px');
    expect(alpha.getByTestId('grid-pct').textContent).toBe('3%');
    expect(alpha.getByTestId('grid-elapsed').textContent).toBe('0m 42s');
  });

  it('footers each pane with the ellipsised current tool', () => {
    render(<Grid agents={four} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const panes = screen.getAllByTestId('grid-pane');
    const tool = within(panes[1]).getByTestId('grid-tool');
    expect(tool.textContent).toBe('Bash(sleep 20)');
    expect(tool.style.padding).toBe('6px 11px');
    expect(tool.style.fontSize).toBe('10px');
    expect(tool.style.whiteSpace).toBe('nowrap');
    expect(tool.style.textOverflow).toBe('ellipsis');
    expect(within(panes[3]).getByTestId('grid-tool').textContent).toBe('');
  });

  it('renders the transcript at grid size', () => {
    render(<Grid agents={four} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const marker = screen.getAllByTestId('transcript-marker')[0];
    expect(marker.style.width).toBe('8px');
    expect(marker.style.fontSize).toBe('10px');
  });

  it('focuses a pane on click', () => {
    const onFocus = vi.fn();
    render(<Grid agents={four} focused={null} onFocus={onFocus} now={FIXTURE_NOW} />);
    fireEvent.click(screen.getAllByTestId('grid-pane')[2]);
    expect(onFocus).toHaveBeenCalledWith('probe-bravo');
  });

  it('dims a departed agent pane to opacity .55', () => {
    const withDeparted = four.map((a) =>
      a.name === 'probe-charlie' ? { ...a, status: 'departed' as const } : a,
    );
    render(<Grid agents={withDeparted} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const panes = screen.getAllByTestId('grid-pane');
    const charlie = panes.find((p) => within(p).getByTestId('grid-name').textContent === 'probe-charlie')!;
    expect(charlie.style.opacity).toBe('0.55');
    const alpha = panes.find((p) => within(p).getByTestId('grid-name').textContent === 'probe-alpha')!;
    expect(alpha.style.opacity).toBe('1');
  });

  it('dims an idle agent pane too — an idle teammate has already returned', () => {
    const withDeparted = four.map((a) =>
      a.name === 'probe-charlie' ? { ...a, status: 'idle' as const } : a,
    );
    render(<Grid agents={withDeparted} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const panes = screen.getAllByTestId('grid-pane');
    const charlie = panes.find((p) => within(p).getByTestId('grid-name').textContent === 'probe-charlie')!;
    expect(charlie.style.opacity).toBe('0.55');
    const alpha = panes.find((p) => within(p).getByTestId('grid-name').textContent === 'probe-alpha')!;
    expect(alpha.style.opacity).toBe('1');
  });
});

describe('Grid pane memoisation', () => {
  it('does not re-render a pane whose agent object did not change', () => {
    const onFocus = vi.fn();
    feed.renders = 0;
    const { rerender } = render(<Grid agents={six} focused={null} onFocus={onFocus} now={FIXTURE_NOW} />);
    expect(feed.renders).toBe(6);

    feed.renders = 0;
    rerender(<Grid agents={six} focused={null} onFocus={onFocus} now={FIXTURE_NOW} />);
    expect(feed.renders).toBe(0);
  });

  it('does not re-render a pane when only the clock advances', () => {
    const onFocus = vi.fn();
    const { rerender } = render(<Grid agents={six} focused={null} onFocus={onFocus} now={FIXTURE_NOW} />);
    const elapsed = () => within(screen.getAllByTestId('grid-pane')[1]).getByTestId('grid-elapsed').textContent;
    expect(elapsed()).toBe('0m 42s');

    feed.renders = 0;
    rerender(<Grid agents={six} focused={null} onFocus={onFocus} now={FIXTURE_NOW + 1000} />);
    expect(feed.renders).toBe(0);
    expect(elapsed()).toBe('0m 43s');
  });

  it('re-renders only the pane whose agent changed', () => {
    const onFocus = vi.fn();
    const { rerender } = render(<Grid agents={six} focused={null} onFocus={onFocus} now={FIXTURE_NOW} />);
    const changed = six.map((a) => (a.name === 'probe-bravo' ? { ...a, status: 'idle' as const } : a));

    feed.renders = 0;
    rerender(<Grid agents={changed} focused={null} onFocus={onFocus} now={FIXTURE_NOW} />);
    expect(feed.renders).toBe(1);
  });
});
