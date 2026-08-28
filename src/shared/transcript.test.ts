import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  currentToolOf,
  parseLine,
  toTranscriptLines,
  TRANSCRIPT_TEXT_CAP,
  type TranscriptRecord,
} from './transcript';

const raw = readFileSync(
  new URL('../../fixtures/transcript-agent-aprobe-alpha-84fd551b27de6433.jsonl', import.meta.url),
  'utf8',
)
  .split('\n')
  .filter((l) => l.trim().length > 0);

const records = raw.map((l) => parseLine(l)!);

const frames = (
  JSON.parse(
    readFileSync(new URL('../../fixtures/lead-transcript-teammate-frames.json', import.meta.url), 'utf8'),
  ) as Array<{ frames: string[] }>
).flatMap((f) => f.frames);

// a-z on repeat: long, whitespace-free (so flatten() is a no-op) and prefix-comparable
function pattern(n: number): string {
  let out = '';
  while (out.length < n) out += 'abcdefghijklmnopqrstuvwxyz';
  return out.slice(0, n);
}

describe('parseLine', () => {
  it('parses all 27 lines of the real alpha transcript', () => {
    expect(raw).toHaveLength(27);
    expect(records.every((r) => r !== null)).toBe(true);
    expect(records[0].type).toBe('user');
    expect(records[0].uuid).toBe('d2908088-b2ed-4344-bb3c-ee08e9366306');
    expect(records[0].isSidechain).toBe(true);
    expect(records[0].agentId).toBe('aprobe-alpha-84fd551b27de6433');
    expect(records[3].type).toBe('assistant');
    expect(records[3].message?.model).toBe('claude-opus-5');
    expect(records[3].message?.id).toBe('msg_011CeTTwecxfqFMr8UmnzxZN');
  });

  it('tolerates every state line type listed in the spec', () => {
    const stateLines = [
      '{"type":"mode","mode":"default"}',
      '{"type":"permission-mode","permissionMode":"bypassPermissions"}',
      '{"type":"custom-title","title":"spike"}',
      '{"type":"ai-title","title":"spike"}',
      '{"type":"agent-name","name":"probe-alpha"}',
      '{"type":"agent-setting","key":"effort","value":"xhigh"}',
      '{"type":"last-prompt","promptId":"76a6dce5-add4-4650-ac9e-20c23b81a179"}',
      '{"type":"bridge-session","sessionId":"98b0b4a7-3206-455b-aaf6-a5a81ad1e283"}',
      '{"type":"queue-operation","op":"push"}',
      '{"type":"file-history-snapshot","messageId":"m"}',
      '{"type":"summary","summary":"spike"}',
      '{"type":"attachment"}',
      '{"type":"system","subtype":"compact_boundary"}',
    ];
    for (const line of stateLines) {
      const parsed = parseLine(line);
      expect(parsed).not.toBeNull();
      expect(toTranscriptLines(parsed!)).toEqual([]);
    }
  });

  it('returns null for unparseable lines', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('   ')).toBeNull();
    expect(parseLine('not json at all')).toBeNull();
    expect(parseLine('{"type":"user"')).toBeNull();
    expect(parseLine('[1,2,3]')).toBeNull();
    expect(parseLine('null')).toBeNull();
    expect(parseLine('42')).toBeNull();
  });
});

