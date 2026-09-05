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

  // Enter used to insert a newline instead. In a one-row box that scrolled the
  // text out of sight with no ack, so typing a message and pressing Enter looked
  // exactly like the console doing nothing at all.
  it('sends on a plain Enter', () => {
    render(<Composer agent={alpha} variant="wall" />);
    const input = screen.getByTestId('composer-input');
    fireEvent.change(input, { target: { value: 'stop after task 1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/probe-alpha/message', expect.anything());
  });

  it('keeps Shift+Enter for a newline, so a multi-line message is still possible', () => {
    render(<Composer agent={alpha} variant="wall" />);
    const input = screen.getByTestId('composer-input');
    fireEvent.change(input, { target: { value: 'line one' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send an empty message', () => {
    render(<Composer agent={alpha} variant="wall" />);
    fireEvent.keyDown(screen.getByTestId('composer-input'), { key: 'Enter', metaKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the ⏎ hint in the wall variant and the placeholder names the teammate', () => {
    render(<Composer agent={alpha} variant="wall" />);
    expect(screen.getByTestId('composer-input')).toHaveProperty('placeholder', 'message probe-alpha');
    expect(screen.getByText('⏎')).toBeTruthy();
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

  // The box stays where it was — it is disabled, not taken away — so it has to
  // say why, or a prompt still reading "message the team" invites a message
  // nothing is left to collect.
  it('says nobody is left to read it rather than keeping its prompt', () => {
    const gone = { ...alpha, status: 'departed' as const };
    render(<Composer agent={gone} alsoTo={[{ ...gone, name: 'probe-bravo' }]} variant="everyone" />);
    expect(screen.getByTestId('composer-input')).toHaveProperty(
      'placeholder', 'nobody is left to read it',
    );
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

describe('Composer delivery honesty', () => {
  const lead = { ...alpha, name: 'team-lead', isLead: true, status: 'working' as const };

  it('wears the canvas prompt line, still usable, when no teammate is live', () => {
    render(<Composer agent={lead} variant="wall" teamLive={false} />);
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
    // Canvas 8b's line — the hint stops naming a team-lead the session does
    // not have (ruling 34).
    expect(input.placeholder).toBe('esc to interrupt · takes its subagents with it');
    // Queueing is real: the message is delivered once a team comes up, so the
    // composer stays usable rather than pretending it is broken.
    expect(input.disabled).toBe(false);
  });

  it('names the lead plainly once a teammate is live', () => {
    render(<Composer agent={lead} variant="wall" teamLive />);
    expect((screen.getByTestId('composer-input') as HTMLTextAreaElement).placeholder).toBe(
      'message team-lead',
    );
  });

  it('leaves a teammate composer alone — its own inbox reader delivers it', () => {
    render(<Composer agent={{ ...alpha, status: 'working' }} variant="wall" teamLive={false} />);
    expect((screen.getByTestId('composer-input') as HTMLTextAreaElement).placeholder).toBe(
      'message probe-alpha',
    );
  });
});

describe('Composer send acknowledgement', () => {
  const live = { ...alpha, status: 'working' as const };
  const lead = { ...alpha, name: 'team-lead', isLead: true, status: 'working' as const };
  const ack = () => screen.queryByTestId('composer-ack')?.textContent;

  async function type(el: HTMLElement, value: string) {
    fireEvent.change(el, { target: { value } });
    fireEvent.keyDown(el, { key: 'Enter', metaKey: true });
  }

  it('says nothing until something is sent', () => {
    render(<Composer agent={live} variant="wall" />);
    expect(ack()).toBeUndefined();
  });

  it('confirms a message to a live teammate as sent', async () => {
    render(<Composer agent={live} variant="wall" teamLive />);
    await type(screen.getByTestId('composer-input'), 'hello');
    await waitFor(() => expect(ack()).toBe('sent'));
  });

  it('says queued when the lead has no teammate to drain its inbox', async () => {
    render(<Composer agent={lead} variant="wall" teamLive={false} />);
    await type(screen.getByTestId('composer-input'), 'hello');
    await waitFor(() => expect(ack()).toBe('queued'));
  });

  it('says so when the send is refused, and keeps the text to retry', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({}) });
    render(<Composer agent={live} variant="wall" teamLive />);
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
    await type(input, 'hello');
    await waitFor(() => expect(ack()).toBe('not sent'));
    expect(input.value).toBe('hello');
  });
});
