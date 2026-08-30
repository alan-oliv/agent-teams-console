const CELLS = 16;

export function meterCells(ratio: number): string {
  const safe = Number.isFinite(ratio) ? ratio : 0;
  const filled = Math.max(0, Math.min(CELLS, Math.round(safe * CELLS)));
  return '█'.repeat(filled) + '░'.repeat(CELLS - filled);
}

/**
 * The bar shows occupancy and nothing else. It used to overwrite one cell with
 * a filled block to mark the compaction threshold, but the marker was drawn in
 * the same glyph and colour as the fill: below the threshold it read as a stray
 * block at the end of the bar, and above it it disappeared into the fill
 * entirely. `warnMark` is what tells the operator the threshold is near, and it
 * says so in the attention colour where it cannot be mistaken for occupancy.
 */
export function contextBar(tokens: number, limit: number): string {
  if (limit <= 0) return meterCells(0);
  return meterCells(tokens / limit);
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
const WARN_RATIO = 0.75;

// "Near the limit" is halfway from the warning to the trigger, so the two
// stages the design asks for stay distinguishable: the glyph alone means the
// threshold is behind you, the glyph plus the note means it is about to fire.
const NOTE_RATIO = WARN_RATIO + (1 - WARN_RATIO) / 2;

export function warnMark(tokens: number, compactAt: number): string {
  if (compactAt <= 0) return '';
  return tokens / compactAt >= WARN_RATIO ? '!' : '';
}

export function compactionNote(tokens: number, compactAt: number): string {
  if (compactAt <= 0 || tokens / compactAt < NOTE_RATIO) return '';
  const left = Math.max(0, Math.round((compactAt - tokens) / 1000));
  return `compaction in ~${left}k tokens`;
}

// U+2212 minus sign, not a hyphen — the design prototype's own glyph.
export function diffStat(added: number, removed: number): string {
  return `+${added} −${removed}`;
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