describe('toTranscriptLines', () => {
  it('maps the spawn prompt to a ❯ line with the teammate-message wrapper stripped', () => {
    const lines = toTranscriptLines(records[0]);
    expect(lines).toHaveLength(1);
    expect(lines[0].marker).toBe('❯');
    expect(lines[0].id).toBe('d2908088-b2ed-4344-bb3c-ee08e9366306#0');
    expect(lines[0].ts).toBe(1787843382986);
    expect(lines[0].text.startsWith('You are a throwaway probe for a 2-minute data-capture spike.')).toBe(true);
    expect(lines[0].text.includes('teammate-message')).toBe(false);
    // The wrapper goes; the prompt's own paragraphs stay, so a view can expand
    // the row into the shape it was written in.
    expect(lines[0].text.includes('\n')).toBe(true);
    expect(lines[0].text).not.toMatch(/\n{3,}| \n|\n /);
  });

  it('maps assistant text to ⏺', () => {
    const lines = toTranscriptLines(records[3]);
    expect(lines).toEqual([
      {
        id: 'ee1047d2-53a6-458e-ab4f-08286f35e1d0#0',
        marker: '⏺',
        text: "I'll run the probe steps exactly as specified.",
        ts: 1787843385081,
      },
    ]);
  });

  it('maps assistant tool_use to ⏺ with the salient input', () => {
    expect(toTranscriptLines(records[4])[0]).toEqual({
      id: '5412b8c2-5d6d-4ab3-8e71-04873ee86f26#0',
      marker: '⏺',
      text: 'Bash(sleep 10)',
      ts: 1787843385568,
    });
    expect(toTranscriptLines(records[5])[0].text).toBe('ToolSearch(select:TaskList,TaskUpdate,SendMessage)');
    expect(toTranscriptLines(records[8])[0].text).toBe('TaskList');
    expect(toTranscriptLines(records[19])[0].text).toBe('TaskUpdate(1)');
  });

  it('maps a plain tool_result to ⎿', () => {
    const lines = toTranscriptLines(records[7]);
    expect(lines).toEqual([
      {
        id: '1718c095-a1ed-4ac6-93ac-5d456ee54f88#0',
        marker: '⎿',
        text: '(Bash completed with no output)',
        ts: 1787843395618,
      },
    ]);
    expect(toTranscriptLines(records[9])[0].marker).toBe('⎿');
    // Two task rows, on two lines — they used to be run together into one.
    expect(toTranscriptLines(records[9])[0].text).toBe(
      '#1 [pending] SPIKE probe A — report your identity\n#2 [pending] SPIKE probe B — report your identity',
    );
  });

  it('maps an "Updated ..." tool_result to ✓', () => {
    expect(toTranscriptLines(records[12])).toEqual([
      {
        id: 'd44ab353-36d7-4fdf-8bde-705601b087e9#0',
        marker: '✓',
        text: 'Updated task #1 owner, status',
        ts: 1787843399365,
      },
    ]);
  });

  it('maps an errored tool_result to ✗ and a finding to !', () => {
    const errored: TranscriptRecord = {
      type: 'user',
      uuid: 'e1',
      timestamp: '2026-08-27T15:09:55.618Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', content: 'boom', is_error: true }],
      },
    };
    expect(toTranscriptLines(errored)[0].marker).toBe('✗');

    const finding: TranscriptRecord = {
      type: 'user',
      uuid: 'f1',
      timestamp: '2026-08-27T15:09:55.618Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', content: 'Found 3 issues in the auth path' }],
      },
    };
    expect(toTranscriptLines(finding)[0].marker).toBe('!');
  });

  it('maps a diffstat tool_result to +', () => {
    const diff: TranscriptRecord = {
      type: 'user',
      uuid: 'd1',
      timestamp: '2026-08-27T15:09:55.618Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', content: '2 files changed, 41 insertions(+), 6 deletions(-)' }],
      },
    };
    expect(toTranscriptLines(diff)[0].marker).toBe('+');
  });

  it('maps a delivered idle_notification frame to ○ and a plan request to ▲', () => {
    const idle: TranscriptRecord = {
      type: 'user',
      uuid: 'i1',
      timestamp: '2026-08-27T15:12:17.951Z',
      message: { role: 'user', content: frames[2] },
    };
    expect(frames[2].includes('idle_notification')).toBe(true);
    expect(toTranscriptLines(idle)[0].marker).toBe('○');
    expect(toTranscriptLines(idle)[0].ts).toBe(1787843537951);

    const plan: TranscriptRecord = {
      type: 'user',
      uuid: 'p1',
      timestamp: '2026-08-27T15:12:17.951Z',
      message: {
        role: 'user',
        content:
          '<teammate-message teammate_id="probe-alpha" color="blue">\n{"type":"plan_approval_request","requestId":"r1"}\n</teammate-message>',
      },
    };
    expect(toTranscriptLines(plan)[0].marker).toBe('▲');
  });

  it('maps a delivered task_assignment frame to ❯', () => {
    const lines = toTranscriptLines(records[22]);
    expect(lines).toHaveLength(1);
    expect(lines[0].marker).toBe('❯');
    expect(lines[0].text.startsWith('{"type":"task_assignment"')).toBe(true);
  });

  it('emits nothing for attachments and empty thinking blocks', () => {
    expect(toTranscriptLines(records[1])).toEqual([]);
    expect(toTranscriptLines(records[2])).toEqual([]);
    expect(toTranscriptLines(records[10])).toEqual([]);
  });
});

describe('currentToolOf', () => {
  it('returns the tool call rendered the same way as its transcript line', () => {
    expect(currentToolOf(records[4])).toBe('Bash(sleep 10)');
    expect(currentToolOf(records[8])).toBe('TaskList');
    expect(currentToolOf(records[11])).toBe('TaskUpdate(1)');

    const huge: TranscriptRecord = {
      type: 'assistant',
      uuid: 'tool-huge',
      timestamp: '2026-08-27T15:09:55.618Z',
      message: {
        content: [{ type: 'tool_use', name: 'Bash', input: { command: pattern(30_000) } }],
      },
    };
    expect(currentToolOf(huge)).toBe(toTranscriptLines(huge)[0].text);
    expect(currentToolOf(huge)!.length).toBeLessThanOrEqual(TRANSCRIPT_TEXT_CAP);
  });

  it('returns undefined for records with no tool call', () => {
    expect(currentToolOf(records[0])).toBeUndefined();
    expect(currentToolOf(records[3])).toBeUndefined();
    expect(currentToolOf(records[7])).toBeUndefined();
  });
});

