import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TranscriptRecord } from './transcript';
import {
  buildSubagentTree,
  digestOf,
  emptySubagentFold,
  foldSubagentRecords,
  spawnsOf,
  SUBAGENT_SUMMARY_CAP,
  type SubagentFacts,
} from './subagents';

interface Fixture {
  parent: { agent: string; records: TranscriptRecord[] };
  subagents: Array<{
    agentId: string;
    meta: { name: string; agentType: string; model: string; description: string; toolUseId: string };
    records: TranscriptRecord[];
  }>;
}

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/subagent-tree.json', import.meta.url), 'utf8'),
) as Fixture;

const bySubagent = new Map(fixture.subagents.map((s) => [s.agentId, s]));
const scout = bySubagent.get('ascout-0011223344556677')!;
const grepper = bySubagent.get('agrepper-1122334455667788')!;
const auditor = bySubagent.get('aauditor-8899aabbccddeeff')!;

function digest(records: TranscriptRecord[]) {
  const fold = emptySubagentFold();
  foldSubagentRecords(fold, records);
  return digestOf(fold);
}

/** Every fixture subagent, joined by the toolUseId its sidecar carries. */
function facts(): Map<string, SubagentFacts> {
  return new Map(
    fixture.subagents.map((sub) => [
      sub.meta.toolUseId,
      { agentId: sub.agentId, meta: sub.meta, digest: digest(sub.records) },
    ]),
  );
}

const leadSpawns = () => spawnsOf(fixture.parent.records);

