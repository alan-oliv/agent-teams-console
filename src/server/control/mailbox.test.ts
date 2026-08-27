import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sendToInbox, setTeamsRoot } from './mailbox';
import type { InboxEntry } from '../../shared/mailbox';

const FIXTURES = path.resolve(process.cwd(), 'fixtures');
const TEAM = 'session-98b0b4a7';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let root: string;
let fixtureEntry: InboxEntry;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-'));
  await fs.mkdir(path.join(root, TEAM, 'inboxes'), { recursive: true });
  await fs.copyFile(
    path.join(FIXTURES, 'config-4-members.json'),
    path.join(root, TEAM, 'config.json'),
  );
  const snapshots = JSON.parse(
    await fs.readFile(path.join(FIXTURES, 'inbox-snapshots.json'), 'utf8'),
  ) as Array<{ path: string; entries: InboxEntry[] }>;
  fixtureEntry = snapshots[3].entries[0];
  setTeamsRoot(root);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const readInbox = async (name: string): Promise<InboxEntry[]> =>
  JSON.parse(await fs.readFile(path.join(root, TEAM, 'inboxes', `${name}.json`), 'utf8')) as InboxEntry[];

describe('sendToInbox', () => {
  it('writes the exact on-disk shape the fixture records', async () => {
    const { msgId } = await sendToInbox(TEAM, 'team-lead', {
      text: fixtureEntry.text,
      summary: fixtureEntry.summary,
      from: 'probe-alpha',
    });

    const entries = await readInbox('team-lead');
    expect(entries).toHaveLength(1);
    const written = entries[0];

    expect(Object.keys(written)).toEqual(Object.keys(fixtureEntry));
    expect(written.from).toBe('probe-alpha');
    expect(written.text).toBe('probe-alpha reporting: I claimed task 1. This is spike traffic.');
    expect(written.summary).toBe('probe-alpha claimed task 1');
    expect(written.color).toBe('blue');
    expect(written.msgV).toBe(1);
    expect(written.type).toBe('message');
    expect(written.read).toBe(false);
    expect(written.msg_id).toBe(msgId);
    expect(written.msg_id).toMatch(UUID);
    expect(Number.isNaN(Date.parse(written.timestamp))).toBe(false);
    expect(written.timestamp).toMatch(/Z$/);
  });

  it('defaults from to team-lead and omits colour the roster does not carry', async () => {
    await sendToInbox(TEAM, 'probe-charlie', { text: 'stand down' });
    const [written] = await readInbox('probe-charlie');
    expect(written.from).toBe('team-lead');
    expect(Object.keys(written)).toEqual(['from', 'text', 'timestamp', 'msgV', 'msg_id', 'type', 'read']);
  });

  it('appends to an existing pending queue without disturbing it', async () => {
    await fs.writeFile(
      path.join(root, TEAM, 'inboxes', 'team-lead.json'),
      JSON.stringify([fixtureEntry], null, 2),
    );
    const { msgId } = await sendToInbox(TEAM, 'team-lead', { text: 'second' });
    const entries = await readInbox('team-lead');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual(fixtureEntry);
    expect(entries[1].text).toBe('second');
    expect(entries[1].msg_id).toBe(msgId);
  });

  it('creates the inbox lazily and releases the lock', async () => {
    await sendToInbox('session-brand-new', 'probe-alpha', { text: 'hello' });
    const file = path.join(root, 'session-brand-new', 'inboxes', 'probe-alpha.json');
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toHaveLength(1);
    await expect(fs.stat(`${file}.lock`)).rejects.toThrow();
  });

  it('serialises two concurrent sends into two entries', async () => {
    await Promise.all([
      sendToInbox(TEAM, 'probe-bravo', { text: 'one' }),
      sendToInbox(TEAM, 'probe-bravo', { text: 'two' }),
    ]);
    const entries = await readInbox('probe-bravo');
    expect(entries.map((e) => e.text).sort()).toEqual(['one', 'two']);
  });

  it('loses no messages when many sends race to create the same brand-new inbox', async () => {
    // Regression for a TOCTOU bug: the inbox file used to be lazily created
    // with a plain fs.access + atomicWrite('[]') BEFORE the lock was taken,
    // so a concurrent creator could clobber an already-written entry with an
    // empty array. Firing many sends at a path that has never existed is the
    // shape of traffic that used to lose messages.
    const N = 8;
    await Promise.all(
      Array.from({ length: N }, (_, i) => sendToInbox(TEAM, 'probe-concurrent', { text: `msg-${i}` })),
    );
    const entries = await readInbox('probe-concurrent');
    expect(entries).toHaveLength(N);
    expect(new Set(entries.map((e) => e.text)).size).toBe(N);
  });
});
