import { describe, expect, it } from 'vitest';
import type { Agent, MailMessage, Marker, Task, TranscriptLine } from './domain';

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

  it('pins the nine transcript markers', () => {
    const markers: Marker[] = ['❯', '⏺', '⎿', '✓', '✗', '+', '!', '▲', '○'];
    expect(markers).toHaveLength(9);
  });
});
