// src/web/views/Rail.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FIXTURE_NOW, fixtureAgents } from '../agents.fixture';
import { Rail } from './Rail';

afterEach(cleanup);

// Counts per-row renders: every row renders exactly one rail-row Portrait, and the real
// one is still rendered so the DOM assertions below are unaffected. The attached pane is
// counted by its single TranscriptFeed the same way.
const row = vi.hoisted(() => ({ renders: 0 }));
vi.mock('../components/Portrait', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/Portrait')>();
  return {
    ...actual,
    Portrait(props: Parameters<typeof actual.Portrait>[0]) {
      if (props.slot === 'rail-row') row.renders += 1;
      return <actual.Portrait {...props} />;
    },
  };
});

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

  it('dims a departed agent row to opacity .55', () => {
    const withDeparted = agents.map((a) =>
      a.name === 'probe-charlie' ? { ...a, status: 'departed' as const } : a,
    );
    render(<Rail agents={withDeparted} focused="team-lead" onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const rows = screen.getAllByRole('option');
    const charlie = rows.find((r) => within(r).getByTestId('rail-name').textContent === 'probe-charlie')!;
    expect(charlie.style.opacity).toBe('0.55');
    const alpha = rows.find((r) => within(r).getByTestId('rail-name').textContent === 'probe-alpha')!;
    expect(alpha.style.opacity).toBe('1');
  });
});

describe('Rail row memoisation', () => {
  it('does not re-render a row whose agent object did not change', () => {
    const onFocus = vi.fn();
    row.renders = 0;
    const { rerender } = render(<Rail agents={agents} focused="probe-alpha" onFocus={onFocus} now={FIXTURE_NOW} />);
    expect(row.renders).toBe(4);

    row.renders = 0;
    rerender(<Rail agents={agents} focused="probe-alpha" onFocus={onFocus} now={FIXTURE_NOW} />);
    expect(row.renders).toBe(0);
  });

  it('re-renders only the row whose agent changed', () => {
    const onFocus = vi.fn();
    const { rerender } = render(<Rail agents={agents} focused="probe-alpha" onFocus={onFocus} now={FIXTURE_NOW} />);
    const changed = agents.map((a) => (a.name === 'probe-bravo' ? { ...a, status: 'idle' as const } : a));

    row.renders = 0;
    rerender(<Rail agents={changed} focused="probe-alpha" onFocus={onFocus} now={FIXTURE_NOW} />);
    expect(row.renders).toBe(1);
  });

  it('does not re-render a row when only the clock advances', () => {
    const onFocus = vi.fn();
    const { rerender } = render(<Rail agents={agents} focused="probe-alpha" onFocus={onFocus} now={FIXTURE_NOW} />);
    const elapsed = () => within(screen.getAllByRole('option')[1]).getByTestId('rail-elapsed').textContent;
    expect(elapsed()).toBe('0m 42s');

    row.renders = 0;
    rerender(<Rail agents={agents} focused="probe-alpha" onFocus={onFocus} now={FIXTURE_NOW + 1000} />);
    expect(row.renders).toBe(0);
    expect(elapsed()).toBe('0m 43s');
  });
});

describe('Rail attached-pane memoisation', () => {
  it('does not re-render the attached pane when no agent changed', () => {
    const onFocus = vi.fn();
    feed.renders = 0;
    const { rerender } = render(<Rail agents={agents} focused="probe-alpha" onFocus={onFocus} now={FIXTURE_NOW} />);
    expect(feed.renders).toBe(1);

    feed.renders = 0;
    rerender(<Rail agents={agents} focused="probe-alpha" onFocus={onFocus} now={FIXTURE_NOW} />);
    expect(feed.renders).toBe(0);
  });

  it('does not re-render the attached pane when only the clock advances', () => {
    const onFocus = vi.fn();
    const { rerender } = render(<Rail agents={agents} focused="probe-alpha" onFocus={onFocus} now={FIXTURE_NOW} />);
    feed.renders = 0;
    rerender(<Rail agents={agents} focused="probe-alpha" onFocus={onFocus} now={FIXTURE_NOW + 1000} />);
    expect(feed.renders).toBe(0);
  });

  it('re-renders the attached pane when its own agent changed', () => {
    const onFocus = vi.fn();
    const { rerender } = render(<Rail agents={agents} focused="probe-alpha" onFocus={onFocus} now={FIXTURE_NOW} />);
    const changed = agents.map((a) => (a.name === 'probe-alpha' ? { ...a, status: 'idle' as const } : a));

    feed.renders = 0;
    rerender(<Rail agents={changed} focused="probe-alpha" onFocus={onFocus} now={FIXTURE_NOW} />);
    expect(feed.renders).toBe(1);
  });
});
