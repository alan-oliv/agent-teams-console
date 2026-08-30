import { compactionNote, contextBar, formatPct, formatTokens, warnMark } from '../format';

export interface ContextMeterProps {
  contextTokens: number;
  contextLimit: number;
  compactAt: number;
  barSize?: number;
  textSize?: number;
}

export function ContextMeter({
  contextTokens,
  contextLimit,
  compactAt,
  barSize = 11.5,
  textSize = 10.5,
}: ContextMeterProps) {
  const note = compactionNote(contextTokens, contextLimit, compactAt);
  return (
    <>
      <span
        data-testid="context-bar"
        style={{
          letterSpacing: '-.5px',
          color: 'var(--color-accent-600)',
          fontSize: barSize,
          flex: 'none',
        }}
      >
        {contextBar(contextTokens, contextLimit)}
      </span>
      <span style={{ color: 'var(--color-neutral-500)', fontSize: textSize, flex: 'none' }}>
        {formatPct(contextTokens / contextLimit)}
      </span>
      <span
        data-testid="context-warn"
        style={{ color: 'var(--warn)', fontSize: textSize, width: 7, flex: 'none' }}
      >
        {warnMark(contextTokens, contextLimit)}
      </span>
      <span style={{ color: 'var(--color-neutral-600)', fontSize: textSize, flex: 'none' }}>
        {`${formatTokens(contextTokens)} / ${formatTokens(contextLimit)}`}
      </span>
      {/*
        The meter is a fragment laid out by whichever row hosts it, so the note
        cannot take a line of its own the way the wall column's does. Instead it
        is the only item on that row that yields: everything else is `flex: none`,
        so a narrow pane clips the note back to nothing rather than wrapping the
        meter onto a second line.
      */}
      {note && (
        <span
          data-testid="context-compaction"
          title={note}
          style={{
            color: 'var(--warn)',
            fontSize: textSize,
            flex: '0 1 auto',
            minWidth: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {note}
        </span>
      )}
    </>
  );
}
