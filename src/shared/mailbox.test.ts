import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  mergeMail,
  parseInboxEntry,
  parseTeammateFrames,
  splitTeammateDelivery,
  unwrapTeammateFrames,
  type InboxEntry,
} from './mailbox';

const snapshots = JSON.parse(
  readFileSync(new URL('../../fixtures/inbox-snapshots.json', import.meta.url), 'utf8'),
) as Array<{ path: string; observedAt: number; entries: InboxEntry[] }>;

const frames = (
  JSON.parse(
    readFileSync(new URL('../../fixtures/lead-transcript-teammate-frames.json', import.meta.url), 'utf8'),
  ) as Array<{ timestamp: string; frames: string[] }>
).flatMap((f) => f.frames);

const leadEntries = snapshots.filter((s) => s.path === 'team-lead.json').flatMap((s) => s.entries);
const alphaEntries = snapshots.filter((s) => s.path === 'probe-alpha.json').flatMap((s) => s.entries);

const DELIVERED_AT = 1787843537951; // 2026-08-27T15:12:17.951Z — the delivery batch

describe('parseInboxEntry', () => {
  it('parses a plain message with its real send time', () => {
    const charlie = leadEntries.find((e) => e.msg_id === '48ba3528-7a03-4d43-ab32-b3ef759ff2bd')!;
    expect(parseInboxEntry(charlie, 'team-lead')).toEqual({
      msgId: '48ba3528-7a03-4d43-ab32-b3ef759ff2bd',
      from: 'probe-charlie',
      to: 'team-lead',
      text: 'probe-charlie reporting: running on a different model so the console can prove per-agent model resolution.',
      summary: 'probe-charlie alive',
      ts: 1787843415734,
      tsIsDelivery: false,
      read: false,
      color: 'yellow',
      protocol: undefined,
    });
  });

  it('detects a task_assignment protocol frame riding inside text', () => {
    const assignment = alphaEntries.find((e) => e.msg_id === '45142e72-ccf0-493d-951c-900d73d989ec')!;
    const mail = parseInboxEntry(assignment, 'probe-alpha');
    expect(mail.protocol?.type).toBe('task_assignment');
    expect(mail.protocol?.data.taskId).toBe('1');
    expect(mail.protocol?.data.assignedBy).toBe('probe-alpha');
    expect(mail.ts).toBe(1787843399360);
    expect(mail.tsIsDelivery).toBe(false);
  });

  it('detects an idle_notification protocol frame', () => {
    const idle = leadEntries.find((e) => e.msg_id === 'c6390c86-1b02-43f4-b8bb-0a58ef1afd66')!;
    const mail = parseInboxEntry(idle, 'team-lead');
    expect(mail.protocol?.type).toBe('idle_notification');
    expect(mail.protocol?.data.idleReason).toBe('available');
    expect(mail.from).toBe('probe-charlie');
  });

  it('synthesises a stable id when the entry carries no msg_id', () => {
    const entry: InboxEntry = {
      from: 'probe-bravo',
      text: 'no id on this one',
      timestamp: '2026-08-27T15:10:27.630Z',
    };
    const a = parseInboxEntry(entry, 'team-lead');
    const b = parseInboxEntry(entry, 'team-lead');
    expect(a.msgId).toBe(b.msgId);
    expect(a.msgId.startsWith('bk-')).toBe(true);
  });
});

describe('parseTeammateFrames', () => {
  it('recovers all six real frames from the lead transcript', () => {
    const recovered = parseTeammateFrames(frames.join('\n'), DELIVERED_AT, 'team-lead');
    expect(recovered).toHaveLength(6);
    expect(recovered.map((m) => m.from)).toEqual([
      'probe-charlie', 'probe-alpha', 'probe-charlie', 'probe-bravo', 'probe-alpha', 'probe-bravo',
    ]);
    expect(recovered.every((m) => m.tsIsDelivery)).toBe(true);
    expect(recovered.every((m) => m.ts === DELIVERED_AT)).toBe(true);
    expect(recovered.every((m) => m.to === 'team-lead')).toBe(true);
  });

  it('recovers from, color, summary and body', () => {
    const recovered = parseTeammateFrames(frames.join('\n'), DELIVERED_AT, 'team-lead');
    expect(recovered[1]).toEqual({
      msgId: recovered[1].msgId,
      from: 'probe-alpha',
      to: 'team-lead',
      text: 'probe-alpha reporting: I claimed task 1. This is spike traffic.',
      summary: 'probe-alpha claimed task 1',
      ts: DELIVERED_AT,
      tsIsDelivery: true,
      read: true,
      color: 'blue',
      protocol: undefined,
    });
    expect(recovered[1].msgId.startsWith('bk-')).toBe(true);
  });

  it('handles a frame with no summary attribute and reads its protocol frame', () => {
    const recovered = parseTeammateFrames(frames.join('\n'), DELIVERED_AT, 'team-lead');
    expect(recovered[2].summary).toBeUndefined();
    expect(recovered[2].color).toBe('yellow');
    expect(recovered[2].protocol?.type).toBe('idle_notification');
  });

  it('is idempotent — re-parsing the same text yields the same ids', () => {
    const a = parseTeammateFrames(frames.join('\n'), DELIVERED_AT, 'team-lead');
    const b = parseTeammateFrames(frames.join('\n'), DELIVERED_AT, 'team-lead');
    expect(a.map((m) => m.msgId)).toEqual(b.map((m) => m.msgId));
  });

  it('returns an empty array when there is no frame', () => {
    expect(parseTeammateFrames('just prose', DELIVERED_AT, 'team-lead')).toEqual([]);
  });
});