describe('spawnsOf', () => {
  it('reads all three calls of a fan-out in dispatch order', () => {
    expect(leadSpawns().map((s) => s.toolUseId)).toEqual([
      'toolu_scout',
      'toolu_auditor',
      'toolu_stray',
    ]);
  });

  it('gives one turn’s calls the same sibling group', () => {
    const groups = new Set(leadSpawns().map((s) => s.siblingGroup));
    expect(groups).toEqual(new Set(['fan-0000-0000-0000-000000000001']));
  });

  it('takes name, type and model off the call itself', () => {
    const [scoutCall, , stray] = leadSpawns();
    expect(scoutCall).toMatchObject({
      name: 'scout',
      description: 'Scout the ingest',
      agentType: 'general-purpose',
      model: 'sonnet',
      queuedAt: Date.parse('2026-08-30T03:28:50.000Z'),
    });
    // No `name` on the call: only what it did say survives.
    expect(stray.name).toBeUndefined();
    expect(stray.description).toBe('Chase the flaky watcher');
    expect(stray.agentType).toBe('Explore');
    expect(stray.model).toBeUndefined();
  });

  it('learns the agentId from an async launch without calling it a return', () => {
    // Only as far as the launches: a background launch answers at dispatch
    // time, and reading that as a return would finish every agent instantly.
    const atLaunch = spawnsOf(fixture.parent.records.slice(0, 4));
    expect(atLaunch.map((s) => s.agentId)).toEqual([
      'ascout-0011223344556677',
      'aauditor-8899aabbccddeeff',
      'a00112233445566778',
    ]);
    expect(atLaunch.every((s) => s.returnedAt === undefined)).toBe(true);
  });

  it('closes a background launch on its task-notification, in either record form', () => {
    const spawns = leadSpawns();
    // delivered as an ordinary user turn
    expect(spawns[1].returnedAt).toBe(Date.parse('2026-08-30T03:31:02.000Z'));
    expect(spawns[1].returnedSummary).toBe('Agent "Audit the store bounds" finished');
    // queued as an attachment, which carries no `message` at all
    expect(spawns[0].returnedAt).toBe(Date.parse('2026-08-30T03:33:20.000Z'));
    expect(spawns[0].returnedSummary).toBe('Agent "Scout the ingest" finished');
  });

  it('closes a synchronous call on its own tool_result', () => {
    expect(spawnsOf(scout.records)).toEqual([
      expect.objectContaining({
        toolUseId: 'toolu_scout_child',
        name: 'grepper',
        returnedAt: Date.parse('2026-08-30T03:30:10.000Z'),
        returnedSummary: 'watch/root.ts wraps fs.watch and debounces it.',
      }),
    ]);
  });

  it('marks a failed call rather than reporting it as returned', () => {
    const records: TranscriptRecord[] = [
      {
        type: 'assistant',
        uuid: 'a',
        timestamp: '2026-08-30T03:00:00.000Z',
        message: { content: [{ type: 'tool_use', id: 'toolu_x', name: 'Task', input: {} }] },
      },
      {
        type: 'user',
        uuid: 'b',
        timestamp: '2026-08-30T03:00:09.000Z',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_x', is_error: true, content: 'boom' },
          ],
        },
      },
    ];
    expect(spawnsOf(records)[0]).toMatchObject({ failed: true, returnedSummary: 'boom' });
  });

  it('ignores every tool that is not a subagent dispatch', () => {
    expect(spawnsOf(grepper.records)).toEqual([]);
  });

  // One `Agent` call spawns a teammate, launches a workflow run or dispatches a
  // subagent, and the call site is identical in all three — the shapes below are
  // the real toolUseResults those three take. A teammate has a roster row of its
  // own and a run has its own console mode, so either one left in this tree
  // would be a second, wrong copy of something already on screen.
  describe('a dispatch that turns out not to be a subagent', () => {
    const answered = (toolUseResult: Record<string, unknown>): TranscriptRecord[] => [
      {
        type: 'assistant',
        uuid: 'turn',
        timestamp: '2026-08-30T03:00:00.000Z',
        message: {
          content: [
            { type: 'tool_use', id: 'toolu_a', name: 'Agent', input: { name: 'kept' } },
            { type: 'tool_use', id: 'toolu_b', name: 'Agent', input: { name: 'dropped' } },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'answer',
        timestamp: '2026-08-30T03:00:01.000Z',
        toolUseResult,
        message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_b', content: 'ok' }] },
      },
    ];

    it('drops a teammate spawn', () => {
      const spawns = spawnsOf(
        answered({
          status: 'teammate_spawned',
          teammate_id: 'roast-battle@session-5a28f780',
          agent_id: 'roast-battle@session-5a28f780',
          name: 'roast-battle',
          team_name: 'session-5a28f780',
        }),
      );
      expect(spawns.map((s) => s.name)).toEqual(['kept']);
    });

    it('drops a workflow run', () => {
      const spawns = spawnsOf(
        answered({
          status: 'async_launched',
          taskType: 'local_workflow',
          runId: 'wf_920cc391-abe',
          workflowName: 'agent-teams-console-recon',
        }),
      );
      expect(spawns.map((s) => s.name)).toEqual(['kept']);
    });

    it('keeps an ordinary background subagent', () => {
      const spawns = spawnsOf(
        answered({
          isAsync: true,
          status: 'async_launched',
          agentId: 'a10431295a87e9bbd',
          resolvedModel: 'claude-sonnet-5',
        }),
      );
      expect(spawns.map((s) => s.name)).toEqual(['kept', 'dropped']);
    });

    it('renumbers the siblings it leaves behind', () => {
      const spawns = spawnsOf(
        answered({ status: 'teammate_spawned', teammate_id: 'mate@session-1' }),
      );
      const built = buildSubagentTree([{ agent: 'team-lead', spawns }], new Map());
      expect(built['team-lead'].map((s) => s.spawnIndex)).toEqual([0]);
    });
  });

  it('caps a returned summary', () => {
    const long = 'x'.repeat(SUBAGENT_SUMMARY_CAP * 2);
    const records: TranscriptRecord[] = [
      {
        type: 'assistant',
        uuid: 'a',
        timestamp: '2026-08-30T03:00:00.000Z',
        message: { content: [{ type: 'tool_use', id: 'toolu_x', name: 'Task', input: {} }] },
      },
      {
        type: 'user',
        uuid: 'b',
        timestamp: '2026-08-30T03:00:09.000Z',
        message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: long }] },
      },
    ];
    expect(spawnsOf(records)[0].returnedSummary).toHaveLength(SUBAGENT_SUMMARY_CAP);
  });
});

