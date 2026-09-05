import { Fragment, type CSSProperties } from 'react';
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

const HEAD: CSSProperties = {
  flex: 'none',
  display: 'flex',
  gap: '10px',
  alignItems: 'center',
  padding: '10px 16px 8px',
  color: 'var(--color-neutral-600)',
  fontSize: '10px',
  letterSpacing: '.12em',
  borderBottom: '1px solid var(--color-neutral-900)',
};

const CHIP: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
  border: '1px solid var(--color-neutral-900)',
  borderRadius: 'var(--radius-sm)',
  padding: '1px 7px',
  fontSize: '10px',
};

const TINT = {
  cache: { color: 'var(--color-neutral-600)', mark: '⤿' },
  fresh: { color: 'var(--color-accent-400)', mark: '▸' },
} as const;

export function WorkflowScript({ run }: { run: WorkflowRun }) {
  const split = resumeSplit(run.agents);
  const boundary = split.cached.length;
  const scriptPath = run.scriptPath;

  return (
    <div data-testid="workflow-script" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div data-testid="wf-script-head" style={HEAD}>
          <span style={{ flex: 'none' }}>SCRIPT</span>
          {scriptPath !== undefined && (
            <>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  letterSpacing: 'normal',
                  color: 'var(--color-neutral-500)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {scriptPath}
              </span>
              <button
                type="button"
                className="btn-neutral"
                data-testid="wf-script-copy-path"
                onClick={() => void navigator.clipboard?.writeText(scriptPath)}
                style={{
                  flex: 'none',
                  border: '1px solid var(--color-neutral-800)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'transparent',
                  color: 'var(--color-neutral-500)',
                  fontSize: '10px',
                  letterSpacing: 'normal',
                  padding: '1px 8px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                copy path
              </button>
            </>
          )}
        </div>

        <div data-testid="wf-script-calls" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {run.agents.map((agent, i) => {
            const cached = i < boundary;
            const tint = cached ? TINT.cache : TINT.fresh;
            return (
              <Fragment key={agent.agentId}>
                {/* The one boundary the resume model is about: the last replayed
                    call above it, the first that ran live below. */}
                {i === boundary && boundary > 0 && (
                  <div
                    data-testid="wf-script-boundary"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '7px 16px 5px',
                      color: 'var(--color-neutral-700)',
                      fontSize: '10px',
                      letterSpacing: '.12em',
                    }}
                  >
                    <span style={{ flex: 'none' }}>RAN LIVE FROM HERE</span>
                    <span style={{ flex: 1, height: '1px', background: 'var(--color-neutral-900)' }} />
                  </div>
                )}
                <div
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
              </Fragment>
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
              {/* The runtime writes the script to disk at run START, so it exists
                  in both cases. Only the route to it differs, and neither case
                  has one yet. */}
              {run.live
                ? 'the console does not fetch the source: a live run has no snapshot yet, and a journal record carries only type, key and agentId — neither the source nor its path has reached this view'
                : 'the console does not fetch the source: the snapshot carries it, and the frame the browser receives strips it back off'}
              {scriptPath !== undefined && (
                <div style={{ color: 'var(--color-neutral-700)', fontSize: '10px', marginTop: '4px' }}>
                  {scriptPath}
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
          <div
            data-testid="wf-script-from"
            style={{ color: 'var(--color-neutral-500)', fontSize: '11px', marginBottom: '8px' }}
          >
            {`from ${run.runId}`}
          </div>

          <div data-testid="wf-script-legend" style={{ ...SIDE_BODY, marginBottom: '8px' }}>
            {/* Counted from the same array that is drawn beside them, so the
                number and the drawing cannot disagree. */}
            <div style={{ display: 'flex', gap: '6px' }}>
              <span data-testid="wf-script-chip-cache" style={{ ...CHIP, color: TINT.cache.color }}>
                {/* A resumed run's journal omits every agent served from cache,
                    so live this count is not zero — it is untakeable. */}
                {`${TINT.cache.mark} ${run.live ? '—' : split.cached.length}`}
              </span>
              <span data-testid="wf-script-chip-fresh" style={{ ...CHIP, color: TINT.fresh.color }}>
                {`${TINT.fresh.mark} ${run.live ? run.agents.length : split.fresh.length}`}
              </span>
            </div>

            <div style={{ color: 'var(--color-neutral-600)', marginTop: '6px' }}>
              {run.live ? (
                'replayed from cache, and seen by the journal — a cache hit is invisible until the snapshot lands, since the journal skips every agent replayed from cache'
              ) : (
                <>
                  replayed from cache, and ran
                  {!split.resumed && ' — nothing was replayed, this run started clean'}
                  {split.strayCacheHits > 0 && ` · ${split.strayCacheHits} cache hit(s) after the prefix`}
                </>
              )}
            </div>
          </div>

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
