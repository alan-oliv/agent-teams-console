import { useState, type CSSProperties } from 'react';
import type { WorkflowAgent, WorkflowAgentState } from '../../shared/domain';
import { formatElapsed, formatTokens } from '../format';
import { GLYPH, GLYPH_COLOR } from './WorkflowRun';

const STATE_WORD: Record<WorkflowAgentState, string> = {
  done: 'returned',
  run: 'running',
  cache: 'cached',
  null: 'returned null',
  // `queued`, not `waiting` — CONSOLE-DECISIONS ruling 11.
  wait: 'queued',
  fail: 'failed',
  block: 'blocked',
};

const HEAD: CSSProperties = {
  flex: 'none',
  display: 'flex',
  gap: '10px',
  padding: '10px 16px 8px',
  color: 'var(--color-neutral-600)',
  fontSize: '10px',
  letterSpacing: '.12em',
  borderBottom: '1px solid var(--color-neutral-900)',
};

const FOOTER: CSSProperties = {
  flex: 'none',
  borderTop: '1px solid var(--color-neutral-900)',
  padding: '9px 16px',
  color: 'var(--color-neutral-600)',
  fontSize: '10px',
};

const ID_W = '150px';
const PHASE_W = '92px';
const MODEL_W = '128px';
const STATE_W = '104px';
const ISO_W = '76px';
const NUM_W = '62px';

const HEAD_CLIP: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const NUM_HEAD: CSSProperties = { width: NUM_W, flex: 'none', textAlign: 'right', ...HEAD_CLIP };
const NUM_CELL: CSSProperties = { width: NUM_W, flex: 'none', textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

/** Absent, not zero — most of these are simply not recorded on a live run. */
const dash = (v: string | number | undefined, format: (n: never) => string = String as never) =>
  v === undefined ? '—' : format(v as never);

export function WorkflowAgents({ agents }: { agents: WorkflowAgent[] }) {
  const [hoveredId, setHoveredId] = useState<string>();

  return (
    <div data-testid="workflow-agents" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div data-testid="wf-agents-head" style={HEAD}>
        <span style={{ width: ID_W, flex: 'none', ...HEAD_CLIP }}>AGENT</span>
        <span style={{ width: PHASE_W, flex: 'none', ...HEAD_CLIP }}>PHASE</span>
        <span style={{ flex: 1, minWidth: 0, ...HEAD_CLIP }}>PROMPT</span>
        <span style={{ width: MODEL_W, flex: 'none', ...HEAD_CLIP }}>MODEL</span>
        <span style={{ width: ISO_W, flex: 'none', ...HEAD_CLIP }}>ISOLATION</span>
        <span style={{ width: STATE_W, flex: 'none', ...HEAD_CLIP }}>STATE</span>
        <span style={NUM_HEAD}>TOKENS</span>
        <span style={NUM_HEAD}>TOOLS</span>
        <span style={NUM_HEAD}>DURATION</span>
        <span style={NUM_HEAD}>ATTEMPT</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {agents.map((agent) => (
          <div
            key={agent.agentId}
            data-testid="wf-agent"
            onMouseEnter={() => setHoveredId(agent.agentId)}
            onMouseLeave={() => setHoveredId(undefined)}
            style={{
              display: 'flex',
              gap: '10px',
              padding: '7px 16px',
              borderBottom: '1px solid var(--color-neutral-900)',
              alignItems: 'baseline',
              fontSize: '11.5px',
              background: hoveredId === agent.agentId ? 'var(--color-neutral-900)' : undefined,
            }}
          >
            <span
              data-testid="wf-agent-id"
              style={{ width: ID_W, flex: 'none', color: 'var(--color-neutral-400)' }}
              title={agent.label}
            >
              {agent.agentId}
            </span>
            <span data-testid="wf-agent-phase" style={{ width: PHASE_W, flex: 'none', color: 'var(--color-neutral-500)' }}>
              {agent.phaseTitle ?? '—'}
            </span>
            <span
              data-testid="wf-agent-prompt"
              style={{
                flex: 1,
                minWidth: 0,
                color: 'var(--color-neutral-600)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={agent.prompt}
            >
              {agent.prompt ?? '—'}
            </span>
            <span data-testid="wf-agent-model" style={{ width: MODEL_W, flex: 'none', color: 'var(--color-neutral-600)' }}>
              {agent.model ?? '—'}
            </span>
            <span
              data-testid="wf-agent-isolation"
              style={{ width: ISO_W, flex: 'none', color: agent.isolation ? 'var(--color-accent-400)' : 'var(--color-neutral-700)' }}
            >
              {agent.isolation ?? '—'}
            </span>
            <span data-testid="wf-agent-state" style={{ width: STATE_W, flex: 'none', color: GLYPH_COLOR[agent.state] }}>
              {GLYPH[agent.state]} {STATE_WORD[agent.state]}
            </span>
            <span data-testid="wf-agent-tokens" style={{ ...NUM_CELL, color: 'var(--color-neutral-500)' }}>
              {dash(agent.tokens, formatTokens)}
            </span>
            <span data-testid="wf-agent-tools" style={{ ...NUM_CELL, color: 'var(--color-neutral-600)' }}>
              {dash(agent.toolCalls)}
            </span>
            <span data-testid="wf-agent-duration" style={{ ...NUM_CELL, color: 'var(--color-neutral-600)' }}>
              {dash(agent.durationMs, formatElapsed)}
            </span>
            <span data-testid="wf-agent-attempt" style={{ ...NUM_CELL, color: 'var(--color-neutral-600)' }}>
              {dash(agent.attempt)}
            </span>
          </div>
        ))}

        {agents.length === 0 && (
          <div data-testid="wf-agents-empty" style={{ padding: '14px 16px', color: 'var(--color-neutral-700)', fontSize: '11px' }}>
            no agents — this run spawned none
          </div>
        )}
      </div>

      <div data-testid="wf-agents-footer" style={FOOTER}>
        ephemeral: one prompt, one return, then gone · not addressable by name,
        and never a member of a team · `schema` is script text and reaches no file
      </div>
    </div>
  );
}
