const CELLS = 16;

export function meterCells(ratio: number): string {
  const safe = Number.isFinite(ratio) ? ratio : 0;
  const filled = Math.max(0, Math.min(CELLS, Math.round(safe * CELLS)));
  return '█'.repeat(filled) + '░'.repeat(CELLS - filled);
}

export function contextBar(tokens: number, limit: number, compactAt: number): string {
  if (limit <= 0) return meterCells(0);
  const cells = [...meterCells(tokens / limit)];
  cells[Math.min(CELLS - 1, Math.floor((compactAt / limit) * CELLS))] = '█';
  return cells.join('');
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `${k < 100 ? k.toFixed(1) : Math.round(k)}k`;
  }
  return String(n);
}

export function formatPct(ratio: number): string {
  return `${Math.round((Number.isFinite(ratio) ? ratio : 0) * 100)}%`;
}

export function formatCost(usd: number): string {
  return `≈$${usd.toFixed(2)}`;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, '0')}m`
    : `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/**
 * How long ago, in one unit. `formatElapsed` always leads with minutes, and
 * `delivered · unread 0m 34s` buries the number that matters in a chat bubble's
 * footnote.
 */
export function briefAge(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m`;
  return `${Math.floor(total / 3600)}h`;
}

export function tokensLabel(n: number): string {
  return formatTokens(n);
}

export function pctLabel(tokens: number, limit: number): string {
  return limit > 0 ? formatPct(tokens / limit) : '0%';
}

export function ctxLabel(tokens: number, limit: number): string {
  return `${tokensLabel(tokens)} / ${tokensLabel(limit)}`;
}

// Warns against the auto-compact trigger, not the raw window (spec §4.3).
export function warnMark(tokens: number, compactAt: number): string {
  if (compactAt <= 0) return '';
  return tokens / compactAt >= 0.75 ? '!' : '';
}

export function costLabel(usd: number): string {
  return formatCost(usd);
}

export function elapsedLabel(startedAt: number, now: number): string {
  return formatElapsed(now - startedAt);
}

// UTC so the rendered clock is identical on every machine that reads a captured log.
export function clockLabel(ts: number): string {
  return new Date(ts).toISOString().slice(11, 19);
}
