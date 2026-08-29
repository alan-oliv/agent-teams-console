// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Agent } from '../../shared/domain';
import { StopButton, stopAffordance } from './StopButton';

afterEach(cleanup);

function agent(over: Partial<Agent> = {}): Agent {
  return {
    name: 'probe-alpha',
    agentId: 'probe-alpha@session-1',
    isLead: false,
    agentType: 'general-purpose',
    model: 'claude-opus-5',
    status: 'working',
    role: '',
    contextTokens: 0,
    contextLimit: 200000,
    startedAt: 0,
    costUsd: 0,
    transcript: [],
    unread: 0,
    ...over,
  } as Agent;
}

describe('stopAffordance', () => {
  it('offers a teammate a plain stop', () => {
    const a = stopAffordance(agent(), false);
    expect(a.glyph).toBe('✕');
    expect(a.title).toBe('stop this teammate');
  });

  // Teammates run inside the lead's session, so `⏻` is not "one more agent".
  it('tells the operator the lead takes the session with it', () => {
    const a = stopAffordance(agent({ name: 'team-lead', isLead: true }), false);
    expect(a.glyph).toBe('⏻');
    expect(a.title).toBe('end the session — the lead cannot be stopped on its own');
  });

  // The load-bearing one. A stop is a shutdown_request sitting in an inbox,
  // read at the agent's next turn boundary and refusable — the same delivery
  // model the comms view surfaces as `delivered · unread 34s`. Reporting the
  // agent as stopped while it is still working would be exactly that lie.
  it('says a stop is REQUESTED, not done, while the agent is still there', () => {
    const a = stopAffordance(agent(), true);
    expect(a.title).toBe('stop requested — it stops at its next turn boundary');
    expect(a.color).toBe('#d99e5c');
    expect(a.glyph).not.toBe('⊗');
  });

  // There is no external respawn path; the server asks the lead to do it.
  it('offers respawn only once the agent is really gone, and names who does it', () => {
    const a = stopAffordance(agent({ status: 'departed' }), true);
    expect(a.glyph).toBe('↻');
    expect(a.title).toBe('ask the lead to respawn this teammate');
  });
});

describe('StopButton', () => {
  it('does not let a stop click also focus the column it sits in', () => {
    let focused = false;
    let stopped = false;
    render(
      <div onClick={() => { focused = true; }}>
        <StopButton agent={agent()} requested={false} onClick={() => { stopped = true; }} />
      </div>,
    );
    screen.getByTestId('stop-button').click();
    expect(stopped).toBe(true);
    expect(focused).toBe(false);
  });

  it('is inert when disabled', () => {
    let stopped = false;
    render(<StopButton agent={agent()} requested={false} disabled onClick={() => { stopped = true; }} />);
    const button = screen.getByTestId('stop-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    button.click();
    expect(stopped).toBe(false);
  });
});
