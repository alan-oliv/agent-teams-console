import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveModel } from './catalog';
import type { TranscriptRecord } from './transcript';
import {
  contextOccupancy,
  costOf,
  dedupeUsage,
  totalCost,
  tokensOf,
  usageRecordsOf,
  type UsageRecord,
} from './usage';

interface FixtureRecord {
  agent: string;
  id: string;
  model: string;
  usage: UsageRecord['usage'];
}

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/usage-records.json', import.meta.url), 'utf8'),
) as FixtureRecord[];

const forAgent = (needle: string): UsageRecord[] =>
  fixture
    .filter((r) => r.agent.includes(needle))
    .map((r) => ({ messageId: r.id, model: r.model, usage: r.usage }));

const sumOutput = (records: UsageRecord[]): number =>
  records.reduce((s, r) => s + r.usage.output_tokens, 0);

const alphaTranscript = readFileSync(
  new URL('../../fixtures/transcript-agent-aprobe-alpha-84fd551b27de6433.jsonl', import.meta.url),
  'utf8',
)
  .split('\n')
  .filter((l) => l.trim().length > 0)
  .map((l) => JSON.parse(l) as TranscriptRecord);

describe('dedupeUsage', () => {
  it('collapses the charlie fixture from 12 records to 6 unique messages', () => {
    const charlie = forAgent('charlie');
    expect(charlie).toHaveLength(12);
    expect(dedupeUsage(charlie)).toHaveLength(6);
  });

  it('shows the 1.29x naive-vs-deduped output discrepancy on charlie', () => {
    const charlie = forAgent('charlie');
    const naive = sumOutput(charlie);
    const deduped = sumOutput(dedupeUsage(charlie));
    expect(naive).toBe(913);
    expect(deduped).toBe(710);
    expect((naive / deduped).toFixed(2)).toBe('1.29');
  });

  it('keeps the record with the maximum output_tokens per messageId', () => {
    const records: UsageRecord[] = [
      { messageId: 'm1', model: 'claude-opus-5', usage: { input_tokens: 2, output_tokens: 1 } },
      { messageId: 'm1', model: 'claude-opus-5', usage: { input_tokens: 2, output_tokens: 184 } },
      { messageId: 'm1', model: 'claude-opus-5', usage: { input_tokens: 2, output_tokens: 12 } },
    ];
    const out = dedupeUsage(records);
    expect(out).toHaveLength(1);
    expect(out[0].usage.output_tokens).toBe(184);
  });

  it('dedupes the alpha and bravo fixtures too', () => {
    expect(forAgent('alpha')).toHaveLength(13);
    expect(dedupeUsage(forAgent('alpha'))).toHaveLength(9);
    expect(forAgent('bravo')).toHaveLength(11);
    expect(dedupeUsage(forAgent('bravo'))).toHaveLength(9);
  });
});

describe('costOf', () => {
  it('reproduces the verified 0.186288 on the Opus 5 tier', () => {
    const cost = costOf(
      {
        input_tokens: 2,
        output_tokens: 4,
        cache_read_input_tokens: 15976,
        cache_creation_input_tokens: 17819,
        cache_creation: { ephemeral_1h_input_tokens: 17819, ephemeral_5m_input_tokens: 0 },
      },
      resolveModel('claude-opus-5').pricing,
    );
    expect(cost.toFixed(6)).toBe('0.186288');
  });

  it('bills the non-1h remainder of cache_creation at the 5m rate, not ephemeral_5m', () => {
    // ephemeral_5m is deliberately 0 while the total is 1_000_000: the remainder
    // must still be charged, or the figure collapses to zero.
    const cost = costOf(
      {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 1_000_000,
        cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
      },
      resolveModel('claude-opus-5').pricing,
    );
    expect(cost.toFixed(6)).toBe('6.250000');
  });

  it('charges web search requests at a flat rate per request', () => {
    const cost = costOf(
      { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 3 } },
      resolveModel('claude-opus-5').pricing,
    );
    expect(cost.toFixed(6)).toBe('0.030000');
  });
});