describe('unwrapTeammateFrames', () => {
  it('leaves the bodies and the prose around them', () => {
    const text = `Another Claude session sent a message:\n${frames[0]}\n\n${frames[1]}\n\nover to you.`;
    expect(unwrapTeammateFrames(text)).toBe(
      [
        'Another Claude session sent a message:',
        'probe-charlie reporting: running on a different model so the console can prove per-agent model resolution.',
        '',
        'probe-alpha reporting: I claimed task 1. This is spike traffic.',
        '',
        'over to you.',
      ].join('\n'),
    );
  });

  it('leaves text carrying no frame alone', () => {
    expect(unwrapTeammateFrames('just a sentence')).toBe('just a sentence');
  });
});

describe('splitTeammateDelivery', () => {
  // A record is not a message: the real lead delivery at 15:12:17.951Z carries
  // six frames from three teammates, because a lead's queued mail all drains at
  // one turn boundary. Attribution therefore belongs to the part, not the row
  // the record used to collapse into.
  it('separates each delivered message from the prose around it', () => {
    const text = `Another Claude session sent a message:\n${frames[0]}\n\n${frames[1]}\n\nover to you.`;
    expect(splitTeammateDelivery(text)).toEqual([
      { text: 'Another Claude session sent a message:\n' },
      {
        from: 'probe-charlie',
        text: 'probe-charlie reporting: running on a different model so the console can prove per-agent model resolution.',
      },
      { text: '\n\n' },
      { from: 'probe-alpha', text: 'probe-alpha reporting: I claimed task 1. This is spike traffic.' },
      { text: '\n\nover to you.' },
    ]);
  });

  it('attributes every frame of the real six-frame delivery', () => {
    const parts = splitTeammateDelivery(`mail:\n${frames.join('\n\n')}`);
    expect(parts.filter((p) => p.from !== undefined).map((p) => p.from)).toEqual([
      'probe-charlie', 'probe-alpha', 'probe-charlie', 'probe-bravo', 'probe-alpha', 'probe-bravo',
    ]);
  });

  it('reports a bare frame as one attributed part, with no prose around it', () => {
    expect(splitTeammateDelivery(frames[0])).toEqual([
      {
        from: 'probe-charlie',
        text: 'probe-charlie reporting: running on a different model so the console can prove per-agent model resolution.',
      },
    ]);
  });

  it('reports text carrying no frame as a single unattributed part', () => {
    expect(splitTeammateDelivery('just a sentence')).toEqual([{ text: 'just a sentence' }]);
  });

  it('rejoins to exactly what unwrapTeammateFrames produces', () => {
    const text = `preamble\n${frames[2]}\n\n${frames[3]}\ntail`;
    expect(splitTeammateDelivery(text).map((p) => p.text).join('')).toBe(unwrapTeammateFrames(text));
  });
});

describe('mergeMail', () => {
  it('merges the six inbox entries with the six backfill frames into six messages', () => {
    const inbox = leadEntries.map((e) => parseInboxEntry(e, 'team-lead'));
    const backfill = parseTeammateFrames(frames.join('\n'), DELIVERED_AT, 'team-lead');
    expect(inbox).toHaveLength(6);
    expect(backfill).toHaveLength(6);

    const merged = mergeMail(inbox, backfill);
    expect(merged).toHaveLength(6);
    expect(merged.every((m) => m.tsIsDelivery === false)).toBe(true);
  });

  it('lets the true send time win over the delivery batch time regardless of order', () => {
    const inbox = leadEntries.map((e) => parseInboxEntry(e, 'team-lead'));
    const backfill = parseTeammateFrames(frames.join('\n'), DELIVERED_AT, 'team-lead');

    for (const merged of [mergeMail(inbox, backfill), mergeMail(backfill, inbox)]) {
      expect(merged).toHaveLength(6);
      expect(merged[0].msgId).toBe('48ba3528-7a03-4d43-ab32-b3ef759ff2bd');
      expect(merged[0].from).toBe('probe-charlie');
      expect(merged[0].ts).toBe(1787843415734);
      expect(merged[0].tsIsDelivery).toBe(false);
      expect(merged[5].msgId).toBe('179b39e6-3516-490f-91f6-3a49a458175d');
      expect(merged[5].ts).toBe(1787843452579);
    }
  });

  it('keeps backfill-only messages at the delivery time', () => {
    const backfill = parseTeammateFrames(frames.join('\n'), DELIVERED_AT, 'team-lead');
    const merged = mergeMail([], backfill);
    expect(merged).toHaveLength(6);
    expect(merged.every((m) => m.tsIsDelivery)).toBe(true);
    expect(merged.every((m) => m.ts === DELIVERED_AT)).toBe(true);
  });

  it('dedupes a repeated inbox snapshot by msgId', () => {
    const inbox = leadEntries.map((e) => parseInboxEntry(e, 'team-lead'));
    expect(mergeMail(inbox, inbox)).toHaveLength(6);
  });

  it('sorts the result by timestamp ascending', () => {
    const inbox = leadEntries.map((e) => parseInboxEntry(e, 'team-lead'));
    const merged = mergeMail([], inbox);
    const stamps = merged.map((m) => m.ts);
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    expect(stamps).toEqual([
      1787843415734, 1787843417891, 1787843422099, 1787843427630, 1787843450152, 1787843452579,
    ]);
  });
});
