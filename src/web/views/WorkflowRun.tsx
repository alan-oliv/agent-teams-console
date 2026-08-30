import { useState, type CSSProperties } from 'react';
import type {
  WorkflowAgent,
  WorkflowAgentState,
  WorkflowPhase,
  WorkflowRun as Run,
} from '../../shared/domain';
import { formatTokens } from '../format';
import { WorkflowAgents } from './WorkflowAgents';
import {
  gridCooperates,
  itemKeyOf,
  liveCounts,
  phaseList,
  phaseTally,
  workflowGrid,
  WORK_ITEM_WIDTH,
} from './workflow-grid';

/**
 * The design's cell vocabulary. `∅` is a returned null — an agent the operator
 * skipped — and is a STATE, not an error row: the script saw `null` and carried
 * on, which is what `.filter(Boolean)` is for. A thrown agent is a different
 * cell and borrows the console's own failed treatment, because a decision and a
 * failure drawn identically is the one thing this cell cannot do.
 */
const GLYPH: Record<WorkflowAgentState, string> = {
  done: '✓',
  run: '●',
  cache: '⤿',
  null: '∅',
  wait: '·',
  fail: '✗',
  block: '⊘',
};

const GLYPH_COLOR: Record<WorkflowAgentState, string> = {
  done: 'var(--color-accent-400)',
  run: 'var(--color-accent-500)',
  cache: 'var(--color-neutral-500)',
  null: 'var(--color-neutral-600)',
  wait: 'var(--color-neutral-700)',
  fail: 'var(--fail)',
  block: 'var(--color-neutral-600)',
};

const PHASE_MIN = 132;

// The header is `flex: none` above a scrolling body, which is what lets the
// detail wrap to two lines without stealing height from the grid.
const HEAD: CSSProperties = {
  flex: 'none',
  display: 'flex',
  gap: '10px',
  padding: '10px 16px 8px',
  borderBottom: '1px solid var(--color-neutral-900)',
};

const DETAIL: CSSProperties = {
  color: 'var(--color-neutral-600)',
  fontSize: '10px',
  lineHeight: 1.35,
  // Two lines, wrapped — never ellipsised. A phase detail is the one place the
  // design insists prose is worth the height.
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
};

const SIDE_LABEL: CSSProperties = {
  color: 'var(--color-neutral-600)',
  fontSize: '10px',
  letterSpacing: '.12em',
  marginBottom: '6px',
};

const SIDE_BODY: CSSProperties = { color: 'var(--color-neutral-500)', fontSize: '11px', lineHeight: 1.5 };

const SIDE_PANEL: CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--color-neutral-900)' };

/**
 * Both the grid's row key and the phase list's identity, so the one MEASURED
 * width covers both. A label with no `verb:` prefix is its own key and a live
 * agent falls back to its id, which is why this can be as wide as a 60-char
 * prompt prefix — hence the clamp rather than an ellipsis.
 */
const IDENTITY: CSSProperties = {
  width: `${WORK_ITEM_WIDTH}px`,
  flex: 'none',
  color: 'var(--color-neutral-300)',
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
  wordBreak: 'break-word',
};

const TAB: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: '2px 8px',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '10px',
  letterSpacing: '.12em',
};

function Cell({ agent }: { agent: WorkflowAgent | undefined }) {
  return (
    <span
      data-testid="wf-cell"
      title={agent ? `${agent.label ?? agent.agentId} · ${agent.state}` : undefined}
      style={{
        flex: 1,
        minWidth: `${PHASE_MIN}px`,
        color: agent ? GLYPH_COLOR[agent.state] : 'transparent',
      }}
    >
      {agent ? GLYPH[agent.state] : ''}
    </span>
  );
}

/** Shared by both layouts, so a phase reads identically whichever is drawn. */
function PhaseHead({ run, phase, style }: { run: Run; phase: WorkflowPhase; style: CSSProperties }) {
  return (
    <div data-testid="wf-phase" style={{ display: 'flex', flexDirection: 'column', gap: '3px', ...style }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
        <span data-testid="wf-phase-title" style={{ color: 'var(--color-text)', fontSize: '11.5px' }}>
          {phase.title}
        </span>
        <span data-testid="wf-phase-count" style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}>
          {phaseTally(run.agents, phase.index)}
        </span>
      </div>
      {phase.detail !== undefined && (
        <div data-testid="wf-phase-detail" style={DETAIL}>
          {phase.detail}
        </div>
      )}
    </div>
  );
}