describe('totalCost', () => {
  it('costs the charlie fixture on the haiku tier after deduping', () => {
    expect(totalCost(forAgent('charlie')).toFixed(6)).toBe('0.044338');
  });

  it('costs the alpha fixture on the opus tier after deduping', () => {
    expect(totalCost(forAgent('alpha')).toFixed(6)).toBe('0.464434');
  });
});

describe('contextOccupancy', () => {
  it('sums input + cache_read + cache_creation of the last assistant record', () => {
    // last assistant record of the alpha transcript: 2 + 14835 + 19632
    expect(contextOccupancy(alphaTranscript)).toBe(34469);
  });

  it('falls back to compactMetadata.postTokens when nothing follows a compact boundary', () => {
    const boundary: TranscriptRecord = {
      type: 'system',
      subtype: 'compact_boundary',
      uuid: 'boundary-1',
      timestamp: '2026-08-27T15:10:45.000Z',
      compactMetadata: { postTokens: 12000 },
    };
    expect(contextOccupancy([...alphaTranscript, boundary])).toBe(12000);
  });

  it('recomputes from the first assistant record after a compact boundary', () => {
    const boundary: TranscriptRecord = {
      type: 'system',
      subtype: 'compact_boundary',
      uuid: 'boundary-1',
      timestamp: '2026-08-27T15:10:45.000Z',
      compactMetadata: { postTokens: 12000 },
    };
    const after: TranscriptRecord = {
      type: 'assistant',
      uuid: 'after-1',
      timestamp: '2026-08-27T15:10:46.000Z',
      isSidechain: true,
      message: {
        id: 'msg_after',
        usage: {
          input_tokens: 3,
          output_tokens: 1,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 200,
        },
      },
    };
    expect(contextOccupancy([...alphaTranscript, boundary, after])).toBe(303);
  });

  it('ignores api-error assistant records', () => {
    const errored: TranscriptRecord = {
      type: 'assistant',
      uuid: 'err-1',
      timestamp: '2026-08-27T15:10:55.000Z',
      isSidechain: true,
      isApiErrorMessage: true,
      message: {
        id: 'msg_err',
        usage: { input_tokens: 999999, output_tokens: 0 },
      },
    };
    expect(contextOccupancy([...alphaTranscript, errored])).toBe(34469);
  });

  it('returns 0 for an empty record list', () => {
    expect(contextOccupancy([])).toBe(0);
  });
});

// These two moved here from project.ts so the ingest and the fold can share one
// implementation of "what did this agent spend". The move must not change what
// they return, so their behaviour is pinned against the same fixture the fold
// reads.
describe('usageRecordsOf', () => {
  it('takes one record per usage-bearing assistant line, keyed on the message id', () => {
    const records = usageRecordsOf(alphaTranscript);
    expect(alphaTranscript).toHaveLength(27);
    expect(records).toHaveLength(13);
    expect(records[0].messageId).toBe('msg_011CeTTwecxfqFMr8UmnzxZN');
    expect(records[0].model).toBe('claude-opus-5');
    // Deliberately NOT deduped: dedupeUsage is what collapses the repeats.
    expect(dedupeUsage(records)).toHaveLength(9);
  });

  it('skips user records and assistant records with no usage', () => {
    expect(
      usageRecordsOf([
        { type: 'user', uuid: 'u1', message: { role: 'user' } },
        { type: 'assistant', uuid: 'a1', message: { id: 'm1', model: 'x' } },
      ]),
    ).toEqual([]);
  });

  it('falls back to the record uuid when the message carries no id', () => {
    const records = usageRecordsOf([
      { type: 'assistant', uuid: 'no-message-id', message: { usage: { input_tokens: 1, output_tokens: 2 } } },
    ]);
    expect(records).toEqual([
      { messageId: 'no-message-id', model: '', usage: { input_tokens: 1, output_tokens: 2 } },
    ]);
  });
});

describe('tokensOf', () => {
  it('sums input, output and cache creation — never cache reads', () => {
    const records = usageRecordsOf(alphaTranscript);
    expect(tokensOf(records)).toBe(129853);
    expect(tokensOf(dedupeUsage(records))).toBe(54065);
  });

  it('is zero for no records', () => {
    expect(tokensOf([])).toBe(0);
  });
});