describe('foldSubagentRecords', () => {
  it('reads the whole file the same way as one chunk at a time', () => {
    const whole = digest(scout.records);
    const chunked = emptySubagentFold();
    for (const rec of scout.records) foldSubagentRecords(chunked, [rec]);
    expect(digestOf(chunked)).toEqual(whole);
  });

  it('counts records, tool calls and the span of its own transcript', () => {
    expect(digest(scout.records)).toMatchObject({
      records: 6,
      // Read, then the nested Task — both are tool calls this subagent made
      toolCalls: 2,
      startedAt: Date.parse('2026-08-30T03:28:52.000Z'),
      lastAt: Date.parse('2026-08-30T03:30:55.000Z'),
    });
  });

  it('bills only the tokens the subagent actually put through the model', () => {
    // input + output + cache_creation over its three assistant turns; cache
    // READS are the re-read prefix and are deliberately not summed.
    expect(digest(scout.records).tokens).toBe(5 + 300 + 1200 + (7 + 90 + 800) + (9 + 210 + 400));
  });

  it('reports context occupancy from its newest assistant turn', () => {
    expect(digest(scout.records).contextTokens).toBe(9 + 400 + 42000);
  });

  it('keeps the last thing it said as its summary', () => {
    expect(digest(scout.records).summary).toBe('The ingest attributes by sidecar, never by name.');
  });

  it('carries its own dispatches so a tree can nest them', () => {
    expect(digest(scout.records).spawns.map((s) => s.toolUseId)).toEqual(['toolu_scout_child']);
    expect(digest(grepper.records).spawns).toEqual([]);
  });

  it('is empty, not zeroed, for a subagent that has written nothing', () => {
    const empty = digestOf(emptySubagentFold());
    expect(empty).toMatchObject({ records: 0, tokens: 0, toolCalls: 0, contextTokens: 0 });
    expect(empty.startedAt).toBeUndefined();
    expect(empty.summary).toBeUndefined();
  });
});

