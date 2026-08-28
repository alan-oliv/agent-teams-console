// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FIXTURE_NOW, fixtureAgents } from '../agents.fixture';
import { Wall } from './Wall';

afterEach(cleanup);

// Counts per-column renders: every column renders exactly one TranscriptFeed, and the
// real one is still rendered so the DOM assertions above are unaffected.
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

describe('Wall column memoisation', () => {
  const now = FIXTURE_NOW;

  it('does not re-render a column whose agent object did not change', () => {
    const onFocus = vi.fn();
    feed.renders = 0;
    const { rerender } = render(<Wall agents={agents} focused="probe-alpha" onFocus={onFocus} now={now} />);
    expect(feed.renders).toBe(4);

    feed.renders = 0;
    rerender(<Wall agents={agents} focused="probe-alpha" onFocus={onFocus} now={now} />);
    expect(feed.renders).toBe(0);
  });

  it('re-renders only the column whose agent changed', () => {
    const onFocus = vi.fn();
    const { rerender } = render(<Wall agents={agents} focused="probe-alpha" onFocus={onFocus} now={now} />);
    const changed = agents.map((a) => (a.name === 'probe-bravo' ? { ...a, status: 'idle' as const } : a));

    feed.renders = 0;
    rerender(<Wall agents={changed} focused="probe-alpha" onFocus={onFocus} now={now} />);
    expect(feed.renders).toBe(1);
  });

  it('does not re-render a column when only the clock advances', () => {
    const onFocus = vi.fn();
    const { rerender } = render(<Wall agents={agents} focused="probe-alpha" onFocus={onFocus} now={now} />);
    const elapsed = () => within(screen.getAllByTestId('wall-column')[1]).getByTestId('wall-elapsed').textContent;
    expect(elapsed()).toBe('0m 42s');

    feed.renders = 0;
    rerender(<Wall agents={agents} focused="probe-alpha" onFocus={onFocus} now={now + 1000} />);
    expect(feed.renders).toBe(0);
    expect(elapsed()).toBe('0m 43s');
  });

  it('does not re-render unhovered columns when hover moves', () => {
    renderWall();
    feed.renders = 0;
    fireEvent.mouseEnter(screen.getAllByTestId('wall-column')[3]);
    // Only the entered column's `isTinted` moves, so exactly one column re-renders.
    expect(feed.renders).toBe(1);
  });

  // The wall used to render in config join order, so a teammate that finished
  // yesterday held a visible column while a live one sat off the right edge of a
  // 5504px scroller nothing ever scrolled.
  describe('live agents hold the visible columns', () => {
    const withDeparted = () => {
      const [lead, alpha, bravo, charlie] = agents;
      return [
        { ...alpha, status: 'departed' as const },
        { ...bravo, status: 'departed' as const },
        lead,
        charlie,
      ];
    };

    const names = () =>
      screen.getAllByTestId('wall-column').map((c) => c.getAttribute('data-agent'));

    it('orders the lead first, then live agents, then departed ones', () => {
      render(<Wall agents={withDeparted()} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
      expect(names()).toEqual(['team-lead', 'probe-charlie', 'probe-alpha', 'probe-bravo']);
    });

    it('keeps join order within each group, so columns do not reshuffle as agents act', () => {
      const [lead, alpha, bravo, charlie] = agents;
      render(
        <Wall
          agents={[{ ...bravo, status: 'departed' as const }, alpha, lead, charlie]}
          focused={null}
          onFocus={vi.fn()}
          now={FIXTURE_NOW}
        />,
      );
      expect(names()).toEqual(['team-lead', 'probe-alpha', 'probe-charlie', 'probe-bravo']);
    });

    it('scrolls the focused column into view, so a ?agent= deep link is reachable', () => {
      const scrolled: string[] = [];
      // jsdom has no layout, so scrollIntoView is undefined until we supply it.
      Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
        scrolled.push(this.getAttribute('data-agent') ?? '');
      };
      render(
        <Wall agents={agents} focused="probe-charlie" onFocus={vi.fn()} now={FIXTURE_NOW} />,
      );
      expect(scrolled).toEqual(['probe-charlie']);
    });

    it('does not scroll when nothing is focused', () => {
      const scrolled: string[] = [];
      Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
        scrolled.push(this.getAttribute('data-agent') ?? '');
      };
      render(<Wall agents={agents} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
      expect(scrolled).toEqual([]);
    });
  });
});

