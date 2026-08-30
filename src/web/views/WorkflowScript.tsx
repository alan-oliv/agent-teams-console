import type { CSSProperties } from 'react';
import type { WorkflowRun } from '../../shared/domain';
import { resumeSplit } from './workflow-resume';

const SIDE_LABEL: CSSProperties = {
  color: 'var(--color-neutral-600)',
  fontSize: '10px',
  letterSpacing: '.12em',
  marginBottom: '6px',
};

const SIDE_BODY: CSSProperties = {
  color: 'var(--color-neutral-500)',
  fontSize: '11px',
  lineHeight: 1.5,
};

const SIDE_PANEL: CSSProperties = {
  padding: '12px 14px',
  borderBottom: '1px solid var(--color-neutral-900)',
};

const TINT = {
  cache: { color: 'var(--color-neutral-600)', mark: '⤿' },
  fresh: { color: 'var(--color-accent-400)', mark: '●' },
} as const;

export function WorkflowScript({ run }: { run: WorkflowRun }) {
  const split = resumeSplit(run.agents);

  return (
    <div data-testid="workflow-script" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div
          data-testid="wf-script-legend"
          style={{
            flex: 'none',
            padding: '10px 16px 8px',
            borderBottom: '1px solid var(--color-neutral-900)',
            color: 'var(--color-neutral-600)',
            fontSize: '10px',
            display: 'flex',
            gap: '14px',
          }}
        >
          {/* Counted from the same array that is drawn below, so the number and
              the drawing cannot disagree. */}
          <span style={{ color: TINT.cache.color }}>
            {`${TINT.cache.mark} ${split.cached.length} replayed from cache`}
          </span>
          <span style={{ color: TINT.fresh.color }}>{`${TINT.fresh.mark} ${split.fresh.length} ran`}</span>
          {!split.resumed && <span>nothing was replayed — this run started clean</span>}
          {split.strayCacheHits > 0 && (
            <span>{`${split.strayCacheHits} cache hit(s) after the prefix`}</span>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {run.agents.map((agent, i) => {
            const cached = i < split.cached.length;
            const tint = cached ? TINT.cache : TINT.fresh;
            return (
              <div
                key={agent.agentId}
                data-testid="wf-script-call"
                data-tint={cached ? 'cache' : 'fresh'}
                style={{
                  display: 'flex',
                  gap: '10px',
                  padding: '5px 16px',
                  alignItems: 'baseline',
                  fontSize: '11.5px',
                  color: tint.color,
                  borderLeft: `2px solid ${tint.color}`,
                }}
              >
                <span style={{ width: '26px', flex: 'none', color: 'var(--color-neutral-700)', fontSize: '10px' }}>
                  {i + 1}
                </span>
                <span style={{ flex: 'none' }}>{tint.mark}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {`agent(${agent.label ?? agent.agentId})`}
                </span>
              </div>
            );
          })}

          {run.script !== undefined && (
            <pre
              data-testid="wf-script-source"
              style={{
                margin: 0,
                padding: '12px 16px',
                borderTop: '1px solid var(--color-neutral-900)',
                color: 'var(--color-neutral-500)',
                fontSize: '11px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {run.script}
            </pre>
          )}

          {run.script === undefined && (
            <div
              data-testid="wf-script-absent"
              style={{
                borderTop: '1px solid var(--color-neutral-900)',
                padding: '12px 16px',
                color: 'var(--color-neutral-600)',
                fontSize: '11px',
                lineHeight: 1.5,
              }}
            >
              the source is not carried on the wire — it is two thirds of a run&apos;s
              bytes and every run would pay for it
              {run.scriptPath !== undefined && (
                <div style={{ color: 'var(--color-neutral-700)', fontSize: '10px', marginTop: '4px' }}>
                  {run.scriptPath}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          width: '268px',
          flex: 'none',
          borderLeft: '1px solid var(--color-neutral-900)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={SIDE_PANEL}>
          <div style={SIDE_LABEL}>RESUME</div>
          <div data-testid="wf-script-note" style={SIDE_BODY}>
            A resume replays the longest unchanged prefix of agent() calls from
            cache; the first edited or new call, and everything after it, runs
            live.
            <div style={{ color: 'var(--color-neutral-600)', marginTop: '6px' }}>
              That is why Date.now(), Math.random() and argless new Date() throw
              inside a script — they would make two runs incomparable.
            </div>
          </div>
        </div>

        <div style={{ ...SIDE_PANEL, borderBottom: 'none' }}>
          <div style={SIDE_LABEL}>DRAWN PER CALL</div>
          <div style={SIDE_BODY}>
            The tint is per agent() call, not per line: nothing on disk maps an
            agent back to the line that spawned it.
          </div>
        </div>
      </div>
    </div>
  );
}
