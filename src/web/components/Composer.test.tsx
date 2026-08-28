// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fixtureAgents } from '../agents.fixture';
import { Composer } from './Composer';

const agents = fixtureAgents();
const alpha = agents.find((a) => a.name === 'probe-alpha')!;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ msgId: 'stub' }) }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Composer', () => {
  it('posts to the teammate message endpoint on ⌘⏎', async () => {
    render(<Composer agent={alpha} variant="wall" />);
    const input = screen.getByTestId('composer-input');
    fireEvent.change(input, { target: { value: 'stop after task 1' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/agents/probe-alpha/message');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ text: 'stop after task 1' });
  });

  it('clears the input once the send is accepted', async () => {
    render(<Composer agent={alpha} variant="wall" />);
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'stop after task 1' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('does not send on a plain Enter', () => {
    render(<Composer agent={alpha} variant="wall" />);
    const input = screen.getByTestId('composer-input');
    fireEvent.change(input, { target: { value: 'stop after task 1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send an empty message', () => {
    render(<Composer agent={alpha} variant="wall" />);
    fireEvent.keyDown(screen.getByTestId('composer-input'), { key: 'Enter', metaKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the ⌘⏎ hint in the wall variant and the placeholder names the teammate', () => {
    render(<Composer agent={alpha} variant="wall" />);
    expect(screen.getByTestId('composer-input')).toHaveProperty('placeholder', 'message probe-alpha');
    expect(screen.getByText('⌘⏎')).toBeTruthy();
    expect(screen.queryByTestId('composer-caret')).toBeNull();
  });

  it('disables the composer for a departed agent and refuses to send', () => {
    const departedAgent = { ...alpha, status: 'departed' as const };
    render(<Composer agent={departedAgent} variant="wall" />);
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);

    fireEvent.change(input, { target: { value: 'stop after task 1' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disables the composer in read-only mode and says why', () => {
    // Without this the textarea looks live, ⌘⏎ fires, the server 409s and the
    // text just sits there with no error shown.
    render(<Composer agent={alpha} variant="wall" readOnly />);
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe('read-only — control routes are disabled');

    fireEvent.change(input, { target: { value: 'stop after task 1' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the blinking caret and the current tool in the rail variant', () => {
    render(<Composer agent={alpha} variant="rail" />);
    const caret = screen.getByTestId('composer-caret');
    expect(caret.style.width).toBe('7px');
    expect(caret.style.height).toBe('15px');
    expect(screen.getByTestId('composer-tool').textContent).toBe('Bash(sleep 20)');
    expect(screen.getByTestId('composer-input')).toHaveProperty(
      'placeholder', 'message probe-alpha directly',
    );
  });
});
