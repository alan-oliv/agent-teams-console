// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FIXTURE_NOW, fixtureAgents, padAgents } from '../agents.fixture';
import { Overview } from './Overview';

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

describe('Overview', () => {
  it('fits six tiles without horizontal scroll', () => {
    render(<Overview agents={six} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const tiles = screen.getAllByTestId('overview-tile');
    expect(tiles).toHaveLength(6);
    for (const tile of tiles) {
      expect(tile.style.width).toBe('');
      expect(tile.style.minWidth).toBe('0px');
    }
    const root = screen.getByTestId('overview');
    expect(root.style.overflowX).toBe('');
    expect(root.style.display).toBe('flex');
  });

  it('renders the header, type and status row for probe-alpha', () => {
    render(<Overview agents={four} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const alpha = within(screen.getAllByTestId('overview-tile')[1]);
    expect(alpha.getByTestId('overview-name').textContent).toBe('probe-alpha');
    expect(alpha.getByTestId('overview-type').textContent).toBe('general-purpose');
    expect(alpha.getByTestId('overview-model').textContent).toBe('claude-opus-5');
    expect(alpha.getByTestId('overview-model').style.fontSize).toBe('10.5px');
    expect(alpha.getByTestId('overview-model').style.color).toBe('var(--color-neutral-600)');
    expect(alpha.getByTestId('overview-pct').textContent).toBe('3%');
    expect(alpha.getByTestId('overview-status').style.fontSize).toBe('');
    expect(alpha.getByTestId('overview-status-row').style.justifyContent).toBe('space-between');
    expect(alpha.getByTestId('overview-status-row').style.fontSize).toBe('10px');
  });

  it('draws a 4px progress bar filled to the context percentage', () => {
    render(<Overview agents={four} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const tiles = screen.getAllByTestId('overview-tile');
    const alphaTrack = within(tiles[1]).getByTestId('overview-track');
    expect(alphaTrack.style.height).toBe('4px');
    expect(within(tiles[1]).getByTestId('overview-fill').style.width).toBe('3%');
    // probe-charlie is on haiku, so the same token count reads much fuller
    expect(within(tiles[3]).getByTestId('overview-fill').style.width).toBe('12%');
  });

  it('puts elapsed left and cost right in the footer', () => {
    render(<Overview agents={four} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const alpha = within(screen.getAllByTestId('overview-tile')[1]);
    const footer = alpha.getByTestId('overview-footer');
    expect(footer.style.padding).toBe('6px 10px');
    // No 9.5px text at neutral-700 (2.69-2.80:1); that register is
    // neutral-600 at 10px everywhere in the console.
    expect(footer.style.fontSize).toBe('10px');
    expect(footer.style.color).toBe('var(--color-neutral-600)');
    expect(alpha.getByTestId('overview-elapsed').textContent).toBe('0m 42s');
    expect(alpha.getByTestId('overview-cost').textContent).toBe('≈$0.46');
  });

  it('sets the focused agent when a tile is clicked', () => {
    const onFocus = vi.fn();
    render(<Overview agents={four} focused={null} onFocus={onFocus} now={FIXTURE_NOW} />);
    fireEvent.click(screen.getAllByTestId('overview-tile')[3]);
    expect(onFocus).toHaveBeenCalledWith('probe-charlie');
  });

  it('tints a tile on hover', () => {
    render(<Overview agents={four} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const tile = screen.getAllByTestId('overview-tile')[0];
    expect(tile.style.background).toBe('var(--term)');
    fireEvent.mouseEnter(tile);
    expect(tile.style.background).toBe('var(--color-bg)');
  });

  it('dims a departed agent tile to opacity .55', () => {
    const withDeparted = four.map((a) =>
      a.name === 'probe-charlie' ? { ...a, status: 'departed' as const } : a,
    );
    render(<Overview agents={withDeparted} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const tiles = screen.getAllByTestId('overview-tile');
    const charlie = tiles.find((t) => within(t).getByTestId('overview-name').textContent === 'probe-charlie')!;
    expect(charlie.style.opacity).toBe('0.55');
    const alpha = tiles.find((t) => within(t).getByTestId('overview-name').textContent === 'probe-alpha')!;
    expect(alpha.style.opacity).toBe('1');
  });

  it('dims an idle agent tile too — an idle teammate has already returned', () => {
    const withDeparted = four.map((a) =>
      a.name === 'probe-charlie' ? { ...a, status: 'idle' as const } : a,
    );
    render(<Overview agents={withDeparted} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const tiles = screen.getAllByTestId('overview-tile');
    const charlie = tiles.find((t) => within(t).getByTestId('overview-name').textContent === 'probe-charlie')!;
    expect(charlie.style.opacity).toBe('0.55');
    const alpha = tiles.find((t) => within(t).getByTestId('overview-name').textContent === 'probe-alpha')!;
    expect(alpha.style.opacity).toBe('1');
  });

  it('pins the lead leftmost and puts departed agents last, same as the wall', () => {
    const [lead, alpha, bravo, charlie] = four;
    const withDepartedMidRoster = [
      { ...alpha, status: 'departed' as const },
      bravo,
      lead,
      charlie,
    ];
    render(<Overview agents={withDepartedMidRoster} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const names = screen
      .getAllByTestId('overview-tile')
      .map((t) => within(t).getByTestId('overview-name').textContent);
    expect(names).toEqual(['team-lead', 'probe-bravo', 'probe-charlie', 'probe-alpha']);
  });
});

describe('Overview tile memoisation', () => {
  it('does not re-render a tile whose agent object did not change', () => {
    const onFocus = vi.fn();
    feed.renders = 0;
    const { rerender } = render(<Overview agents={four} focused={null} onFocus={onFocus} now={FIXTURE_NOW} />);
    expect(feed.renders).toBe(4);

    feed.renders = 0;
    rerender(<Overview agents={four} focused={null} onFocus={onFocus} now={FIXTURE_NOW} />);
    expect(feed.renders).toBe(0);
  });

  it('does not re-render a tile when only the clock advances', () => {
    const onFocus = vi.fn();
    const { rerender } = render(<Overview agents={four} focused={null} onFocus={onFocus} now={FIXTURE_NOW} />);
    const elapsed = () => within(screen.getAllByTestId('overview-tile')[1]).getByTestId('overview-elapsed').textContent;
    expect(elapsed()).toBe('0m 42s');

    feed.renders = 0;
    rerender(<Overview agents={four} focused={null} onFocus={onFocus} now={FIXTURE_NOW + 1000} />);
    expect(feed.renders).toBe(0);
    expect(elapsed()).toBe('0m 43s');
  });

  it('re-renders only the tile whose agent changed', () => {
    const onFocus = vi.fn();
    const { rerender } = render(<Overview agents={four} focused={null} onFocus={onFocus} now={FIXTURE_NOW} />);
    const changed = four.map((a) => (a.name === 'probe-bravo' ? { ...a, status: 'idle' as const } : a));

    feed.renders = 0;
    rerender(<Overview agents={changed} focused={null} onFocus={onFocus} now={FIXTURE_NOW} />);
    expect(feed.renders).toBe(1);
  });
});
