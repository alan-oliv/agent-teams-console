// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FIXTURE_NOW, sampleTeamState } from '../test/state-fixture';
import { formatCost } from '../format';
import { dollarsAvoided, spendByModel } from './usage-team';
import { DEFAULT_SETTINGS, SettingsContext } from '../state/useSettings';
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
    expect(avoided).not.toBeUndefined();
    expect(screen.getByTestId('usage-cache-note').textContent).toContain(formatCost(avoided!));
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

  // A row on disk from before this widening shipped carries `totals` (cost,
  // tokens) but no `split` — totalsOf's cast in store.ts hands it out as
  // undefined at runtime regardless of the wire type. "Not recorded" must
  // never collapse into "measured zero": a team that plainly spent money with
  // a blank token split reads as a contradiction, not an absence.
  it('draws an em dash for tokens and dollars avoided when an agent carries cost but no split at all — never $2.56 spent / 0 tokens on the same screen', () => {
    const state = sampleTeamState();
    const noSplit = {
      ...state,
      agents: state.agents.map((a, i) => (i === 0 ? { ...a, tokenSplit: undefined } : a)),
    };
    render(<UsageTeam state={noSplit} now={FIXTURE_NOW} focused={null} onFocus={vi.fn()} spendSamples={[]} />);

    // Cost is unaffected — it never depended on the split.
    expect(screen.getByTestId('usage-cost-value').textContent).toBe(formatCost(noSplit.totalCostUsd));
    // Tokens and dollars-avoided are aggregates over every agent, and one
    // agent's unknown split makes the aggregate itself unknown, not smaller.
    expect(screen.getByTestId('usage-tokens-value').textContent).toBe('—');
    expect(screen.getByTestId('usage-tokens-note').textContent).toBe('—');
    expect(screen.getByTestId('usage-cache-note').textContent).toContain('—');
    // The row with no split draws nothing rather than a zero-width bar.
    const row = screen.getAllByTestId('usage-ledger-row')[0];
    expect(within(row).queryAllByTestId('usage-row-segment')).toHaveLength(0);
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

  // The caption is the promise the click has to keep. It said "focus that
  // agent" while the click also left the view, which reads as a stray
  // navigation rather than the thing the operator asked for.
  it('says the row opens the agent in the wall, which is where the click actually lands', () => {
    renderUsage();
    expect(screen.getByTestId('usage-ledger-caption').textContent).toContain('wall');
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

  // Deliberately a model id the catalog cannot know. Naming a real one couples
  // this test to which models happen to be listed today: it was written against
  // `claude-fable-5` and went green-to-red the moment that row was added.
  const UNCATALOGUED = 'claude-not-in-the-catalog-9';

  it('marks a fallback-priced model as approximate on the rate panel', () => {
    const state = sampleTeamState();
    const withUnknown = {
      ...state,
      agents: state.agents.map((a, i) => (i === 0 ? { ...a, model: UNCATALOGUED } : a)),
    };
    render(<UsageTeam state={withUnknown} now={FIXTURE_NOW} focused={null} onFocus={vi.fn()} spendSamples={[]} />);
    const panel = screen.getByTestId('usage-spend-by-model');
    const row = within(panel).getAllByTestId('usage-model-row').find((r) => r.textContent?.includes(UNCATALOGUED));
    expect(within(row!).getByTestId('usage-model-approx')).toBeTruthy();
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

describe('UsageTeam — cumulative spend stacked by agent', () => {
  const samples = (over: Array<{ at: number; cost: number; byAgent: Record<string, number> }>) => over;

  it('says it has nothing to plot rather than drawing an empty chart, and says why', () => {
    renderUsage(vi.fn(), { spendSamples: [] });
    const empty = screen.getByTestId('usage-stacked-empty').textContent ?? '';
    expect(empty).toMatch(/backfill|spawn/i);
  });

  // The whole reason the panel exists. A console open for four minutes must not
  // present four minutes as the session's whole history.
  it('captions the chart with its own sampling window, not the session length', () => {
    renderUsage(vi.fn(), {
      spendSamples: samples([
        { at: FIXTURE_NOW - 240_000, cost: 1, byAgent: { 'team-lead': 1 } },
        { at: FIXTURE_NOW, cost: 2.56, byAgent: { 'team-lead': 2.56 } },
      ]),
    });
    expect(screen.getByTestId('usage-stacked-caption').textContent).toMatch(/sampled/i);
  });

  it('draws one filled area per agent as SVG geometry', () => {
    const { state } = renderUsage(vi.fn(), {
      spendSamples: samples([
        { at: FIXTURE_NOW - 240_000, cost: 1, byAgent: { 'team-lead': 1 } },
        { at: FIXTURE_NOW, cost: 2.56, byAgent: { 'team-lead': 1.31, 'probe-alpha': 0.42, 'probe-bravo': 0.61, 'probe-charlie': 0.22 } },
      ]),
    });
    expect(screen.getAllByTestId('usage-stacked-area')).toHaveLength(state.agents.length);
  });

  it('labels the money ladder in whole-dollar steps as HTML, not svg text', () => {
    const { container } = render(
      <UsageTeam
        state={sampleTeamState()}
        now={FIXTURE_NOW}
        focused={null}
        onFocus={vi.fn()}
        spendSamples={samples([
          { at: FIXTURE_NOW - 240_000, cost: 1, byAgent: { 'team-lead': 1 } },
          { at: FIXTURE_NOW, cost: 2.56, byAgent: { 'team-lead': 2.56 } },
        ])}
      />,
    );
    expect(screen.getAllByTestId('usage-stacked-tick').length).toBeGreaterThan(1);
    expect(container.querySelector('svg text')).toBeNull();
  });

  it('marks each teammate spawn that falls inside the sampled window', () => {
    const state = sampleTeamState();
    // probe-* all joined ~45,275s after the team was created; sample across it.
    renderUsage(vi.fn(), {
      spendSamples: samples([
        { at: state.agents[1].startedAt - 1000, cost: 1, byAgent: { 'team-lead': 1 } },
        { at: state.agents[3].startedAt + 1000, cost: 2.56, byAgent: { 'team-lead': 1.31, 'probe-alpha': 0.42, 'probe-bravo': 0.61, 'probe-charlie': 0.22 } },
      ]),
    });
    expect(screen.getAllByTestId('usage-stacked-spawn')).toHaveLength(3);
  });
});

describe('UsageTeam — donut, rate card, pressure, coordination, worth-it', () => {
  it('draws one donut arc per model', () => {
    const { state } = renderUsage();
    expect(screen.getAllByTestId('usage-donut-arc')).toHaveLength(spendByModel(state.agents).length);
  });

  it('carries a blended $/Mtok on each donut legend row, which is why the panel exists', () => {
    renderUsage();
    const rows = screen.getAllByTestId('usage-model-permtok');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.textContent).toContain('/Mtok');
  });

  it('draws an em-dash $/Mtok, never a zero rate, when a model\'s split is unrecorded', () => {
    const state = sampleTeamState();
    const noSplit = {
      ...state,
      agents: state.agents.map((a, i) => (i === 0 ? { ...a, tokenSplit: undefined } : a)),
    };
    render(<UsageTeam state={noSplit} now={FIXTURE_NOW} focused={null} onFocus={vi.fn()} spendSamples={[]} />);
    const permtoks = screen.getAllByTestId('usage-model-permtok').map((n) => n.textContent);
    expect(permtoks.some((t) => t?.startsWith('—'))).toBe(true);
  });

  // CONSOLE-NOTES §18: the console's rates come from catalog.json, and the
  // design's own card overstates this catalog's Opus rate 3x. The panel exists
  // to show which numbers produced the totals, so it must show the real ones.
  it('draws the rate card from the catalog, not from the design\'s published figures', () => {
    renderUsage();
    const rows = screen.getAllByTestId('usage-rate-row');
    const opus = rows.find((r) => r.textContent?.includes('claude-opus-5'));
    expect(opus!.textContent).toContain('5.00');
    expect(opus!.textContent).not.toContain('15.00');
  });

  it('shows the derived cache-write and cache-read columns and the 5-minute TTL footnote', () => {
    renderUsage();
    const opus = screen.getAllByTestId('usage-rate-row').find((r) => r.textContent?.includes('claude-opus-5'))!;
    expect(opus.textContent).toContain('6.25'); // 1.25x input
    expect(opus.textContent).toContain('0.50'); // 0.1x input
    const note = screen.getByTestId('usage-rate-note').textContent ?? '';
    expect(note).toContain('5 minutes');
    expect(note).toContain('subagentPromptCacheTtl');
  });

  it('hides the rate card when the appearance store turns it off', () => {
    render(
      <SettingsContext.Provider value={{ ...DEFAULT_SETTINGS, showRateCard: false } as never}>
        <UsageTeam state={sampleTeamState()} now={FIXTURE_NOW} focused={null} onFocus={vi.fn()} spendSamples={[]} />
      </SettingsContext.Provider>,
    );
    expect(screen.queryByTestId('usage-rate-card')).toBeNull();
  });

  it('shows the rate card by default, so the panel is visible before the setting exists', () => {
    renderUsage();
    expect(screen.getByTestId('usage-rate-card')).toBeTruthy();
  });

  // USAGE-STATE.md §6: metered against each agent's OWN window, never a fixed
  // 200k — Opus-5's window is 1,000,000 here, so a fixed denominator would read
  // every lead as permanently over its limit.
  it('meters context pressure against each agent\'s own limit, not a fixed 200k', () => {
    const { state } = renderUsage();
    const rows = screen.getAllByTestId('usage-pressure-row');
    expect(rows).toHaveLength(state.agents.length);
    const lead = rows[0];
    expect(lead.textContent).toContain('1M'); // the lead's real window, not 200k
  });

  it('bands the pressure bars on the accent ramp and never on warn or fail', () => {
    renderUsage();
    for (const bar of screen.getAllByTestId('usage-pressure-bar')) {
      expect(bar.style.background).toMatch(/var\(--color-accent-(300|500|700)\)/);
    }
  });

  it('carries the compaction consequence under the pressure bars', () => {
    renderUsage();
    const note = screen.getByTestId('usage-pressure-note').textContent ?? '';
    expect(note.toLowerCase()).toContain('compaction');
    expect(note.toLowerCase()).toContain('cache write');
  });

  it('draws the design\'s 17 coordination bars and counts what was delivered', () => {
    renderUsage();
    expect(screen.getAllByTestId('usage-coord-bar')).toHaveLength(17);
    expect(screen.getByTestId('usage-coord-delivered').textContent).toMatch(/\d+ of \d+/);
  });

  // The design asks for "spend attributable to re-reading inboxes". No token is
  // attributable to a message read, so the figure is absent and the panel says
  // so rather than apportioning one.
  it('says why the inbox-spend figure is absent instead of inventing an apportionment', () => {
    renderUsage();
    const note = screen.getByTestId('usage-coord-note').textContent ?? '';
    expect(note).toMatch(/no token is attributable/i);
  });

  it('captions the serial comparison as an estimate and names its assumption', () => {
    renderUsage();
    expect(screen.getByTestId('usage-worth-it-caption').textContent).toMatch(/estimate/i);
    expect(screen.getByTestId('usage-worth-note').textContent).toMatch(/only the first bar is measured/i);
  });

  it('reconciles the worth-it panel\'s measured bar with the ledger total', () => {
    const { state } = renderUsage();
    const truth = state.agents.reduce((s, a) => s + a.costUsd, 0);
    expect(screen.getByTestId('usage-worth-actual').textContent).toBe(formatCost(truth));
  });

  it('draws an em-dash serial estimate and ratio, never a zero, when a split is unrecorded', () => {
    const state = sampleTeamState();
    const noSplit = {
      ...state,
      agents: state.agents.map((a, i) => (i === 0 ? { ...a, tokenSplit: undefined } : a)),
    };
    render(<UsageTeam state={noSplit} now={FIXTURE_NOW} focused={null} onFocus={vi.fn()} spendSamples={[]} />);
    expect(screen.getByTestId('usage-worth-serial').textContent).toBe('—');
    expect(screen.getByTestId('usage-worth-ratio').textContent).toBe('—');
  });
});
