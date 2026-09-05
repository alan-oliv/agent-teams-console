import { Fragment, useEffect, useState, type CSSProperties } from 'react';
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

interface FetchedScript {
  source: 'as-executed' | 'snapshot';
  path: string;
  script: string;
}

const ORIGIN_WORD: Record<FetchedScript['source'], string> = {
  'as-executed': 'as executed · written at run start',
  snapshot: 'from the run’s snapshot',
};

/**
 * The source is on disk from the moment a run starts, and on no frame at any
 * point: `leanRun` strips it because it is 65% of the model's bytes. So it is
 * fetched once per run, and only when the frame did not carry it after all.
 */
function useScriptSource(runId: string, onFrame: string | undefined): FetchedScript | 'missing' | null {
  // Null is the fetch still being in flight, and is drawn as neither a source
  // nor "there is none" — for the moment it takes, both would be a guess.
  const [fetched, setFetched] = useState<FetchedScript | 'missing' | null>(null);

  useEffect(() => {
    setFetched(null);
    if (onFrame !== undefined) return;
    let current = true;
    void (async () => {
      let got: FetchedScript | 'missing' = 'missing';
      try {
        const res = await fetch(`/api/workflow/${encodeURIComponent(runId)}/script`);
        // 404 is a run that left no source on either path — ordinary, and what
        // the absent-source message exists to say.
        if (res.ok) {
          const body = (await res.json()) as FetchedScript;
          if (typeof body.script === 'string') got = body;
        }
      } catch {
        // The console went away; the next frame remounts this.
      }
      if (current) setFetched(got);
    })();
    return () => {
      current = false;
    };
  }, [runId, onFrame]);

  return fetched;
}

export function WorkflowScript({ run }: { run: WorkflowRun }) {
  const split = resumeSplit(run.agents);
  const boundary = split.cached.length;
  const scriptPath = run.scriptPath;
  const fetched = useScriptSource(run.runId, run.script);
  const origin = fetched === null || fetched === 'missing' ? null : fetched;
  const script = run.script ?? origin?.script;

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

          {script !== undefined && (
            <>
              {/* Three copies of a script can differ — the one on the wire, the
                  one as executed, and the repo file `scriptPath` points at,
                  which may have been edited since. Which one this is matters. */}
              {origin !== null && (
                <div
                  data-testid="wf-script-origin"
                  style={{
                    borderTop: '1px solid var(--color-neutral-900)',
                    padding: '8px 16px 0',
                    color: 'var(--color-neutral-700)',
                    fontSize: '10px',
                  }}
                >
                  {`${ORIGIN_WORD[origin.source]} · ${origin.path}`}
                </div>
              )}
              <pre
                data-testid="wf-script-source"
                style={{
                  margin: 0,
                  padding: '12px 16px',
                  borderTop: origin === null ? '1px solid var(--color-neutral-900)' : 'none',
                  color: 'var(--color-neutral-500)',
                  fontSize: '11px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {script}
              </pre>
            </>
          )}

          {script === undefined && fetched === 'missing' && (
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
              {/* The frame never carries the source, so this is the fetch coming
                  back empty — not a guess about what disk holds. The two cases
                  have a different set of places left to look. */}
              {run.live
                ? 'no source on disk for this run: the copy the runtime writes at run start is not there, and no frame carries one'
                : 'no source on disk for this run: neither the copy written at run start nor an inline script in its snapshot, and no frame carries one'}
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
