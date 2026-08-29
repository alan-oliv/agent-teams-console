// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { MailMessage, Task } from '../../shared/domain';
import { Tasks } from './Tasks';

afterEach(cleanup);

// fixtures/tasks.json: task 1 was claimed and completed by probe-alpha; task 2 in
// its unclaimed pending snapshot.
const TASKS: Task[] = [
  {
    id: '1',
    subject: 'SPIKE probe A — report your identity',
    description:
      'Throwaway spike task. Claim this task with TaskUpdate (set owner to your own name and status to in_progress), then use SendMessage to send team-lead a one-line message saying which task you claimed. Then mark it completed. Do nothing else.',
    activeForm: 'Probing identity A',
    owner: 'probe-alpha',
    state: 'completed',
    blocks: [],
    blockedBy: [],
  },
  {
    id: '2',
    subject: 'SPIKE probe B — report your identity',
    description:
      'Throwaway spike task. Claim this task with TaskUpdate (set owner to your own name and status to in_progress), then use SendMessage to send team-lead a one-line message saying which task you claimed. Then mark it completed. Do nothing else.',
    activeForm: 'Probing identity B',
    state: 'pending',
    blocks: [],
    blockedBy: [],
  },
];

// fixtures/inbox-snapshots.json (sent times) plus the batched delivery time from
// fixtures/lead-transcript-teammate-frames.json for the backfilled frame.
const MAIL: MailMessage[] = [
  {
    msgId: '48ba3528-7a03-4d43-ab32-b3ef759ff2bd',
    from: 'probe-charlie',
    to: 'team-lead',
    text: 'probe-charlie reporting: running on a different model so the console can prove per-agent model resolution.',
    summary: 'probe-charlie alive',
    ts: Date.parse('2026-08-27T15:10:15.734Z'),
    tsIsDelivery: false,
    read: true,
    color: 'yellow',
  },
  {
    msgId: '4a236089-e8f5-4688-bca2-e47c6f0d8310',
    from: 'probe-alpha',
    to: 'team-lead',
    text: 'probe-alpha reporting: I claimed task 1. This is spike traffic.',
    summary: 'probe-alpha claimed task 1',
    ts: Date.parse('2026-08-27T15:10:17.891Z'),
    tsIsDelivery: false,
    read: true,
    color: 'blue',
  },
  {
    msgId: 'c6390c86-1b02-43f4-b8bb-0a58ef1afd66',
    from: 'probe-charlie',
    to: 'team-lead',
    text: '{"type":"idle_notification","from":"probe-charlie","timestamp":"2026-08-27T15:10:22.099Z","idleReason":"available"}',
    ts: Date.parse('2026-08-27T15:12:17.951Z'),
    tsIsDelivery: true,
    read: true,
    color: 'yellow',
    protocol: { type: 'idle_notification', data: { from: 'probe-charlie', idleReason: 'available' } },
  },
];

function renderTasks() {
  render(<Tasks tasks={TASKS} teamName="session-98b0b4a7" />);
}

// jsdom's CSSOM always serialises the `flex` shorthand back out in its
// longhand form, so `flex: '1'` round-trips as `'1 1 0%'` even though
// that's exactly what was set. Compare against the same round-trip instead
// of the literal keyword (see Portrait.test.tsx for the same workaround).
function domFlex(css: string): string {
  const probe = document.createElement('div');
  probe.style.flex = css;
  return probe.style.flex;
}

describe('Tasks — left pane', () => {
  it('uses the design column widths', () => {
    renderTasks();
    expect(screen.getByText('TASK').style.width).toBe('44px');
    expect(screen.getByText('DESCRIPTION').style.flex).toBe(domFlex('1'));
    expect(screen.getByText('STATE').style.width).toBe('92px');
    expect(screen.getByText('OWNER').style.width).toBe('80px');
    expect(screen.getByText('DEPENDS ON').style.width).toBe('88px');
  });

  it('renders each task as a hairline-bottomed row', () => {
    renderTasks();
    const rows = screen.getAllByTestId('task-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].style.padding).toBe('12px 16px');
    expect(rows[0].style.fontSize).toBe('11.5px');
    expect(rows[0].style.borderBottom).toBe('1px solid var(--row-hairline)');
  });

  // Top-aligned, unlike a stream: `tail` here pushed the first task 90-170px
  // down the pane and the last ones below the fold.
  it('scrolls on its own, reading top-down', () => {
    renderTasks();
    const list = screen.getAllByTestId('task-row')[0].parentElement!;
    expect(list.className).toBe('tscroll');
    expect(list.style.overflow).toBe('');
  });

  // The symptom this prevents: a lead that spawned teammates with the Agent
  // tool and never called TaskCreate leaves a genuinely empty list, and bare
  // column headers over a blank pane read as a console that failed to load.
  it('says so when the team never used the shared list', () => {
    render(<Tasks tasks={[]} teamName="session-98b0b4a7" />);
    expect(screen.getByTestId('tasks-empty').textContent).toBe(
      "no tasks \u2014 this team hasn't used the shared list",
    );
    expect(screen.queryAllByTestId('task-row')).toHaveLength(0);
  });

  it('shows the owner, or "unassigned" when nobody has claimed it', () => {
    renderTasks();
    const rows = screen.getAllByTestId('task-row');
    expect(within(rows[0]).getByTestId('task-owner').textContent).toBe('probe-alpha');
    expect(within(rows[1]).getByTestId('task-owner').textContent).toBe('unassigned');
  });

  it('shows the state glyph and label, and an em dash for no dependencies', () => {
    renderTasks();
    const rows = screen.getAllByTestId('task-row');
    expect(within(rows[0]).getByTestId('task-state').textContent).toBe('✓completed');
    expect(within(rows[1]).getByTestId('task-state').textContent).toBe('○pending');
    expect(within(rows[0]).getByTestId('task-deps').textContent).toBe('—');
  });

  it('names the on-disk task directory and the locking rule in the footer', () => {
    renderTasks();
    const footer = screen.getByTestId('tasks-footer');
    expect(within(footer).getByText('~/.claude/tasks/session-98b0b4a7/')).toBeTruthy();
    expect(
      within(footer).getByText('claiming is file-locked · completing a task unblocks its dependents'),
    ).toBeTruthy();
  });
});

