// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ViewId } from '../../shared/domain';
import { useKeyboard, type KeyboardActions } from './useKeyboard';

afterEach(cleanup);

// The wall column order for the captured spike team.
const AGENTS = ['team-lead', 'probe-alpha', 'probe-bravo', 'probe-charlie'];

let actions: KeyboardActions;

function Harness({ actions: a }: { actions: KeyboardActions }) {
  useKeyboard(a);
  return (
    <>
      <textarea data-testid="composer" />
      {/* Stands in for the rail's listbox, which handles ↑↓⏎ itself. */}
      <div data-testid="listbox" tabIndex={0} onKeyDown={(e) => e.preventDefault()} />
    </>
  );
}

function mount(overrides: Partial<KeyboardActions> = {}) {
  actions = {
    agents: AGENTS,
    view: 'wall' as ViewId,
    focused: 'probe-alpha',
    setFocused: vi.fn(),
    setView: vi.fn(),
    interrupt: vi.fn(),
    stop: vi.fn(),
    toggleTeams: vi.fn(),
    ...overrides,
  };
  render(<Harness actions={actions} />);
  return actions;
}

beforeEach(() => vi.clearAllMocks());

describe('useKeyboard — wall navigation', () => {
  it('l jumps to the next column', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'l' });
    expect(actions.setFocused).toHaveBeenCalledWith('probe-bravo');
  });

  it('h jumps to the previous column', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'h' });
    expect(actions.setFocused).toHaveBeenCalledWith('team-lead');
  });

  it('↑ and ↓ select, which is what the panel legend advertises', () => {
    // The legend said "↑↓ select · ⏎ open" while only h/l were bound, so the
    // two gestures a new operator tries first did nothing in four of five views.
    mount();
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(actions.setFocused).toHaveBeenCalledWith('probe-bravo');

    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    expect(actions.setFocused).toHaveBeenCalledWith('team-lead');
  });

  it('⏎ opens the focused agent in the rail, the single-agent detail view', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(actions.setView).toHaveBeenCalledWith('rail');
  });

  it('leaves a key a view already handled alone', () => {
    // The rail's own listbox handles ↑↓⏎ and calls preventDefault; without this
    // the cursor and the focus would both move on one press.
    mount();
    fireEvent.keyDown(screen.getByTestId('listbox'), { key: 'ArrowDown' });
    expect(actions.setFocused).not.toHaveBeenCalled();
  });

  it('clamps at both ends of the wall', () => {
    mount({ focused: 'team-lead' });
    fireEvent.keyDown(document.body, { key: 'h' });
    expect(actions.setFocused).toHaveBeenCalledWith('team-lead');
    vi.clearAllMocks();
    cleanup();

    mount({ focused: 'probe-charlie' });
    fireEvent.keyDown(document.body, { key: 'l' });
    expect(actions.setFocused).toHaveBeenCalledWith('probe-charlie');
  });
});

describe('useKeyboard — view switching', () => {
  it('⌘1-7 select the seven views in switcher order', () => {
    mount();
    for (const [key, view] of [
      ['1', 'wall'], ['2', 'overview'], ['3', 'comms'], ['4', 'tasks'], ['5', 'rail'], ['6', 'grid'], ['7', 'usage'],
    ] as Array<[string, ViewId]>) {
      fireEvent.keyDown(document.body, { key, metaKey: true });
      expect(actions.setView).toHaveBeenCalledWith(view);
    }
    expect(actions.setView).toHaveBeenCalledTimes(7);
  });

  it('⌘8 is not a view', () => {
    mount();
    fireEvent.keyDown(document.body, { key: '8', metaKey: true });
    expect(actions.setView).not.toHaveBeenCalled();
  });

  it('⌃T opens the tasks view and toggles back to the wall', () => {
    mount({ view: 'wall' });
    fireEvent.keyDown(document.body, { key: 't', ctrlKey: true });
    expect(actions.setView).toHaveBeenCalledWith('tasks');
    cleanup();

    mount({ view: 'tasks' });
    fireEvent.keyDown(document.body, { key: 't', ctrlKey: true });
    expect(actions.setView).toHaveBeenCalledWith('wall');
  });
});

