// src/web/views/Rail.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FIXTURE_NOW, fixtureAgents } from '../agents.fixture';
import { Rail } from './Rail';

afterEach(cleanup);

const agents = fixtureAgents();

function renderRail(onFocus = vi.fn(), focused: string | null = 'team-lead') {
  render(<Rail agents={agents} focused={focused} onFocus={onFocus} now={FIXTURE_NOW} />);
  return onFocus;
}

describe('Rail — left list', () => {
  it('is a 348px listbox headed with the team size', () => {
    renderRail();
    expect(screen.getByTestId('rail-left').style.width).toBe('348px');
    expect(screen.getByText('TEAM · 4')).toBeTruthy();
    expect(screen.getByText('click to attach')).toBeTruthy();
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('marks the attached agent with a left selection bar', () => {
    renderRail();
    const rows = screen.getAllByRole('option');
    expect(rows).toHaveLength(4);
    expect(rows[0].getAttribute('aria-selected')).toBe('true');
    expect(rows[0].style.borderLeft).toBe('2px solid var(--color-accent-600)');
    expect(rows[1].getAttribute('aria-selected')).toBe('false');
    expect(rows[1].style.borderLeft).toBe('2px solid transparent');
    expect(rows[0].style.padding).toBe('8px 10px');
  });

  it('renders the two per-row lines for probe-alpha', () => {
    renderRail();
    const alpha = within(screen.getAllByRole('option')[1]);
    expect(alpha.getByTestId('rail-name').textContent).toBe('probe-alpha');
    expect(alpha.getByTestId('rail-type').textContent).toBe('general-purpose');
    expect(alpha.getByTestId('rail-elapsed').textContent).toBe('0m 42s');
    // 34_469 / 1_000_000 * 16 cells rounds to 1 filled cell, plus the forced compactAt tick at
    // floor(967_000 / 1_000_000 * 16) = index 15.
    expect(alpha.getByTestId('rail-bar').textContent).toBe('█░░░░░░░░░░░░░░█');
    expect(alpha.getByTestId('rail-pct').textContent).toBe('3%');
    expect(alpha.getByTestId('rail-cost').textContent).toBe('≈$0.46');
  });

  it('shows the percent exactly once per row, not duplicated by a context meter', () => {
    renderRail();
    const alpha = within(screen.getAllByRole('option')[1]);
    expect(alpha.getAllByText('3%')).toHaveLength(1);
    expect(alpha.queryByTestId('context-warn')).toBeNull();
  });

  it('lists the key legend in the footer', () => {
    renderRail();
    const footer = screen.getByTestId('rail-footer');
    expect(within(footer).getByText('↑↓ select')).toBeTruthy();
    expect(within(footer).getByText('⏎ attach')).toBeTruthy();
    expect(within(footer).getByText('esc interrupt')).toBeTruthy();
  });

  it('moves the cursor with the arrow keys', () => {
    renderRail();
    const listbox = screen.getByRole('listbox');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('rail-option-team-lead');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe('rail-option-probe-alpha');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe('rail-option-probe-bravo');
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe('rail-option-probe-alpha');
  });

  it('does not run the cursor off either end', () => {
    renderRail();
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe('rail-option-team-lead');
    for (let i = 0; i < 8; i += 1) fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe('rail-option-probe-charlie');
  });

  it('attaches the cursor agent on Enter', () => {
    const onFocus = renderRail();
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onFocus).toHaveBeenCalledWith('probe-alpha');
  });

  it('attaches on click too', () => {
    const onFocus = renderRail();
    fireEvent.click(screen.getAllByRole('option')[2]);
    expect(onFocus).toHaveBeenCalledWith('probe-bravo');
  });
});

describe('Rail — attached pane', () => {
  it('heads the pane with the attached agent', () => {
    renderRail(vi.fn(), 'probe-charlie');
    const header = screen.getByTestId('rail-detail-header');
    expect(header.style.padding).toBe('10px 18px');
    expect(within(header).getByTestId('rail-detail-name').textContent).toBe('probe-charlie');
    expect(within(header).getByTestId('rail-detail-type').textContent).toBe('general-purpose');
    expect(within(header).getByTestId('rail-detail-role').textContent).toBe('Spike probe charlie');
    // 23_639 / 200_000 * 16 cells rounds to 2 filled, plus the forced compactAt tick at
    // floor(167_000 / 200_000 * 16) = index 13.
    expect(within(header).getByTestId('rail-detail-bar').textContent).toBe('██░░░░░░░░░░░█░░');
    expect(within(header).getByTestId('rail-detail-ctx').textContent).toBe('23.6k / 200k');
    expect(within(header).getByTestId('rail-detail-cost').textContent).toBe('≈$0.04');
  });

  it('shows the token count exactly once in the header, not duplicated by a context meter', () => {
    renderRail(vi.fn(), 'probe-charlie');
    const header = within(screen.getByTestId('rail-detail-header'));
    expect(header.getAllByText('23.6k / 200k')).toHaveLength(1);
    expect(header.queryByTestId('context-warn')).toBeNull();
  });

  it('renders the attached transcript at rail size and a rail composer', () => {
    renderRail(vi.fn(), 'probe-charlie');
    expect(screen.getAllByTestId('transcript-marker')[0].style.width).toBe('10px');
    expect(screen.getByTestId('composer-input')).toHaveProperty(
      'placeholder', 'message probe-charlie directly',
    );
    expect(screen.getByTestId('composer-caret')).toBeTruthy();
  });
});
