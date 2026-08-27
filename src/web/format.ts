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
