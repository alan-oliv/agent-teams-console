// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { WorkflowAgent, WorkflowRun, WorkflowUsage as WorkflowUsageFigures } from '../../shared/domain';
import { usdCost, type TokenSplit } from '../../shared/cost';
import { billedTokens, cacheHitRatio } from './usage-team';
import { formatCost, formatPct, formatTokens } from '../format';
import { WorkflowUsage, bannerFires, concurrency, phaseRows, runCost } from './WorkflowUsage';

afterEach(cleanup);

const T0 = 1_787_853_919_000;

const agent = (over: Partial<WorkflowAgent> & { agentId: string }): WorkflowAgent => ({
  state: 'done',
  ...over,
});

const run = (over: Partial<WorkflowRun> = {}): WorkflowRun => ({
  runId: 'wf_c6178afd-453',
  status: 'completed',
  live: false,
  name: 'agent-teams-console-pipeline',
  startedAt: T0,
  durationMs: 600_000,
  logs: [],
  phases: [{ index: 1, title: 'Build' }],
  agents: [
    agent({ agentId: 'a1', phaseIndex: 1, tokens: 50_000, startedAt: T0, durationMs: 60_000 }),
  ],
  ...over,
});

const draw = (r: WorkflowRun) => render(<WorkflowUsage run={r} now={T0 + 600_000} />);

describe('the pending phase rule', () => {
  // The design's own words: never a zero, which reads as measured. A phase the
  // run never reached has no agents recorded under it at all, so there is
  // nothing to sum and nothing to sum it from.
  it('draws em-dashes, not zeros, for a phase the run never reached', () => {
    draw(
      run({
        phases: [
          { index: 1, title: 'Build' },
          { index: 2, title: 'Review' },
        ],
      }),
    );
    const elapsed = screen.getAllByTestId('wfu-phase-elapsed');
    expect(elapsed[0].textContent).not.toBe('—'); // the phase that ran is measured
    expect(elapsed[1].textContent).toBe('—');
  });

  // Decision 21 keeps tokens and cost off the Gantt entirely — the figure the
  // old flat table carried here is final context, and it belongs to the agent
  // table where it can be labelled per agent.
  it('carries no tokens or cost column on the Gantt itself', () => {
    draw(run({ phases: [{ index: 1, title: 'Build' }] }));
    expect(screen.queryByTestId('wfu-phase-context')).toBeNull();
    expect(screen.getAllByTestId('wfu-agent-row')[0].textContent).toContain('50.0k');
  });

  it('says a pending phase is queued rather than counting its agents at zero', () => {
    draw(run({ phases: [{ index: 1, title: 'Build' }, { index: 2, title: 'Review' }] }));
    expect(screen.getAllByTestId('wfu-phase-tally')[1].textContent).toBe('queued');
  });

  // The count the design wants on that row does not exist: a phase reaches disk
  // with its agents or with nothing, so `N agents queued` cannot be filled in.
  it('says the queued agent count is not recorded, rather than inventing one', () => {
    draw(run({ phases: [{ index: 1, title: 'Build' }, { index: 2, title: 'Review' }] }));
    expect(screen.getByTestId('wfu-phase-note').textContent).toMatch(/not recorded/i);
  });
});

describe('projection', () => {
  it('draws no projection panel on a finished run', () => {
    draw(run());
    expect(screen.queryByTestId('wfu-projection')).toBeNull();
  });

  // The design makes projection live-run-only. On this runtime it is neither:
  // a live run has no token figure at all to project from.
  it('draws no projection panel on a live run either, and says why', () => {
    draw(run({ live: true, agents: [agent({ agentId: 'a1', state: 'run' })], phases: [] }));
    expect(screen.queryByTestId('wfu-projection')).toBeNull();
    expect(screen.getByTestId('wfu-live-note').textContent).toMatch(/journal/i);
  });
});