describe('Wall column resizing', () => {
  const grip = (name: string) =>
    screen.getAllByTestId('wall-grip').find((g) => g.getAttribute('data-agent') === name)!;
  const column = (name: string) =>
    screen.getAllByTestId('wall-column').find((c) => c.getAttribute('data-agent') === name)!;

  function renderResizable(widths: Record<string, number> = {}) {
    const onWidthChange = vi.fn();
    const { rerender } = render(
      <Wall
        agents={agents}
        focused={null}
        onFocus={vi.fn()}
        now={FIXTURE_NOW}
        widths={widths}
        onWidthChange={onWidthChange}
      />,
    );
    return { onWidthChange, rerender };
  }

  function drag(name: string, dx: number) {
    fireEvent.mouseDown(grip(name), { clientX: 400 });
    fireEvent.mouseMove(window, { clientX: 400 + dx });
  }

  it('defaults every column to 366px', () => {
    renderResizable();
    for (const c of screen.getAllByTestId('wall-column')) expect(c.style.width).toBe('366px');
  });

  it('renders the width the store holds for that agent', () => {
    renderResizable({ 'probe-alpha': 500 });
    expect(column('probe-alpha').style.width).toBe('500px');
    expect(column('probe-bravo').style.width).toBe('366px');
  });

  it('reports the dragged delta for that column only', () => {
    const { onWidthChange } = renderResizable();
    drag('probe-alpha', 90);
    expect(onWidthChange).toHaveBeenCalledWith('probe-alpha', 456);
    fireEvent.mouseUp(window);
  });

  it('drags from the column own width, not the default', () => {
    const { onWidthChange } = renderResizable({ 'probe-alpha': 500 });
    drag('probe-alpha', -40);
    expect(onWidthChange).toHaveBeenCalledWith('probe-alpha', 460);
    fireEvent.mouseUp(window);
  });

  it('stops reporting once the mouse is released', () => {
    const { onWidthChange } = renderResizable();
    drag('probe-alpha', 20);
    fireEvent.mouseUp(window);
    onWidthChange.mockClear();
    fireEvent.mouseMove(window, { clientX: 900 });
    expect(onWidthChange).not.toHaveBeenCalled();
  });

  it('resets to the default on double-click', () => {
    const { onWidthChange } = renderResizable({ 'probe-alpha': 500 });
    fireEvent.doubleClick(grip('probe-alpha'));
    expect(onWidthChange).toHaveBeenCalledWith('probe-alpha', null);
  });

  // The grip lives inside the column, and the column focuses its agent on click.
  it('does not focus the agent when the grip is grabbed', () => {
    const onFocus = vi.fn();
    render(
      <Wall
        agents={agents}
        focused={null}
        onFocus={onFocus}
        now={FIXTURE_NOW}
        widths={{}}
        onWidthChange={vi.fn()}
      />,
    );
    fireEvent.mouseDown(grip('probe-alpha'), { clientX: 400 });
    fireEvent.click(grip('probe-alpha'));
    expect(onFocus).not.toHaveBeenCalled();
    fireEvent.mouseUp(window);
  });

  it('shows the accent line only on the column being dragged', () => {
    renderResizable();
    const line = (name: string) => grip(name).firstElementChild as HTMLElement;
    expect(line('probe-alpha').style.background).toBe('transparent');
    drag('probe-alpha', 10);
    expect(line('probe-alpha').style.background).toBe('var(--color-accent-500)');
    expect(line('probe-bravo').style.background).toBe('transparent');
    fireEvent.mouseUp(window);
  });
});
