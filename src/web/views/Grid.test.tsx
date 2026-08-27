// src/web/views/Grid.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FIXTURE_NOW, fixtureAgents, padAgents } from '../agents.fixture';
import { Grid } from './Grid';

afterEach(cleanup);

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
});