describe('the large-workflow banner', () => {
  const many = (n: number): WorkflowAgent[] =>
    Array.from({ length: n }, (_, i) => agent({ agentId: `a${i}`, phaseIndex: 1 }));

  it('stays silent at the threshold', () => {
    expect(bannerFires(run({ agents: many(25) }), 25)).toBe(false);
  });

  it('fires past the threshold', () => {
    expect(bannerFires(run({ agents: many(26) }), 25)).toBe(true);
  });

  it('draws the badge when it fires', () => {
    draw(run({ agents: many(30) }));
    expect(screen.getByTestId('wfu-banner-badge').textContent).toBe('LARGE WORKFLOW');
  });

  it('says the warning is advisory and does not pause the run', () => {
    draw(run({ agents: many(30) }));
    expect(screen.getByTestId('wfu-banner').textContent).toMatch(/advisory/i);
  });

  // The badge is the first thing a narrow viewport crushes, and a wrapped
  // "LARGE / WORKFLOW" reads as a rendering fault rather than a warning.
  it('keeps the badge from being crushed by a narrow viewport', () => {
    draw(run({ agents: many(30) }));
    const badge = screen.getByTestId('wfu-banner-badge');
    expect(badge.style.flexShrink).toBe('0');
    expect(badge.style.whiteSpace).toBe('nowrap');
  });

  it('does not fire on a live run, whose agent count is only what has started', () => {
    expect(bannerFires(run({ live: true, agents: many(40) }), 25)).toBe(false);
  });
});

describe('concurrency', () => {
  it('counts agents whose runs overlap', () => {
    const overlapping = [
      agent({ agentId: 'a1', startedAt: T0, durationMs: 10_000 }),
      agent({ agentId: 'a2', startedAt: T0 + 1_000, durationMs: 10_000 }),
      agent({ agentId: 'a3', startedAt: T0 + 2_000, durationMs: 10_000 }),
    ];
    expect(concurrency(overlapping).peak).toBe(3);
  });

  it('does not count agents that never overlap', () => {
    const sequential = [
      agent({ agentId: 'a1', startedAt: T0, durationMs: 1_000 }),
      agent({ agentId: 'a2', startedAt: T0 + 5_000, durationMs: 1_000 }),
    ];
    expect(concurrency(sequential).peak).toBe(1);
  });

  it('reports how long the run sat at its peak', () => {
    const pair = [
      agent({ agentId: 'a1', startedAt: T0, durationMs: 10_000 }),
      agent({ agentId: 'a2', startedAt: T0 + 4_000, durationMs: 2_000 }),
    ];
    expect(concurrency(pair)).toEqual({ peak: 2, msAtPeak: 2_000 });
  });

  // An agent killed in flight keeps its tokens and loses its durationMs. It was
  // running right up to the kill, so dropping it would under-report the peak of
  // exactly the runs an operator is looking at.
  it('holds an agent with no duration open to the end of the run', () => {
    const killed = [
      agent({ agentId: 'a1', state: 'run', startedAt: T0 }),
      agent({ agentId: 'a2', startedAt: T0 + 1_000, durationMs: 1_000 }),
    ];
    expect(concurrency(killed).peak).toBe(2);
  });

  it('reports nothing for a run whose agents have no timings', () => {
    expect(concurrency([agent({ agentId: 'a1' })])).toEqual({ peak: 0, msAtPeak: 0 });
  });
});

describe('phaseRows', () => {
  it('sums each phase over only its own agents', () => {
    const rows = phaseRows(
      run({
        phases: [
          { index: 1, title: 'Build' },
          { index: 2, title: 'Review' },
        ],
        agents: [
          agent({ agentId: 'a1', phaseIndex: 1, tokens: 10, startedAt: T0, durationMs: 5 }),
          agent({ agentId: 'a2', phaseIndex: 2, tokens: 400, startedAt: T0, durationMs: 5 }),
        ],
      }),
    );
    expect(rows.map((r) => r.contextTokens)).toEqual([10, 400]);
  });

  it('leaves a phase with no agents undefined rather than zero', () => {
    const rows = phaseRows(run({ phases: [{ index: 1, title: 'Build' }, { index: 2, title: 'Review' }] }));
    expect(rows[1].contextTokens).toBeUndefined();
    expect(rows[1].elapsedMs).toBeUndefined();
    expect(rows[1].pending).toBe(true);
  });
});

