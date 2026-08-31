import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StoredEvent, Store } from '../store';
import { foldWorkflows } from '../workflow';
import type { WorkflowUsagePayload } from '../../shared/workflow-usage';
import { createWorkflowUsageIngest, workflowAgentClaimOf } from './workflow-agents';

const FIXTURES = path.resolve(process.cwd(), 'fixtures');
const SLUG = '-Users-alanoliv-code-agents-team-ui';
const SESSION = '98b0b4a7-3206-455b-aaf6-a5a81ad1e283';
const RUN = 'wf_d36b25c0-f96';

const fixture = JSON.parse(
  readFileSync(path.join(FIXTURES, 'workflow-agent-usage.json'), 'utf8'),
) as { agents: Record<string, unknown[]> };

const pathFor = (agentId: string, session = SESSION) =>
  `/home/.claude/projects/${SLUG}/${session}/subagents/workflows/${RUN}/agent-${agentId}.jsonl`;

const linesOf = (agentId: string) => fixture.agents[agentId].map((r) => JSON.stringify(r));

/** A store that only records what was appended — nothing here reads it back. */
function spyStore(): { store: Store; events: StoredEvent[] } {
  const events: StoredEvent[] = [];
  const store: Store = {
    append(kind, payload, agent) {
      const ev: StoredEvent = { seq: events.length + 1, ts: events.length + 1, kind, agent, payload };
      events.push(ev);
      return ev;
    },
    replay: () => events.slice(),
    setTeam: () => {},
    close: () => {},
  };
  return { store, events };
}

const usageRows = (events: StoredEvent[]) =>
  events.filter((e) => e.kind === 'workflow-usage').map((e) => e.payload as WorkflowUsagePayload);

describe('workflowAgentClaimOf', () => {
  it('reads the run, session and agent out of the path', () => {
    expect(workflowAgentClaimOf(pathFor('a06eeee08bb883b02'))).toEqual({
      runId: RUN,
      sessionId: SESSION,
      agentId: 'a06eeee08bb883b02',
    });
  });

  it('refuses the run journal beside it', () => {
    expect(
      workflowAgentClaimOf(
        `/home/.claude/projects/${SLUG}/${SESSION}/subagents/workflows/${RUN}/journal.jsonl`,
      ),
    ).toBeNull();
  });

  it('refuses a team-side subagent, which is a different contract entirely', () => {
    expect(
      workflowAgentClaimOf(
        `/home/.claude/projects/${SLUG}/${SESSION}/subagents/agent-a10431295a87e9bbd.jsonl`,
      ),
    ).toBeNull();
  });

  it('refuses a directory that merely looks like a run', () => {
    expect(
      workflowAgentClaimOf(
        `/home/.claude/projects/${SLUG}/${SESSION}/subagents/notruns/${RUN}/agent-a10431295a87e9bbd.jsonl`,
      ),
    ).toBeNull();
  });
});

