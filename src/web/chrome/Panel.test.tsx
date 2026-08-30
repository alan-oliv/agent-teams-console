// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent, AgentStatus } from '../../shared/domain';
import { Panel } from './Panel';

// This suite renders once per `it`; without explicit cleanup the un-unmounted
// nodes from one test leak into the next and getByRole/getByText start
// matching more than one element.
afterEach(cleanup);

// Counts per-chip renders: every chip renders exactly one StatusGlyph, and the real one
// is still rendered so the DOM assertions below are unaffected.
const chip = vi.hoisted(() => ({ renders: 0 }));
vi.mock('../components/StatusGlyph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/StatusGlyph')>();
  return {
    ...actual,
    StatusGlyph(props: Parameters<typeof actual.StatusGlyph>[0]) {
      chip.renders += 1;
      return <actual.StatusGlyph {...props} />;
    },
  };
});

function agent(name: string, status: AgentStatus, contextTokens: number): Agent {
  return {
    name,
    agentId: `${name}@session-98b0b4a7`,
    isLead: name === 'team-lead',
    agentType: 'general-purpose',
    model: 'claude-opus-5',
    role: `Spike ${name}`,
    status,
    contextTokens,
    contextLimit: 1_000_000,
    compactAt: 967_000,
    costUsd: 0.42,
    startedAt: 1_787_843_382_976,
    transcript: [],
    unread: 0,
  };
}

it('shows one chip per agent while three or fewer are idle', () => {
  render(
    <Panel
      agents={[
        agent('probe-alpha', 'idle', 120_000),
        agent('probe-bravo', 'idle', 500_000),
        agent('probe-charlie', 'idle', 156_000),
      ]}
      focusedAgent={null}
      onFocusAgent={vi.fn()}
    />,
  );
  expect(screen.getAllByTestId('agent-chip')).toHaveLength(3);
  expect(screen.queryByTestId('idle-chip')).toBeNull();
});

it('collapses only the idle surplus into a dashed chip once more than three are idle', () => {
  render(
    <Panel
      agents={[
        agent('team-lead', 'idle', 53_100),
        agent('probe-alpha', 'idle', 120_000),
        agent('probe-bravo', 'idle', 500_000),
        agent('probe-charlie', 'idle', 156_000),
      ]}
      focusedAgent={null}
      onFocusAgent={vi.fn()}
    />,
  );
  // The first three idle agents stay visible as chips — only the surplus
  // (the fourth) collapses.
  expect(screen.getAllByTestId('agent-chip')).toHaveLength(3);
  expect(screen.queryByText('probe-charlie')).toBeNull();
  const idleChip = screen.getByTestId('idle-chip');
  expect(idleChip.textContent).toBe('1 idle agent');
  expect(idleChip.style.border).toBe('1px dashed var(--color-neutral-800)');

  fireEvent.click(idleChip);
  expect(screen.getAllByTestId('agent-chip')).toHaveLength(4);
  expect(screen.queryByTestId('idle-chip')).toBeNull();
});

it('keeps busy agents and the first three idle ones visible, collapsing only the surplus', () => {
  render(
    <Panel
      agents={[
        agent('team-lead', 'working', 53_100),
        agent('probe-alpha', 'idle', 120_000),
        agent('probe-bravo', 'idle', 500_000),
        agent('probe-charlie', 'idle', 156_000),
        agent('probe-delta', 'idle', 40_000),
      ]}
      focusedAgent={null}
      onFocusAgent={vi.fn()}
    />,
  );
  expect(screen.getAllByTestId('agent-chip')).toHaveLength(4);
  expect(screen.queryByText('probe-delta')).toBeNull();
  expect(screen.getByTestId('idle-chip').textContent).toBe('1 idle agent');
});

it('shows the glyph, name and context percent on each chip and focuses on click', () => {
  const onFocusAgent = vi.fn();
  render(
    <Panel
      agents={[agent('probe-alpha', 'working', 120_000)]}
      focusedAgent="probe-alpha"
      onFocusAgent={onFocusAgent}
    />,
  );
  const chip = screen.getByTestId('agent-chip');
  expect(chip.getAttribute('aria-pressed')).toBe('true');
  expect(chip.style.padding).toBe('2px 7px');
  expect(chip.style.border).toBe('1px solid var(--color-neutral-900)');
  expect(screen.getByTestId('status-glyph').textContent).toBe('●');
  expect(screen.getByText('probe-alpha')).toBeTruthy();
  expect(screen.getByText('12%')).toBeTruthy();

  fireEvent.click(chip);
  expect(onFocusAgent).toHaveBeenCalledWith('probe-alpha');
});

