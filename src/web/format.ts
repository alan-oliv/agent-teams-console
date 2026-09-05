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

// Warns against the window the meter draws, so the threshold is a percent the
// operator can read off the screen (CONSOLE-DECISIONS.md ruling 2). Measured
// against compactAt instead, it lit at ~63% of a 200k window and 73% of a 1M
// one — one glyph meaning a different number per model, and a "75%" setting
// that fired at neither.
const WARN_RATIO = 0.75;

const warnAt = (contextLimit: number) => contextLimit * WARN_RATIO;

export function warnMark(tokens: number, contextLimit: number): string {
  if (contextLimit <= 0) return '';
  return tokens >= warnAt(contextLimit) ? '!' : '';
}

// Two stages of one warning: the glyph means the threshold is behind you, the
// note means the trigger is about to fire. So the note starts halfway from the
// threshold to the trigger, and counts towards the trigger — the only figure
// that describes the thing actually approaching.
export function compactionNote(tokens: number, contextLimit: number, compactAt: number): string {
  if (contextLimit <= 0 || compactAt <= 0) return '';
  const threshold = warnAt(contextLimit);
  if (tokens < threshold + (compactAt - threshold) / 2) return '';
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

// Local time, so the clock reads as the time the operator experienced.
/**
 * `/Users/alanoliv/code/octo` → `~/code/octo` — the form the folder chip draws.
 * The server sends the real path because that is what it takes back; the home
 * prefix is the operator's own and carries nothing worth the width.
 */
export function shortPath(dir: string): string {
  return dir.replace(/^\/(?:Users|home)\/[^/]+/, '~');
}

export function clockLabel(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
