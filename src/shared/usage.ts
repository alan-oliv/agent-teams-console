import { resolveModel, type PricingTier } from './catalog';
import type { TranscriptRecord } from './transcript';

export interface Usage {
  input_tokens: number; output_tokens: number;
  cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  server_tool_use?: { web_search_requests?: number };
}
export interface UsageRecord { messageId: string; model: string; usage: Usage }

export function dedupeUsage(records: UsageRecord[]): UsageRecord[] {
  const best = new Map<string, UsageRecord>();
  for (const record of records) {
    const previous = best.get(record.messageId);
    if (!previous || record.usage.output_tokens > previous.usage.output_tokens) {
      best.set(record.messageId, record);
    }
  }
  return [...best.values()];
}

export function costOf(usage: Usage, tier: PricingTier): number {
  const created = usage.cache_creation_input_tokens ?? 0;
  // ephemeral_5m is absent on lines that still report a cache_creation total, so
  // the 5m share is the remainder after the 1h bucket — never ephemeral_5m itself.
  const oneHour = Math.min(usage.cache_creation?.ephemeral_1h_input_tokens ?? 0, created);
  const cacheCreation = (oneHour * tier.cacheWrite1h + (created - oneHour) * tier.cacheWrite5m) / 1e6;
  return (
    (usage.input_tokens * tier.input) / 1e6 +
    (usage.output_tokens * tier.output) / 1e6 +
    ((usage.cache_read_input_tokens ?? 0) * tier.cacheRead) / 1e6 +
    cacheCreation +
    (usage.server_tool_use?.web_search_requests ?? 0) * tier.webSearch
  );
}

export function totalCost(records: UsageRecord[]): number {
  let sum = 0;
  for (const record of dedupeUsage(records)) {
    sum += costOf(record.usage, resolveModel(record.model).pricing);
  }
  return sum;
}

export function contextOccupancy(records: TranscriptRecord[]): number {
  let lastBoundary = -1;
  for (let i = 0; i < records.length; i++) {
    if (records[i].type === 'system' && records[i].subtype === 'compact_boundary') lastBoundary = i;
  }
  const after = lastBoundary === -1 ? records : records.slice(lastBoundary + 1);
  const assistants = after.filter(
    (r) => r.type === 'assistant' && r.isApiErrorMessage !== true && r.message?.usage,
  );
  // "non-sidechain" is right for the lead transcript, but a teammate file is
  // entirely sidechain — prefer non-sidechain, fall back rather than report zero.
  const own = assistants.filter((r) => r.isSidechain !== true);
  const pool = own.length > 0 ? own : assistants;
  const last = pool[pool.length - 1];
  if (!last) {
    return lastBoundary === -1 ? 0 : records[lastBoundary].compactMetadata?.postTokens ?? 0;
  }
  const usage = last.message!.usage!;
  return (
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}