// `queued` is the tally's word for an agent waiting on a concurrency slot. A
// run that spawned nobody has nothing waiting, and saying so would describe
// agents that do not exist.
it('does not describe a run that spawned no agents as having agents queued', () => {
  draw(run({ agents: [], phases: [] }));
  expect(screen.getByTestId('workflow-usage').textContent).not.toMatch(/queued/);
});

describe('what this mode does not draw, and says so', () => {
  // The whole finding of the audit: workflowProgress[].tokens matched each
  // agent's FINAL CONTEXT SIZE in 135 of 135 records on disk, and matched a
  // billed-token sum in none of them. Pricing it would put a dollar sign on a
  // different quantity.
  it('never labels the run snapshot figure as spend', () => {
    draw(run());
    expect(screen.getByTestId('wfu-basis').textContent).toMatch(/context/i);
    // No usage was measured for this run, so no dollar figure may appear —
    // measured money exists now, but never from the snapshot's own numbers.
    expect(screen.queryByText(/\$\d/)).toBeNull();
  });

  it('names the runtime caps as caps in the footer', () => {
    draw(run());
    const footer = screen.getByTestId('wfu-footer').textContent ?? '';
    expect(footer).toMatch(/16 concurrent/);
    expect(footer).toMatch(/4,096/);
    expect(footer).toMatch(/1,000 agents/);
  });

  it('says a subscription meters the same usage against plan limits', () => {
    draw(run());
    expect(screen.getByTestId('wfu-footer').textContent).toMatch(/plan limits/i);
  });

  it('carries the relaunch replay order, which is why an operator stops early', () => {
    draw(run());
    const relaunch = screen.getByTestId('wfu-relaunch').textContent ?? '';
    expect(relaunch).toMatch(/start order/i);
    expect(relaunch).toMatch(/already finished/i);
  });
});

describe('a live run', () => {
  const liveRun = run({
    live: true,
    name: undefined,
    startedAt: undefined,
    durationMs: undefined,
    phases: [],
    agents: [agent({ agentId: 'a1', state: 'run' }), agent({ agentId: 'a2', state: 'done' })],
  });

  it('reports what the journal knows and nothing else', () => {
    draw(liveRun);
    expect(screen.getByTestId('wfu-live-counts').textContent).toBe('2 started · 1 returned');
  });

  it('draws no phase table, because a live run has no phases on disk', () => {
    draw(liveRun);
    expect(screen.queryByTestId('wfu-phase-tally')).toBeNull();
  });

  it('still draws the footer, whose caps do not depend on the run', () => {
    draw(liveRun);
    expect(screen.getByTestId('wfu-footer')).toBeTruthy();
  });
});

