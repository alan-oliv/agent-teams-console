import { describe, expect, it } from 'vitest';
import { DIFF_LINES_CAP, DIFF_LINE_TEXT_CAP } from './domain';
import type { Agent, Diff, MailMessage, Marker, Task, TranscriptLine } from './domain';

describe('domain contract', () => {
  it('types a transcript line with a marker from the pinned union', () => {
    const line: TranscriptLine = {
      id: 'd2908088-b2ed-4344-bb3c-ee08e9366306#0',
      marker: '❯',
      text: 'probe-alpha done',
      ts: 1787843382986,
    };
    expect(line.marker).toBe('❯');
    expect(line.ts).toBe(1787843382986);
  });

  it('types the lead agent from config-4-members.json with no colour', () => {
    const lead: Agent = {
      name: 'team-lead',
      agentId: 'team-lead@session-98b0b4a7',
      isLead: true,
      agentType: 'team-lead',
      model: 'claude-opus-5',
      role: '',
      status: 'working',
      contextTokens: 0,
      contextLimit: 1_000_000,
      compactAt: 967_000,
      costUsd: 0,
      startedAt: 1787798107581,
      transcript: [],
      unread: 0,
    };
    expect(lead.isLead).toBe(true);
    expect(lead.color).toBeUndefined();
    expect(lead.agentType).toBe('team-lead');
    expect(lead.compactAt).toBe(967_000);
  });

  it('types a mail message and a task with the pinned field names', () => {
    const mail: MailMessage = {
      msgId: '4a236089-e8f5-4688-bca2-e47c6f0d8310',
      from: 'probe-alpha',
      to: 'team-lead',
      text: 'probe-alpha reporting: I claimed task 1. This is spike traffic.',
      summary: 'probe-alpha claimed task 1',
      ts: 1787843417891,
      tsIsDelivery: false,
      read: true,
      color: 'blue',
    };
    const task: Task = {
      id: '1',
      subject: 'SPIKE probe A — report your identity',
      description: 'Throwaway spike task.',
      activeForm: 'Probing identity A',
      owner: 'probe-alpha',
      state: 'in_progress',
      blocks: [],
      blockedBy: [],
    };
    expect(mail.tsIsDelivery).toBe(false);
    expect(task.state).toBe('in_progress');
    expect(task.owner).toBe('probe-alpha');
  });

  it('types a task carrying its creation-time metadata, model as a tier name', () => {
    const task: Task = {
      id: '2',
      subject: 'Add the diff payload to the shared domain model',
      description: 'Add an optional diff field to TranscriptLine.',
      owner: 'domain',
      state: 'completed',
      blocks: ['3', '4'],
      blockedBy: [],
      metadata: {
        complexity: 'judgment',
        model: 'opus',
        effort: 'high',
        why: 'defines the shape #3, #4 and #6 all consume',
      },
    };
    expect(task.metadata?.model).toBe('opus');
    expect(task.metadata?.complexity).toBe('judgment');
  });

  it('leaves metadata undefined on a task from a session that never set it', () => {
    const task: Task = {
      id: '3',
      subject: 'no metadata',
      description: '',
      state: 'pending',
      blocks: [],
      blockedBy: [],
    };
    expect(task.metadata).toBeUndefined();
  });

  it('pins the nine transcript markers', () => {
    const markers: Marker[] = ['❯', '⏺', '⎿', '✓', '✗', '+', '!', '▲', '○'];
    expect(markers).toHaveLength(9);
  });

  it('types a transcript line carrying the prototype diff', () => {
    const line: TranscriptLine = {
      id: 'd2908088-b2ed-4344-bb3c-ee08e9366306#4',
      marker: '⎿',
      text: 'Updated src/web/state/useTeamState.ts with 14 additions and 2 removals',
      ts: 1787843382986,
      diff: {
        path: 'src/web/state/useTeamState.ts',
        added: 14,
        removed: 2,
        agent: 'lead',
        ts: 1787843382986,
        commit: '9be5ee0',
        hunks: [
          {
            header: '@@ -146,10 +146,24 @@ export function useTeamState(',
            lines: [
              { sign: ' ', oldLineNo: 146, newLineNo: 146, text: '  const [selected, setAgent] = useState<string | null>(initial.agent);' },
              { sign: '-', oldLineNo: 149, newLineNo: null, text: '  const [widths, setWidths] = useState<Record<string, number>>({});' },
              { sign: '+', oldLineNo: null, newLineNo: 149, text: '  const [widths, setWidths] = useState<Record<string, number>>(readWidths);' },
            ],
          },
        ],
      },
    };
    const [context, removed, added] = line.diff!.hunks[0].lines;
    expect(context.sign).toBe(' ');
    expect(removed.newLineNo).toBeNull();
    expect(added.oldLineNo).toBeNull();
    expect(line.diff!.hunks[0].header).toMatch(/^@@ /);
  });

  it('types a diff whose commit is not knowable yet', () => {
    const uncommitted: Diff = {
      path: 'src/shared/domain.ts',
      added: 1,
      removed: 0,
      agent: 'domain',
      ts: 1787843382986,
      hunks: [
        {
          header: '@@ -7,4 +7,5 @@',
          lines: [{ sign: '+', oldLineNo: null, newLineNo: 11, text: '  diff?: Diff;' }],
        },
      ],
    };
    expect(uncommitted.commit).toBeUndefined();
    expect(uncommitted.truncated).toBeUndefined();
  });

  it('keeps the full counts on a diff whose hunks were cut by the cap', () => {
    const big: Diff = {
      path: 'package-lock.json',
      added: 4200,
      removed: 3100,
      agent: 'lead',
      ts: 1787843382986,
      truncated: true,
      hunks: [
        {
          header: '@@ -1,4 +1,4 @@',
          lines: [{ sign: '+', oldLineNo: null, newLineNo: 1, text: '{' }],
        },
      ],
    };
    const shipped = big.hunks.reduce((n, h) => n + h.lines.length, 0);
    expect(shipped).toBeLessThan(big.added + big.removed);
    expect(big.truncated).toBe(true);
  });

  it('bounds one diff payload well under the worst transcript line the feed already ships', () => {
    expect(DIFF_LINES_CAP * DIFF_LINE_TEXT_CAP).toBeLessThanOrEqual(64_000);
  });
});