describe('TRANSCRIPT_TEXT_CAP', () => {
  const toolResult = (content: string): TranscriptRecord => ({
    type: 'user',
    uuid: 'cap-1',
    timestamp: '2026-08-27T15:09:55.618Z',
    message: { role: 'user', content: [{ type: 'tool_result', content }] },
  });

  it('caps an oversized tool_result at TRANSCRIPT_TEXT_CAP', () => {
    const source = pattern(30_000);
    const line = toTranscriptLines(toolResult(source))[0];
    expect(line.text).toHaveLength(TRANSCRIPT_TEXT_CAP);
    expect(line.text.endsWith('…')).toBe(true);
    expect(line.text.slice(0, 200)).toBe(source.slice(0, 200));
  });

  it('leaves a line at or under the cap byte-identical', () => {
    const exact = pattern(TRANSCRIPT_TEXT_CAP);
    const short = pattern(100);
    expect(toTranscriptLines(toolResult(exact))[0].text).toBe(exact);
    expect(toTranscriptLines(toolResult(short))[0].text).toBe(short);
    expect(toTranscriptLines(toolResult(exact))[0].text.endsWith('…')).toBe(false);
    expect(toTranscriptLines(toolResult(short))[0].text.endsWith('…')).toBe(false);
  });

  it('never truncates in the middle of a surrogate pair', () => {
    // the emoji straddles the cut: its high surrogate lands on the last kept index
    const text = toTranscriptLines(toolResult(`${pattern(998)}😀${pattern(200)}`))[0].text;
    expect(text.length).toBeLessThanOrEqual(TRANSCRIPT_TEXT_CAP);
    expect(text).not.toMatch(/[\uD800-\uDBFF]/);
    // JSON.stringify escapes a lone surrogate rather than dropping it, and the
    // browser paints the escape as U+FFFD
    expect(JSON.stringify(text)).not.toMatch(/\\ud[89ab]/i);
    expect([...(JSON.parse(JSON.stringify(text)) as string)]).toHaveLength([...text].length);
  });

  it('keeps a surrogate pair that fits under the cap', () => {
    const source = `😀${pattern(10)}`;
    expect(toTranscriptLines(toolResult(source))[0].text).toBe(source);
  });
});

describe('structure worth expanding', () => {
  const assistant = (blocks: unknown[]): TranscriptRecord => ({
    type: 'assistant',
    uuid: 'struct-1',
    timestamp: '2026-08-27T15:09:55.618Z',
    message: { role: 'assistant', content: blocks },
  });
  const bash = (command: string) => assistant([{ type: 'tool_use', name: 'Bash', input: { command } }]);
  const shown = (rec: TranscriptRecord) => toTranscriptLines(rec)[0].text;

  it('keeps the line breaks of a multi-line message, so a view can expand it', () => {
    const body = '## Result\n\n| what | n |\n| --- | --- |\n| tests | 571 |\n\nAll green.';
    expect(shown(assistant([{ type: 'text', text: body }]))).toBe(body);
  });

  it('still squashes indentation runs, which carry no structure at a 47-char width', () => {
    expect(shown(assistant([{ type: 'text', text: 'one\n\n\n\n   two    three' }]))).toBe(
      'one\n\ntwo three',
    );
  });

  it('drops a leading cd into the project, which was 43 of the 47 visible characters', () => {
    expect(shown(bash('cd /Users/alanoliv/code/agents-team-ui; npm test'))).toBe('Bash(npm test)');
    expect(shown(bash('cd /repo && git log --oneline'))).toBe('Bash(git log --oneline)');
    // A newline separates them as often as `;` does — every multi-line command
    // this project writes opens that way.
    expect(shown(bash('cd /Users/alanoliv/code/agents-team-ui\nnpm test'))).toBe('Bash(npm test)');
  });

  it('renders two commands that share that prefix differently — the whole point', () => {
    const a = shown(bash('cd /Users/alanoliv/code/agents-team-ui; git log --oneline'));
    const b = shown(bash('cd /Users/alanoliv/code/agents-team-ui; npx vite build'));
    // Both used to open with the same 43 characters, so a 47-char Wall column
    // showed two characters of difference. The command has to lead.
    expect(a.startsWith('Bash(cd ')).toBe(false);
    expect(b.startsWith('Bash(cd ')).toBe(false);
    expect(a.slice(0, 12)).not.toBe(b.slice(0, 12));
  });

  it('never eats a cd that is a real argument rather than a prefix', () => {
    for (const cmd of [
      'git log | grep cd',
      'echo "cd /tmp"',
      'rg --cwd /repo pattern',
      'cd',
      'cdk deploy; ls',
    ]) {
      expect(shown(bash(cmd))).toBe(`Bash(${cmd})`);
    }
  });
});