describe('the phase Gantt', () => {
  const twoPhases = () =>
    run({
      startedAt: T0,
      durationMs: 300_000,
      phases: [
        { index: 1, title: 'Survey' },
        { index: 2, title: 'Build' },
        { index: 3, title: 'Never reached' },
      ],
      agents: [
        agent({ agentId: 'a1', phaseIndex: 1, startedAt: T0, durationMs: 60_000, tokens: 10_000 }),
        agent({ agentId: 'a2', phaseIndex: 2, startedAt: T0 + 60_000, durationMs: 120_000, tokens: 20_000 }),
      ],
    });

  it('folds each phase to its own first start and last return', () => {
    const rows = phaseRows(twoPhases());
    expect(rows[0].startMs).toBe(T0);
    expect(rows[0].endMs).toBe(T0 + 60_000);
    expect(rows[1].startMs).toBe(T0 + 60_000);
    expect(rows[1].endMs).toBe(T0 + 180_000);
  });

  it('leaves a phase the run never reached without a span at all', () => {
    const rows = phaseRows(twoPhases());
    expect(rows[2].startMs).toBeUndefined();
    expect(rows[2].endMs).toBeUndefined();
    expect(rows[2].pending).toBe(true);
  });

  it('positions each bar as a percentage of the run span', () => {
    draw(twoPhases());
    const bars = screen.getAllByTestId('wfu-gantt-bar');
    expect(bars).toHaveLength(2); // the pending phase draws no bar
    expect(bars[0].style.left).toBe('0%');
    expect(parseFloat(bars[0].style.width)).toBeCloseTo(33.33, 1);
  });

  it('says "queued" and draws em-dashes for a pending row, never a zero', () => {
    draw(twoPhases());
    const rows = screen.getAllByTestId('wfu-gantt-row');
    expect(rows[2].textContent).toContain('queued');
    expect(within(rows[2]).getByTestId('wfu-phase-elapsed').textContent).toBe('—');
  });

  it('draws cache hit and cost as em-dashes on the agent table, never zeros', () => {
    draw(twoPhases());
    expect(screen.getAllByTestId('wfu-agent-cachehit')[0].textContent).toBe('—');
    expect(screen.getAllByTestId('wfu-agent-cost')[0].textContent).toBe('—');
  });

  it('scopes the agent table to the phase whose row was clicked', () => {
    draw(twoPhases());
    fireEvent.click(screen.getAllByTestId('wfu-gantt-row')[1]);
    expect(screen.getByTestId('wfu-agent-table-title').textContent).toContain('Build');
    expect(screen.getAllByTestId('wfu-agent-row')).toHaveLength(1);
  });
});

describe('the per-agent scatter', () => {
  const mixed = () =>
    run({
      startedAt: T0,
      durationMs: 300_000,
      agents: [
        agent({ agentId: 'a1', state: 'done', startedAt: T0, durationMs: 60_000, tokens: 10_000 }),
        agent({ agentId: 'a2', state: 'fail', startedAt: T0, durationMs: 30_000, tokens: 5_000 }),
        agent({ agentId: 'a3', state: 'run', startedAt: T0 + 10_000, tokens: 8_000 }),
        agent({ agentId: 'a4', state: 'null', startedAt: T0, durationMs: 10_000, tokens: 1_000 }),
      ],
    });

  it('draws one point per agent that actually ran', () => {
    draw(mixed());
    expect(screen.getAllByTestId('wfu-scatter-point')).toHaveLength(4);
  });

  // Decision 21 substitutes toolCalls for the cost the design wanted here,
  // rather than leaving the radius channel carrying nothing.
  it('scales the radius by tool calls, the measure that does exist', () => {
    draw(
      run({
        agents: [
          agent({ agentId: 'a1', startedAt: T0, durationMs: 1000, tokens: 100, toolCalls: 20 }),
          agent({ agentId: 'a2', startedAt: T0, durationMs: 1000, tokens: 100, toolCalls: 1 }),
        ],
      }),
    );
    const [busy, quiet] = screen.getAllByTestId('wfu-scatter-point');
    expect(Number(busy.getAttribute('r'))).toBeGreaterThan(Number(quiet.getAttribute('r')));
  });

  it('draws the smallest point, never a zero-area one, for an agent with no tool-call count', () => {
    draw(
      run({
        agents: [
          agent({ agentId: 'a1', startedAt: T0, durationMs: 1000, tokens: 100, toolCalls: 20 }),
          agent({ agentId: 'a2', startedAt: T0, durationMs: 1000, tokens: 100 }),
        ],
      }),
    );
    const unknown = screen.getAllByTestId('wfu-scatter-point')[1];
    expect(Number(unknown.getAttribute('r'))).toBeGreaterThan(0);
  });

  it('names tool calls as what the radius carries, so it is not read as cost', () => {
    draw(mixed());
    expect(screen.getByTestId('wfu-scatter-ylabel').textContent).toMatch(/tool calls/i);
  });

  it('draws a failed agent as a hollow ring so it is findable without a second hue', () => {
    draw(mixed());
    const failed = screen.getAllByTestId('wfu-scatter-point').find((p) => p.getAttribute('data-state') === 'fail')!;
    expect(failed.getAttribute('fill')).toBe('none');
    expect(failed.getAttribute('stroke')).toBeTruthy();
  });

  it('counts each state on its filter chip', () => {
    draw(mixed());
    const chips = screen.getAllByTestId('wfu-scatter-chip').map((c) => c.textContent);
    expect(chips.some((c) => c?.includes('all') && c?.includes('4'))).toBe(true);
    expect(chips.some((c) => c?.includes('failed') && c?.includes('1'))).toBe(true);
  });

  it('filters the points down to the chip that was clicked', () => {
    draw(mixed());
    const done = screen.getAllByTestId('wfu-scatter-chip').find((c) => c.textContent?.includes('done'))!;
    fireEvent.click(done);
    expect(screen.getAllByTestId('wfu-scatter-point')).toHaveLength(1);
  });

  // The y axis is final context occupancy, not billed spend. Labelling it
  // "tokens" is the exact conflation the whole mode exists to avoid.
  it('names its y axis final context rather than tokens', () => {
    draw(mixed());
    expect(screen.getByTestId('wfu-scatter-ylabel').textContent).toMatch(/final context/i);
  });
});