function AgentRow({ agent }: { agent: WorkflowAgent }) {
  const identity = itemKeyOf(agent.label, agent.agentId);
  return (
    <div
      data-testid="wf-phase-agent"
      style={{
        display: 'flex',
        gap: '10px',
        padding: '6px 16px',
        alignItems: 'baseline',
        fontSize: '11.5px',
      }}
    >
      <span
        data-testid="wf-glyph"
        title={agent.state}
        style={{ flex: 'none', width: '12px', color: GLYPH_COLOR[agent.state] }}
      >
        {GLYPH[agent.state]}
      </span>
      <span data-testid="wf-name" style={IDENTITY} title={agent.label}>
        {identity}
      </span>
      {identity !== agent.agentId && (
        <span style={{ color: 'var(--color-neutral-700)', fontSize: '10px' }}>{agent.agentId}</span>
      )}
    </div>
  );
}

export function WorkflowRun({ run }: { run: Run }) {
  const [layout, setLayout] = useState<'phases' | 'grid'>('phases');
  const { columns, rows } = workflowGrid(run);
  const { groups, unphased } = phaseList(run);
  // The grid is offered, not assumed — and the offer can be withdrawn under a
  // layout already chosen, so this decides the drawing rather than the click.
  const offered = gridCooperates(run);
  const showGrid = offered && layout === 'grid';
  const live = liveCounts(run);

  return (
    <div data-testid="workflow-run" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {run.live ? (
          <>
            <div
              data-testid="wf-live-note"
              style={{
                flex: 'none',
                padding: '10px 16px',
                borderBottom: '1px solid var(--color-neutral-900)',
                color: 'var(--color-neutral-600)',
                fontSize: '11px',
                lineHeight: 1.5,
              }}
            >
              this run is still going, so there is no grid to draw — the phases
              and labels reach disk only in the snapshot, which is written once,
              at termination. Until the run ends the journal knows which agents
              started and which came back, and nothing else.
            </div>
            <WorkflowAgents agents={run.agents} />
          </>
        ) : (
          <>
            {offered && (
              <div data-testid="wf-layout" style={{ flex: 'none', display: 'flex', padding: '8px 12px 0' }}>
                {(['phases', 'grid'] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    data-testid={`wf-layout-${id}`}
                    onClick={() => setLayout(id)}
                    style={{
                      ...TAB,
                      color: layout === id ? 'var(--color-accent-400)' : 'var(--color-neutral-600)',
                    }}
                  >
                    {id === 'phases' ? 'BY PHASE' : 'ITEM GRID'}
                  </button>
                ))}
              </div>
            )}

            {showGrid ? (
          <>
            <div style={HEAD}>
              <span
                style={{
                  width: `${WORK_ITEM_WIDTH}px`,
                  flex: 'none',
                  color: 'var(--color-neutral-600)',
                  fontSize: '10px',
                  letterSpacing: '.12em',
                }}
              >
                WORK ITEM
              </span>
              {columns.map((phase) => (
                <PhaseHead
                  key={phase.index}
                  run={run}
                  phase={phase}
                  style={{ flex: 1, minWidth: `${PHASE_MIN}px` }}
                />
              ))}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {rows.map((row) => (
                <div
                  key={row.key}
                  data-testid="wf-row"
                  style={{
                    display: 'flex',
                    gap: '10px',
                    padding: '7px 16px',
                    borderBottom: '1px solid var(--color-neutral-900)',
                    alignItems: 'baseline',
                  }}
                >
                  <span data-testid="wf-item" style={IDENTITY}>
                    {row.key}
                  </span>
                  {row.cells.map((agent, i) => (
                    <Cell key={columns[i].index} agent={agent} />
                  ))}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {groups.map(({ phase, clusters }) => (
              <div key={phase.index} data-testid="wf-phase-group">
                <PhaseHead
                  run={run}
                  phase={phase}
                  style={{
                    padding: '10px 16px 8px',
                    borderTop: '1px solid var(--color-neutral-900)',
                  }}
                />
                {clusters.map((cluster) => (
                  <div key={cluster.agents[0].agentId}>
                    {/* Only ever said of a cluster of two or more. A singleton
                        is not evidence of sequential dispatch, so it says
                        nothing at all rather than the opposite. */}
                    {cluster.together && (
                      <div
                        data-testid="wf-dispatch"
                        style={{ padding: '5px 16px 1px', color: 'var(--color-neutral-600)', fontSize: '10px' }}
                      >
                        {`${cluster.agents.length} dispatched together`}
                      </div>
                    )}
                    {cluster.agents.map((agent) => (
                      <AgentRow key={agent.agentId} agent={agent} />
                    ))}
                  </div>
                ))}
              </div>
            ))}

            {groups.length === 0 && unphased.length === 0 && (
              <div style={{ padding: '14px 16px', color: 'var(--color-neutral-700)', fontSize: '11px' }}>
                no agents — this run spawned none
              </div>
            )}
          </div>
            )}
          </>
        )}

        {unphased.length > 0 && (
          <div
            data-testid="wf-unphased"
            style={{
              flex: 'none',
              borderTop: '1px solid var(--color-neutral-900)',
              padding: '9px 16px',
              color: 'var(--color-neutral-600)',
              fontSize: '10px',
            }}
          >
            {`${unphased.length} agent${unphased.length === 1 ? '' : 's'} outside every phase — the script called agent() without phase()`}
          </div>
        )}
      </div>

      <div
        style={{
          width: '268px',
          flex: 'none',
          borderLeft: '1px solid var(--color-neutral-900)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div style={SIDE_PANEL}>
          <div style={SIDE_LABEL}>RUN TOTALS</div>
          <div data-testid="wf-totals" style={SIDE_BODY}>
            {run.live
              ? `${live.started} started · ${live.returned} returned`
              : `${formatTokens(run.totalTokens ?? 0)} · ${run.totalToolCalls ?? 0} tool calls · ${run.agentCount ?? run.agents.length} agents`}
            {/* Budget is deliberately absent: it exists nowhere on disk, and
                totalTokens counts this run's agents while budget.spent() is a
                session-level counter — showing one as the other under-reports. */}
            <div style={{ color: 'var(--color-neutral-700)', fontSize: '10px', marginTop: '4px' }}>
              {run.live
                ? 'tokens, tool calls and duration land with the snapshot, at the end'
                : "no budget on disk · this is the run's own spend, not the session's"}
            </div>
          </div>
        </div>

        <div style={SIDE_PANEL}>
          <div style={SIDE_LABEL}>LIMITS</div>
          <div data-testid="wf-limits" style={SIDE_BODY}>
            concurrency is min(16, CPUs − 2) agents at once
            <div style={{ color: 'var(--color-neutral-600)', marginTop: '4px' }}>
              1000 agents is the lifetime cap for the whole run
            </div>
            {/* The cap is resolved from the HOST's cpu count at launch and never
                written to the snapshot. This browser's own core count is a
                different machine's number, so the figure is named as missing
                rather than substituted. */}
            <div style={{ color: 'var(--color-neutral-700)', fontSize: '10px', marginTop: '4px' }}>
              the slot count itself is not recorded — only the formula is known
            </div>
          </div>
        </div>

        <div style={{ ...SIDE_PANEL, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={SIDE_LABEL}>NARRATION</div>
          <div data-testid="wf-log" style={{ ...SIDE_BODY, flex: 1, minHeight: 0, overflow: 'auto' }}>
            {run.logs.length > 0
              ? run.logs.map((line, i) => (
                  <div key={`${i}-${line}`} style={{ marginBottom: '3px' }}>
                    {line}
                  </div>
                ))
              : run.live
                ? // log() output reaches disk only in the snapshot, so an empty
                  // list mid-run is silence about the script, not silence FROM it.
                  'the narration arrives with the snapshot — nothing to read yet'
                : 'the script called log() nowhere'}
          </div>
        </div>

        <div style={{ ...SIDE_PANEL, borderBottom: 'none', borderTop: '1px solid var(--color-neutral-900)' }}>
          <div data-testid="wf-not-in-loop" style={{ color: 'var(--color-neutral-600)', fontSize: '10px', lineHeight: 1.5 }}>
            you are not in the loop — a workflow opts in at launch and reports at
            the end. Nothing here steers it.
          </div>
        </div>
      </div>
    </div>
  );
}
