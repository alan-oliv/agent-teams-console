// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FIXTURE_NOW, fixtureAgents, padAgents } from '../agents.fixture';
import { Overview } from './Overview';

afterEach(cleanup);

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
    expect(footer.style.fontSize).toBe('9.5px');
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
    expect(tile.style.background).toBe('rgb(18, 20, 31)');
    fireEvent.mouseEnter(tile);
    expect(tile.style.background).toBe('var(--color-bg)');
  });
});