describe('buildSubagentTree', () => {
  const tree = () => buildSubagentTree([{ agent: 'team-lead', spawns: leadSpawns() }], facts());

  it('keys the tree by the agent that dispatched, in spawn order', () => {
    expect(Object.keys(tree())).toEqual(['team-lead']);
    expect(tree()['team-lead'].map((s) => s.name)).toEqual([
      'scout',
      'auditor',
      'Chase the flaky watcher',
    ]);
    expect(tree()['team-lead'].map((s) => s.spawnIndex)).toEqual([0, 1, 2]);
  });

  it('groups a fan-out under one sibling group', () => {
    const groups = tree()['team-lead'].map((s) => s.siblingGroup);
    expect(new Set(groups).size).toBe(1);
  });

  it('splits calls made in different turns into different sibling groups', () => {
    const sequential: TranscriptRecord[] = [
      {
        type: 'assistant',
        uuid: 'turn-1',
        timestamp: '2026-08-30T03:00:00.000Z',
        message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Agent', input: {} }] },
      },
      {
        type: 'assistant',
        uuid: 'turn-2',
        timestamp: '2026-08-30T03:00:30.000Z',
        message: { content: [{ type: 'tool_use', id: 'toolu_2', name: 'Agent', input: {} }] },
      },
    ];
    const built = buildSubagentTree(
      [{ agent: 'team-lead', spawns: spawnsOf(sequential) }],
      new Map(),
    );
    expect(built['team-lead'].map((s) => s.siblingGroup)).toEqual(['turn-1', 'turn-2']);
  });

  it('nests a subagent’s own dispatch one level deeper', () => {
    const [scoutNode] = tree()['team-lead'];
    expect(scoutNode.depth).toBe(1);
    expect(scoutNode.parent).toBe('team-lead');
    expect(scoutNode.children.map((c) => c.name)).toEqual(['grepper']);
    const [child] = scoutNode.children;
    expect(child.depth).toBe(2);
    expect(child.parent).toBe('toolu_scout');
    // The subtree still knows which roster agent it hangs off.
    expect(child.agent).toBe('team-lead');
    expect(child.children).toEqual([]);
  });

  it('joins the sidecar and the subagent’s own transcript onto the call', () => {
    const [scoutNode] = tree()['team-lead'];
    expect(scoutNode).toMatchObject({
      toolUseId: 'toolu_scout',
      agentId: 'ascout-0011223344556677',
      agentType: 'general-purpose',
      model: 'sonnet',
      queuedAt: Date.parse('2026-08-30T03:28:50.000Z'),
      startedAt: Date.parse('2026-08-30T03:28:52.000Z'),
      returnedAt: Date.parse('2026-08-30T03:33:20.000Z'),
      toolCalls: 2,
      contextTokens: 9 + 400 + 42000,
      returnedSummary: 'Agent "Scout the ingest" finished',
      state: 'returned',
    });
    expect(scoutNode.durationMs).toBe(
      Date.parse('2026-08-30T03:33:20.000Z') - Date.parse('2026-08-30T03:28:52.000Z'),
    );
  });

  it('degrades to journal-only fields when the sidecar is missing', () => {
    const stray = tree()['team-lead'][2];
    expect(stray).toMatchObject({
      toolUseId: 'toolu_stray',
      // the lead's own journal still knows all of this
      name: 'Chase the flaky watcher',
      description: 'Chase the flaky watcher',
      agentType: 'Explore',
      agentId: 'a00112233445566778',
      queuedAt: Date.parse('2026-08-30T03:28:50.000Z'),
      depth: 1,
      spawnIndex: 2,
      state: 'queued',
    });
    // Everything only the sidecar or its own transcript could say is absent,
    // not defaulted — a zero here would read as "spent nothing".
    expect(stray.model).toBeUndefined();
    expect(stray.startedAt).toBeUndefined();
    expect(stray.tokens).toBeUndefined();
    expect(stray.toolCalls).toBeUndefined();
    expect(stray.contextTokens).toBeUndefined();
    expect(stray.durationMs).toBeUndefined();
    expect(stray.children).toEqual([]);
  });

  it('reads a subagent that is writing but has not been closed as running', () => {
    // The scout's own transcript exists, but strip the notification that closed
    // it and nothing proves it ever came back.
    const open = leadSpawns().map((s) =>
      s.toolUseId === 'toolu_scout' ? { ...s, returnedAt: undefined, returnedSummary: undefined } : s,
    );
    const built = buildSubagentTree([{ agent: 'team-lead', spawns: open }], facts());
    expect(built['team-lead'][0].state).toBe('running');
    expect(built['team-lead'][0].durationMs).toBeUndefined();
    // Its own transcript still bills, because that is measured, not inferred.
    expect(built['team-lead'][0].tokens).toBe(digest(scout.records).tokens);
  });

  it('reads a dispatch with a sidecar but no records yet as queued', () => {
    const unstarted = new Map<string, SubagentFacts>([
      ['toolu_scout', { agentId: scout.agentId, meta: scout.meta, digest: digest([]) }],
    ]);
    const open = leadSpawns()
      .slice(0, 1)
      .map((s) => ({ ...s, returnedAt: undefined, returnedSummary: undefined }));
    const built = buildSubagentTree([{ agent: 'team-lead', spawns: open }], unstarted);
    expect(built['team-lead'][0].state).toBe('queued');
    expect(built['team-lead'][0].tokens).toBeUndefined();
    // The sidecar still named it, which is why the row can be drawn at all.
    expect(built['team-lead'][0].name).toBe('scout');
  });

  it('marks a call the parent closed with an error as failed', () => {
    const failed = leadSpawns()
      .slice(1, 2)
      .map((s) => ({ ...s, failed: true }));
    const built = buildSubagentTree([{ agent: 'team-lead', spawns: failed }], facts());
    expect(built['team-lead'][0].state).toBe('failed');
  });

  it('leaves an agent that dispatched nothing out of the tree entirely', () => {
    expect(
      buildSubagentTree(
        [
          { agent: 'team-lead', spawns: leadSpawns() },
          { agent: 'quiet', spawns: [] },
        ],
        facts(),
      ),
    ).not.toHaveProperty('quiet');
  });

  it('survives a cycle rather than recursing forever', () => {
    const selfSpawn = spawnsOf([
      {
        type: 'assistant',
        uuid: 'loop',
        timestamp: '2026-08-30T03:00:00.000Z',
        message: { content: [{ type: 'tool_use', id: 'toolu_loop', name: 'Agent', input: {} }] },
      },
    ]);
    const looped = new Map<string, SubagentFacts>([
      ['toolu_loop', { digest: { ...digestOf(emptySubagentFold()), spawns: selfSpawn } }],
    ]);
    const built = buildSubagentTree([{ agent: 'team-lead', spawns: selfSpawn }], looped);
    expect(built['team-lead']).toHaveLength(1);
    expect(built['team-lead'][0].children).toEqual([]);
  });

  it('reads the auditor, which never dispatched anything, as a childless leaf', () => {
    const auditorNode = tree()['team-lead'][1];
    expect(auditorNode.children).toEqual([]);
    expect(auditorNode.tokens).toBe(digest(auditor.records).tokens);
  });
});

