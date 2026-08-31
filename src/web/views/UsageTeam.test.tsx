// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FIXTURE_NOW, sampleTeamState } from '../test/state-fixture';
import { formatCost } from '../format';
import { dollarsAvoided, spendByModel } from './usage-team';
import { UsageTeam } from './UsageTeam';

afterEach(cleanup);

function renderUsage(onFocus = vi.fn(), over: Partial<Parameters<typeof UsageTeam>[0]> = {}) {
  const state = sampleTeamState();
  render(
    <UsageTeam
      state={state}
      now={FIXTURE_NOW}
      focused={null}
      onFocus={onFocus}
      spendSamples={[]}
      {...over}
    />,
  );
  return { state, onFocus };
}

describe('UsageTeam — reconciliation', () => {
  // The hard rule: the view's own total must be the exact figure the status
  // bar already ticks, because both have to read the same per-agent source.
  it('shows the session-cost tile as the status bar\'s own totalCostUsd, formatted the same way', () => {
    const { state } = renderUsage();
    expect(screen.getByTestId('usage-cost-value').textContent).toBe(formatCost(state.totalCostUsd));
  });

  it('never invents a second cost total — the tile and the sum of agent.costUsd agree exactly', () => {
    const { state } = renderUsage();
    const truth = state.agents.reduce((sum, a) => sum + a.costUsd, 0);
    expect(state.totalCostUsd).toBe(truth); // fixture sanity: this IS what the status bar reads
    expect(screen.getByTestId('usage-cost-value').textContent).toBe(formatCost(truth));
  });
});

describe('UsageTeam — tiles', () => {
  it('renders five tiles, no more and no fewer', () => {
    renderUsage();
    expect(screen.getAllByTestId('usage-tile')).toHaveLength(5);
  });

  it('splits the tokens tile into in, out and cache-read within one glance', () => {
    renderUsage();
    const note = screen.getByTestId('usage-tokens-note').textContent ?? '';
    expect(note).toContain('in');
    expect(note).toContain('out');
    expect(note).toContain('cache read');
  });

  it('notes dollars avoided on the cache-hit tile, derived through the shared cost model', () => {
    const { state } = renderUsage();
    const avoided = dollarsAvoided(state.agents);
    expect(screen.getByTestId('usage-cache-note').textContent).toContain(formatCost(avoided));
  });

  it('names the count of tasks the cost-per-task figure divided by', () => {
    renderUsage();
    // The fixture has one completed task (owned by probe-alpha).
    expect(screen.getByTestId('usage-per-task-note').textContent).toContain('1');
  });
});

describe('UsageTeam — em dashes for unknowns', () => {
  it('draws an em dash, never $0.00, when no task has been completed yet', () => {
    const state = sampleTeamState();
    const noTasksDone = { ...state, tasks: state.tasks.map((t) => ({ ...t, state: 'pending' as const })) };
    render(<UsageTeam state={noTasksDone} now={FIXTURE_NOW} focused={null} onFocus={vi.fn()} spendSamples={[]} />);
    expect(screen.getByTestId('usage-per-task-value').textContent).toBe('—');
  });

  it("draws an em dash for a brand-new agent's cache hit and $/Mtok, never a NaN or a zero", () => {
    const state = sampleTeamState();
    const fresh = {
      ...state,
      agents: state.agents.map((a, i) =>
        i === 0 ? { ...a, costUsd: 0, tokenSplit: { in: 0, out: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 } } : a,
      ),
    };
    render(<UsageTeam state={fresh} now={FIXTURE_NOW} focused={null} onFocus={vi.fn()} spendSamples={[]} />);
    const row = screen.getAllByTestId('usage-ledger-row')[0];
    expect(within(row).getByTestId('usage-row-cache').textContent).toBe('—');
    expect(within(row).getByTestId('usage-row-permtok').textContent).toBe('—');
  });
});

