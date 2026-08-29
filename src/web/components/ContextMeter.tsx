import { contextBar, formatPct, formatTokens, warnMark } from '../format';

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
  return (
    <>
      <span
        data-testid="context-bar"
        style={{ letterSpacing: '-.5px', color: 'var(--color-accent-600)', fontSize: barSize }}
      >
        {contextBar(contextTokens, contextLimit)}
      </span>
      <span style={{ color: 'var(--color-neutral-500)', fontSize: textSize }}>
        {formatPct(contextTokens / contextLimit)}
      </span>
      <span
        data-testid="context-warn"
        style={{ color: 'var(--warn)', fontSize: textSize, width: 7 }}
      >
        {warnMark(contextTokens, compactAt)}
      </span>
      <span style={{ color: 'var(--color-neutral-600)', fontSize: textSize }}>
        {`${formatTokens(contextTokens)} / ${formatTokens(contextLimit)}`}
      </span>
    </>
  );
}
