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
  return <textarea data-testid="composer" />;
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
  it('⌘1-5 select the five views in switcher order', () => {
    mount();
    for (const [key, view] of [
      ['1', 'wall'], ['2', 'overview'], ['3', 'tasks'], ['4', 'rail'], ['5', 'grid'],
    ] as Array<[string, ViewId]>) {
      fireEvent.keyDown(document.body, { key, metaKey: true });
      expect(actions.setView).toHaveBeenCalledWith(view);
    }
    expect(actions.setView).toHaveBeenCalledTimes(5);
  });

  it('⌘6 is not a view', () => {
    mount();
    fireEvent.keyDown(document.body, { key: '6', metaKey: true });
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