describe('UsageTeam — per-agent ledger', () => {
  it('draws one row per agent, in the same order as the roster', () => {
    const { state } = renderUsage();
    const rows = screen.getAllByTestId('usage-ledger-row');
    expect(rows).toHaveLength(state.agents.length);
    expect(rows.map((r) => within(r).getByTestId('usage-row-name').textContent)).toEqual(
      state.agents.map((a) => a.name),
    );
  });

  it('draws the four segments in fixed order cache-read, cache-write, input, output', () => {
    renderUsage();
    const row = screen.getAllByTestId('usage-ledger-row')[0];
    const segments = within(row).getAllByTestId('usage-row-segment');
    expect(segments.map((s) => s.dataset.segment)).toEqual(['cacheRead', 'cacheWrite', 'in', 'out']);
  });

  it('colours the segments from the accent ramp, never a warn or fail token', () => {
    renderUsage();
    const row = screen.getAllByTestId('usage-ledger-row')[0];
    const segments = within(row).getAllByTestId('usage-row-segment');
    const colors = segments.map((s) => s.style.background);
    expect(colors).toEqual([
      'var(--color-accent-700)',
      'var(--color-accent-500)',
      'var(--color-accent-400)',
      'var(--color-accent-300)',
    ]);
  });

  it('clicking a row focuses that agent in the shared store', () => {
    const { state, onFocus } = renderUsage();
    const rows = screen.getAllByTestId('usage-ledger-row');
    fireEvent.click(rows[2]);
    expect(onFocus).toHaveBeenCalledWith(state.agents[2].name);
  });

  it('totals tokens, cache hit and cost in a footer row on the same ground', () => {
    const { state } = renderUsage();
    const footer = screen.getByTestId('usage-ledger-footer');
    const truthCost = state.agents.reduce((s, a) => s + a.costUsd, 0);
    expect(within(footer).getByTestId('usage-foot-cost').textContent).toBe(formatCost(truthCost));
  });
});

describe('UsageTeam — right rail', () => {
  it('lists spend by model with the live rate beside each', () => {
    const { state } = renderUsage();
    const panel = screen.getByTestId('usage-spend-by-model');
    const models = spendByModel(state.agents);
    const rows = within(panel).getAllByTestId('usage-model-row');
    expect(rows).toHaveLength(models.length);
  });

  it('marks a fallback-priced model as approximate on the rate panel', () => {
    const state = sampleTeamState();
    const withFable = {
      ...state,
      agents: state.agents.map((a, i) => (i === 0 ? { ...a, model: 'claude-fable-5' } : a)),
    };
    render(<UsageTeam state={withFable} now={FIXTURE_NOW} focused={null} onFocus={vi.fn()} spendSamples={[]} />);
    const panel = screen.getByTestId('usage-spend-by-model');
    const fableRow = within(panel).getAllByTestId('usage-model-row').find((r) => r.textContent?.includes('claude-fable-5'));
    expect(within(fableRow!).getByTestId('usage-model-approx')).toBeTruthy();
  });

  it('carries the cache-TTL, compaction and rates-from-config notes', () => {
    renderUsage();
    const notes = screen.getByTestId('usage-notes').textContent ?? '';
    expect(notes).toContain('5 minutes');
    expect(notes).toContain('subagentPromptCacheTtl');
    expect(notes.toLowerCase()).toContain('compaction');
    expect(notes.toLowerCase()).toContain('config');
  });

  it('says how long the spend-per-2-min sample covers, rather than presenting it as full history', () => {
    renderUsage(vi.fn(), { spendSamples: [{ at: FIXTURE_NOW - 4 * 60_000, cost: 1 }, { at: FIXTURE_NOW, cost: 2 }] });
    const caption = screen.getByTestId('usage-buckets-caption').textContent ?? '';
    expect(caption).toMatch(/sampled|elapsed/i);
  });

  it('says so, rather than drawing an empty chart, when nothing has been sampled yet', () => {
    renderUsage(vi.fn(), { spendSamples: [] });
    expect(screen.getByTestId('usage-buckets-empty')).toBeTruthy();
  });
});

// The hard rule: money is not a failure state anywhere on this page.
it('never reaches for --warn or --fail anywhere on the page', () => {
  const { container } = render(
    <UsageTeam state={sampleTeamState()} now={FIXTURE_NOW} focused={null} onFocus={vi.fn()} spendSamples={[]} />,
  );
  expect(container.innerHTML).not.toContain('--warn');
  expect(container.innerHTML).not.toContain('--fail');
});

// The hard rule: every colour resolves through a theme variable, or a light
// theme breaks silently around a literal.
it('never paints from a hard-coded hex — every colour is a var(--…) token', () => {
  const { container } = render(
    <UsageTeam state={sampleTeamState()} now={FIXTURE_NOW} focused={null} onFocus={vi.fn()} spendSamples={[]} />,
  );
  const hex = container.innerHTML.match(/#[0-9a-fA-F]{3,8}\b/g);
  expect(hex).toBeNull();
});