describe('useKeyboard — team switching', () => {
  it('t toggles the team list', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 't' });
    expect(actions.toggleTeams).toHaveBeenCalledTimes(1);
    expect(actions.setView).not.toHaveBeenCalled();
    expect(actions.stop).not.toHaveBeenCalled();
  });

  it('t works with no agent focused — a switch is not a per-agent action', () => {
    mount({ focused: null });
    fireEvent.keyDown(document.body, { key: 't' });
    expect(actions.toggleTeams).toHaveBeenCalledTimes(1);
  });

  it('leaves t alone inside the composer', () => {
    mount();
    const composer = screen.getByTestId('composer');
    composer.focus();
    fireEvent.keyDown(composer, { key: 't' });
    expect(actions.toggleTeams).not.toHaveBeenCalled();
  });

  it('leaves a t the popover already handled alone', () => {
    mount();
    fireEvent.keyDown(screen.getByTestId('listbox'), { key: 't' });
    expect(actions.toggleTeams).not.toHaveBeenCalled();
  });
});

describe('useKeyboard — per-agent control', () => {
  it('Esc interrupts the focused teammate', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(actions.interrupt).toHaveBeenCalledWith('probe-alpha');
  });

  it('x stops the focused teammate', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'x' });
    expect(actions.stop).toHaveBeenCalledWith('probe-alpha');
  });

  it('does nothing when no agent is focused', () => {
    mount({ focused: null });
    fireEvent.keyDown(document.body, { key: 'x' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(actions.stop).not.toHaveBeenCalled();
    expect(actions.interrupt).not.toHaveBeenCalled();
  });
});

describe('useKeyboard — composer scoping', () => {
  it('does not stop the agent when x is typed into the composer', () => {
    mount();
    const composer = screen.getByTestId('composer');
    composer.focus();
    fireEvent.keyDown(composer, { key: 'x' });
    expect(actions.stop).not.toHaveBeenCalled();
  });

  it('leaves h, l and Esc alone inside the composer', () => {
    mount();
    const composer = screen.getByTestId('composer');
    composer.focus();
    fireEvent.keyDown(composer, { key: 'h' });
    fireEvent.keyDown(composer, { key: 'l' });
    fireEvent.keyDown(composer, { key: 'Escape' });
    expect(actions.setFocused).not.toHaveBeenCalled();
    expect(actions.interrupt).not.toHaveBeenCalled();
  });

  it('leaves ⌘1-5 and ⌃T alone inside the composer', () => {
    mount();
    const composer = screen.getByTestId('composer');
    composer.focus();
    fireEvent.keyDown(composer, { key: '3', metaKey: true });
    fireEvent.keyDown(composer, { key: 't', ctrlKey: true });
    expect(actions.setView).not.toHaveBeenCalled();
  });

  it('still fires when focus is outside any editable element', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'x' });
    expect(actions.stop).toHaveBeenCalledTimes(1);
  });
});

// The diff modal owns the keyboard while it is open. Without this the wall's
// own bindings fire underneath it: Esc interrupts the focused agent instead of
// closing the patch, and j/k/↑↓ move a selection nobody can see.
describe('useKeyboard — suspended behind a modal', () => {
  it('drops every wall binding while suspended', () => {
    mount({ suspended: true });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    fireEvent.keyDown(document.body, { key: 'l' });
    fireEvent.keyDown(document.body, { key: 'x' });
    fireEvent.keyDown(document.body, { key: 't' });
    fireEvent.keyDown(document.body, { key: '2', metaKey: true });
    expect(actions.interrupt).not.toHaveBeenCalled();
    expect(actions.setFocused).not.toHaveBeenCalled();
    expect(actions.stop).not.toHaveBeenCalled();
    expect(actions.toggleTeams).not.toHaveBeenCalled();
    expect(actions.setView).not.toHaveBeenCalled();
  });

  it('hands the bindings back when the modal closes', () => {
    mount({ suspended: false });
    fireEvent.keyDown(document.body, { key: 'x' });
    expect(actions.stop).toHaveBeenCalledTimes(1);
  });

  it('treats an absent flag as not suspended, so the wall keeps working', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'l' });
    expect(actions.setFocused).toHaveBeenCalledWith('probe-bravo');
  });
});