// The real notification a RESUMED session emits for agents it inherited. Four
// ids in one record, named by <task-id> with no <tool-use-id> at all — reading
// only the head left three of them `running`, with trace lifelines that ran to
// `now` for as long as the console stayed open. On a week-old session that is a
// week-long bar, four times over.
it('ends every agent a resumed session sweeps, not just the first', () => {
  const dispatch = (toolUseId: string, agentId: string): TranscriptRecord => ({
    type: 'assistant',
    uuid: `d-${toolUseId}`,
    timestamp: '2026-08-27T01:50:00.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: toolUseId, name: 'Agent', input: { description: agentId } },
      ],
    },
  });
  const launched = (toolUseId: string, agentId: string): TranscriptRecord => ({
    type: 'user',
    uuid: `l-${toolUseId}`,
    timestamp: '2026-08-27T01:50:01.000Z',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'launched' }],
    },
    toolUseResult: { status: 'async_launched', agentId },
  });
  const sweep: TranscriptRecord = {
    type: 'user',
    uuid: 'sweep',
    timestamp: '2026-09-03T22:47:39.075Z',
    message: {
      role: 'user',
      content:
        '<task-notification><task-id>aAAA</task-id><task-id>aBBB</task-id>' +
        '<status>stopped</status><summary>No completion record found</summary>' +
        '</task-notification>',
    },
  };

  const spawns = spawnsOf([
    dispatch('toolu_a', 'aAAA'),
    launched('toolu_a', 'aAAA'),
    dispatch('toolu_b', 'aBBB'),
    launched('toolu_b', 'aBBB'),
    sweep,
  ]);

  expect(spawns).toHaveLength(2);
  const stoppedAt = Date.parse('2026-09-03T22:47:39.075Z');
  for (const spawn of spawns) {
    expect(spawn.returnedAt).toBe(stoppedAt);
    // `stopped` is not `completed`, so it is reported rather than smoothed.
    expect(spawn.failed).toBe(true);
  }
});
