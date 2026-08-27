// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FIXTURE_NOW, fixtureAgents } from '../agents.fixture';
import { Wall } from './Wall';

afterEach(cleanup);

const agents = fixtureAgents();

function renderWall(onFocus = vi.fn()) {
  render(<Wall agents={agents} focused="probe-alpha" onFocus={onFocus} now={FIXTURE_NOW} />);
  return onFocus;
}

describe('Wall', () => {
  it('renders one 366px column per team member', () => {
    renderWall();
    const columns = screen.getAllByTestId('wall-column');
    expect(columns).toHaveLength(4);
    for (const column of columns) expect(column.style.width).toBe('366px');
  });

  it('pins only the lead column', () => {
    renderWall();
    const columns = screen.getAllByTestId('wall-column');
    expect(columns[0].style.left).toBe('0px');
    expect(columns[0].style.zIndex).toBe('2');
    expect(columns[1].style.left).toBe('');
    expect(columns[1].style.zIndex).toBe('');
    expect(columns[2].style.left).toBe('');
  });

  it('pins the lead column leftmost even when it is last in the agents array', () => {
    const leadLast = [...agents.slice(1), agents[0]];
    expect(leadLast[leadLast.length - 1].isLead).toBe(true);
    render(<Wall agents={leadLast} focused="probe-alpha" onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const columns = screen.getAllByTestId('wall-column');
    expect(within(columns[0]).getByTestId('wall-name').textContent).toBe('team-lead');
    expect(columns[0].style.position).toBe('sticky');
    expect(columns[0].style.left).toBe('0px');
    expect(columns[0].style.zIndex).toBe('2');
  });

  it('scrolls horizontally only', () => {
    renderWall();
    const wall = screen.getByTestId('wall');
    expect(wall.style.overflowX).toBe('auto');
    expect(wall.style.overflowY).toBe('hidden');
  });

  it('renders the three header lines for probe-alpha', () => {
    renderWall();
    const alpha = within(screen.getAllByTestId('wall-column')[1]);
    expect(alpha.getByTestId('wall-name').textContent).toBe('probe-alpha');
    expect(alpha.getByTestId('wall-type').textContent).toBe('general-purpose');
    expect(alpha.getByTestId('wall-model').textContent).toBe('claude-opus-5');
    expect(alpha.getByTestId('wall-role').textContent).toBe('Spike probe alpha');
    expect(alpha.getByTestId('wall-elapsed').textContent).toBe('0m 42s');
    expect(alpha.getByTestId('wall-pct').textContent).toBe('3%');
    expect(alpha.getByTestId('wall-ctx').textContent).toBe('34.5k / 1M');
    expect(alpha.getByTestId('wall-cost').textContent).toBe('≈$0.46');
    expect(alpha.getByTestId('wall-warn').textContent).toBe('');
    expect(alpha.getByTestId('wall-warn').style.width).toBe('7px');
  });

  it('renders the current-tool row folded back from the README', () => {
    renderWall();
    const columns = screen.getAllByTestId('wall-column');
    const alphaTool = within(columns[1]).getByTestId('wall-current-tool');
    expect(alphaTool.textContent).toBe('Bash(sleep 20)');
    expect(alphaTool.style.whiteSpace).toBe('nowrap');
    expect(alphaTool.style.overflow).toBe('hidden');
    expect(alphaTool.style.textOverflow).toBe('ellipsis');
    // probe-charlie is idle and has no tool in flight
    expect(within(columns[3]).getByTestId('wall-current-tool').textContent).toBe('');
  });

  it('gives every column a composer aimed at that teammate', () => {
    renderWall();
    const inputs = screen.getAllByTestId('composer-input') as HTMLTextAreaElement[];
    expect(inputs).toHaveLength(4);
    expect(inputs[1].placeholder).toBe('message probe-alpha');
    expect(inputs[3].placeholder).toBe('message probe-charlie');
  });

  it('focuses a column on click', () => {
    const onFocus = renderWall();
    fireEvent.click(screen.getAllByTestId('wall-column')[2]);
    expect(onFocus).toHaveBeenCalledWith('probe-bravo');
  });

  it('tints a column on hover and clears the tint on leave', () => {
    renderWall();
    const charlie = screen.getAllByTestId('wall-column')[3];
    expect(charlie.style.background).toBe('rgb(18, 20, 31)');
    fireEvent.mouseEnter(charlie);
    expect(charlie.style.background).toBe('var(--color-bg)');
    fireEvent.mouseLeave(charlie);
    expect(charlie.style.background).toBe('rgb(18, 20, 31)');
  });

  it('dims a departed agent column to opacity .55', () => {
    const withDeparted = agents.map((a) =>
      a.name === 'probe-charlie' ? { ...a, status: 'departed' as const } : a,
    );
    render(<Wall agents={withDeparted} focused="probe-alpha" onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const columns = screen.getAllByTestId('wall-column');
    const charlie = columns.find((c) => within(c).getByTestId('wall-name').textContent === 'probe-charlie')!;
    expect(charlie.style.opacity).toBe('0.55');
    const alpha = columns.find((c) => within(c).getByTestId('wall-name').textContent === 'probe-alpha')!;
    expect(alpha.style.opacity).toBe('1');
  });
});