describe('what the mode still refuses, and why', () => {
  it('refuses the cap line and the 1.5M threshold by name', () => {
    draw(run());
    const why = screen.getByTestId('wfu-basis').textContent ?? '';
    expect(why).toContain('1.5M');
    expect(why.toLowerCase()).toContain('cap');
  });

  it('never reaches for --warn or --fail anywhere on the page', () => {
    const { container } = draw(run());
    expect(container.innerHTML).not.toContain('--warn');
    expect(container.innerHTML).not.toContain('--fail');
  });
});

// ————— the money half, from the ingested classes (old-batch #25) —————
//
// Every dollar below reconciles against usdCost over the same tokenSplit the
// row draws, so the test computes its expectation from the one cost model
// rather than hardcoding a figure the rate card could drift from.

const SPLIT_A: TokenSplit = { in: 1_000, out: 500, cacheWrite: 2_000, cacheWrite1h: 0, cacheRead: 50_000 };
const SPLIT_B: TokenSplit = { in: 800, out: 300, cacheWrite: 1_000, cacheWrite1h: 0, cacheRead: 30_000 };

const sumSplits = (a: TokenSplit, b: TokenSplit): TokenSplit => ({
  in: a.in + b.in,
  out: a.out + b.out,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  cacheRead: a.cacheRead + b.cacheRead,
});

const USAGE: WorkflowUsageFigures = {
  split: sumSplits(SPLIT_A, SPLIT_B),
  byPhase: [{ phaseIndex: 1, split: sumSplits(SPLIT_A, SPLIT_B) }],
  burn: { startedAt: T0, stepMs: 10_000, cumulative: [10_000, 40_000, 85_600] },
  agentsMeasured: 2,
};

const measuredAgents = () => [
  agent({ agentId: 'a1', phaseIndex: 1, tokens: 50_000, startedAt: T0, durationMs: 60_000, model: 'claude-opus-5', tokenSplit: SPLIT_A, toolCalls: 4 }),
  agent({ agentId: 'a2', phaseIndex: 1, tokens: 30_000, startedAt: T0, durationMs: 30_000, model: 'claude-sonnet-5', tokenSplit: SPLIT_B }),
];

const measuredRun = (over: Partial<WorkflowRun> = {}) =>
  run({ agents: measuredAgents(), usage: USAGE, ...over });

const EXPECTED_USD = usdCost('claude-opus-5', SPLIT_A) + usdCost('claude-sonnet-5', SPLIT_B);