describe('the workflow usage ingest', () => {
  it('publishes a run’s measured usage as its agents write', () => {
    const { store, events } = spyStore();
    const ingest = createWorkflowUsageIngest(store, () => true);

    expect(ingest.handle(pathFor('a06eeee08bb883b02'), linesOf('a06eeee08bb883b02'), true)).toBe(true);
    const [first] = usageRows(events);
    expect(first.runId).toBe(RUN);
    expect(first.agents.map((a) => a.agentId)).toEqual(['a06eeee08bb883b02']);
    expect(first.split.cacheRead).toBe(30000);

    // A second agent of the same run adds to it rather than replacing it.
    ingest.handle(pathFor('ad5320caf6d71b0e3'), linesOf('ad5320caf6d71b0e3'), true);
    expect(usageRows(events).at(-1)!.split.cacheRead).toBe(35000);
  });

  it('leaves a path that is not a workflow agent’s alone', () => {
    const { store, events } = spyStore();
    const ingest = createWorkflowUsageIngest(store, () => true);
    const teammate = `/home/.claude/projects/${SLUG}/${SESSION}/subagents/agent-aprobe-charlie-12ee4cb1ed35cf7c.jsonl`;
    expect(ingest.handle(teammate, ['{"type":"assistant"}'], true)).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('re-reading one agent’s file from byte zero keeps its siblings', () => {
    const { store, events } = spyStore();
    const ingest = createWorkflowUsageIngest(store, () => true);
    ingest.handle(pathFor('a06eeee08bb883b02'), linesOf('a06eeee08bb883b02'), true);
    ingest.handle(pathFor('ad5320caf6d71b0e3'), linesOf('ad5320caf6d71b0e3'), true);
    const before = usageRows(events).at(-1)!.split;

    // The sweep re-reads the first agent's whole file.
    ingest.handle(pathFor('a06eeee08bb883b02'), linesOf('a06eeee08bb883b02'), true);
    expect(usageRows(events).at(-1)!.split).toEqual(before);
  });

  it('bills a tailed file once across the chunks it arrived in', () => {
    const { store, events } = spyStore();
    const ingest = createWorkflowUsageIngest(store, () => true);
    const lines = linesOf('a06eeee08bb883b02');
    ingest.handle(pathFor('a06eeee08bb883b02'), lines.slice(0, 1), true);
    ingest.handle(pathFor('a06eeee08bb883b02'), lines.slice(1), false);

    const whole = createWorkflowUsageIngest(spyStore().store, () => true);
    void whole;
    const { store: s2, events: e2 } = spyStore();
    createWorkflowUsageIngest(s2, () => true).handle(pathFor('a06eeee08bb883b02'), lines, true);
    expect(usageRows(events).at(-1)!.split).toEqual(usageRows(e2).at(-1)!.split);
  });

  it('holds a run whose session is not ours yet, and publishes it when it becomes ours', () => {
    const { store, events } = spyStore();
    let known = false;
    const ingest = createWorkflowUsageIngest(store, () => known);

    ingest.handle(pathFor('a06eeee08bb883b02'), linesOf('a06eeee08bb883b02'), true);
    // Out of scope: nothing published, and nothing lost either.
    expect(usageRows(events)).toHaveLength(0);

    // config.json lands and names the session. A finished run's files never
    // move again, so this flush is the only thing that can publish it.
    known = true;
    ingest.flush();
    expect(usageRows(events)).toHaveLength(1);
    expect(usageRows(events)[0].split.cacheRead).toBe(30000);
  });

  it('never publishes another session’s run', () => {
    const { store, events } = spyStore();
    const ingest = createWorkflowUsageIngest(store, (s) => s === SESSION);
    const stranger = pathFor('a06eeee08bb883b02', 'aaaaaaaa-1111-2222-3333-444444444444');
    expect(ingest.handle(stranger, linesOf('a06eeee08bb883b02'), true)).toBe(true);
    ingest.flush();
    expect(usageRows(events)).toHaveLength(0);
  });

  it('publishes nothing for a run whose agents have not had a billed turn', () => {
    const { store, events } = spyStore();
    const ingest = createWorkflowUsageIngest(store, () => true);
    ingest.handle(pathFor('a06eeee08bb883b02'), ['{"type":"user","uuid":"u","timestamp":"2026-08-30T03:00:00.000Z"}'], true);
    expect(usageRows(events)).toHaveLength(0);
  });

  it('reaches the run model through the store, which is the whole point', () => {
    const { store, events } = spyStore();
    const ingest = createWorkflowUsageIngest(store, () => true);
    for (const agentId of Object.keys(fixture.agents)) {
      ingest.handle(pathFor(agentId), linesOf(agentId), true);
    }
    // The run itself, as parseWorkflowRun would have stored it.
    events.unshift({
      seq: 0,
      ts: 0,
      kind: 'workflow',
      payload: {
        runId: RUN,
        status: 'completed',
        live: false,
        phases: [],
        logs: [],
        totalTokens: 698551,
        agents: [
          { agentId: 'a06eeee08bb883b02', state: 'done', phaseIndex: 1 },
          { agentId: 'ad5320caf6d71b0e3', state: 'done', phaseIndex: 1 },
          { agentId: 'a6db0927d6cf282b1', state: 'done', phaseIndex: 2 },
          { agentId: 'a2a07e2a8ef27d692', state: 'done', phaseIndex: 2 },
        ],
      },
    });

    const [run] = foldWorkflows(events);
    expect(run.usage?.split.cacheRead).toBe(63000);
    expect(run.usage?.byPhase.map((p) => p.phaseIndex)).toEqual([1, 2]);
    expect(run.agents[0].tokenSplit?.cacheRead).toBe(30000);
    // The runtime's own figure is still there, and still a different quantity.
    expect(run.totalTokens).toBe(698551);
  });
});