// The row that holds these chips is overflow:hidden with no wrap (Panel.tsx),
// so a chip too wide for a narrow window is at the mercy of the browser's own
// layout. Each chip has to be able to shrink and ellipsize its own name
// legibly, rather than count on the row to never slice it mid-glyph.
it('lets a squeezed chip ellipsize its name rather than clip raw text', () => {
  render(
    <Panel
      agents={[agent('probe-alpha', 'working', 120_000)]}
      focusedAgent={null}
      onFocusAgent={vi.fn()}
    />,
  );
  const chip = screen.getByTestId('agent-chip');
  // A real minimum, not the browser default of "never shrink below my
  // content" — that default is exactly what let the row's overflow:hidden
  // slice a percent sign in half.
  expect(chip.style.minWidth).not.toBe('');
  expect(chip.style.minWidth).not.toBe('auto');

  const name = screen.getByText('probe-alpha');
  expect(name.style.overflow).toBe('hidden');
  expect(name.style.textOverflow).toBe('ellipsis');
  expect(name.style.whiteSpace).toBe('nowrap');
  expect(name.style.minWidth).toBe('0');

  // The percent is the one that got clipped in practice — it must never be
  // the part that shrinks.
  const pct = screen.getByText('12%');
  expect(pct.style.flexShrink).toBe('0');
});

it('collapses departed agents into their own dashed chip, distinct from idle', () => {
  render(
    <Panel
      agents={[
        agent('team-lead', 'working', 53_100),
        agent('probe-alpha', 'idle', 120_000),
        agent('probe-ghost', 'departed', 90_000),
      ]}
      focusedAgent={null}
      onFocusAgent={vi.fn()}
    />,
  );
  // Only three or fewer idle agents, so the idle chip does not collapse — but
  // the departed agent never gets an addressable chip regardless of count.
  expect(screen.getAllByTestId('agent-chip')).toHaveLength(2);
  expect(screen.queryByTestId('idle-chip')).toBeNull();
  expect(screen.queryByText('probe-ghost')).toBeNull();

  const departedChip = screen.getByTestId('departed-chip');
  expect(departedChip.textContent).toBe('1 departed');
  expect(departedChip.style.border).toBe('1px dashed var(--color-neutral-800)');

  fireEvent.click(departedChip);
  expect(screen.getByTestId('departed-name').textContent).toBe('probe-ghost');
  // Still not an addressable chip once revealed.
  expect(screen.getAllByTestId('agent-chip')).toHaveLength(2);
});

it('renders the PANEL label and the key legend', () => {
  render(<Panel agents={[]} focusedAgent={null} onFocusAgent={vi.fn()} />);
  const label = screen.getByText('PANEL');
  expect(label.style.color).toBe('var(--color-neutral-600)');
  expect(label.style.letterSpacing).toBe('.12em');
  expect(
    screen.getByText('↑↓ select · ⏎ open · esc interrupt · x stop · ⌃T tasks · t teams'),
  ).toBeTruthy();
});

describe('Panel chip memoisation', () => {
  const agents = [
    agent('team-lead', 'working', 53_100),
    agent('probe-alpha', 'working', 120_000),
    agent('probe-bravo', 'working', 500_000),
  ];

  it('does not re-render a chip whose agent object did not change', () => {
    const onFocusAgent = vi.fn();
    chip.renders = 0;
    const { rerender } = render(
      <Panel agents={agents} focusedAgent="probe-alpha" onFocusAgent={onFocusAgent} />,
    );
    expect(chip.renders).toBe(3);

    chip.renders = 0;
    rerender(<Panel agents={agents} focusedAgent="probe-alpha" onFocusAgent={onFocusAgent} />);
    expect(chip.renders).toBe(0);
  });

  it('re-renders only the chip whose agent changed', () => {
    const onFocusAgent = vi.fn();
    const { rerender } = render(
      <Panel agents={agents} focusedAgent="probe-alpha" onFocusAgent={onFocusAgent} />,
    );
    const changed = agents.map((a) =>
      a.name === 'probe-bravo' ? { ...a, contextTokens: 600_000 } : a,
    );

    chip.renders = 0;
    rerender(<Panel agents={changed} focusedAgent="probe-alpha" onFocusAgent={onFocusAgent} />);
    expect(chip.renders).toBe(1);
    expect(screen.getByText('60%')).toBeTruthy();
  });

  it('re-renders only the two chips whose pressed state moved when focus changes', () => {
    const onFocusAgent = vi.fn();
    const { rerender } = render(
      <Panel agents={agents} focusedAgent="probe-alpha" onFocusAgent={onFocusAgent} />,
    );

    chip.renders = 0;
    rerender(<Panel agents={agents} focusedAgent="probe-bravo" onFocusAgent={onFocusAgent} />);
    expect(chip.renders).toBe(2);
  });
});
