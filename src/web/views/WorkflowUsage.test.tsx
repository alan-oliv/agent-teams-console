// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { WorkflowAgent, WorkflowRun } from '../../shared/domain';
import { WorkflowUsage, bannerFires, concurrency, phaseRows } from './WorkflowUsage';

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
    const cells = screen.getAllByTestId('wfu-phase-context');
    expect(cells[0].textContent).toBe('50.0k');
    expect(cells[1].textContent).toBe('—');
    expect(screen.getAllByTestId('wfu-phase-elapsed')[1].textContent).toBe('—');
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
    expect(screen.getByTestId('wfu-no-cost').textContent).toMatch(/context/i);
    expect(screen.queryByText(/\$/)).toBeNull();
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
