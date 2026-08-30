// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NeedsYouItem } from '../../shared/domain';
import { FIXTURE_NOW } from '../test/state-fixture';
import { buildCast } from '../../shared/cast';
import { CastContext } from '../state/useCast';
import { NeedsYou } from './NeedsYou';

// This suite renders once per `it`; without explicit cleanup the un-unmounted
// nodes from one test leak into the next and getByRole/getByText start
// matching more than one element.
afterEach(cleanup);

const PLAN: NeedsYouItem = {
  id: 'req-7f3',
  kind: 'plan',
  agent: 'probe-bravo',
  reason: 'plan approval',
  detail: '4 steps · step 4 drops migrations/legacy/',
};
const FAILURE: NeedsYouItem = {
  id: 'fail-1',
  kind: 'failure',
  agent: 'probe-charlie',
  reason: 'failed',
  detail: '529 overloaded_error',
};
const PERMISSION: NeedsYouItem = {
  id: 'permit-9',
  kind: 'permission',
  agent: 'probe-alpha',
  reason: 'permission',
  detail: 'Bash(rm -rf migrations/legacy)',
  expiresAt: FIXTURE_NOW + 90_000,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('labels the strip with the pending count in the attention colour', () => {
  render(<NeedsYou items={[PLAN, FAILURE, PERMISSION]} readOnly={false} now={FIXTURE_NOW} />);
  const label = screen.getByText('NEEDS YOU · 3');
  expect(label.style.color).toBe('var(--warn)');
  expect(label.style.fontSize).toBe('10.5px');
  expect(label.style.letterSpacing).toBe('.12em');
});

it('renders the three card kinds', () => {
  render(<NeedsYou items={[PLAN, FAILURE, PERMISSION]} readOnly={false} now={FIXTURE_NOW} />);
  expect(screen.getByText('probe-bravo · plan approval')).toBeTruthy();
  expect(screen.getByText('4 steps · step 4 drops migrations/legacy/')).toBeTruthy();
  expect(screen.getByText('probe-charlie · failed').style.color).toBe('var(--fail)');
  expect(screen.getByText('529 overloaded_error')).toBeTruthy();
  expect(screen.getByTestId('card-plan').style.border).toBe('1px solid var(--warn-edge)');
});

it('counts the permission hold down to expiresAt', () => {
  render(<NeedsYou items={[PERMISSION]} readOnly={false} now={FIXTURE_NOW} />);
  expect(screen.getByTestId('permit-countdown').textContent).toBe('90s');

  screen.getByTestId('permit-countdown').remove();
  render(<NeedsYou items={[PERMISSION]} readOnly={false} now={FIXTURE_NOW + 89_400} />);
  expect(screen.getByTestId('permit-countdown').textContent).toBe('1s');
});

it('POSTs approve to the plan endpoint', () => {
  render(<NeedsYou items={[PLAN]} readOnly={false} now={FIXTURE_NOW} />);
  fireEvent.click(screen.getByRole('button', { name: 'approve' }));
  expect(fetchMock).toHaveBeenCalledWith('/api/plans/req-7f3/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
});

it('POSTs the collected feedback on reject, and sends nothing when cancelled', () => {
  vi.spyOn(window, 'prompt').mockReturnValueOnce('step 4 is unsafe');
  render(<NeedsYou items={[PLAN]} readOnly={false} now={FIXTURE_NOW} />);
  fireEvent.click(screen.getByRole('button', { name: 'reject with feedback' }));
  expect(fetchMock).toHaveBeenCalledWith('/api/plans/req-7f3/reject', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ feedback: 'step 4 is unsafe' }),
  });

  vi.spyOn(window, 'prompt').mockReturnValueOnce(null);
  fireEvent.click(screen.getByRole('button', { name: 'reject with feedback' }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('POSTs respawn and permission decisions to their own endpoints', () => {
  render(<NeedsYou items={[FAILURE, PERMISSION]} readOnly={false} now={FIXTURE_NOW} />);
  fireEvent.click(screen.getByRole('button', { name: 'respawn' }));
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/agents/probe-charlie/respawn',
    expect.objectContaining({ method: 'POST' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'allow' }));
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/permits/permit-9/allow',
    expect.objectContaining({ method: 'POST' }),
  );
});

it('disables every button in read-only mode instead of failing on click', () => {
  render(<NeedsYou items={[PLAN, FAILURE, PERMISSION]} readOnly now={FIXTURE_NOW} />);
  const buttons = screen.getAllByRole('button');
  expect(buttons.length).toBeGreaterThan(0);
  for (const b of buttons) expect((b as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'approve' }));
  expect(fetchMock).not.toHaveBeenCalled();
});

it('stays mounted with an empty queue', () => {
  render(<NeedsYou items={[]} readOnly={false} now={FIXTURE_NOW} />);
  expect(screen.getByText('NEEDS YOU · 0')).toBeTruthy();
  expect(screen.getByText('nothing waiting')).toBeTruthy();
});

it('names the character on a card, and still answers on the real id', () => {
  const agents = [
    { name: 'team-lead', agentType: 'team-lead', isLead: true },
    { name: 'probe-bravo', agentType: 'Explore', isLead: false },
  ];
  render(
    <CastContext.Provider value={buildCast(agents, 'inception')}>
      <NeedsYou items={[PLAN]} readOnly={false} now={FIXTURE_NOW} />
    </CastContext.Provider>,
  );
  expect(screen.getByText('Saito · plan approval')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'approve' }));
  expect(fetchMock).toHaveBeenCalledWith('/api/plans/req-7f3/approve', expect.anything());
});