describe('the measured-spend figure (decision 31)', () => {
  it('prices a fully measured finished run through the one cost model', () => {
    draw(measuredRun());
    expect(screen.getByTestId('wfu-cost-value').textContent).toBe(formatCost(EXPECTED_USD));
    expect(screen.getByTestId('wfu-money').textContent).toContain('2 of 2 agents measured');
  });

  it('em-dashes a finished run with an unmeasured agent — a permanent hole of unknown size', () => {
    draw(
      measuredRun({
        agents: [...measuredAgents(), agent({ agentId: 'a3', phaseIndex: 1, startedAt: T0 })],
      }),
    );
    expect(screen.getByTestId('wfu-cost-value').textContent).toBe('—');
    expect(screen.getByTestId('wfu-money').textContent).toContain('2 of 3');
  });

  it('draws a live run partial WITH its coverage — spend to date is a true figure', () => {
    draw(
      measuredRun({
        live: true,
        status: 'running',
        phases: [],
        agentCount: undefined,
        agents: [...measuredAgents(), agent({ agentId: 'a3', state: 'run' })],
      }),
    );
    expect(screen.getByTestId('wfu-cost-value').textContent).toBe(formatCost(EXPECTED_USD));
    expect(screen.getByTestId('wfu-money').textContent).toContain('2 of 3 agents measured');
  });

  it('runCost refuses to price a measured agent that names no model', () => {
    const agents = measuredAgents().map((a) => ({ ...a, model: undefined }));
    expect(runCost(run({ agents, usage: USAGE, defaultModel: undefined })).usd).toBeUndefined();
  });

  it('shows the measured tokens with cache reads included, beside their split', () => {
    draw(measuredRun());
    const money = screen.getByTestId('wfu-money').textContent ?? '';
    expect(money).toContain(formatTokens(billedTokens(USAGE.split)));
    expect(money).toMatch(/cache read/i);
  });
});

describe('the per-agent money cells', () => {
  it('fills cache hit and cost from the agent’s own split and model', () => {
    draw(measuredRun());
    const hits = screen.getAllByTestId('wfu-agent-cachehit').map((c) => c.textContent);
    const costs = screen.getAllByTestId('wfu-agent-cost').map((c) => c.textContent);
    expect(hits[0]).toBe(formatPct(cacheHitRatio(SPLIT_A)!));
    expect(costs[0]).toBe(formatCost(usdCost('claude-opus-5', SPLIT_A)));
  });

  it('keeps the em-dash for an agent with no measured split', () => {
    draw(
      measuredRun({
        agents: [...measuredAgents(), agent({ agentId: 'a3', phaseIndex: 1, startedAt: T0 })],
      }),
    );
    // The hole rule gates only the TOTAL; a row still shows what was measured
    // for it, and an unmeasured row keeps the em-dash it always had.
    expect(screen.getAllByTestId('wfu-agent-cachehit').at(-1)?.textContent).toBe('—');
    expect(screen.getAllByTestId('wfu-agent-cost').at(-1)?.textContent).toBe('—');
  });
});

describe('the burn line', () => {
  it('draws the cumulative measured series as geometry with an HTML max label', () => {
    draw(measuredRun());
    expect(screen.getByTestId('wfu-burn-line')).toBeTruthy();
    expect(screen.getByTestId('wfu-burn-max').textContent).toBe(formatTokens(85_600));
  });

  it('falls back to prose, not an empty chart, when nothing is measured yet', () => {
    draw(run());
    expect(screen.queryByTestId('wfu-burn-line')).toBeNull();
  });
});

describe('the basis note', () => {
  it('labels every dollar as derived at API list price from the agents’ own transcripts', () => {
    draw(measuredRun());
    expect(screen.getByTestId('wfu-basis').textContent).toMatch(/list price/i);
    expect(screen.getByTestId('wfu-footer').textContent).toMatch(/list price/i);
  });
});
