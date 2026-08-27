# Agent Teams Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web console that renders live Claude Code agent-teams state — every teammate's transcript, per-agent context and cost, the shared task list, mailbox traffic — and lets the operator message teammates, approve plans, answer permission prompts, and interrupt or stop agents.

**Architecture:** One Node process both observes and controls. It ingests push events from Claude Code `type:"http"` hooks plus the `statusLine`/`subagentStatusLine` command hooks, reconciles against `fs.watch` over `~/.claude/{projects,teams,tasks,sessions}`, appends everything to a SQLite event log, folds that log into a `TeamState`, and pushes it over SSE. Writes go back through the teammate mailbox protocol and through held `PermissionRequest` hook responses. The React front end renders the five `#4a` views behind a status-bar switcher with fixed chrome above and below.

**Tech Stack:** TypeScript 7 (strict, ESM) · Node 22.17 · Vite 8 + React 19 · vitest 4 · better-sqlite3 13 (WAL) · proper-lockfile 4 · tsx

**Spec:** `docs/superpowers/specs/2026-08-27-agent-teams-console-design.md` — read it alongside this plan. Every task argues from it; §2 in particular is the verified data contract and is not negotiable.

## Global Constraints

- **Build target is `#4a`**, lines 40–348 of `design_handoff_agent_teams_console/Octo Session Console.dc.html`. Its DOM and CSS values are the visual truth. Three README behaviours are folded back on top: the current-tool row in wall columns, wall hover + click-to-focus, and the two-line mailbox footer. Branch, PR and diffstat are **dropped** — the view switcher took that space.
- **The pinned type contract in Task 1's `src/shared/domain.ts` is frozen.** Never rename an exported symbol, change a property's casing, or add a field to a contract type. If a task needs a helper the contract does not define, define it inside that task's own module.
- **Node ≥ 22.17, ESM only** (`"type": "module"`). No CommonJS.
- **Relative imports are EXTENSIONLESS** (`from './catalog'`), not `.js`. `tsconfig` uses `moduleResolution: bundler`, and both `tsx` (dev/start) and Vite (web) resolve them. Verified: `npx tsx` runs an extensionless relative import; plain `node` ESM does not — which is why the server is BUNDLED for production rather than emitted file-by-file.
- **Server binds `127.0.0.1` only**, default port **4823**. No authentication, no external interface.
- **Hook endpoints must never block.** Claude Code hooks are synchronous and stall the agent's turn; the default timeout is **600 000 ms**. Every endpoint returns `200 {}` immediately, wrapped so a thrown error cannot escape — the one exception is the deliberate `PermissionRequest` hold in Task 15, which auto-denies at 90 % of its timeout.
- **Never write to `~/.claude/settings.json` as a side effect.** Hook installation is an explicit `setup` command that prints the block and writes only on confirmation (Task 17).
- **Never hand-edit `config.json` or the task files.** They are observed state. The only sanctioned writes are teammate inbox files, under `proper-lockfile`.
- **`--read-only` disables every control route** (409 with an explanatory body) and the UI disables the controls rather than failing on click.
- **Model pricing and context windows live in `catalog.json`, editable config, never constants.** Claude Code's own baked table is stale for Sonnet 5 ($3/$15 baked vs $2/$10 live).
- **Token accounting: dedupe by `message.id`, take max `output_tokens`.** Naive per-line summation over-counts output by up to 2.63×. Sum top-level `usage` only, never `usage.iterations`.
- **The console covers agent TEAMS only — never ordinary subagents.** A team member is an agent that appears in `config.json` `members[]` and whose sidecar carries `taskKind: "in_process_teammate"`. Agent-tool subagents and workflow fan-outs are neither, and must not be ingested, stored, counted in totals, or rendered. Verified in the capture spike: six workflow subagents were live and `members[]` still held only the lead. Enforced at three points — the transcript ingest path filter and pending buffer (Task 13), the `substatus` row filter (Task 14), and the roster join (Task 6).
- **Scope is in-process teammates only** (`backendType: "in-process"`). `tmux` and `iterm2` backends are out of scope for v1.
- **Copy is exact.** UI strings — `NEEDS YOU · N`, `claiming is file-locked · completing a task unblocks its dependents`, `teammates message each other directly — the lead doesn't relay`, `↑↓ select · ⏎ open · esc interrupt · x stop · ⌃T tasks` — are reproduced character for character, including the `·` separators and the typographic apostrophe.
- **Colours: five non-token values get explicit names** in `theme.css` — `--terminal-ground #12141f`, `--row-hairline #1b1d2b`, `--attention #d99e5c`, `--attention-border #6b4f2c`, `--failure-rose #c98d8d`. Everything else comes from the Nocturne tokens. The twelve portrait skin hexes are the only other non-token colours.
- **Type below 10 px is never used.** Transcript 11.5 px, status bar 12.5 px, agent name 13 px.
- **Tests assert real values from `fixtures/`,** which holds data captured from a genuine 4-member team run. No invented expected values.

---


### Task 1: Project scaffold and the pinned domain contract

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`, `src/shared/domain.ts`
- Test: `src/shared/domain.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: every type in the pinned contract — `AgentStatus`, `TaskState`, `ViewId`, `Marker`, `PortraitId`, `TranscriptLine`, `Agent`, `Task`, `ProtocolFrameType`, `MailMessage`, `NeedsYouItem`, `RateLimits`, `TeamState` — exported from `src/shared/domain.ts`

- [ ] **Step 1: Write the failing test**

First create the harness the test needs to run at all:

```bash
cd /Users/alanoliv/code/agents-team-ui
git init
mkdir -p src/shared src/server src/web
```

`package.json`:

```json
{
  "name": "agent-teams-console",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server/index.ts & vite",
    "build": "vite build",
    "start": "tsx src/server/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "proper-lockfile": "^4.1.2",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.13.1",
    "@types/proper-lockfile": "^4.1.4",
    "@types/react": "^19.0.8",
    "@types/react-dom": "^19.0.3",
    "@vitejs/plugin-react": "^4.3.4",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vite": "^6.1.0",
    "vitest": "^3.0.5"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4823',
      '/stream': 'http://127.0.0.1:4823',
    },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
```

`.gitignore`:

```
node_modules/
dist/
*.sqlite
*.sqlite-wal
*.sqlite-shm
.DS_Store
```

```bash
cd /Users/alanoliv/code/agents-team-ui && npm install
```

Now the test — `src/shared/domain.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Agent, MailMessage, Marker, Task, TranscriptLine } from './domain';

describe('domain contract', () => {
  it('types a transcript line with a marker from the pinned union', () => {
    const line: TranscriptLine = {
      id: 'd2908088-b2ed-4344-bb3c-ee08e9366306#0',
      marker: '❯',
      text: 'probe-alpha done',
      ts: 1787843382986,
    };
    expect(line.marker).toBe('❯');
    expect(line.ts).toBe(1787843382986);
  });

  it('types the lead agent from config-4-members.json with no colour', () => {
    const lead: Agent = {
      name: 'team-lead',
      agentId: 'team-lead@session-98b0b4a7',
      isLead: true,
      agentType: 'team-lead',
      model: 'claude-opus-5',
      role: '',
      status: 'working',
      contextTokens: 0,
      contextLimit: 1_000_000,
      compactAt: 967_000,
      costUsd: 0,
      startedAt: 1787798107581,
      transcript: [],
      unread: 0,
    };
    expect(lead.isLead).toBe(true);
    expect(lead.color).toBeUndefined();
    expect(lead.agentType).toBe('team-lead');
    expect(lead.compactAt).toBe(967_000);
  });

  it('types a mail message and a task with the pinned field names', () => {
    const mail: MailMessage = {
      msgId: '4a236089-e8f5-4688-bca2-e47c6f0d8310',
      from: 'probe-alpha',
      to: 'team-lead',
      text: 'probe-alpha reporting: I claimed task 1. This is spike traffic.',
      summary: 'probe-alpha claimed task 1',
      ts: 1787843417891,
      tsIsDelivery: false,
      color: 'blue',
    };
    const task: Task = {
      id: '1',
      subject: 'SPIKE probe A — report your identity',
      description: 'Throwaway spike task.',
      activeForm: 'Probing identity A',
      owner: 'probe-alpha',
      state: 'in_progress',
      blocks: [],
      blockedBy: [],
    };
    expect(mail.tsIsDelivery).toBe(false);
    expect(task.state).toBe('in_progress');
    expect(task.owner).toBe('probe-alpha');
  });

  it('pins the nine transcript markers', () => {
    const markers: Marker[] = ['❯', '⏺', '⎿', '✓', '✗', '+', '!', '▲', '○'];
    expect(markers).toHaveLength(9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/domain.test.ts -t "pins the nine transcript markers"`
Expected: FAIL with `Failed to resolve import "./domain" from "src/shared/domain.test.ts"`

- [ ] **Step 3: Write the implementation**

`src/shared/domain.ts` — the pinned contract, verbatim:

```ts
export type AgentStatus = 'working' | 'idle' | 'plan_pending' | 'failed' | 'blocked';
export type TaskState = 'pending' | 'in_progress' | 'completed' | 'plan_pending' | 'failed' | 'blocked';
export type ViewId = 'wall' | 'overview' | 'tasks' | 'rail' | 'grid';
export type Marker = '❯' | '⏺' | '⎿' | '✓' | '✗' | '+' | '!' | '▲' | '○';
export type PortraitId = 'lead' | 'security' | 'perf' | 'tests' | 'architect' | 'repro';

export interface TranscriptLine {
  id: string;          // transcript record uuid — React key, dedupe key
  marker: Marker;
  text: string;        // single line, already flattened; view does the ellipsis
  ts: number;          // epoch ms
}

export interface Agent {
  name: string;              // bare name — the join key across every source
  agentId: string;           // `${name}@${team}`
  isLead: boolean;
  agentType: string;         // from config.json members[].agentType — the badge
  model: string;             // canonical, e.g. 'claude-haiku-4-5'
  role: string;              // sidecar description, else truncated config prompt
  color?: string;
  status: AgentStatus;
  currentTool?: string;
  contextTokens: number;
  contextLimit: number;
  compactAt: number;
  costUsd: number;
  startedAt: number;         // epoch ms
  transcript: TranscriptLine[];
  unread: number;
  error?: string;
}

export interface Task {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  owner?: string;            // bare agent name
  state: TaskState;
  blocks: string[];
  blockedBy: string[];
}

export type ProtocolFrameType =
  | 'task_assignment' | 'task_completed' | 'idle_notification'
  | 'plan_approval_request' | 'plan_approval_response'
  | 'permission_request' | 'permission_response'
  | 'shutdown_request' | 'shutdown_approved' | 'shutdown_rejected'
  | 'mode_set_request' | 'teammate_terminated';

export interface MailMessage {
  msgId: string;             // msg_id from the inbox; synthesised for backfill frames
  from: string;
  to: string;
  text: string;
  summary?: string;
  ts: number;                // SENT time when known (inbox), delivery time otherwise
  tsIsDelivery: boolean;     // true when only the batched transcript time was available
  color?: string;
  protocol?: { type: ProtocolFrameType; data: Record<string, unknown> };
}

export interface NeedsYouItem {
  id: string;
  kind: 'plan' | 'permission' | 'failure';
  agent: string;
  reason: string;            // e.g. 'plan approval', 'failed'
  detail: string;            // e.g. '4 steps · step 4 drops migrations/legacy/'
  expiresAt?: number;        // permission holds only
}

export interface RateLimits { fiveHourPct: number; sevenDayPct: number; resetsAt?: string }

export interface TeamState {
  teamName: string;
  leadSessionId: string;
  branch?: string;
  startedAt: number;
  totalTokens: number;
  totalCostUsd: number;
  rateLimits?: RateLimits;
  agents: Agent[];
  tasks: Task[];
  mail: MailMessage[];
  needsYou: NeedsYouItem[];
  readOnly: boolean;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/domain.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/alanoliv/code/agents-team-ui && git add -A && git commit -m "feat: scaffold TypeScript/Vite/vitest harness and pin the shared domain contract"
```

---

### Task 2: Model catalog and resolution

**Files:**
- Create: `src/shared/catalog.json`, `src/shared/catalog.ts`
- Test: `src/shared/catalog.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `interface PricingTier { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; webSearch: number }`, `interface ResolvedModel { canonical: string; window: number; compactAt: number; pricing: PricingTier; approximate: boolean }`, `function resolveModel(raw: string | undefined): ResolvedModel`. Also `function compactAtFor(window: number): number` — a helper this phase defines, not in the pinned contract.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/catalog.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compactAtFor, resolveModel } from './catalog';

const usageRecords = JSON.parse(
  readFileSync(new URL('../../fixtures/usage-records.json', import.meta.url), 'utf8'),
) as Array<{ agent: string; id: string; model: string }>;

describe('resolveModel', () => {
  it('resolves the Opus 5 tier and its 1M window', () => {
    const m = resolveModel('claude-opus-5');
    expect(m.canonical).toBe('claude-opus-5');
    expect(m.window).toBe(1_000_000);
    expect(m.compactAt).toBe(967_000);
    expect(m.approximate).toBe(false);
    expect(m.pricing).toEqual({
      input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, webSearch: 0.01,
    });
  });

  it('resolves the Sonnet 5 tier at the live $2/$10 rate, not the stale baked one', () => {
    const m = resolveModel('claude-sonnet-5');
    expect(m.pricing).toEqual({
      input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, webSearch: 0.01,
    });
    expect(m.window).toBe(1_000_000);
    expect(m.compactAt).toBe(967_000);
  });

  it('resolves the Haiku 4.5 tier and its 200k window', () => {
    const m = resolveModel('claude-haiku-4-5');
    expect(m.pricing).toEqual({
      input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, webSearch: 0.01,
    });
    expect(m.window).toBe(200_000);
    expect(m.compactAt).toBe(167_000);
    expect(m.approximate).toBe(false);
  });

  it('resolves the aliases config.json records verbatim', () => {
    expect(resolveModel('haiku').canonical).toBe('claude-haiku-4-5');
    expect(resolveModel('opus').canonical).toBe('claude-opus-5');
    expect(resolveModel('sonnet').canonical).toBe('claude-sonnet-5');
    expect(resolveModel('haiku').window).toBe(200_000);
  });

  it('normalises dated ids', () => {
    const m = resolveModel('claude-haiku-4-5-20251001');
    expect(m.canonical).toBe('claude-haiku-4-5');
    expect(m.window).toBe(200_000);
    expect(m.approximate).toBe(false);
  });

  it('strips the [1m] suffix case-insensitively before lookup', () => {
    expect(resolveModel('claude-opus-5[1m]').canonical).toBe('claude-opus-5');
    expect(resolveModel('claude-opus-5[1M]').canonical).toBe('claude-opus-5');
    expect(resolveModel('claude-opus-5[1M]').approximate).toBe(false);
    expect(resolveModel('claude-haiku-4-5-20251001[1M]').canonical).toBe('claude-haiku-4-5');
  });

  it('falls back to the Opus-5 tier and a 200k window for an unknown model', () => {
    const m = resolveModel('claude-mystery-9');
    expect(m.canonical).toBe('claude-mystery-9');
    expect(m.window).toBe(200_000);
    expect(m.compactAt).toBe(167_000);
    expect(m.pricing.input).toBe(5);
    expect(m.pricing.output).toBe(25);
    expect(m.approximate).toBe(true);
  });

  it('falls back for a missing model', () => {
    const m = resolveModel(undefined);
    expect(m.canonical).toBe('unknown');
    expect(m.approximate).toBe(true);
    expect(m.window).toBe(200_000);
  });

  it('resolves every model present in usage-records.json', () => {
    const models = [...new Set(usageRecords.map((r) => r.model))].sort();
    expect(models).toEqual(['claude-haiku-4-5-20251001', 'claude-opus-5']);
    for (const raw of models) {
      expect(resolveModel(raw).approximate).toBe(false);
    }
    expect(resolveModel('claude-haiku-4-5-20251001').pricing.output).toBe(5);
    expect(resolveModel('claude-opus-5').pricing.output).toBe(25);
  });
});

describe('compactAtFor', () => {
  it('subtracts the 20k output reserve and 13k compact headroom', () => {
    expect(compactAtFor(1_000_000)).toBe(967_000);
    expect(compactAtFor(200_000)).toBe(167_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/catalog.test.ts -t "resolves the Opus 5 tier and its 1M window"`
Expected: FAIL with `Failed to resolve import "./catalog" from "src/shared/catalog.test.ts"`

- [ ] **Step 3: Write the implementation**

`src/shared/catalog.json` — editable config, not a constant (spec §4.2):

```json
{
  "version": "2.1.231",
  "outputReserve": 20000,
  "compactHeadroom": 13000,
  "fallbackModel": "claude-opus-5",
  "fallbackWindow": 200000,
  "aliases": {
    "opus": "claude-opus-5",
    "sonnet": "claude-sonnet-5",
    "haiku": "claude-haiku-4-5"
  },
  "models": {
    "claude-opus-5": {
      "window": 1000000,
      "pricing": { "input": 5, "output": 25, "cacheWrite5m": 6.25, "cacheWrite1h": 10, "cacheRead": 0.5, "webSearch": 0.01 }
    },
    "claude-sonnet-5": {
      "window": 1000000,
      "pricing": { "input": 2, "output": 10, "cacheWrite5m": 2.5, "cacheWrite1h": 4, "cacheRead": 0.2, "webSearch": 0.01 }
    },
    "claude-haiku-4-5": {
      "window": 200000,
      "pricing": { "input": 1, "output": 5, "cacheWrite5m": 1.25, "cacheWrite1h": 2, "cacheRead": 0.1, "webSearch": 0.01 }
    }
  }
}
```

`src/shared/catalog.ts`:

```ts
import catalogJson from './catalog.json';

export interface PricingTier {
  input: number; output: number;            // USD per million tokens
  cacheWrite5m: number; cacheWrite1h: number; cacheRead: number;
  webSearch: number;                        // USD per request
}
export interface ResolvedModel {
  canonical: string; window: number; compactAt: number; pricing: PricingTier; approximate: boolean;
}

interface CatalogFile {
  version: string;
  outputReserve: number;
  compactHeadroom: number;
  fallbackModel: string;
  fallbackWindow: number;
  aliases: Record<string, string>;
  models: Record<string, { window: number; pricing: PricingTier }>;
}

const catalog = catalogJson as CatalogFile;

export function compactAtFor(window: number): number {
  return window - catalog.outputReserve - catalog.compactHeadroom;
}

function normalise(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const noWindowSuffix = lower.replace(/\[1m\]$/, '');
  const undated = noWindowSuffix.replace(/-\d{8}$/, '');
  return catalog.aliases[undated] ?? undated;
}

export function resolveModel(raw: string | undefined): ResolvedModel {
  const canonical = raw ? normalise(raw) : '';
  const entry = catalog.models[canonical];
  if (entry) {
    return {
      canonical,
      window: entry.window,
      compactAt: compactAtFor(entry.window),
      pricing: entry.pricing,
      approximate: false,
    };
  }
  return {
    canonical: canonical || 'unknown',
    window: catalog.fallbackWindow,
    compactAt: compactAtFor(catalog.fallbackWindow),
    pricing: catalog.models[catalog.fallbackModel].pricing,
    approximate: true,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/catalog.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/alanoliv/code/agents-team-ui && git add -A && git commit -m "feat: model catalog with alias, dated-id and [1m] resolution"
```

---

### Task 3: Token dedupe, cost and context occupancy

**Files:**
- Create: `src/shared/usage.ts`, `src/shared/transcript.ts` (the `TranscriptRecord` interface only — Task 4 adds the functions to the same file)
- Test: `src/shared/usage.test.ts`

**Interfaces:**
- Consumes: `resolveModel(raw: string | undefined): ResolvedModel`, `PricingTier`
- Produces: `interface Usage`, `interface UsageRecord { messageId: string; model: string; usage: Usage }`, `dedupeUsage(records: UsageRecord[]): UsageRecord[]`, `costOf(usage: Usage, tier: PricingTier): number`, `totalCost(records: UsageRecord[]): number`, `contextOccupancy(records: TranscriptRecord[]): number`, and `interface TranscriptRecord` exported from `src/shared/transcript.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/usage.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveModel } from './catalog';
import type { TranscriptRecord } from './transcript';
import { contextOccupancy, costOf, dedupeUsage, totalCost, type UsageRecord } from './usage';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/usage.test.ts -t "reproduces the verified 0.186288 on the Opus 5 tier"`
Expected: FAIL with `Failed to resolve import "./usage" from "src/shared/usage.test.ts"`

- [ ] **Step 3: Write the implementation**

`src/shared/transcript.ts` — the record shape only; Task 4 appends the three functions:

```ts
import type { Usage } from './usage';

export interface TranscriptRecord {           // one parsed JSONL line, loosely typed
  type?: string; uuid?: string; timestamp?: string; isSidechain?: boolean;
  isApiErrorMessage?: boolean; agentId?: string; subtype?: string;
  compactMetadata?: { postTokens?: number };
  message?: { id?: string; model?: string; role?: string; usage?: Usage; content?: unknown };
  toolUseResult?: unknown;
}
```

`src/shared/usage.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/usage.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/alanoliv/code/agents-team-ui && git add -A && git commit -m "feat: usage dedupe, verified cost formula and context occupancy"
```

---

### Task 4: Transcript line parsing and markers

**Files:**
- Edit: `src/shared/transcript.ts` (adds `parseLine`, `toTranscriptLines`, `currentToolOf` beneath the existing `TranscriptRecord`)
- Test: `src/shared/transcript.test.ts`

**Interfaces:**
- Consumes: `TranscriptRecord` (Task 3), `Marker`, `TranscriptLine` from `./domain`
- Produces: `parseLine(raw: string): TranscriptRecord | null`, `toTranscriptLines(rec: TranscriptRecord): TranscriptLine[]`, `currentToolOf(rec: TranscriptRecord): string | undefined`. Line ids are `` `${rec.uuid}#${index}` `` — a convention this phase defines, since one record can yield several lines.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/transcript.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { currentToolOf, parseLine, toTranscriptLines, type TranscriptRecord } from './transcript';

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
    expect(lines[0].text.includes('\n')).toBe(false);
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
    expect(toTranscriptLines(records[9])[0].text).toBe(
      '#1 [pending] SPIKE probe A — report your identity #2 [pending] SPIKE probe B — report your identity',
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
  });

  it('returns undefined for records with no tool call', () => {
    expect(currentToolOf(records[0])).toBeUndefined();
    expect(currentToolOf(records[3])).toBeUndefined();
    expect(currentToolOf(records[7])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify they fail**

Run: `npx vitest run src/shared/transcript.test.ts -t "maps assistant tool_use to ⏺ with the salient input"`
Expected: FAIL with `TypeError: toTranscriptLines is not a function`

- [ ] **Step 3: Write the implementation**

Replace `src/shared/transcript.ts` with:

```ts
import type { Marker, TranscriptLine } from './domain';
import type { Usage } from './usage';

export interface TranscriptRecord {           // one parsed JSONL line, loosely typed
  type?: string; uuid?: string; timestamp?: string; isSidechain?: boolean;
  isApiErrorMessage?: boolean; agentId?: string; subtype?: string;
  compactMetadata?: { postTokens?: number };
  message?: { id?: string; model?: string; role?: string; usage?: Usage; content?: unknown };
  toolUseResult?: unknown;
}

const TEAMMATE_OPEN = /^<teammate-message\s[^>]*>\r?\n?/;
const TEAMMATE_CLOSE = /\r?\n?<\/teammate-message>\s*$/;

const TOOL_INPUT_KEYS = [
  'command', 'file_path', 'path', 'pattern', 'query', 'url',
  'prompt', 'message', 'subject', 'description', 'taskId',
];

function flatten(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function parseLine(raw: string): TranscriptRecord | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as TranscriptRecord;
}

function describeTool(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return name;
  const fields = input as Record<string, unknown>;
  for (const key of TOOL_INPUT_KEYS) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim()) return `${name}(${flatten(value)})`;
  }
  return name;
}

function markerForUserText(body: string): Marker {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    try {
      const frame = JSON.parse(trimmed) as { type?: unknown };
      if (frame.type === 'idle_notification') return '○';
      if (typeof frame.type === 'string' && frame.type.endsWith('_request')) return '▲';
    } catch {
      // plain prose that merely starts with a brace
    }
  }
  return '❯';
}

function markerForResult(text: string, isError: boolean): Marker {
  if (isError) return '✗';
  if (/\b\d+ insertions?\(\+\)|\b\d+ deletions?\(-\)/.test(text)) return '+';
  if (/^(error|warning|failed|found \d+)/i.test(text)) return '!';
  if (/^(updated|created|wrote|applied|added|completed|done|success)/i.test(text)) return '✓';
  return '⎿';
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return flatten(content);
  if (Array.isArray(content)) {
    return flatten(
      content
        .map((block) => {
          if (block && typeof block === 'object') {
            const text = (block as { text?: unknown }).text;
            if (typeof text === 'string') return text;
          }
          return JSON.stringify(block);
        })
        .join(' '),
    );
  }
  return flatten(JSON.stringify(content ?? ''));
}

export function toTranscriptLines(rec: TranscriptRecord): TranscriptLine[] {
  if (!rec.uuid || !rec.timestamp) return [];
  const ts = Date.parse(rec.timestamp);
  if (Number.isNaN(ts)) return [];

  const drafts: Array<{ marker: Marker; text: string }> = [];
  const content = rec.message?.content;

  if (rec.type === 'user') {
    if (typeof content === 'string') {
      const body = content.replace(TEAMMATE_OPEN, '').replace(TEAMMATE_CLOSE, '');
      const text = flatten(body);
      if (text) drafts.push({ marker: markerForUserText(body), text });
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as { type?: string; content?: unknown; is_error?: boolean; text?: string };
        if (b.type === 'tool_result') {
          const text = resultText(b.content);
          if (text) drafts.push({ marker: markerForResult(text, b.is_error === true), text });
        } else if (b.type === 'text' && typeof b.text === 'string') {
          const text = flatten(b.text);
          if (text) drafts.push({ marker: '❯', text });
        }
      }
    }
  } else if (rec.type === 'assistant' && Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as { type?: string; text?: string; name?: string; input?: unknown };
      if (b.type === 'text' && typeof b.text === 'string') {
        const text = flatten(b.text);
        if (text) drafts.push({ marker: '⏺', text });
      } else if (b.type === 'tool_use' && typeof b.name === 'string') {
        drafts.push({ marker: '⏺', text: describeTool(b.name, b.input) });
      }
    }
  }

  return drafts.map((draft, i) => ({
    id: `${rec.uuid}#${i}`,
    marker: draft.marker,
    text: draft.text,
    ts,
  }));
}

export function currentToolOf(rec: TranscriptRecord): string | undefined {
  const content = rec.message?.content;
  if (rec.type !== 'assistant' || !Array.isArray(content)) return undefined;
  let found: string | undefined;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: string; name?: string; input?: unknown };
    if (b.type === 'tool_use' && typeof b.name === 'string') found = describeTool(b.name, b.input);
  }
  return found;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/transcript.test.ts src/shared/usage.test.ts`
Expected: PASS (28 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/alanoliv/code/agents-team-ui && git add -A && git commit -m "feat: transcript line parsing with marker heuristics and current-tool extraction"
```

---

### Task 5: Mailbox entries, backfill frames and merge

**Files:**
- Create: `src/shared/mailbox.ts`
- Test: `src/shared/mailbox.test.ts`

**Interfaces:**
- Consumes: `MailMessage`, `ProtocolFrameType` from `./domain`
- Produces: `interface InboxEntry`, `parseInboxEntry(e: InboxEntry, to: string): MailMessage`, `parseTeammateFrames(text: string, deliveredAt: number, to: string): MailMessage[]`, `mergeMail(existing: MailMessage[], incoming: MailMessage[]): MailMessage[]`. Backfill ids are `` `bk-${fnv1a32hex(from\0text\0ts)}` `` and merge folds a backfill copy onto the inbox copy by `from + to + text` — both conventions this phase defines, since a synthesised id can never equal the inbox `msg_id` uuid.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/mailbox.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mergeMail, parseInboxEntry, parseTeammateFrames, type InboxEntry } from './mailbox';

const snapshots = JSON.parse(
  readFileSync(new URL('../../fixtures/inbox-snapshots.json', import.meta.url), 'utf8'),
) as Array<{ path: string; observedAt: number; entries: InboxEntry[] }>;

const frames = (
  JSON.parse(
    readFileSync(new URL('../../fixtures/lead-transcript-teammate-frames.json', import.meta.url), 'utf8'),
  ) as Array<{ timestamp: string; frames: string[] }>
).flatMap((f) => f.frames);

const leadEntries = snapshots.filter((s) => s.path === 'team-lead.json').flatMap((s) => s.entries);
const alphaEntries = snapshots.filter((s) => s.path === 'probe-alpha.json').flatMap((s) => s.entries);

const DELIVERED_AT = 1787843537951; // 2026-08-27T15:12:17.951Z — the delivery batch

describe('parseInboxEntry', () => {
  it('parses a plain message with its real send time', () => {
    const charlie = leadEntries.find((e) => e.msg_id === '48ba3528-7a03-4d43-ab32-b3ef759ff2bd')!;
    expect(parseInboxEntry(charlie, 'team-lead')).toEqual({
      msgId: '48ba3528-7a03-4d43-ab32-b3ef759ff2bd',
      from: 'probe-charlie',
      to: 'team-lead',
      text: 'probe-charlie reporting: running on a different model so the console can prove per-agent model resolution.',
      summary: 'probe-charlie alive',
      ts: 1787843415734,
      tsIsDelivery: false,
      color: 'yellow',
      protocol: undefined,
    });
  });

  it('detects a task_assignment protocol frame riding inside text', () => {
    const assignment = alphaEntries.find((e) => e.msg_id === '45142e72-ccf0-493d-951c-900d73d989ec')!;
    const mail = parseInboxEntry(assignment, 'probe-alpha');
    expect(mail.protocol?.type).toBe('task_assignment');
    expect(mail.protocol?.data.taskId).toBe('1');
    expect(mail.protocol?.data.assignedBy).toBe('probe-alpha');
    expect(mail.ts).toBe(1787843399360);
    expect(mail.tsIsDelivery).toBe(false);
  });

  it('detects an idle_notification protocol frame', () => {
    const idle = leadEntries.find((e) => e.msg_id === 'c6390c86-1b02-43f4-b8bb-0a58ef1afd66')!;
    const mail = parseInboxEntry(idle, 'team-lead');
    expect(mail.protocol?.type).toBe('idle_notification');
    expect(mail.protocol?.data.idleReason).toBe('available');
    expect(mail.from).toBe('probe-charlie');
  });

  it('synthesises a stable id when the entry carries no msg_id', () => {
    const entry: InboxEntry = {
      from: 'probe-bravo',
      text: 'no id on this one',
      timestamp: '2026-08-27T15:10:27.630Z',
    };
    const a = parseInboxEntry(entry, 'team-lead');
    const b = parseInboxEntry(entry, 'team-lead');
    expect(a.msgId).toBe(b.msgId);
    expect(a.msgId.startsWith('bk-')).toBe(true);
  });
});

describe('parseTeammateFrames', () => {
  it('recovers all six real frames from the lead transcript', () => {
    const recovered = parseTeammateFrames(frames.join('\n'), DELIVERED_AT, 'team-lead');
    expect(recovered).toHaveLength(6);
    expect(recovered.map((m) => m.from)).toEqual([
      'probe-charlie', 'probe-alpha', 'probe-charlie', 'probe-bravo', 'probe-alpha', 'probe-bravo',
    ]);
    expect(recovered.every((m) => m.tsIsDelivery)).toBe(true);
    expect(recovered.every((m) => m.ts === DELIVERED_AT)).toBe(true);
    expect(recovered.every((m) => m.to === 'team-lead')).toBe(true);
  });

  it('recovers from, color, summary and body', () => {
    const recovered = parseTeammateFrames(frames.join('\n'), DELIVERED_AT, 'team-lead');
    expect(recovered[1]).toEqual({
      msgId: recovered[1].msgId,
      from: 'probe-alpha',
      to: 'team-lead',
      text: 'probe-alpha reporting: I claimed task 1. This is spike traffic.',
      summary: 'probe-alpha claimed task 1',
      ts: DELIVERED_AT,
      tsIsDelivery: true,
      color: 'blue',
      protocol: undefined,
    });
    expect(recovered[1].msgId.startsWith('bk-')).toBe(true);
  });

  it('handles a frame with no summary attribute and reads its protocol frame', () => {
    const recovered = parseTeammateFrames(frames.join('\n'), DELIVERED_AT, 'team-lead');
    expect(recovered[2].summary).toBeUndefined();
    expect(recovered[2].color).toBe('yellow');
    expect(recovered[2].protocol?.type).toBe('idle_notification');
  });

  it('is idempotent — re-parsing the same text yields the same ids', () => {
    const a = parseTeammateFrames(frames.join('\n'), DELIVERED_AT, 'team-lead');
    const b = parseTeammateFrames(frames.join('\n'), DELIVERED_AT, 'team-lead');
    expect(a.map((m) => m.msgId)).toEqual(b.map((m) => m.msgId));
  });

  it('returns an empty array when there is no frame', () => {
    expect(parseTeammateFrames('just prose', DELIVERED_AT, 'team-lead')).toEqual([]);
  });
});

describe('mergeMail', () => {
  it('merges the six inbox entries with the six backfill frames into six messages', () => {
    const inbox = leadEntries.map((e) => parseInboxEntry(e, 'team-lead'));
    const backfill = parseTeammateFrames(frames.join('\n'), DELIVERED_AT, 'team-lead');
    expect(inbox).toHaveLength(6);
    expect(backfill).toHaveLength(6);

    const merged = mergeMail(inbox, backfill);
    expect(merged).toHaveLength(6);
    expect(merged.every((m) => m.tsIsDelivery === false)).toBe(true);
  });

  it('lets the true send time win over the delivery batch time regardless of order', () => {
    const inbox = leadEntries.map((e) => parseInboxEntry(e, 'team-lead'));
    const backfill = parseTeammateFrames(frames.join('\n'), DELIVERED_AT, 'team-lead');

    for (const merged of [mergeMail(inbox, backfill), mergeMail(backfill, inbox)]) {
      expect(merged).toHaveLength(6);
      expect(merged[0].msgId).toBe('48ba3528-7a03-4d43-ab32-b3ef759ff2bd');
      expect(merged[0].from).toBe('probe-charlie');
      expect(merged[0].ts).toBe(1787843415734);
      expect(merged[0].tsIsDelivery).toBe(false);
      expect(merged[5].msgId).toBe('179b39e6-3516-490f-91f6-3a49a458175d');
      expect(merged[5].ts).toBe(1787843452579);
    }
  });

  it('keeps backfill-only messages at the delivery time', () => {
    const backfill = parseTeammateFrames(frames.join('\n'), DELIVERED_AT, 'team-lead');
    const merged = mergeMail([], backfill);
    expect(merged).toHaveLength(6);
    expect(merged.every((m) => m.tsIsDelivery)).toBe(true);
    expect(merged.every((m) => m.ts === DELIVERED_AT)).toBe(true);
  });

  it('dedupes a repeated inbox snapshot by msgId', () => {
    const inbox = leadEntries.map((e) => parseInboxEntry(e, 'team-lead'));
    expect(mergeMail(inbox, inbox)).toHaveLength(6);
  });

  it('sorts the result by timestamp ascending', () => {
    const inbox = leadEntries.map((e) => parseInboxEntry(e, 'team-lead'));
    const merged = mergeMail([], inbox);
    const stamps = merged.map((m) => m.ts);
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    expect(stamps).toEqual([
      1787843415734, 1787843417891, 1787843422099, 1787843427630, 1787843450152, 1787843452579,
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/mailbox.test.ts -t "recovers all six real frames from the lead transcript"`
Expected: FAIL with `Failed to resolve import "./mailbox" from "src/shared/mailbox.test.ts"`

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/mailbox.ts
import type { MailMessage, ProtocolFrameType } from './domain';

export interface InboxEntry {
  from: string; text: string; summary?: string; timestamp: string;
  color?: string; msgV?: number; msg_id?: string; type?: string; read?: boolean;
}

const PROTOCOL_TYPES = new Set<string>([
  'task_assignment', 'task_completed', 'idle_notification',
  'plan_approval_request', 'plan_approval_response',
  'permission_request', 'permission_response',
  'shutdown_request', 'shutdown_approved', 'shutdown_rejected',
  'mode_set_request', 'teammate_terminated',
] satisfies ProtocolFrameType[]);

const FRAME_RE = /<teammate-message\s+([^>]*?)>\r?\n?([\s\S]*?)\r?\n?<\/teammate-message>/g;
const ATTR_RE = /(\w+)="([^"]*)"/g;

function fnv1a32(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Backfilled frames carry no msg_id, so one is synthesised from the content the
// transcript does preserve. It is stable across re-reads of the same transcript.
function synthMsgId(from: string, text: string, ts: number): string {
  return `bk-${fnv1a32(`${from}\u0000${text}\u0000${ts}`)}`;
}

function detectProtocol(text: string): MailMessage['protocol'] {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const data = parsed as Record<string, unknown>;
  const type = data.type;
  if (typeof type !== 'string' || !PROTOCOL_TYPES.has(type)) return undefined;
  return { type: type as ProtocolFrameType, data };
}

export function parseInboxEntry(e: InboxEntry, to: string): MailMessage {
  const parsedTs = Date.parse(e.timestamp);
  const ts = Number.isNaN(parsedTs) ? 0 : parsedTs;
  return {
    msgId: e.msg_id ?? synthMsgId(e.from, e.text, ts),
    from: e.from,
    to,
    text: e.text,
    summary: e.summary,
    ts,
    tsIsDelivery: false,
    color: e.color,
    protocol: detectProtocol(e.text),
  };
}

export function parseTeammateFrames(text: string, deliveredAt: number, to: string): MailMessage[] {
  const out: MailMessage[] = [];
  FRAME_RE.lastIndex = 0;
  let frame: RegExpExecArray | null;
  while ((frame = FRAME_RE.exec(text)) !== null) {
    const attrs: Record<string, string> = {};
    ATTR_RE.lastIndex = 0;
    let attr: RegExpExecArray | null;
    while ((attr = ATTR_RE.exec(frame[1])) !== null) attrs[attr[1]] = attr[2];

    const from = attrs.teammate_id;
    if (!from) continue;
    const body = frame[2];
    out.push({
      msgId: synthMsgId(from, body, deliveredAt),
      from,
      to,
      text: body,
      summary: attrs.summary,
      ts: deliveredAt,
      tsIsDelivery: true,
      color: attrs.color,
      protocol: detectProtocol(body),
    });
  }
  return out;
}

function contentKey(m: MailMessage): string {
  return `${m.from}\u0000${m.to}\u0000${m.text}`;
}

export function mergeMail(existing: MailMessage[], incoming: MailMessage[]): MailMessage[] {
  const all = [...existing, ...incoming];
  // Inbox entries are folded first so their real msg_id becomes the canonical id
  // for a message the transcript also backfilled under a synthesised one.
  const ordered = [...all.filter((m) => !m.tsIsDelivery), ...all.filter((m) => m.tsIsDelivery)];

  const canonicalId = new Map<string, string>();
  const kept = new Map<string, MailMessage>();
  for (const message of ordered) {
    const key = contentKey(message);
    const id = canonicalId.get(key) ?? message.msgId;
    canonicalId.set(key, id);
    const previous = kept.get(id);
    if (!previous) {
      kept.set(id, { ...message, msgId: id });
      continue;
    }
    if (previous.tsIsDelivery && !message.tsIsDelivery) kept.set(id, { ...message, msgId: id });
  }
  return [...kept.values()].sort((a, b) => a.ts - b.ts);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/mailbox.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/alanoliv/code/agents-team-ui && git add -A && git commit -m "feat: mailbox parsing, transcript backfill frames and send-time-wins merge"
```

---

### Task 6: Roster join across config and sidecars

**Files:**
- Create: `src/shared/roster.ts`
- Test: `src/shared/roster.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `interface TeamConfigMember`, `interface TeamConfig`, `interface Sidecar`, `interface AgentIdentity`, `buildRoster(config: TeamConfig | null, sidecars: Array<{ meta: Sidecar; transcriptPath: string }>): AgentIdentity[]`. The 80-character role truncation and the "sidecar agentType is only usable when it differs from the name" rule are conventions this phase defines.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/roster.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRoster, type Sidecar, type TeamConfig } from './roster';

const config = JSON.parse(
  readFileSync(new URL('../../fixtures/config-4-members.json', import.meta.url), 'utf8'),
) as TeamConfig;

const metas = JSON.parse(
  readFileSync(new URL('../../fixtures/meta-sidecars.json', import.meta.url), 'utf8'),
) as Sidecar[];

const sidecars = metas.map((meta) => ({
  meta,
  transcriptPath: `/x/subagents/agent-a${meta.name}.jsonl`,
}));

describe('buildRoster', () => {
  it('joins the four config members to their sidecars on name', () => {
    const roster = buildRoster(config, sidecars);
    expect(roster).toHaveLength(4);
    expect(roster.map((a) => a.name)).toEqual([
      'team-lead', 'probe-alpha', 'probe-bravo', 'probe-charlie',
    ]);
    expect(roster[1].transcriptPath).toBe('/x/subagents/agent-aprobe-alpha.jsonl');
    expect(roster[0].transcriptPath).toBeUndefined();
  });

  it('marks only the lead as lead and gives it no colour, model or role', () => {
    const roster = buildRoster(config, sidecars);
    expect(roster[0].isLead).toBe(true);
    expect(roster[0].agentId).toBe('team-lead@session-98b0b4a7');
    expect(roster[0].color).toBeUndefined();
    expect(roster[0].rawModel).toBeUndefined();
    expect(roster[0].role).toBe('');
    expect(roster.filter((a) => a.isLead)).toHaveLength(1);
  });

  it('takes agentType from config, never from the sidecar which repeats the name', () => {
    const roster = buildRoster(config, sidecars);
    expect(metas[0].agentType).toBe('probe-alpha'); // the trap, straight from the fixture
    expect(roster[1].agentType).toBe('general-purpose');
    expect(roster[1].agentType).not.toBe('probe-alpha');
    expect(roster[2].agentType).toBe('Explore');
    expect(roster[3].agentType).toBe('general-purpose');
    expect(roster[0].agentType).toBe('team-lead');
  });

  it('takes the role from the sidecar description', () => {
    const roster = buildRoster(config, sidecars);
    expect(roster[1].role).toBe('Spike probe alpha');
    expect(roster[2].role).toBe('Spike probe bravo');
    expect(roster[3].role).toBe('Spike probe charlie');
  });

  it('falls back to a truncated config prompt when there is no sidecar', () => {
    const roster = buildRoster(config, []);
    expect(roster).toHaveLength(4);
    expect(roster[1].role).toBe(
      'You are a throwaway probe for a 2-minute data-capture spike. Do EXACTLY these st…',
    );
    expect(roster[1].role.includes('\n')).toBe(false);
  });

  it('carries the raw model verbatim, alias and all', () => {
    const roster = buildRoster(config, sidecars);
    expect(roster[1].rawModel).toBe('claude-opus-5');
    expect(roster[3].rawModel).toBe('haiku');
  });

  it('carries colour and joinedAt from config', () => {
    const roster = buildRoster(config, sidecars);
    expect(roster[1].color).toBe('blue');
    expect(roster[2].color).toBe('green');
    expect(roster[3].color).toBe('yellow');
    expect(roster[1].joinedAt).toBe(1787843382976);
  });

  it('works from sidecars alone after the lead exits and the team dir is gone', () => {
    const roster = buildRoster(null, sidecars);
    expect(roster).toHaveLength(3);
    expect(roster.map((a) => a.name)).toEqual(['probe-alpha', 'probe-bravo', 'probe-charlie']);
    expect(roster[0].agentId).toBe('probe-alpha@session-98b0b4a7');
    expect(roster[0].isLead).toBe(false);
    expect(roster[0].role).toBe('Spike probe alpha');
    expect(roster[0].color).toBe('blue');
    expect(roster[0].rawModel).toBe('claude-opus-5');
    // no config means no real subagent type — the sidecar only repeats the name
    expect(roster[0].agentType).toBe('');
  });

  it('appends a sidecar that config has not caught up with yet', () => {
    const extra: Sidecar = {
      agentType: 'probe-delta',
      description: 'Spike probe delta',
      name: 'probe-delta',
      spawnDepth: 0,
      model: 'claude-sonnet-5',
      taskKind: 'in_process_teammate',
      teamName: 'session-98b0b4a7',
      color: 'red',
    };
    const roster = buildRoster(config, [
      ...sidecars,
      { meta: extra, transcriptPath: '/x/subagents/agent-aprobe-delta.jsonl' },
    ]);
    expect(roster).toHaveLength(5);
    expect(roster[4].name).toBe('probe-delta');
    expect(roster[4].agentId).toBe('probe-delta@session-98b0b4a7');
    expect(roster[4].rawModel).toBe('claude-sonnet-5');
    expect(roster[4].joinedAt).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/roster.test.ts -t "takes agentType from config, never from the sidecar which repeats the name"`
Expected: FAIL with `Failed to resolve import "./roster" from "src/shared/roster.test.ts"`

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/roster.ts
export interface TeamConfigMember {
  agentId: string; name: string; agentType?: string; color?: string; model?: string;
  prompt?: string; planModeRequired?: boolean; cwd?: string; joinedAt: number;
  tmuxPaneId: string; backendType?: string; subscriptions: string[];
}
export interface TeamConfig {
  name: string; createdAt: number; leadAgentId: string; leadSessionId: string;
  members: TeamConfigMember[];
}
export interface Sidecar {
  agentType: string; description: string; name: string; spawnDepth: number;
  model: string; taskKind: string; teamName: string; color?: string;
  planModeRequired?: boolean; permissionMode?: string;
}
export interface AgentIdentity {
  name: string; agentId: string; isLead: boolean; agentType: string;
  rawModel?: string; role: string; color?: string; joinedAt: number;
  transcriptPath?: string;
}

const ROLE_MAX = 80;

// The sidecar's agentType is the teammate name again (spec §2.2), so it is only
// usable as a subagent type when it differs from the name.
function typeFromSidecar(meta: Sidecar | undefined): string {
  if (!meta) return '';
  return meta.agentType && meta.agentType !== meta.name ? meta.agentType : '';
}

function roleOf(meta: Sidecar | undefined, prompt: string | undefined): string {
  const described = meta?.description?.trim();
  if (described) return described;
  const flat = (prompt ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > ROLE_MAX ? `${flat.slice(0, ROLE_MAX)}…` : flat;
}

export function buildRoster(
  config: TeamConfig | null,
  sidecars: Array<{ meta: Sidecar; transcriptPath: string }>,
): AgentIdentity[] {
  const byName = new Map(sidecars.map((s) => [s.meta.name, s]));
  const roster: AgentIdentity[] = [];
  const claimed = new Set<string>();

  for (const member of config?.members ?? []) {
    const sidecar = byName.get(member.name);
    roster.push({
      name: member.name,
      agentId: member.agentId,
      isLead: member.agentId === config?.leadAgentId,
      agentType: member.agentType ?? typeFromSidecar(sidecar?.meta),
      rawModel: member.model ?? sidecar?.meta.model,
      role: roleOf(sidecar?.meta, member.prompt),
      color: member.color ?? sidecar?.meta.color,
      joinedAt: member.joinedAt,
      transcriptPath: sidecar?.transcriptPath,
    });
    claimed.add(member.name);
  }

  for (const sidecar of sidecars) {
    if (claimed.has(sidecar.meta.name)) continue;
    roster.push({
      name: sidecar.meta.name,
      agentId: `${sidecar.meta.name}@${sidecar.meta.teamName}`,
      isLead: false,
      agentType: typeFromSidecar(sidecar.meta),
      rawModel: sidecar.meta.model,
      role: roleOf(sidecar.meta, undefined),
      color: sidecar.meta.color,
      joinedAt: 0,
      transcriptPath: sidecar.transcriptPath,
    });
  }

  return roster;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/roster.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/alanoliv/code/agents-team-ui && git add -A && git commit -m "feat: roster join on name with the config agentType and sidecar description"
```

---

### Task 7: Status tables and task-state derivation

**Files:**
- Create: `src/shared/status.ts`
- Test: `src/shared/status.test.ts`

**Interfaces:**
- Consumes: `Agent`, `AgentStatus`, `TaskState` from `./domain`
- Produces: `interface StatusStyle { glyph: string; label: string; color: string }`, `const AGENT_STATUS: Record<AgentStatus, StatusStyle>`, `const TASK_STATUS: Record<TaskState, StatusStyle>`, `deriveTaskState(raw: 'pending' | 'in_progress' | 'completed', task: { owner?: string; blockedBy: string[] }, agents: Agent[]): TaskState`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/status.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Agent, AgentStatus } from './domain';
import { AGENT_STATUS, deriveTaskState, TASK_STATUS } from './status';

interface DiskTask {
  id: string; subject: string; description: string; activeForm: string;
  owner?: string; status: 'pending' | 'in_progress' | 'completed';
  blocks: string[]; blockedBy: string[];
}

const diskTasks = JSON.parse(
  readFileSync(new URL('../../fixtures/tasks.json', import.meta.url), 'utf8'),
) as DiskTask[];

const agent = (name: string, status: AgentStatus): Agent => ({
  name,
  agentId: `${name}@session-98b0b4a7`,
  isLead: false,
  agentType: 'general-purpose',
  model: 'claude-opus-5',
  role: 'Spike probe alpha',
  status,
  contextTokens: 34469,
  contextLimit: 1_000_000,
  compactAt: 967_000,
  costUsd: 0.464434,
  startedAt: 1787843382976,
  transcript: [],
  unread: 0,
});

describe('AGENT_STATUS', () => {
  it('carries the exact glyphs, labels and colours from the design', () => {
    expect(AGENT_STATUS.working).toEqual({ glyph: '●', label: 'working', color: 'var(--color-accent-400)' });
    expect(AGENT_STATUS.idle).toEqual({ glyph: '○', label: 'idle', color: 'var(--color-neutral-600)' });
    expect(AGENT_STATUS.plan_pending).toEqual({ glyph: '▲', label: 'plan approval', color: '#d99e5c' });
    expect(AGENT_STATUS.failed).toEqual({ glyph: '✗', label: 'failed', color: '#c98d8d' });
    expect(AGENT_STATUS.blocked).toEqual({ glyph: '⊘', label: 'blocked', color: 'var(--color-neutral-600)' });
    expect(Object.keys(AGENT_STATUS)).toHaveLength(5);
  });
});

describe('TASK_STATUS', () => {
  it('carries the exact glyphs, labels and colours from the design', () => {
    expect(TASK_STATUS.pending).toEqual({ glyph: '○', label: 'pending', color: 'var(--color-neutral-500)' });
    expect(TASK_STATUS.in_progress).toEqual({ glyph: '●', label: 'in progress', color: 'var(--color-accent-400)' });
    expect(TASK_STATUS.completed).toEqual({ glyph: '✓', label: 'completed', color: 'var(--color-accent-500)' });
    expect(TASK_STATUS.plan_pending).toEqual({ glyph: '▲', label: 'plan approval', color: '#d99e5c' });
    expect(TASK_STATUS.failed).toEqual({ glyph: '✗', label: 'failed', color: '#c98d8d' });
    expect(TASK_STATUS.blocked).toEqual({ glyph: '⊘', label: 'blocked', color: 'var(--color-neutral-600)' });
    expect(Object.keys(TASK_STATUS)).toHaveLength(6);
  });

  it('uses the attention amber for plan approval and the failure rose for failed', () => {
    expect(TASK_STATUS.plan_pending.color).toBe('#d99e5c');
    expect(TASK_STATUS.failed.color).toBe('#c98d8d');
  });
});

describe('deriveTaskState', () => {
  it('passes the three on-disk states through when nothing derives', () => {
    const unclaimed = diskTasks[0];
    expect(unclaimed.status).toBe('pending');
    expect(deriveTaskState(unclaimed.status, unclaimed, [])).toBe('pending');

    const claimed = diskTasks[2];
    expect(claimed.status).toBe('in_progress');
    expect(claimed.owner).toBe('probe-alpha');
    expect(deriveTaskState(claimed.status, claimed, [agent('probe-alpha', 'working')])).toBe('in_progress');

    const done = diskTasks[4];
    expect(done.status).toBe('completed');
    expect(deriveTaskState(done.status, done, [agent('probe-alpha', 'working')])).toBe('completed');
  });

  it('derives plan_pending from the owning agent', () => {
    const claimed = diskTasks[2];
    expect(deriveTaskState(claimed.status, claimed, [agent('probe-alpha', 'plan_pending')])).toBe('plan_pending');
  });

  it('derives failed from the owning agent', () => {
    const claimed = diskTasks[2];
    expect(deriveTaskState(claimed.status, claimed, [agent('probe-alpha', 'failed')])).toBe('failed');
  });

  it('derives blocked from a non-empty blockedBy', () => {
    expect(deriveTaskState('pending', { blockedBy: ['1'] }, [])).toBe('blocked');
    expect(deriveTaskState('in_progress', { owner: 'probe-alpha', blockedBy: ['1', '2'] }, [
      agent('probe-alpha', 'working'),
    ])).toBe('blocked');
  });

  it('derives blocked from a blocked owner', () => {
    expect(deriveTaskState('in_progress', { owner: 'probe-alpha', blockedBy: [] }, [
      agent('probe-alpha', 'blocked'),
    ])).toBe('blocked');
  });

  it('lets completed beat every derived state', () => {
    expect(deriveTaskState('completed', { owner: 'probe-alpha', blockedBy: ['1'] }, [
      agent('probe-alpha', 'failed'),
    ])).toBe('completed');
  });

  it('ignores an owner that is not in the roster', () => {
    expect(deriveTaskState('in_progress', { owner: 'probe-ghost', blockedBy: [] }, [
      agent('probe-alpha', 'failed'),
    ])).toBe('in_progress');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/status.test.ts -t "carries the exact glyphs, labels and colours from the design"`
Expected: FAIL with `Failed to resolve import "./status" from "src/shared/status.test.ts"`

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/status.ts
import type { Agent, AgentStatus, TaskState } from './domain';

export interface StatusStyle { glyph: string; label: string; color: string }

export const AGENT_STATUS: Record<AgentStatus, StatusStyle> = {
  working: { glyph: '●', label: 'working', color: 'var(--color-accent-400)' },
  idle: { glyph: '○', label: 'idle', color: 'var(--color-neutral-600)' },
  plan_pending: { glyph: '▲', label: 'plan approval', color: '#d99e5c' },
  failed: { glyph: '✗', label: 'failed', color: '#c98d8d' },
  blocked: { glyph: '⊘', label: 'blocked', color: 'var(--color-neutral-600)' },
};

export const TASK_STATUS: Record<TaskState, StatusStyle> = {
  pending: { glyph: '○', label: 'pending', color: 'var(--color-neutral-500)' },
  in_progress: { glyph: '●', label: 'in progress', color: 'var(--color-accent-400)' },
  completed: { glyph: '✓', label: 'completed', color: 'var(--color-accent-500)' },
  plan_pending: { glyph: '▲', label: 'plan approval', color: '#d99e5c' },
  failed: { glyph: '✗', label: 'failed', color: '#c98d8d' },
  blocked: { glyph: '⊘', label: 'blocked', color: 'var(--color-neutral-600)' },
};

export function deriveTaskState(
  raw: 'pending' | 'in_progress' | 'completed',
  task: { owner?: string; blockedBy: string[] },
  agents: Agent[],
): TaskState {
  if (raw === 'completed') return 'completed';
  const owner = task.owner ? agents.find((a) => a.name === task.owner) : undefined;
  if (owner?.status === 'plan_pending') return 'plan_pending';
  if (owner?.status === 'failed') return 'failed';
  if (task.blockedBy.length > 0 || owner?.status === 'blocked') return 'blocked';
  return raw;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/status.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/alanoliv/code/agents-team-ui && git add -A && git commit -m "feat: agent and task status tables plus UI-only task state derivation"
```

---

### Task 8: Portrait sprites and inline SVG

**Files:**
- Create: `src/shared/portrait.ts`
- Test: `src/shared/portrait.test.ts`

**Interfaces:**
- Consumes: `PortraitId` from `./domain`
- Produces: `portraitFor(agent: { name: string; agentType: string; isLead: boolean }): { portrait: PortraitId; skinIndex: number }`, `portraitSvg(portrait: PortraitId, skinIndex: number): string`. Also `const SPRITES: Record<PortraitId, string[]>`, `const SPRITE_COLORS: Record<string, string>`, `const SKIN_PAIRS: Record<PortraitId, [string, string]>`, `const PORTRAIT_IDS: PortraitId[]` — data exports this phase defines so the sprites can be asserted directly.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/portrait.test.ts
import { describe, expect, it } from 'vitest';
import type { PortraitId } from './domain';
import { PORTRAIT_IDS, portraitFor, portraitSvg, SKIN_PAIRS, SPRITE_COLORS, SPRITES } from './portrait';

const countPaths = (svg: string): number => (svg.match(/<path /g) ?? []).length;

describe('sprite data', () => {
  it('holds six sprites, each exactly 12 rows of 12 characters', () => {
    expect(PORTRAIT_IDS).toEqual(['lead', 'security', 'perf', 'tests', 'architect', 'repro']);
    expect(Object.keys(SPRITES)).toHaveLength(6);
    for (const id of PORTRAIT_IDS) {
      const grid = SPRITES[id];
      expect(grid, id).toHaveLength(12);
      for (const row of grid) expect(row.length, `${id}:${row}`).toBe(12);
    }
  });

  it('carries the prototype palette verbatim', () => {
    expect(SPRITE_COLORS).toEqual({
      a: '#b5abfc', b: '#5d5294', h: '#3f424d', k: '#292b31',
      w: '#e9e9ed', d: '#d99e5c', e: '#c98d8d',
    });
  });

  it('carries the twelve skin hexes as six pairs', () => {
    expect(SKIN_PAIRS).toEqual({
      lead: ['#e0c3a8', '#b99a80'],
      security: ['#8d6a52', '#6f5240'],
      perf: ['#c9a88f', '#a3846e'],
      tests: ['#e6cdb4', '#c2a68c'],
      architect: ['#a87c5e', '#86603f'],
      repro: ['#d9b89c', '#b2937a'],
    });
    expect(Object.values(SKIN_PAIRS).flat()).toHaveLength(12);
  });

  it('bakes the failure rose into the repro shirt', () => {
    expect(SPRITES.repro[9]).toBe('..eeeeeeee..');
  });
});

describe('portraitFor', () => {
  it('gives the lead the crown regardless of agentType', () => {
    expect(portraitFor({ name: 'team-lead', agentType: 'team-lead', isLead: true })).toEqual({
      portrait: 'lead',
      skinIndex: 1,
    });
  });

  it('matches agentType keywords before falling back to the name hash', () => {
    const cases: Array<[string, PortraitId]> = [
      ['security-auditor', 'security'],
      ['code-review', 'security'],
      ['perf-bench', 'perf'],
      ['test-writer', 'tests'],
      ['architect', 'architect'],
      ['planner', 'architect'],
      ['repro-runner', 'repro'],
      ['debugger', 'repro'],
    ];
    for (const [agentType, expected] of cases) {
      expect(portraitFor({ name: 'probe-alpha', agentType, isLead: false }).portrait, agentType).toBe(expected);
    }
  });

  it('falls back to a stable hash of the name for the real fixture teammates', () => {
    expect(portraitFor({ name: 'probe-alpha', agentType: 'general-purpose', isLead: false })).toEqual({
      portrait: 'perf',
      skinIndex: 2,
    });
    expect(portraitFor({ name: 'probe-bravo', agentType: 'Explore', isLead: false })).toEqual({
      portrait: 'perf',
      skinIndex: 2,
    });
    expect(portraitFor({ name: 'probe-charlie', agentType: 'general-purpose', isLead: false })).toEqual({
      portrait: 'architect',
      skinIndex: 4,
    });
  });

  it('is deterministic across repeated calls', () => {
    const first = portraitFor({ name: 'probe-charlie', agentType: 'general-purpose', isLead: false });
    for (let i = 0; i < 100; i++) {
      expect(portraitFor({ name: 'probe-charlie', agentType: 'general-purpose', isLead: false })).toEqual(first);
    }
  });

  it('always produces a skin index inside the pair range', () => {
    for (const name of ['team-lead', 'probe-alpha', 'probe-bravo', 'probe-charlie', '', 'x']) {
      const { skinIndex } = portraitFor({ name, agentType: 'general-purpose', isLead: false });
      expect(skinIndex).toBeGreaterThanOrEqual(0);
      expect(skinIndex).toBeLessThan(6);
    }
  });
});

describe('portraitSvg', () => {
  it('emits one path per distinct colour used by the sprite', () => {
    expect(countPaths(portraitSvg('lead', 0))).toBe(5);
    expect(countPaths(portraitSvg('security', 0))).toBe(6);
    expect(countPaths(portraitSvg('perf', 0))).toBe(5);
    expect(countPaths(portraitSvg('tests', 0))).toBe(5);
    expect(countPaths(portraitSvg('architect', 0))).toBe(6);
    expect(countPaths(portraitSvg('repro', 0))).toBe(5);
  });

  it('renders crisp 12x12 inline SVG', () => {
    const svg = portraitSvg('lead', 0);
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox="0 0 12 12"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('M3 0h1v1h-1z'); // lead row 0, column 3 is 'a'
  });

  it('picks the skin pair by index', () => {
    const zero = portraitSvg('lead', 0);
    expect(zero).toContain('#e0c3a8');
    expect(zero).toContain('#b99a80');

    const one = portraitSvg('lead', 1);
    expect(one).toContain('#8d6a52');
    expect(one).toContain('#6f5240');
    expect(one).not.toContain('#e0c3a8');
  });

  it('paints the repro shirt with the failure rose and the security badge with white', () => {
    expect(portraitSvg('repro', 0)).toContain('#c98d8d');
    expect(portraitSvg('security', 0)).toContain('#e9e9ed');
  });

  it('returns identical output for the same (portrait, skinIndex)', () => {
    expect(portraitSvg('architect', 4)).toBe(portraitSvg('architect', 4));
    expect(portraitSvg('architect', 4)).not.toBe(portraitSvg('architect', 3));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/portrait.test.ts -t "holds six sprites, each exactly 12 rows of 12 characters"`
Expected: FAIL with `Failed to resolve import "./portrait" from "src/shared/portrait.test.ts"`

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/portrait.ts
import type { PortraitId } from './domain';

// Lifted verbatim from "Octo Session Console.dc.html" lines 1237-1333.
export const SPRITES: Record<PortraitId, string[]> = {
  lead: [
    '...a.aa.a...',
    '...aaaaaa...',
    '..hhhhhhhh..',
    '..hssssssh..',
    '..hskssksh..',
    '..hssssssh..',
    '...sskkss...',
    '...SssssS...',
    '....SSSS....',
    '..aaaaaaaa..',
    '.aaaaaaaaaa.',
    '.aa.aaaa.aa.',
  ],
  security: [
    '............',
    '..bbbbbbbb..',
    '.bbbbbbbbbb.',
    '..bssssssb..',
    '..bskssksb..',
    '..bssssssb..',
    '...sskkss...',
    '...SssssS...',
    '....SSSS....',
    '..aaaaaaaa..',
    '.aaawaaaaaa.',
    '.aa.aaaa.aa.',
  ],
  perf: [
    '...aaaaaa...',
    '..ahhhhhha..',
    '..ahhhhhha..',
    '..assssssa..',
    '..askssksa..',
    '..hssssssh..',
    '...sskkss...',
    '...SssssS...',
    '....SSSS....',
    '..aaaaaaaa..',
    '.aaaaaaaaaa.',
    '.aa.aaaa.aa.',
  ],
  tests: [
    '............',
    '...aaaaaa...',
    '.aaaaaaaaaa.',
    '..hssssssh..',
    '..hskssksh..',
    '..hssssssh..',
    '...sskkss...',
    '...SssssS...',
    '....SSSS....',
    '..aaaaaaaa..',
    '.aaaaaaaaaa.',
    '.aa.aaaa.aa.',
  ],
  architect: [
    '............',
    '...bbbbbb...',
    '.bbbbbbbbbb.',
    '..hssssssh..',
    '..akkakkas..',
    '..hssssssh..',
    '...sskkss...',
    '...SssssS...',
    '....SSSS....',
    '..aaaaaaaa..',
    '.aaaaaaaaaa.',
    '.aa.aaaa.aa.',
  ],
  repro: [
    '..h..h..h...',
    '..hhhhhhhh..',
    '.hhhhhhhhhh.',
    '..hssssssh..',
    '..hskssksh..',
    '..hssssssh..',
    '...skkkks...',
    '...SssssS...',
    '....SSSS....',
    '..eeeeeeee..',
    '.eeeeeeeeee.',
    '.ee.eeee.ee.',
  ],
};

export const SPRITE_COLORS: Record<string, string> = {
  a: '#b5abfc', b: '#5d5294', h: '#3f424d', k: '#292b31',
  w: '#e9e9ed', d: '#d99e5c', e: '#c98d8d',
};

export const SKIN_PAIRS: Record<PortraitId, [string, string]> = {
  lead: ['#e0c3a8', '#b99a80'],
  security: ['#8d6a52', '#6f5240'],
  perf: ['#c9a88f', '#a3846e'],
  tests: ['#e6cdb4', '#c2a68c'],
  architect: ['#a87c5e', '#86603f'],
  repro: ['#d9b89c', '#b2937a'],
};

export const PORTRAIT_IDS: PortraitId[] = ['lead', 'security', 'perf', 'tests', 'architect', 'repro'];

const TYPE_PORTRAITS: Array<[RegExp, PortraitId]> = [
  [/security|review/, 'security'],
  [/perf/, 'perf'],
  [/test/, 'tests'],
  [/architect|plan/, 'architect'],
  [/repro|debug/, 'repro'],
];

const PAINT_ORDER = ['a', 'b', 'h', 'k', 'w', 'd', 'e', 's', 'S'];

function hashName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function portraitFor(agent: { name: string; agentType: string; isLead: boolean }): {
  portrait: PortraitId;
  skinIndex: number;
} {
  const skinIndex = hashName(agent.name) % PORTRAIT_IDS.length;
  if (agent.isLead) return { portrait: 'lead', skinIndex };
  const type = agent.agentType.toLowerCase();
  for (const [pattern, portrait] of TYPE_PORTRAITS) {
    if (pattern.test(type)) return { portrait, skinIndex };
  }
  return { portrait: PORTRAIT_IDS[skinIndex], skinIndex };
}

const svgCache = new Map<string, string>();

export function portraitSvg(portrait: PortraitId, skinIndex: number): string {
  const key = `${portrait}:${skinIndex}`;
  const cached = svgCache.get(key);
  if (cached !== undefined) return cached;

  const skin = SKIN_PAIRS[PORTRAIT_IDS[skinIndex % PORTRAIT_IDS.length]];
  const grid = SPRITES[portrait];
  const paths: string[] = [];

  for (const ch of PAINT_ORDER) {
    const fill = ch === 's' ? skin[0] : ch === 'S' ? skin[1] : SPRITE_COLORS[ch];
    let d = '';
    for (let y = 0; y < grid.length; y++) {
      const row = grid[y];
      for (let x = 0; x < row.length; x++) {
        if (row[x] === ch) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    if (d) paths.push(`<path fill="${fill}" d="${d}"/>`);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" shape-rendering="crispEdges">${paths.join('')}</svg>`;
  svgCache.set(key, svg);
  return svg;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — 12 portrait tests, 71 tests across `src/shared/`, and a clean typecheck

- [ ] **Step 5: Commit**

```bash
cd /Users/alanoliv/code/agents-team-ui && git add -A && git commit -m "feat: 12x12 portrait sprites, stable agent mapping and memoised inline SVG"
```


### Task 9: Append-only transcript tailer

**Files:**
- Create: `src/server/watch/tail.ts`
- Test: `src/server/watch/tail.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `interface TailState { inode: number; offset: number; partial: string }`, `emptyTailState(): TailState`, `drain(path: string, state: TailState): Promise<{ lines: string[]; state: TailState }>`, `watchAppendOnly(root: string, onLines: (path: string, lines: string[]) => void): { close(): void }`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/watch/tail.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyTailState, drain, watchAppendOnly } from './tail.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tail-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('drain', () => {
  it('recovers appended lines exactly and advances the offset', async () => {
    const file = path.join(dir, 'a.jsonl');
    await fs.writeFile(file, '{"i":1}\n{"i":2}\n');

    const first = await drain(file, emptyTailState());
    expect(first.lines).toEqual(['{"i":1}', '{"i":2}']);
    expect(first.state.offset).toBe(16);
    expect(first.state.partial).toBe('');

    await fs.appendFile(file, '{"i":3}\n');
    const second = await drain(file, first.state);
    expect(second.lines).toEqual(['{"i":3}']);
    expect(second.state.offset).toBe(24);
  });

  it('never emits a torn line and completes it on the next drain', async () => {
    const file = path.join(dir, 'b.jsonl');
    await fs.writeFile(file, '{"i":1}\n{"par');

    const first = await drain(file, emptyTailState());
    expect(first.lines).toEqual(['{"i":1}']);
    expect(first.state.partial).toBe('{"par');

    await fs.appendFile(file, 'tial":true}\n');
    const second = await drain(file, first.state);
    expect(second.lines).toEqual(['{"partial":true}']);
    expect(second.state.partial).toBe('');
  });

  it('resets to offset 0 when the file is truncated', async () => {
    const file = path.join(dir, 'c.jsonl');
    await fs.writeFile(file, '{"i":1}\n{"i":2}\n');
    const first = await drain(file, emptyTailState());
    expect(first.state.offset).toBe(16);

    await fs.truncate(file, 0);
    await fs.writeFile(file, '{"i":9}\n');
    const second = await drain(file, first.state);
    expect(second.lines).toEqual(['{"i":9}']);
    expect(second.state.offset).toBe(8);
  });

  it('resets to offset 0 when the inode changes', async () => {
    const file = path.join(dir, 'd.jsonl');
    await fs.writeFile(file, '{"i":1}\n{"i":2}\n');
    const first = await drain(file, emptyTailState());
    expect(first.lines).toHaveLength(2);

    await fs.rm(file);
    await fs.writeFile(file, '{"i":7}\n{"i":8}\n');
    const second = await drain(file, first.state);
    expect(second.lines).toEqual(['{"i":7}', '{"i":8}']);
    expect(second.state.offset).toBe(16);
  });

  it('returns no lines for a missing file', async () => {
    const out = await drain(path.join(dir, 'nope.jsonl'), emptyTailState());
    expect(out.lines).toEqual([]);
  });
});

describe('watchAppendOnly', () => {
  it('picks up a brand-new nested file (macOS reports rename, not change)', async () => {
    await fs.mkdir(path.join(dir, 'slug', 'subagents'), { recursive: true });
    const got: Array<{ path: string; lines: string[] }> = [];
    const w = watchAppendOnly(dir, (p, lines) => got.push({ path: p, lines }));
    try {
      const file = path.join(dir, 'slug', 'subagents', 'agent-aprobe-charlie-12ee4cb1ed35cf7c.jsonl');
      await fs.writeFile(file, '{"type":"assistant"}\n');
      const hit = await waitFor(() => got.find((g) => g.path === file));
      expect(hit.lines).toEqual(['{"type":"assistant"}']);

      await fs.appendFile(file, '{"type":"user"}\n');
      const second = await waitFor(() =>
        got.filter((g) => g.path === file).length > 1
          ? got.filter((g) => g.path === file)[1]
          : undefined,
      );
      expect(second.lines).toEqual(['{"type":"user"}']);
    } finally {
      w.close();
    }
  });

  it('ignores files that are not .jsonl', async () => {
    const got: string[] = [];
    const w = watchAppendOnly(dir, (p) => got.push(p));
    try {
      await fs.writeFile(path.join(dir, 'config.json'), '{}');
      await new Promise((r) => setTimeout(r, 300));
      expect(got).toEqual([]);
    } finally {
      w.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/watch/tail.test.ts`
Expected: FAIL with "Failed to resolve import \"./tail.js\" from \"src/server/watch/tail.test.ts\""

- [ ] **Step 3: Write the implementation**

```ts
// src/server/watch/tail.ts
import { promises as fs, watch } from 'node:fs';
import path from 'node:path';

export interface TailState {
  inode: number;
  offset: number;
  partial: string;
}

export function emptyTailState(): TailState {
  return { inode: 0, offset: 0, partial: '' };
}

export async function drain(
  filePath: string,
  state: TailState,
): Promise<{ lines: string[]; state: TailState }> {
  let st;
  try {
    st = await fs.stat(filePath);
  } catch {
    return { lines: [], state };
  }

  // Inode change means the file was replaced; size below our offset means it was
  // truncated. Both invalidate the offset, so start over from byte 0.
  let next: TailState = state;
  if (st.ino !== state.inode || st.size < state.offset) {
    next = { inode: st.ino, offset: 0, partial: '' };
  }

  const length = st.size - next.offset;
  if (length <= 0) return { lines: [], state: next };

  const buf = Buffer.alloc(length);
  let read = 0;
  const fh = await fs.open(filePath, 'r');
  try {
    while (read < length) {
      const r = await fh.read(buf, read, length - read, next.offset + read);
      if (r.bytesRead === 0) break;
      read += r.bytesRead;
    }
  } finally {
    await fh.close();
  }

  const chunk = next.partial + buf.subarray(0, read).toString('utf8');
  const cut = chunk.lastIndexOf('\n');
  const offset = next.offset + read;

  if (cut === -1) {
    return { lines: [], state: { inode: next.inode, offset, partial: chunk } };
  }

  const lines = chunk
    .slice(0, cut)
    .split('\n')
    .filter((l) => l.length > 0);

  return { lines, state: { inode: next.inode, offset, partial: chunk.slice(cut + 1) } };
}

export function watchAppendOnly(
  root: string,
  onLines: (path: string, lines: string[]) => void,
): { close(): void } {
  const states = new Map<string, TailState>();
  const queues = new Map<string, Promise<void>>();
  let closed = false;

  const pump = (file: string) => {
    const prev = queues.get(file) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        if (closed) return;
        const out = await drain(file, states.get(file) ?? emptyTailState());
        states.set(file, out.state);
        if (out.lines.length > 0) onLines(file, out.lines);
      })
      .catch(() => undefined);
    queues.set(file, next);
  };

  const watcher = watch(root, { recursive: true }, (eventType, filename) => {
    // macOS reports 'rename' for the first write to a new file; a watcher that
    // only handles 'change' never sees a teammate transcript appear.
    if (eventType !== 'rename' && eventType !== 'change') return;
    if (!filename) return;
    const name = typeof filename === 'string' ? filename : filename.toString();
    if (!name.endsWith('.jsonl')) return;
    pump(path.join(root, name));
  });
  watcher.on('error', () => undefined);

  return {
    close() {
      closed = true;
      watcher.close();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/watch/tail.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/watch/tail.ts src/server/watch/tail.test.ts && git commit -m "feat: append-only transcript tailer with inode, offset and partial-line recovery"
```

---

### Task 10: Atomic-rewrite JSON watcher

**Files:**
- Create: `src/server/watch/jsonfile.ts`
- Test: `src/server/watch/jsonfile.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `readJsonSafe<T>(path: string): Promise<T | null>`, `watchJsonTree(root: string, onChange: (path: string) => void): { close(): void }`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/watch/jsonfile.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonSafe, watchJsonTree } from './jsonfile.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsonfile-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('readJsonSafe', () => {
  it('parses a well-formed file', async () => {
    const file = path.join(dir, 'ok.json');
    await fs.writeFile(file, '{"name":"session-98b0b4a7"}');
    expect(await readJsonSafe<{ name: string }>(file)).toEqual({ name: 'session-98b0b4a7' });
  });

  it('retries once after 20ms and recovers a torn read', async () => {
    const file = path.join(dir, 'torn.json');
    await fs.writeFile(file, '{"name":"session-98b0b');
    setTimeout(() => {
      void fs.writeFile(file, '{"name":"session-98b0b4a7"}');
    }, 5);
    expect(await readJsonSafe<{ name: string }>(file)).toEqual({ name: 'session-98b0b4a7' });
  });

  it('returns null when both attempts fail', async () => {
    const file = path.join(dir, 'bad.json');
    await fs.writeFile(file, 'not json at all');
    expect(await readJsonSafe(file)).toBeNull();
  });

  it('returns null for a missing file', async () => {
    expect(await readJsonSafe(path.join(dir, 'gone.json'))).toBeNull();
  });
});

describe('watchJsonTree', () => {
  it('fires on the temp-file + rename arm of atomicWrite', async () => {
    await fs.mkdir(path.join(dir, 'session-98b0b4a7', 'inboxes'), { recursive: true });
    const seen: string[] = [];
    const w = watchJsonTree(dir, (p) => seen.push(p));
    try {
      const target = path.join(dir, 'session-98b0b4a7', 'inboxes', 'team-lead.json');
      const tmp = `${target}.tmp`;
      await fs.writeFile(tmp, '[{"from":"probe-alpha"}]');
      await fs.rename(tmp, target);
      const hit = await waitFor(() => seen.find((p) => p === target));
      expect(hit).toBe(target);
      expect(await readJsonSafe<Array<{ from: string }>>(target)).toEqual([{ from: 'probe-alpha' }]);
    } finally {
      w.close();
    }
  });

  it('fires on the in-place truncate(0) + write arm of atomicWrite', async () => {
    const target = path.join(dir, 'config.json');
    await fs.writeFile(target, '{"name":"old"}');
    const seen: string[] = [];
    const w = watchJsonTree(dir, (p) => seen.push(p));
    try {
      await new Promise((r) => setTimeout(r, 100));
      seen.length = 0;
      const fh = await fs.open(target, 'r+');
      await fh.truncate(0);
      await fh.write(Buffer.from('{"name":"session-98b0b4a7"}'), 0, 26, 0);
      await fh.close();
      const hit = await waitFor(() => seen.find((p) => p === target));
      expect(hit).toBe(target);
      expect(await readJsonSafe<{ name: string }>(target)).toEqual({ name: 'session-98b0b4a7' });
    } finally {
      w.close();
    }
  });

  it('ignores the proper-lockfile sibling', async () => {
    const seen: string[] = [];
    const w = watchJsonTree(dir, (p) => seen.push(p));
    try {
      await fs.mkdir(path.join(dir, 'team-lead.json.lock'), { recursive: true });
      await new Promise((r) => setTimeout(r, 300));
      expect(seen).toEqual([]);
    } finally {
      w.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/watch/jsonfile.test.ts`
Expected: FAIL with "Failed to resolve import \"./jsonfile.js\" from \"src/server/watch/jsonfile.test.ts\""

- [ ] **Step 3: Write the implementation**

```ts
// src/server/watch/jsonfile.ts
import { promises as fs, watch } from 'node:fs';
import path from 'node:path';

const RETRY_DELAY_MS = 20;
const DEBOUNCE_MS = 15;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
    } catch {
      // These files are atomically rewritten under a lock we deliberately do not
      // take, so a failed read is usually a torn read mid-rewrite, not corruption.
      if (attempt === 0) await delay(RETRY_DELAY_MS);
    }
  }
  return null;
}

export function watchJsonTree(
  root: string,
  onChange: (path: string) => void,
): { close(): void } {
  const timers = new Map<string, NodeJS.Timeout>();
  let closed = false;

  const watcher = watch(root, { recursive: true }, (eventType, filename) => {
    if (eventType !== 'rename' && eventType !== 'change') return;
    if (!filename) return;
    const name = typeof filename === 'string' ? filename : filename.toString();
    // `.json.lock` ends in `.lock`, so this also excludes proper-lockfile siblings.
    if (!name.endsWith('.json')) return;

    const full = path.join(root, name);
    const pending = timers.get(full);
    if (pending) clearTimeout(pending);
    // The truncate(0)+write arm fires twice; debouncing keeps the consumer out of
    // the zero-byte window between them.
    timers.set(
      full,
      setTimeout(() => {
        timers.delete(full);
        if (!closed) onChange(full);
      }, DEBOUNCE_MS),
    );
  });
  watcher.on('error', () => undefined);

  return {
    close() {
      closed = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      watcher.close();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/watch/jsonfile.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/watch/jsonfile.ts src/server/watch/jsonfile.test.ts && git commit -m "feat: atomic-rewrite JSON watcher handling both rename and truncate arms"
```

---

### Task 11: Append-only event store

**Files:**
- Create: `src/server/store.ts`
- Test: `src/server/store.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `type EventKind = 'roster' | 'transcript' | 'task' | 'mail' | 'hook' | 'statusline' | 'substatus' | 'needsyou' | 'needsyou-resolved'`, `interface StoredEvent { seq: number; ts: number; kind: EventKind; agent?: string; payload: unknown }`, `interface Store { append(kind, payload, agent?): StoredEvent; replay(): StoredEvent[]; close(): void }`, `openStore(dbPath: string): Store`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from './store.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'store-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('openStore', () => {
  it('survives close and reopen, replaying in seq order', () => {
    const dbPath = path.join(dir, 'events.db');
    const first = openStore(dbPath);
    const a = first.append('roster', { config: { name: 'session-98b0b4a7' } });
    const b = first.append('task', { id: '1', status: 'in_progress' });
    const c = first.append('mail', { to: 'team-lead' }, 'probe-alpha');
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    first.close();

    const second = openStore(dbPath);
    const events = second.replay();
    second.close();

    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(events.map((e) => e.kind)).toEqual(['roster', 'task', 'mail']);
    expect(events[0].payload).toEqual({ config: { name: 'session-98b0b4a7' } });
    expect(events[1].payload).toEqual({ id: '1', status: 'in_progress' });
    expect(events[2].agent).toBe('probe-alpha');
    expect(events[0].agent).toBeUndefined();
  });

  it('stamps ts with epoch milliseconds', () => {
    const store = openStore(path.join(dir, 'ts.db'));
    const before = Date.now();
    const ev = store.append('hook', { event: 'PreToolUse' }, 'probe-bravo');
    const after = Date.now();
    store.close();
    expect(ev.ts).toBeGreaterThanOrEqual(before);
    expect(ev.ts).toBeLessThanOrEqual(after);
  });

  it('creates the parent directory when it does not exist', () => {
    const store = openStore(path.join(dir, 'nested', 'deeper', 'events.db'));
    store.append('statusline', { fiveHourPct: 41 });
    expect(store.replay()).toHaveLength(1);
    store.close();
  });

  it('runs in WAL mode', () => {
    const dbPath = path.join(dir, 'wal.db');
    const store = openStore(dbPath);
    store.append('substatus', { agent: 'probe-charlie', tokenCount: 23639 });
    store.close();
    const reopened = openStore(dbPath);
    expect(reopened.replay()[0].payload).toEqual({ agent: 'probe-charlie', tokenCount: 23639 });
    reopened.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/store.test.ts`
Expected: FAIL with "Failed to resolve import \"./store.js\" from \"src/server/store.test.ts\""

- [ ] **Step 3: Write the implementation**

```ts
// src/server/store.ts
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type EventKind =
  | 'roster'
  | 'transcript'
  | 'task'
  | 'mail'
  | 'hook'
  | 'statusline'
  | 'substatus'
  | 'needsyou'
  | 'needsyou-resolved';

export interface StoredEvent {
  seq: number;
  ts: number;
  kind: EventKind;
  agent?: string;
  payload: unknown;
}

export interface Store {
  append(kind: EventKind, payload: unknown, agent?: string): StoredEvent;
  replay(): StoredEvent[];
  close(): void;
}

interface Row {
  seq: number;
  ts: number;
  kind: string;
  agent: string | null;
  payload: string;
}

export function openStore(dbPath: string): Store {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      seq     INTEGER PRIMARY KEY AUTOINCREMENT,
      ts      INTEGER NOT NULL,
      kind    TEXT    NOT NULL,
      agent   TEXT,
      payload TEXT    NOT NULL
    );
  `);

  const insert = db.prepare(
    'INSERT INTO events (ts, kind, agent, payload) VALUES (?, ?, ?, ?)',
  );
  const selectAll = db.prepare(
    'SELECT seq, ts, kind, agent, payload FROM events ORDER BY seq ASC',
  );

  return {
    append(kind, payload, agent) {
      const ts = Date.now();
      const info = insert.run(ts, kind, agent ?? null, JSON.stringify(payload ?? null));
      return { seq: Number(info.lastInsertRowid), ts, kind, agent, payload };
    },
    replay() {
      return (selectAll.all() as Row[]).map((r) => ({
        seq: r.seq,
        ts: r.ts,
        kind: r.kind as EventKind,
        agent: r.agent ?? undefined,
        payload: JSON.parse(r.payload) as unknown,
      }));
    },
    close() {
      db.close();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/store.ts src/server/store.test.ts && git commit -m "feat: append-only sqlite event store with WAL and seq-ordered replay"
```

---

### Task 12: Event-log projector

**Files:**
- Create: `src/server/project.ts`
- Test: `src/server/project.test.ts`

**Interfaces:**
- Consumes: `StoredEvent`, `EventKind` from `src/server/store.ts`; `buildRoster(config, sidecars)`, `TeamConfig`, `Sidecar`, `AgentIdentity` from `src/shared/roster.ts`; `resolveModel(raw)` from `src/shared/catalog.ts`; `dedupeUsage(records)`, `totalCost(records)`, `contextOccupancy(records)`, `UsageRecord` from `src/shared/usage.ts`; `toTranscriptLines(rec)`, `currentToolOf(rec)`, `TranscriptRecord` from `src/shared/transcript.ts`; `parseInboxEntry(e, to)`, `parseTeammateFrames(text, deliveredAt, to)`, `mergeMail(existing, incoming)`, `InboxEntry` from `src/shared/mailbox.ts`; `deriveTaskState(raw, task, agents)` from `src/shared/status.ts`; `TeamState`, `Agent`, `Task`, `TaskState`, `AgentStatus`, `MailMessage`, `NeedsYouItem`, `RateLimits`, `TranscriptLine` from `src/shared/domain.ts`
- Produces: `project(events: StoredEvent[], readOnly: boolean): TeamState`, plus the event payload shapes the contract does not define — **defined here, in this phase**: `TRANSCRIPT_CAP`, `RosterPayload`, `TranscriptPayload`, `TaskPayload`, `MailPayload`, `HookPayload`, `StatuslinePayload`, `SubstatusPayload`, `NeedsYouResolvedPayload`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/project.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { project } from './project.js';
import type { StoredEvent, EventKind } from './store.js';
import type { TeamConfig, Sidecar } from '../shared/roster.js';
import { parseLine, type TranscriptRecord } from '../shared/transcript.js';
import { contextOccupancy } from '../shared/usage.js';
import type { InboxEntry } from '../shared/mailbox.js';

const FIXTURES = path.resolve(process.cwd(), 'fixtures');
const fx = (name: string) => path.join(FIXTURES, name);
const readJson = <T>(name: string): T => JSON.parse(readFileSync(fx(name), 'utf8')) as T;

const TRANSCRIPTS: Array<[string, string]> = [
  ['probe-alpha', 'transcript-agent-aprobe-alpha-84fd551b27de6433.jsonl'],
  ['probe-bravo', 'transcript-agent-aprobe-bravo-babf58016882bc72.jsonl'],
  ['probe-charlie', 'transcript-agent-aprobe-charlie-12ee4cb1ed35cf7c.jsonl'],
];

function recordsOf(file: string): TranscriptRecord[] {
  return readFileSync(fx(file), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map(parseLine)
    .filter((r): r is TranscriptRecord => r !== null);
}

function buildLog(): StoredEvent[] {
  const config = readJson<TeamConfig>('config-4-members.json');
  const sidecars = readJson<Sidecar[]>('meta-sidecars.json').map((meta) => ({
    meta,
    transcriptPath: `/projects/slug/subagents/agent-a${meta.name}-0000000000000000.jsonl`,
  }));
  const tasks = readJson<Array<Record<string, unknown>>>('tasks.json');
  const snapshots = readJson<Array<{ path: string; entries: InboxEntry[] }>>('inbox-snapshots.json');

  const events: StoredEvent[] = [];
  let seq = 0;
  const push = (kind: EventKind, payload: unknown, agent?: string) => {
    events.push({ seq: ++seq, ts: 1787843400000 + seq, kind, agent, payload });
  };

  push('roster', { config, sidecars });
  for (const [agent, file] of TRANSCRIPTS) push('transcript', { agent, records: recordsOf(file) }, agent);
  for (const t of tasks) push('task', t);
  for (const s of snapshots) {
    push('mail', { source: 'inbox', to: s.path.replace(/\.json$/, ''), entries: s.entries }, s.path);
  }
  push('substatus', { agent: 'probe-charlie', tokenCount: 23639, contextWindowSize: 200000 }, 'probe-charlie');
  push('statusline', { branch: 'HEAD', fiveHourPct: 41, sevenDayPct: 12, resetsAt: '2026-08-27T20:00:00Z' }, 'team-lead');
  return events;
}

describe('project', () => {
  const state = project(buildLog(), false);
  const byName = Object.fromEntries(state.agents.map((a) => [a.name, a]));

  it('assembles the four-member roster from the real config', () => {
    expect(state.agents).toHaveLength(4);
    expect(state.agents.map((a) => a.name).sort()).toEqual([
      'probe-alpha',
      'probe-bravo',
      'probe-charlie',
      'team-lead',
    ]);
    expect(state.teamName).toBe('session-98b0b4a7');
    expect(state.leadSessionId).toBe('98b0b4a7-3206-455b-aaf6-a5a81ad1e283');
    expect(state.startedAt).toBe(1787798107581);
    expect(byName['team-lead'].isLead).toBe(true);
    expect(byName['probe-alpha'].agentType).toBe('general-purpose');
    expect(byName['probe-bravo'].agentType).toBe('Explore');
    expect(byName['probe-alpha'].color).toBe('blue');
  });

  it('gives each agent the window of its own resolved model', () => {
    expect(byName['probe-alpha'].model).toBe('claude-opus-5');
    expect(byName['probe-alpha'].contextLimit).toBe(1_000_000);
    expect(byName['probe-alpha'].compactAt).toBe(967_000);
    expect(byName['probe-bravo'].contextLimit).toBe(1_000_000);
    expect(byName['probe-charlie'].model).toBe('claude-haiku-4-5');
    expect(byName['probe-charlie'].contextLimit).toBe(200_000);
    expect(byName['probe-charlie'].compactAt).toBe(167_000);
  });

  it('computes non-zero per-agent and total cost', () => {
    expect(byName['probe-charlie'].costUsd).toBeCloseTo(0.044338, 4);
    expect(byName['probe-alpha'].costUsd).toBeGreaterThan(0);
    expect(byName['team-lead'].costUsd).toBe(0);
    expect(state.totalCostUsd).toBeCloseTo(
      byName['probe-alpha'].costUsd + byName['probe-bravo'].costUsd + byName['probe-charlie'].costUsd,
      9,
    );
    expect(state.totalCostUsd).toBeGreaterThan(0);
    expect(state.totalTokens).toBe(734808);
  });

  it('prefers substatus tokenCount and falls back to transcript occupancy', () => {
    expect(byName['probe-charlie'].contextTokens).toBe(23639);
    expect(byName['probe-alpha'].contextTokens).toBe(
      contextOccupancy(recordsOf('transcript-agent-aprobe-alpha-84fd551b27de6433.jsonl')),
    );
  });

  it('caps the in-memory transcript at 2000 lines per agent', () => {
    for (const a of state.agents) expect(a.transcript.length).toBeLessThanOrEqual(2000);
    expect(byName['probe-charlie'].transcript.length).toBeGreaterThan(0);
    expect(byName['team-lead'].transcript).toEqual([]);
  });

  it('folds tasks last-write-wins and derives state', () => {
    expect(state.tasks.map((t) => t.id)).toEqual(['1', '2']);
    const one = state.tasks.find((t) => t.id === '1')!;
    expect(one.state).toBe('completed');
    expect(one.owner).toBe('probe-alpha');
    expect(one.subject).toBe('SPIKE probe A — report your identity');
    expect(state.tasks.find((t) => t.id === '2')!.owner).toBe('probe-bravo');
  });

  it('merges mail by msg_id and counts pending unread per inbox', () => {
    expect(state.mail).toHaveLength(9);
    const claimed = state.mail.find((m) => m.msgId === '4a236089-e8f5-4688-bca2-e47c6f0d8310')!;
    expect(claimed.from).toBe('probe-alpha');
    expect(claimed.to).toBe('team-lead');
    expect(claimed.ts).toBe(1787843417891);
    expect(claimed.tsIsDelivery).toBe(false);
    expect(byName['probe-alpha'].unread).toBe(2);
    expect(byName['probe-bravo'].unread).toBe(1);
    expect(byName['team-lead'].unread).toBe(1);
    expect(byName['probe-charlie'].unread).toBe(0);
  });

  it('carries branch, rate limits and the read-only flag', () => {
    expect(state.branch).toBe('HEAD');
    expect(state.rateLimits).toEqual({
      fiveHourPct: 41,
      sevenDayPct: 12,
      resetsAt: '2026-08-27T20:00:00Z',
    });
    expect(state.readOnly).toBe(false);
    expect(project(buildLog(), true).readOnly).toBe(true);
  });

  it('drops resolved needs-you cards', () => {
    const log = buildLog();
    let seq = log.length;
    log.push({
      seq: ++seq,
      ts: 1787843500000,
      kind: 'needsyou',
      agent: 'probe-alpha',
      payload: { id: 'p1', kind: 'plan', agent: 'probe-alpha', reason: 'plan approval', detail: '4 steps' },
    });
    log.push({
      seq: ++seq,
      ts: 1787843500001,
      kind: 'needsyou',
      agent: 'probe-bravo',
      payload: { id: 'p2', kind: 'permission', agent: 'probe-bravo', reason: 'permission', detail: 'Bash' },
    });
    const withCards = project(log, false);
    expect(withCards.needsYou.map((n) => n.id)).toEqual(['p1', 'p2']);
    expect(withCards.agents.find((a) => a.name === 'probe-alpha')!.status).toBe('plan_pending');

    log.push({ seq: ++seq, ts: 1787843500002, kind: 'needsyou-resolved', payload: { id: 'p1' } });
    expect(project(log, false).needsYou.map((n) => n.id)).toEqual(['p2']);
  });

  it('deduplicates transcript records re-read by the reconciliation sweep', () => {
    const log = buildLog();
    const dup = log.find((e) => e.kind === 'transcript' && e.agent === 'probe-charlie')!;
    const once = project(log, false).agents.find((a) => a.name === 'probe-charlie')!;
    log.push({ ...dup, seq: log.length + 1 });
    const twice = project(log, false).agents.find((a) => a.name === 'probe-charlie')!;
    expect(twice.transcript.length).toBe(once.transcript.length);
    expect(twice.costUsd).toBeCloseTo(once.costUsd, 9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/project.test.ts`
Expected: FAIL with "Failed to resolve import \"./project.js\" from \"src/server/project.test.ts\""

- [ ] **Step 3: Write the implementation**

```ts
// src/server/project.ts
import type { StoredEvent } from './store.js';
import type {
  Agent,
  AgentStatus,
  MailMessage,
  NeedsYouItem,
  RateLimits,
  Task,
  TeamState,
  TranscriptLine,
} from '../shared/domain.js';
import { buildRoster, type Sidecar, type TeamConfig } from '../shared/roster.js';
import { resolveModel } from '../shared/catalog.js';
import { contextOccupancy, dedupeUsage, totalCost, type UsageRecord } from '../shared/usage.js';
import { currentToolOf, toTranscriptLines, type TranscriptRecord } from '../shared/transcript.js';
import {
  mergeMail,
  parseInboxEntry,
  parseTeammateFrames,
  type InboxEntry,
} from '../shared/mailbox.js';
import { deriveTaskState } from '../shared/status.js';

export const TRANSCRIPT_CAP = 2000;

// ---------------------------------------------------------------------------
// Event payload shapes. The pinned contract fixes `EventKind` but not what each
// kind carries, so these are defined here and consumed by src/server/ingest/*.
// ---------------------------------------------------------------------------
export interface RosterPayload {
  config: TeamConfig | null;
  sidecars: Array<{ meta: Sidecar; transcriptPath: string }>;
}
export interface TranscriptPayload {
  agent: string;
  records: TranscriptRecord[];
}
export interface TaskPayload {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  owner?: string;
  status: 'pending' | 'in_progress' | 'completed';
  blocks: string[];
  blockedBy: string[];
}
export type MailPayload =
  | { source: 'inbox'; to: string; entries: InboxEntry[] }
  | { source: 'transcript'; to: string; text: string; deliveredAt: number };
export interface HookPayload {
  event: string;
  agent: string;
  toolName?: string;
  text?: string;
  error?: string;
}
export interface StatuslinePayload {
  totalCostUsd?: number;
  contextTokens?: number;
  contextWindow?: number;
  branch?: string;
  fiveHourPct?: number;
  sevenDayPct?: number;
  resetsAt?: string;
}
export interface SubstatusPayload {
  agent: string;
  tokenCount?: number;
  contextWindowSize?: number;
  status?: string;
  model?: string;
}
export interface NeedsYouResolvedPayload {
  id: string;
}

function usageRecordsOf(records: TranscriptRecord[]): UsageRecord[] {
  const out: UsageRecord[] = [];
  for (const r of records) {
    if (r.type !== 'assistant') continue;
    const usage = r.message?.usage;
    if (!usage) continue;
    out.push({
      messageId: r.message?.id ?? r.uuid ?? '',
      model: r.message?.model ?? '',
      usage,
    });
  }
  return out;
}

function tokensOf(records: UsageRecord[]): number {
  let sum = 0;
  for (const r of records) {
    sum +=
      (r.usage.input_tokens ?? 0) +
      (r.usage.output_tokens ?? 0) +
      (r.usage.cache_read_input_tokens ?? 0) +
      (r.usage.cache_creation_input_tokens ?? 0);
  }
  return sum;
}

function lastAssistantModel(records: TranscriptRecord[]): string | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const m = records[i].message?.model;
    if (records[i].type === 'assistant' && m) return m;
  }
  return undefined;
}

export function project(events: StoredEvent[], readOnly: boolean): TeamState {
  let config: TeamConfig | null = null;
  let sidecars: Array<{ meta: Sidecar; transcriptPath: string }> = [];
  let branch: string | undefined;
  let rateLimits: RateLimits | undefined;

  const records = new Map<string, TranscriptRecord[]>();
  const seenRecords = new Map<string, Set<string>>();
  const tasksRaw = new Map<string, TaskPayload>();
  const unread = new Map<string, number>();
  const substatus = new Map<string, SubstatusPayload>();
  const currentTool = new Map<string, string | undefined>();
  const errors = new Map<string, string>();
  const lastActivity = new Map<string, number>();
  const needsYou = new Map<string, NeedsYouItem>();
  let mail: MailMessage[] = [];

  const bump = (agent: string, ts: number) => {
    if (ts > (lastActivity.get(agent) ?? -1)) lastActivity.set(agent, ts);
  };

  for (const ev of events) {
    switch (ev.kind) {
      case 'roster': {
        const p = ev.payload as RosterPayload;
        if (p.config) config = p.config;
        if (p.sidecars && p.sidecars.length > 0) sidecars = p.sidecars;
        break;
      }
      case 'transcript': {
        const p = ev.payload as TranscriptPayload;
        const list = records.get(p.agent) ?? [];
        const seen = seenRecords.get(p.agent) ?? new Set<string>();
        for (const rec of p.records) {
          // The 5s reconciliation sweep deliberately re-reads files, so the same
          // record can arrive twice; the record uuid is the dedupe key.
          const key = rec.uuid ?? '';
          if (key && seen.has(key)) continue;
          if (key) seen.add(key);
          list.push(rec);

          const tool = currentToolOf(rec);
          if (tool) currentTool.set(p.agent, tool);
          else if (rec.type === 'user' && rec.toolUseResult !== undefined) {
            currentTool.set(p.agent, undefined);
          }
          if (rec.type === 'assistant') {
            if (rec.isApiErrorMessage) {
              errors.set(p.agent, toTranscriptLines(rec)[0]?.text ?? 'api error');
            } else {
              errors.delete(p.agent);
            }
          }
          const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
          if (!Number.isNaN(ts)) bump(p.agent, ts);
        }
        records.set(p.agent, list);
        seenRecords.set(p.agent, seen);
        break;
      }
      case 'task': {
        const p = ev.payload as TaskPayload;
        tasksRaw.set(p.id, p);
        break;
      }
      case 'mail': {
        const p = ev.payload as MailPayload;
        if (p.source === 'inbox') {
          mail = mergeMail(mail, p.entries.map((e) => parseInboxEntry(e, p.to)));
          unread.set(p.to, p.entries.filter((e) => e.read === false).length);
        } else {
          mail = mergeMail(mail, parseTeammateFrames(p.text, p.deliveredAt, p.to));
        }
        break;
      }
      case 'hook': {
        const p = ev.payload as HookPayload;
        if (p.event === 'PreToolUse' && p.toolName) currentTool.set(p.agent, p.toolName);
        if (p.event === 'PostToolUse') currentTool.set(p.agent, undefined);
        if (p.error) errors.set(p.agent, p.error);
        bump(p.agent, ev.ts);
        break;
      }
      case 'statusline': {
        const p = ev.payload as StatuslinePayload;
        if (p.branch) branch = p.branch;
        if (p.fiveHourPct !== undefined || p.sevenDayPct !== undefined) {
          rateLimits = {
            fiveHourPct: p.fiveHourPct ?? 0,
            sevenDayPct: p.sevenDayPct ?? 0,
            resetsAt: p.resetsAt,
          };
        }
        break;
      }
      case 'substatus': {
        const p = ev.payload as SubstatusPayload;
        substatus.set(p.agent, { ...substatus.get(p.agent), ...p });
        break;
      }
      case 'needsyou': {
        const item = ev.payload as NeedsYouItem;
        needsYou.set(item.id, item);
        break;
      }
      case 'needsyou-resolved': {
        needsYou.delete((ev.payload as NeedsYouResolvedPayload).id);
        break;
      }
    }
  }

  const lastIdle = new Map<string, number>();
  for (const m of mail) {
    if (m.protocol?.type === 'idle_notification' && m.ts > (lastIdle.get(m.from) ?? -1)) {
      lastIdle.set(m.from, m.ts);
    }
  }

  const cards = [...needsYou.values()];
  let totalTokens = 0;

  const agents: Agent[] = buildRoster(config, sidecars).map((id) => {
    const recs = records.get(id.name) ?? [];
    const sub = substatus.get(id.name);
    const resolved = resolveModel(lastAssistantModel(recs) ?? sub?.model ?? id.rawModel);
    const usage = dedupeUsage(usageRecordsOf(recs));
    totalTokens += tokensOf(usage);

    const lines: TranscriptLine[] = [];
    for (const rec of recs) for (const l of toTranscriptLines(rec)) lines.push(l);

    let status: AgentStatus = 'working';
    if (errors.has(id.name)) status = 'failed';
    else if (cards.some((c) => c.agent === id.name && c.kind === 'plan')) status = 'plan_pending';
    else {
      const act = lastActivity.get(id.name) ?? -1;
      const idle = lastIdle.get(id.name) ?? -1;
      if (act < 0 || idle >= act) status = 'idle';
    }

    return {
      name: id.name,
      agentId: id.agentId,
      isLead: id.isLead,
      agentType: id.agentType,
      model: resolved.canonical,
      role: id.role,
      color: id.color,
      status,
      currentTool: currentTool.get(id.name),
      contextTokens: sub?.tokenCount ?? contextOccupancy(recs),
      contextLimit: resolved.window,
      compactAt: resolved.compactAt,
      costUsd: totalCost(usage),
      startedAt: id.joinedAt,
      transcript: lines.slice(-TRANSCRIPT_CAP),
      unread: unread.get(id.name) ?? 0,
      error: errors.get(id.name),
    };
  });

  const tasks: Task[] = [...tasksRaw.values()].map((t) => ({
    id: t.id,
    subject: t.subject,
    description: t.description,
    activeForm: t.activeForm,
    owner: t.owner,
    state: deriveTaskState(t.status, { owner: t.owner, blockedBy: t.blockedBy ?? [] }, agents),
    blocks: t.blocks ?? [],
    blockedBy: t.blockedBy ?? [],
  }));

  // Agent 'blocked' needs the derived task states, so it is a second pass.
  for (const agent of agents) {
    if (agent.status !== 'working') continue;
    if (tasks.some((t) => t.owner === agent.name && t.state === 'blocked')) agent.status = 'blocked';
  }

  return {
    teamName: config?.name ?? '',
    leadSessionId: config?.leadSessionId ?? '',
    branch,
    startedAt: config?.createdAt ?? 0,
    totalTokens,
    totalCostUsd: agents.reduce((sum, a) => sum + a.costUsd, 0),
    rateLimits,
    agents,
    tasks,
    mail,
    needsYou: cards,
    readOnly,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/project.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/project.ts src/server/project.test.ts && git commit -m "feat: fold the event log into TeamState with per-agent cost, context and 2000-line transcript cap"
```

---

### Task 13: File ingest and reconciliation sweep

**Files:**
- Create: `src/server/ingest/files.ts`
- Test: `src/server/ingest/files.test.ts`

**Interfaces:**
- Consumes: `drain`, `emptyTailState`, `watchAppendOnly`, `TailState` from `src/server/watch/tail.ts`; `readJsonSafe`, `watchJsonTree` from `src/server/watch/jsonfile.ts`; `Store` from `src/server/store.ts`; `RosterPayload`, `TranscriptPayload`, `TaskPayload`, `MailPayload`, `StatuslinePayload` from `src/server/project.ts`; `parseLine`, `TranscriptRecord` from `src/shared/transcript.ts`; `TeamConfig`, `Sidecar` from `src/shared/roster.ts`; `InboxEntry` from `src/shared/mailbox.ts`
- Produces: `interface IngestPaths { projects: string; teams: string; tasks: string; sessions: string }`, `interface IngestConfig { paths: IngestPaths; teamName?: string; leadSessionId?: string; leadName?: string; sweepIntervalMs?: number }`, `interface FileIngest { sweep(): Promise<void>; close(): void }`, `startFileIngest(store: Store, config: IngestConfig): FileIngest`, `agentOfTranscript(file: string, leadSessionId: string | undefined, leadName: string): string | null`, `DEFAULT_SWEEP_MS`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/ingest/files.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, type Store, type StoredEvent } from '../store.js';
import { startFileIngest, agentOfTranscript, type IngestPaths } from './files.js';
import type { RosterPayload, TranscriptPayload, TaskPayload, MailPayload } from '../project.js';

const FIXTURES = path.resolve(process.cwd(), 'fixtures');
const SLUG = '-Users-alanoliv-code-agents-team-ui';
const TEAM = 'session-98b0b4a7';
const LEAD_SESSION = '98b0b4a7-3206-455b-aaf6-a5a81ad1e283';

let home: string;
let store: Store;
let paths: IngestPaths;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-home-'));
  paths = {
    projects: path.join(home, 'projects'),
    teams: path.join(home, 'teams'),
    tasks: path.join(home, 'tasks'),
    sessions: path.join(home, 'sessions'),
  };
  for (const p of Object.values(paths)) await fs.mkdir(p, { recursive: true });
  store = openStore(path.join(home, 'events.db'));
});

afterEach(async () => {
  store.close();
  await fs.rm(home, { recursive: true, force: true });
});

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function layout(): Promise<void> {
  await fs.mkdir(path.join(paths.teams, TEAM, 'inboxes'), { recursive: true });
  await fs.mkdir(path.join(paths.tasks, TEAM), { recursive: true });
  await fs.mkdir(path.join(paths.projects, SLUG, LEAD_SESSION, 'subagents'), { recursive: true });

  await fs.copyFile(
    path.join(FIXTURES, 'config-4-members.json'),
    path.join(paths.teams, TEAM, 'config.json'),
  );

  const sidecars = JSON.parse(
    await fs.readFile(path.join(FIXTURES, 'meta-sidecars.json'), 'utf8'),
  ) as Array<Record<string, unknown>>;
  await fs.writeFile(
    path.join(paths.projects, SLUG, LEAD_SESSION, 'subagents', 'agent-aprobe-charlie-12ee4cb1ed35cf7c.meta.json'),
    JSON.stringify(sidecars.find((s) => s.name === 'probe-charlie')),
  );

  await fs.copyFile(
    path.join(FIXTURES, 'transcript-agent-aprobe-charlie-12ee4cb1ed35cf7c.jsonl'),
    path.join(paths.projects, SLUG, LEAD_SESSION, 'subagents', 'agent-aprobe-charlie-12ee4cb1ed35cf7c.jsonl'),
  );

  const tasks = JSON.parse(await fs.readFile(path.join(FIXTURES, 'tasks.json'), 'utf8')) as TaskPayload[];
  await fs.writeFile(path.join(paths.tasks, TEAM, '1.json'), JSON.stringify(tasks[4]));

  const snapshots = JSON.parse(
    await fs.readFile(path.join(FIXTURES, 'inbox-snapshots.json'), 'utf8'),
  ) as Array<{ path: string; entries: unknown[] }>;
  await fs.writeFile(
    path.join(paths.teams, TEAM, 'inboxes', 'team-lead.json'),
    JSON.stringify(snapshots[3].entries),
  );

  await fs.writeFile(
    path.join(paths.sessions, `${LEAD_SESSION}.json`),
    JSON.stringify({ sessionId: LEAD_SESSION, gitBranch: 'HEAD' }),
  );
}

const of = (events: StoredEvent[], kind: string) => events.filter((e) => e.kind === kind);

describe('agentOfTranscript', () => {
  it('maps a subagent filename to the bare teammate name', () => {
    expect(
      agentOfTranscript('/a/subagents/agent-aprobe-charlie-12ee4cb1ed35cf7c.jsonl', LEAD_SESSION, 'team-lead'),
    ).toBe('probe-charlie');
  });

  it('maps the lead session transcript to the lead name', () => {
    expect(agentOfTranscript(`/a/${LEAD_SESSION}.jsonl`, LEAD_SESSION, 'team-lead')).toBe('team-lead');
  });

  it('ignores an unrelated session transcript', () => {
    expect(agentOfTranscript('/a/11111111-2222-3333-4444-555555555555.jsonl', LEAD_SESSION, 'team-lead')).toBeNull();
  });
});

describe('scope rule: agent teams only', () => {
  const LEAD = '98b0b4a7-3206-455b-aaf6-a5a81ad1e283';
  const base = `/Users/alanoliv/.claude/projects/${SLUG}`;

  it('attributes a real teammate transcript under the lead session', () => {
    const f = `${base}/${LEAD}/subagents/agent-aprobe-alpha-84fd551b27de6433.jsonl`;
    expect(agentOfTranscript(f, LEAD, 'team-lead')).toBe('probe-alpha');
  });

  it('attributes the lead transcript to the lead', () => {
    expect(agentOfTranscript(`${base}/${LEAD}.jsonl`, LEAD, 'team-lead')).toBe('team-lead');
  });

  it('REJECTS workflow fan-out transcripts', () => {
    const f = `${base}/${LEAD}/subagents/workflows/wf_920cc391-abe/agent-a3eeaa94f896ac303.jsonl`;
    expect(agentOfTranscript(f, LEAD, 'team-lead')).toBeNull();
  });

  it('REJECTS subagents belonging to a different session', () => {
    const other = '5cd370e5-2d86-4b64-878e-095f726aea82';
    const f = `${base}/${other}/subagents/agent-ahatch-elixir-scout-cbe1898474d3f8fe.jsonl`;
    expect(agentOfTranscript(f, LEAD, 'team-lead')).toBeNull();
  });

  it('buffers an unknown agent and only stores it once a teammate sidecar lands', async () => {
    const projects = path.join(dir, 'projects');
    const agentDir = path.join(projects, SLUG, LEAD, 'subagents');
    await fs.mkdir(agentDir, { recursive: true });

    const jsonl = path.join(agentDir, 'agent-alater-1111111111111111.jsonl');
    await fs.writeFile(
      jsonl,
      JSON.stringify({ type: 'user', uuid: 'u1', timestamp: new Date().toISOString() }) + '\n',
    );
    await settle();
    // No sidecar yet -> nothing stored.
    expect(store.replay().filter((e) => e.kind === 'transcript')).toHaveLength(0);

    await fs.writeFile(
      path.join(agentDir, 'agent-alater-1111111111111111.meta.json'),
      JSON.stringify({
        name: 'later',
        agentType: 'later',
        description: 'a teammate',
        spawnDepth: 0,
        model: 'claude-opus-5',
        taskKind: 'in_process_teammate',
        teamName: TEAM,
      }),
    );
    await settle();
    const stored = store.replay().filter((e) => e.kind === 'transcript');
    expect(stored.map((e) => e.agent)).toContain('later');
  });

  it('DISCARDS a buffered agent whose sidecar proves it is an ordinary subagent', async () => {
    const projects = path.join(dir, 'projects');
    const agentDir = path.join(projects, SLUG, LEAD, 'subagents');
    await fs.mkdir(agentDir, { recursive: true });

    await fs.writeFile(
      path.join(agentDir, 'agent-ahelper-2222222222222222.jsonl'),
      JSON.stringify({ type: 'user', uuid: 'u2', timestamp: new Date().toISOString() }) + '\n',
    );
    await settle();
    await fs.writeFile(
      path.join(agentDir, 'agent-ahelper-2222222222222222.meta.json'),
      JSON.stringify({
        name: 'helper',
        agentType: 'general-purpose',
        description: 'an ordinary subagent',
        spawnDepth: 0,
        model: 'claude-opus-5',
        taskKind: 'task',          // NOT in_process_teammate
        teamName: TEAM,
      }),
    );
    await settle();
    const agents = store.replay().filter((e) => e.kind === 'transcript').map((e) => e.agent);
    expect(agents).not.toContain('helper');
  });
});

describe('startFileIngest', () => {
  it('reconciliation sweep ingests every pre-existing file', async () => {
    await layout();
    const ingest = startFileIngest(store, { paths, sweepIntervalMs: 0 });
    try {
      await ingest.sweep();
    } finally {
      ingest.close();
    }

    const events = store.replay();

    const roster = of(events, 'roster').at(-1)!.payload as RosterPayload;
    expect(roster.config!.name).toBe(TEAM);
    expect(roster.config!.members).toHaveLength(4);
    expect(roster.sidecars.map((s) => s.meta.name)).toEqual(['probe-charlie']);
    expect(roster.sidecars[0].transcriptPath.endsWith('agent-aprobe-charlie-12ee4cb1ed35cf7c.jsonl')).toBe(true);

    const transcripts = of(events, 'transcript');
    expect(transcripts).toHaveLength(1);
    const tp = transcripts[0].payload as TranscriptPayload;
    expect(tp.agent).toBe('probe-charlie');
    expect(tp.records).toHaveLength(21);
    expect(tp.records[0].uuid).toBe('11e6d4d8-e189-4e20-af44-164cbfed2cfa');

    const task = of(events, 'task').at(-1)!.payload as TaskPayload;
    expect(task.id).toBe('1');
    expect(task.status).toBe('completed');
    expect(task.owner).toBe('probe-alpha');

    const mail = of(events, 'mail').at(-1)!.payload as MailPayload;
    expect(mail.source).toBe('inbox');
    expect(mail.to).toBe('team-lead');
    if (mail.source === 'inbox') {
      expect(mail.entries[0].msg_id).toBe('4a236089-e8f5-4688-bca2-e47c6f0d8310');
    }

    expect(of(events, 'statusline').at(-1)!.payload).toEqual({ branch: 'HEAD' });
  });

  it('a second sweep with no mtime advance appends nothing', async () => {
    await layout();
    const ingest = startFileIngest(store, { paths, sweepIntervalMs: 0 });
    try {
      await ingest.sweep();
      const after = store.replay().length;
      await ingest.sweep();
      expect(store.replay()).toHaveLength(after);
    } finally {
      ingest.close();
    }
  });

  it('watches a live inbox rewrite without a sweep', async () => {
    await layout();
    const ingest = startFileIngest(store, { paths, sweepIntervalMs: 0 });
    try {
      await ingest.sweep();
      const before = of(store.replay(), 'mail').length;
      await fs.writeFile(
        path.join(paths.teams, TEAM, 'inboxes', 'probe-alpha.json'),
        JSON.stringify([{ from: 'team-lead', text: 'live', timestamp: '2026-08-27T15:20:00.000Z', msg_id: 'live-1', read: false }]),
      );
      const hit = await waitFor(() => {
        const events = of(store.replay(), 'mail');
        return events.length > before ? (events.at(-1)!.payload as MailPayload) : undefined;
      });
      expect(hit.to).toBe('probe-alpha');
    } finally {
      ingest.close();
    }
  });

  it('watches a live transcript append without a sweep', async () => {
    await layout();
    const ingest = startFileIngest(store, { paths, sweepIntervalMs: 0 });
    try {
      const file = path.join(
        paths.projects, SLUG, LEAD_SESSION, 'subagents',
        'agent-aprobe-bravo-babf58016882bc72.jsonl',
      );
      await fs.writeFile(file, JSON.stringify({ type: 'assistant', uuid: 'live-uuid' }) + '\n');
      const hit = await waitFor(() => {
        const found = of(store.replay(), 'transcript')
          .map((e) => e.payload as TranscriptPayload)
          .find((p) => p.agent === 'probe-bravo');
        return found;
      });
      expect(hit.records[0].uuid).toBe('live-uuid');
    } finally {
      ingest.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/ingest/files.test.ts`
Expected: FAIL with "Failed to resolve import \"./files.js\" from \"src/server/ingest/files.test.ts\""

- [ ] **Step 3: Write the implementation**

```ts
// src/server/ingest/files.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { drain, emptyTailState, watchAppendOnly, type TailState } from '../watch/tail.js';
import { readJsonSafe, watchJsonTree } from '../watch/jsonfile.js';
import type { Store } from '../store.js';
import type { TaskPayload } from '../project.js';
import { parseLine, type TranscriptRecord } from '../../shared/transcript.js';
import type { TeamConfig, Sidecar } from '../../shared/roster.js';
import type { InboxEntry } from '../../shared/mailbox.js';

export const DEFAULT_SWEEP_MS = 5000;
const SUBAGENT_FILE = /^agent-a(.+)-[0-9a-f]{16}\.jsonl$/;

export interface IngestPaths {
  projects: string;
  teams: string;
  tasks: string;
  sessions: string;
}

export interface IngestConfig {
  paths: IngestPaths;
  teamName?: string;
  leadSessionId?: string;
  leadName?: string;
  sweepIntervalMs?: number;
}

export interface FileIngest {
  sweep(): Promise<void>;
  close(): void;
}

const WORKFLOW_SEGMENT = `${path.sep}workflows${path.sep}`;

/**
 * SCOPE RULE: the console covers agent TEAMS only. Ordinary Agent-tool
 * subagents and workflow fan-outs are not team members and must never be
 * ingested — verified in the capture spike, where six workflow subagents were
 * live and config.json members[] still held only the lead.
 *
 * Two exclusions are decidable from the path alone, before anything is parsed:
 *   - workflow fan-outs live under <session>/subagents/workflows/<runId>/
 *   - another session's subagents are not under our leadSessionId
 * The third case — an Agent-tool subagent spawned by the lead, which lands in
 * the SAME directory as a teammate — is only decidable from its .meta.json
 * taskKind, so it is resolved by the pending buffer in handleLines.
 */
export function agentOfTranscript(
  file: string,
  leadSessionId: string | undefined,
  leadName: string,
): string | null {
  if (file.includes(WORKFLOW_SEGMENT)) return null;
  const base = path.basename(file);
  if (leadSessionId && base === `${leadSessionId}.jsonl`) return leadName;
  const m = SUBAGENT_FILE.exec(base);
  if (!m) return null;
  // <projects>/<slug>/<leadSessionId>/subagents/agent-<name>-<hex>.jsonl
  if (leadSessionId && path.basename(path.dirname(path.dirname(file))) !== leadSessionId) {
    return null;
  }
  return m[1];
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) out.push(full);
    }
  }
  // config.json first so the sweep learns the team before reading anything keyed on it.
  return out.sort(
    (a, b) =>
      (path.basename(a) === 'config.json' ? 0 : 1) - (path.basename(b) === 'config.json' ? 0 : 1) ||
      a.localeCompare(b),
  );
}

export function startFileIngest(store: Store, config: IngestConfig): FileIngest {
  const { paths } = config;
  const leadName = config.leadName ?? 'team-lead';
  let teamName = config.teamName;
  let leadSessionId = config.leadSessionId;

  let lastConfig: TeamConfig | null = null;
  const sidecars = new Map<string, { meta: Sidecar; transcriptPath: string }>();
  const marks = new Map<string, number>();
  // The sweep keeps its own tail state because watchAppendOnly owns the primary
  // one. Both readers see every byte once; project.ts dedupes records by uuid,
  // so a re-read during a watcher gap is harmless rather than a duplicate line.
  const sweepTails = new Map<string, TailState>();
  let closed = false;

  const mark = async (file: string) => {
    try {
      marks.set(file, (await fs.stat(file)).mtimeMs);
    } catch {
      /* file vanished between event and stat */
    }
  };

  const appendRoster = () => {
    store.append('roster', { config: lastConfig, sidecars: [...sidecars.values()] });
  };

  // A teammate's transcript can be appended before its .meta.json sidecar lands
  // (observed in the spike: sidecars appeared 22-33s in). We cannot tell a
  // teammate from an ordinary subagent until the sidecar arrives, so hold the
  // lines in a bounded buffer instead of guessing — and drop them outright once
  // a sidecar proves the agent is not a teammate.
  const pending = new Map<string, TranscriptRecord[]>();
  const PENDING_CAP = 500;

  const flushPending = (agent: string) => {
    const buf = pending.get(agent);
    pending.delete(agent);
    if (buf && buf.length > 0) store.append('transcript', { agent, records: buf }, agent);
  };

  const handleLines = (file: string, lines: string[]) => {
    const agent = agentOfTranscript(file, leadSessionId, leadName);
    if (!agent) return;
    const records: TranscriptRecord[] = [];
    for (const l of lines) {
      const rec = parseLine(l);
      if (rec) records.push(rec);
    }
    if (records.length === 0) return;

    if (agent === leadName || sidecars.has(agent)) {
      flushPending(agent);
      store.append('transcript', { agent, records }, agent);
      return;
    }
    const buf = pending.get(agent) ?? [];
    buf.push(...records);
    pending.set(agent, buf.slice(-PENDING_CAP));
  };

  const handleTeamsJson = async (file: string) => {
    const base = path.basename(file);
    const dirName = path.basename(path.dirname(file));
    if (base === 'config.json') {
      if (teamName && dirName !== teamName) return;
      const cfg = await readJsonSafe<TeamConfig>(file);
      if (!cfg) return;
      lastConfig = cfg;
      teamName = cfg.name;
      leadSessionId = cfg.leadSessionId;
      appendRoster();
      return;
    }
    if (dirName !== 'inboxes') return;
    const to = base.replace(/\.json$/, '');
    const entries = await readJsonSafe<InboxEntry[]>(file);
    if (!Array.isArray(entries)) return;
    store.append('mail', { source: 'inbox', to, entries }, to);
  };

  const handleProjectsJson = async (file: string) => {
    if (!file.endsWith('.meta.json')) return;
    const meta = await readJsonSafe<Sidecar>(file);
    if (!meta) return;
    if (meta.taskKind !== 'in_process_teammate' || (teamName && meta.teamName !== teamName)) {
      // Proven NOT a teammate — discard anything buffered under that name.
      if (meta.name) pending.delete(meta.name);
      return;
    }
    sidecars.set(meta.name, { meta, transcriptPath: file.replace(/\.meta\.json$/, '.jsonl') });
    flushPending(meta.name);
    appendRoster();
  };

  const handleTaskJson = async (file: string) => {
    if (teamName && path.basename(path.dirname(file)) !== teamName) return;
    const task = await readJsonSafe<TaskPayload>(file);
    if (!task || typeof task.id !== 'string') return;
    store.append('task', task, task.owner);
  };

  const handleSessionJson = async (file: string) => {
    if (leadSessionId && path.basename(file) !== `${leadSessionId}.json`) return;
    const doc = await readJsonSafe<{ gitBranch?: string; branch?: string }>(file);
    const branch = doc?.gitBranch ?? doc?.branch;
    if (!branch) return;
    store.append('statusline', { branch }, leadName);
  };

  const dispatchJson = async (file: string, root: string) => {
    if (root === paths.teams) await handleTeamsJson(file);
    else if (root === paths.projects) await handleProjectsJson(file);
    else if (root === paths.tasks) await handleTaskJson(file);
    else if (root === paths.sessions) await handleSessionJson(file);
  };

  const sweepTranscript = async (file: string) => {
    const agent = agentOfTranscript(file, leadSessionId, leadName);
    if (!agent) return;
    const out = await drain(file, sweepTails.get(file) ?? emptyTailState());
    sweepTails.set(file, out.state);
    if (out.lines.length > 0) handleLines(file, out.lines);
  };

  const sweep = async (): Promise<void> => {
    for (const root of [paths.teams, paths.projects, paths.tasks, paths.sessions]) {
      for (const file of await walk(root)) {
        if (closed) return;
        let st;
        try {
          st = await fs.stat(file);
        } catch {
          continue;
        }
        if ((marks.get(file) ?? -1) >= st.mtimeMs) continue;
        marks.set(file, st.mtimeMs);
        if (file.endsWith('.jsonl')) await sweepTranscript(file);
        else if (file.endsWith('.json')) await dispatchJson(file, root);
      }
    }
  };

  const watchers = [
    watchAppendOnly(paths.projects, (file, lines) => {
      handleLines(file, lines);
      void fs.stat(file).then(
        (st) => {
          marks.set(file, st.mtimeMs);
          if (!sweepTails.has(file)) {
            sweepTails.set(file, { inode: st.ino, offset: st.size, partial: '' });
          }
        },
        () => undefined,
      );
    }),
    watchJsonTree(paths.projects, (file) => {
      void handleProjectsJson(file).then(() => mark(file));
    }),
    watchJsonTree(paths.teams, (file) => {
      void handleTeamsJson(file).then(() => mark(file));
    }),
    watchJsonTree(paths.tasks, (file) => {
      void handleTaskJson(file).then(() => mark(file));
    }),
    watchJsonTree(paths.sessions, (file) => {
      void handleSessionJson(file).then(() => mark(file));
    }),
  ];

  const interval = config.sweepIntervalMs ?? DEFAULT_SWEEP_MS;
  const timer =
    interval > 0
      ? setInterval(() => {
          void sweep().catch(() => undefined);
        }, interval)
      : null;
  timer?.unref?.();

  return {
    sweep,
    close() {
      closed = true;
      if (timer) clearInterval(timer);
      for (const w of watchers) w.close();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/ingest/files.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/ingest/files.ts src/server/ingest/files.test.ts && git commit -m "feat: wire transcript, team, task and session watchers to the store with a 5s reconciliation sweep"
```

---

### Task 14: Hook, statusline and substatus endpoints

**Files:**
- Create: `src/server/control/permits.ts` (types only; Task 15 adds `createPermits`)
- Create: `src/server/ingest/hooks.ts`
- Test: `src/server/ingest/hooks.test.ts`

**Interfaces:**
- Consumes: `Store` from `src/server/store.ts`; the `Permits` **type** from `src/server/control/permits.ts` — declared in Step 1 below, implemented in Task 15; `HookPayload`, `StatuslinePayload`, `SubstatusPayload` from `src/server/project.ts`; `NeedsYouItem` from `src/shared/domain.ts`
- Produces: `interface HookResponse { status: number; body: unknown }`, `interface HookDeps { store: Store; permits: Permits; permissionTimeoutMs?: number; leadName?: string }`, `interface HookHandlers { hook(body: unknown): Promise<HookResponse>; statusline(body: unknown): Promise<HookResponse>; substatus(body: unknown): Promise<HookResponse> }`, `createHookHandlers(deps: HookDeps): HookHandlers`, `agentNameFrom(raw: unknown, leadName?: string): string`, `DEFAULT_PERMISSION_TIMEOUT_MS`

- [ ] **Step 1: Declare the permits port (types only)**

Task 14 depends on `Permits` but Task 15 implements it. Create the types now so
this task compiles and can be tested against a stub; Task 15 appends
`createPermits` to the same file.

```ts
// src/server/control/permits.ts
export interface HeldPermit {
  id: string;
  agent: string;
  toolName: string;
  input: unknown;
  expiresAt: number;
}

export interface Permits {
  hold(
    agent: string,
    toolName: string,
    input: unknown,
    timeoutMs: number,
  ): { id: string; promise: Promise<{ decision: 'allow' | 'deny'; reason?: string }> };
  resolve(id: string, decision: 'allow' | 'deny', reason?: string): boolean;
  list(): HeldPermit[];
}
```

Use this stub in this task's tests:

```ts
// src/server/ingest/hooks.test.ts — helper
function stubPermits(): Permits & { held: HeldPermit[] } {
  const held: HeldPermit[] = [];
  return {
    held,
    hold(agent, toolName, input, timeoutMs) {
      const id = `permit-${held.length + 1}`;
      held.push({ id, agent, toolName, input, expiresAt: Date.now() + timeoutMs });
      return { id, promise: new Promise(() => {}) }; // never settles: the hold is the point
    },
    resolve: () => true,
    list: () => held,
  };
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/server/ingest/hooks.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, type Store, type StoredEvent } from '../store.js';
import { createPermits, type Permits } from '../control/permits.js';
import { agentNameFrom, createHookHandlers, type HookHandlers } from './hooks.js';
import type { HookPayload, StatuslinePayload, SubstatusPayload } from '../project.js';
import type { NeedsYouItem } from '../../shared/domain.js';

let dir: string;
let store: Store;
let permits: Permits;
let handlers: HookHandlers;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hooks-'));
  store = openStore(path.join(dir, 'events.db'));
  permits = createPermits();
  handlers = createHookHandlers({ store, permits });
});

afterEach(async () => {
  store.close();
  await fs.rm(dir, { recursive: true, force: true });
});

const of = (events: StoredEvent[], kind: string) => events.filter((e) => e.kind === kind);

describe('substatus scope rule: teammates only', () => {
  it('stores in_process_teammate rows and ignores every other subagent row', async () => {
    const store = openStore(':memory:');
    const handlers = createHookHandlers({ store, permits: stubPermits() });

    await handlers.substatus({
      session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283',
      tasks: [
        { agentId: 'probe-alpha', name: 'probe-alpha', type: 'in_process_teammate',
          tokenCount: 34469, contextWindowSize: 1000000, status: 'active', model: 'claude-opus-5' },
        { agentId: 'a9f20a3464bfe2362', name: 'searcher', type: 'task',
          tokenCount: 91000, contextWindowSize: 1000000, status: 'active', model: 'claude-opus-5' },
        { agentId: 'a3eeaa94f896ac303', name: 'plan-author', type: 'workflow',
          tokenCount: 120000, contextWindowSize: 1000000, status: 'active', model: 'claude-opus-5' },
      ],
    });

    const rows = store.replay().filter((e) => e.kind === 'substatus');
    expect(rows).toHaveLength(1);
    expect(rows[0].agent).toBe('probe-alpha');
    expect((rows[0].payload as { tokenCount: number }).tokenCount).toBe(34469);
    store.close();
  });
});

describe('agentNameFrom', () => {
  it('strips the a-prefix and 16-hex suffix of a subagent id', () => {
    expect(agentNameFrom('aprobe-alpha-84fd551b27de6433')).toBe('probe-alpha');
    expect(agentNameFrom('aprobe-charlie-12ee4cb1ed35cf7c')).toBe('probe-charlie');
  });

  it('takes the bare name from an agentId', () => {
    expect(agentNameFrom('probe-bravo@session-98b0b4a7')).toBe('probe-bravo');
  });

  it('falls back to the lead name', () => {
    expect(agentNameFrom(undefined)).toBe('team-lead');
    expect(agentNameFrom(null, 'lead')).toBe('lead');
  });
});

describe('hook', () => {
  it('answers a non-permission hook immediately and attributes the agent', async () => {
    const res = await handlers.hook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'sleep 10' },
      agent_id: 'aprobe-alpha-84fd551b27de6433',
      agent_type: 'general-purpose',
    });
    expect(res).toEqual({ status: 200, body: {} });

    const events = of(store.replay(), 'hook');
    expect(events).toHaveLength(1);
    expect(events[0].agent).toBe('probe-alpha');
    expect(events[0].payload).toMatchObject({ event: 'PreToolUse', agent: 'probe-alpha', toolName: 'Bash' });
  });

  it('never throws on a malformed body', async () => {
    expect(await handlers.hook(null)).toEqual({ status: 200, body: {} });
    expect(await handlers.hook('nonsense')).toEqual({ status: 200, body: {} });
    expect(await handlers.hook({ hook_event_name: 42 })).toEqual({ status: 200, body: {} });
  });

  it('captures MessageDisplay text and UserPromptSubmit prompts', async () => {
    await handlers.hook({ hook_event_name: 'Notification', message: 'Claude needs your permission' });
    await handlers.hook({ hook_event_name: 'UserPromptSubmit', prompt: 'spawn three probes' });
    const events = of(store.replay(), 'hook').map((e) => e.payload as HookPayload);
    expect(events[0].text).toBe('Claude needs your permission');
    expect(events[1].text).toBe('spawn three probes');
  });

  it('holds PermissionRequest until the operator decides', async () => {
    const pending = handlers.hook({
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf migrations/legacy' },
      agent_id: 'aprobe-bravo-babf58016882bc72',
      timeout: 10000,
    });

    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false);

    const card = of(store.replay(), 'needsyou').at(-1)!.payload as NeedsYouItem;
    expect(card.kind).toBe('permission');
    expect(card.agent).toBe('probe-bravo');
    expect(card.detail).toContain('Bash');
    expect(permits.list().map((p) => p.id)).toEqual([card.id]);

    expect(permits.resolve(card.id, 'allow')).toBe(true);
    expect(await pending).toEqual({
      status: 200,
      body: {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          permissionDecision: 'allow',
          permissionDecisionReason: '',
        },
      },
    });
    expect((of(store.replay(), 'needsyou-resolved').at(-1)!.payload as { id: string }).id).toBe(card.id);
  });
});

describe('statusline', () => {
  it('extracts cost, context window and both rate limits', async () => {
    const res = await handlers.statusline({
      cost: { total_cost_usd: 8.4 },
      context_window: { used_tokens: 53100, max_tokens: 1000000 },
      rate_limits: {
        five_hour: { used_pct: 41, resets_at: '2026-08-27T20:00:00Z' },
        seven_day: { used_pct: 12 },
      },
      gitBranch: 'HEAD',
    });
    expect(res).toEqual({ status: 200, body: {} });

    const payload = of(store.replay(), 'statusline').at(-1)!.payload as StatuslinePayload;
    expect(payload.totalCostUsd).toBe(8.4);
    expect(payload.contextTokens).toBe(53100);
    expect(payload.contextWindow).toBe(1000000);
    expect(payload.fiveHourPct).toBe(41);
    expect(payload.sevenDayPct).toBe(12);
    expect(payload.resetsAt).toBe('2026-08-27T20:00:00Z');
    expect(payload.branch).toBe('HEAD');
  });

  it('answers 200 on a body with none of the expected fields', async () => {
    expect(await handlers.statusline({})).toEqual({ status: 200, body: {} });
    expect(await handlers.statusline(undefined)).toEqual({ status: 200, body: {} });
  });
});

describe('substatus', () => {
  it('appends one event per teammate task entry', async () => {
    const res = await handlers.substatus({
      tasks: [
        { name: 'probe-charlie', tokenCount: 23639, contextWindowSize: 200000, status: 'idle', model: 'claude-haiku-4-5-20251001' },
        { agentId: 'aprobe-alpha-84fd551b27de6433', tokenCount: 34469, contextWindowSize: 1000000, status: 'working' },
      ],
    });
    expect(res).toEqual({ status: 200, body: {} });

    const payloads = of(store.replay(), 'substatus').map((e) => e.payload as SubstatusPayload);
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toEqual({
      agent: 'probe-charlie',
      tokenCount: 23639,
      contextWindowSize: 200000,
      status: 'idle',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(payloads[1].agent).toBe('probe-alpha');
    expect(payloads[1].tokenCount).toBe(34469);
  });

  it('answers 200 when tasks is missing', async () => {
    expect(await handlers.substatus({})).toEqual({ status: 200, body: {} });
    expect(store.replay()).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/server/ingest/hooks.test.ts`
Expected: FAIL with "Failed to resolve import \"./hooks.js\" from \"src/server/ingest/hooks.test.ts\""

- [ ] **Step 4: Write the implementation**

```ts
// src/server/ingest/hooks.ts
import type { Store } from '../store.js';
import type { Permits } from '../control/permits.js';

export const DEFAULT_PERMISSION_TIMEOUT_MS = 600_000;
const SUBAGENT_ID = /^a(.+)-[0-9a-f]{16}$/;

export interface HookResponse {
  status: number;
  body: unknown;
}

export interface HookDeps {
  store: Store;
  permits: Permits;
  permissionTimeoutMs?: number;
  leadName?: string;
}

export interface HookHandlers {
  hook(body: unknown): Promise<HookResponse>;
  statusline(body: unknown): Promise<HookResponse>;
  substatus(body: unknown): Promise<HookResponse>;
}

type Bag = Record<string, unknown>;

const bagOf = (v: unknown): Bag => (v !== null && typeof v === 'object' ? (v as Bag) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function agentNameFrom(raw: unknown, leadName = 'team-lead'): string {
  const id = str(raw);
  if (!id) return leadName;
  const at = id.indexOf('@');
  if (at > 0) return id.slice(0, at);
  const m = SUBAGENT_ID.exec(id);
  return m ? m[1] : id;
}

// The statusline rate-limit and context-window shapes are not pinned by the
// contract, so both readers below are tolerant: a bare number, or an object
// carrying any of the observed key spellings.
function pctOf(raw: unknown): number | undefined {
  const n = num(raw);
  if (n !== undefined) return n;
  const b = bagOf(raw);
  return num(b.used_pct) ?? num(b.utilization) ?? num(b.percent);
}

function resetOf(raw: unknown): string | undefined {
  const b = bagOf(raw);
  return str(b.resets_at) ?? str(b.reset_at) ?? str(b.resetsAt);
}

export function createHookHandlers(deps: HookDeps): HookHandlers {
  const { store, permits } = deps;
  const leadName = deps.leadName ?? 'team-lead';

  return {
    async hook(body) {
      // A thrown error or a hang here is a 10-minute stall of the agent's turn,
      // so every path returns 200 and nothing escapes this try.
      try {
        const b = bagOf(body);
        const event = str(b.hook_event_name) ?? '';
        const agent = agentNameFrom(b.agent_id, leadName);
        const toolName = str(b.tool_name);
        const text = str(b.message) ?? str(b.prompt);
        store.append('hook', { event, agent, toolName, text }, agent);

        if (event !== 'PermissionRequest') return { status: 200, body: {} };

        const timeoutMs = num(b.timeout) ?? deps.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS;
        const held = permits.hold(agent, toolName ?? 'unknown', b.tool_input, timeoutMs);
        store.append(
          'needsyou',
          {
            id: held.id,
            kind: 'permission',
            agent,
            reason: 'permission',
            detail: `${toolName ?? 'unknown'} — awaiting your decision`,
            expiresAt: Date.now() + Math.floor(timeoutMs * 0.9),
          },
          agent,
        );

        const decided = await held.promise;
        store.append('needsyou-resolved', { id: held.id }, agent);
        return {
          status: 200,
          body: {
            hookSpecificOutput: {
              hookEventName: 'PermissionRequest',
              permissionDecision: decided.decision,
              permissionDecisionReason: decided.reason ?? '',
            },
          },
        };
      } catch {
        return { status: 200, body: {} };
      }
    },

    async statusline(body) {
      try {
        const b = bagOf(body);
        const cost = bagOf(b.cost);
        const window = bagOf(b.context_window);
        const limits = bagOf(b.rate_limits);
        store.append(
          'statusline',
          {
            totalCostUsd: num(cost.total_cost_usd),
            contextTokens: num(window.used_tokens) ?? num(window.input_tokens),
            contextWindow: num(window.max_tokens) ?? num(window.context_window_size),
            branch: str(b.gitBranch) ?? str(b.branch),
            fiveHourPct: pctOf(limits.five_hour),
            sevenDayPct: pctOf(limits.seven_day),
            resetsAt: resetOf(limits.five_hour),
          },
          agentNameFrom(b.agent_id, leadName),
        );
      } catch {
        /* never throw into the turn */
      }
      return { status: 200, body: {} };
    },

    async substatus(body) {
      try {
        const b = bagOf(body);
        const tasks = Array.isArray(b.tasks) ? b.tasks : [];
        for (const raw of tasks) {
          const t = bagOf(raw);
          // SCOPE RULE: agent teams only. subagentStatusLine reports a row for
          // EVERY subagent, including Agent-tool subagents and workflow
          // fan-outs. Only in_process_teammate rows are team members.
          if (str(t.type) !== 'in_process_teammate') continue;
          const agent = agentNameFrom(t.agentId ?? t.agent_id ?? t.name, leadName);
          store.append(
            'substatus',
            {
              agent,
              tokenCount: num(t.tokenCount),
              contextWindowSize: num(t.contextWindowSize),
              status: str(t.status),
              model: str(t.model),
            },
            agent,
          );
        }
      } catch {
        /* never throw into the turn */
      }
      return { status: 200, body: {} };
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/server/ingest/hooks.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/ingest/hooks.ts src/server/ingest/hooks.test.ts && git commit -m "feat: hook, statusline and substatus ingest that always answers immediately except a held PermissionRequest"
```

---

### Task 15: Mailbox writer and permission holds

**Files:**
- Create: `src/server/control/mailbox.ts`
- Modify: `src/server/control/permits.ts` (types created in Task 14 — ADD `createPermits`, keep the existing exports)
- Test: `src/server/control/mailbox.test.ts`
- Test: `src/server/control/permits.test.ts`

**Interfaces:**
- Consumes: `readJsonSafe` from `src/server/watch/jsonfile.ts`; `InboxEntry` from `src/shared/mailbox.ts`; `TeamConfig` from `src/shared/roster.ts`
- Produces: `sendToInbox(teamName: string, toAgent: string, body: { text: string; summary?: string; from?: string }): Promise<{ msgId: string }>`, `setTeamsRoot(root: string): void`, `getTeamsRoot(): string`, `atomicWrite(path: string, data: string): Promise<void>` — the root accessors and `atomicWrite` are **defined here, in this phase**, because the frozen `sendToInbox` signature carries no base-directory parameter. Also `createPermits(): Permits`, `interface HeldPermit`, `interface Permits`, `autoDenyReason(timeoutMs: number): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/control/permits.test.ts
import { describe, it, expect } from 'vitest';
import { createPermits, autoDenyReason } from './permits.js';

describe('createPermits', () => {
  it('auto-denies at 90% of the hook timeout with a stated reason', async () => {
    const permits = createPermits();
    const before = Date.now();
    const held = permits.hold('probe-alpha', 'Bash', { command: 'rm -rf /' }, 100);

    const listed = permits.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: held.id, agent: 'probe-alpha', toolName: 'Bash' });
    expect(listed[0].input).toEqual({ command: 'rm -rf /' });
    expect(listed[0].expiresAt).toBeGreaterThanOrEqual(before + 90);
    expect(listed[0].expiresAt).toBeLessThanOrEqual(before + 120);

    expect(await held.promise).toEqual({
      decision: 'deny',
      reason: 'auto-denied after 90ms with no operator response',
    });
    expect(permits.list()).toEqual([]);
    expect(Date.now() - before).toBeGreaterThanOrEqual(85);
  });

  it('resolves on an operator decision and forgets the hold', async () => {
    const permits = createPermits();
    const held = permits.hold('probe-bravo', 'Write', { file_path: '/tmp/x' }, 600000);
    expect(permits.resolve(held.id, 'allow')).toBe(true);
    expect(await held.promise).toEqual({ decision: 'allow', reason: undefined });
    expect(permits.list()).toEqual([]);
    expect(permits.resolve(held.id, 'deny')).toBe(false);
  });

  it('carries an operator deny reason through', async () => {
    const permits = createPermits();
    const held = permits.hold('probe-charlie', 'Bash', {}, 600000);
    permits.resolve(held.id, 'deny', 'not touching migrations');
    expect(await held.promise).toEqual({ decision: 'deny', reason: 'not touching migrations' });
  });

  it('keeps concurrent holds independent', async () => {
    const permits = createPermits();
    const a = permits.hold('probe-alpha', 'Bash', {}, 600000);
    const b = permits.hold('probe-bravo', 'Edit', {}, 600000);
    expect(permits.list()).toHaveLength(2);
    permits.resolve(b.id, 'deny', 'no');
    expect(await b.promise).toEqual({ decision: 'deny', reason: 'no' });
    expect(permits.list().map((p) => p.id)).toEqual([a.id]);
    permits.resolve(a.id, 'allow');
    await a.promise;
  });

  it('states the exact auto-deny reason', () => {
    expect(autoDenyReason(600000)).toBe('auto-denied after 540000ms with no operator response');
  });
});
```

```ts
// src/server/control/mailbox.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sendToInbox, setTeamsRoot } from './mailbox.js';
import type { InboxEntry } from '../../shared/mailbox.js';

const FIXTURES = path.resolve(process.cwd(), 'fixtures');
const TEAM = 'session-98b0b4a7';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let root: string;
let fixtureEntry: InboxEntry;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-'));
  await fs.mkdir(path.join(root, TEAM, 'inboxes'), { recursive: true });
  await fs.copyFile(
    path.join(FIXTURES, 'config-4-members.json'),
    path.join(root, TEAM, 'config.json'),
  );
  const snapshots = JSON.parse(
    await fs.readFile(path.join(FIXTURES, 'inbox-snapshots.json'), 'utf8'),
  ) as Array<{ path: string; entries: InboxEntry[] }>;
  fixtureEntry = snapshots[3].entries[0];
  setTeamsRoot(root);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const readInbox = async (name: string): Promise<InboxEntry[]> =>
  JSON.parse(await fs.readFile(path.join(root, TEAM, 'inboxes', `${name}.json`), 'utf8')) as InboxEntry[];

describe('sendToInbox', () => {
  it('writes the exact on-disk shape the fixture records', async () => {
    const { msgId } = await sendToInbox(TEAM, 'team-lead', {
      text: fixtureEntry.text,
      summary: fixtureEntry.summary,
      from: 'probe-alpha',
    });

    const entries = await readInbox('team-lead');
    expect(entries).toHaveLength(1);
    const written = entries[0];

    expect(Object.keys(written)).toEqual(Object.keys(fixtureEntry));
    expect(written.from).toBe('probe-alpha');
    expect(written.text).toBe('probe-alpha reporting: I claimed task 1. This is spike traffic.');
    expect(written.summary).toBe('probe-alpha claimed task 1');
    expect(written.color).toBe('blue');
    expect(written.msgV).toBe(1);
    expect(written.type).toBe('message');
    expect(written.read).toBe(false);
    expect(written.msg_id).toBe(msgId);
    expect(written.msg_id).toMatch(UUID);
    expect(Number.isNaN(Date.parse(written.timestamp))).toBe(false);
    expect(written.timestamp).toMatch(/Z$/);
  });

  it('defaults from to team-lead and omits colour the roster does not carry', async () => {
    await sendToInbox(TEAM, 'probe-charlie', { text: 'stand down' });
    const [written] = await readInbox('probe-charlie');
    expect(written.from).toBe('team-lead');
    expect(Object.keys(written)).toEqual(['from', 'text', 'timestamp', 'msgV', 'msg_id', 'type', 'read']);
  });

  it('appends to an existing pending queue without disturbing it', async () => {
    await fs.writeFile(
      path.join(root, TEAM, 'inboxes', 'team-lead.json'),
      JSON.stringify([fixtureEntry], null, 2),
    );
    const { msgId } = await sendToInbox(TEAM, 'team-lead', { text: 'second' });
    const entries = await readInbox('team-lead');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual(fixtureEntry);
    expect(entries[1].text).toBe('second');
    expect(entries[1].msg_id).toBe(msgId);
  });

  it('creates the inbox lazily and releases the lock', async () => {
    await sendToInbox('session-brand-new', 'probe-alpha', { text: 'hello' });
    const file = path.join(root, 'session-brand-new', 'inboxes', 'probe-alpha.json');
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toHaveLength(1);
    await expect(fs.stat(`${file}.lock`)).rejects.toThrow();
  });

  it('serialises two concurrent sends into two entries', async () => {
    await Promise.all([
      sendToInbox(TEAM, 'probe-bravo', { text: 'one' }),
      sendToInbox(TEAM, 'probe-bravo', { text: 'two' }),
    ]);
    const entries = await readInbox('probe-bravo');
    expect(entries.map((e) => e.text).sort()).toEqual(['one', 'two']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/control/permits.test.ts src/server/control/mailbox.test.ts`
Expected: FAIL with "Failed to resolve import \"./permits.js\"" and "Failed to resolve import \"./mailbox.js\""

- [ ] **Step 3: Write the implementation**

```ts
// src/server/control/permits.ts
import { randomUUID } from 'node:crypto';

export interface HeldPermit {
  id: string;
  agent: string;
  toolName: string;
  input: unknown;
  expiresAt: number;
}

export interface Permits {
  hold(
    agent: string,
    toolName: string,
    input: unknown,
    timeoutMs: number,
  ): { id: string; promise: Promise<{ decision: 'allow' | 'deny'; reason?: string }> };
  resolve(id: string, decision: 'allow' | 'deny', reason?: string): boolean;
  list(): HeldPermit[];
}

export function autoDenyReason(timeoutMs: number): string {
  return `auto-denied after ${Math.floor(timeoutMs * 0.9)}ms with no operator response`;
}

interface Entry {
  permit: HeldPermit;
  timer: NodeJS.Timeout;
  settle(decision: 'allow' | 'deny', reason?: string): void;
}

export function createPermits(): Permits {
  const held = new Map<string, Entry>();

  return {
    hold(agent, toolName, input, timeoutMs) {
      const id = randomUUID();
      // Auto-deny short of the hook's own timeout so the agent gets a clear
      // refusal instead of the turn hanging to the full 600s.
      const holdMs = Math.floor(timeoutMs * 0.9);
      let settle!: (v: { decision: 'allow' | 'deny'; reason?: string }) => void;
      const promise = new Promise<{ decision: 'allow' | 'deny'; reason?: string }>((res) => {
        settle = res;
      });

      const timer = setTimeout(() => {
        held.delete(id);
        settle({ decision: 'deny', reason: autoDenyReason(timeoutMs) });
      }, holdMs);
      timer.unref?.();

      held.set(id, {
        permit: { id, agent, toolName, input, expiresAt: Date.now() + holdMs },
        timer,
        settle: (decision, reason) => settle({ decision, reason }),
      });

      return { id, promise };
    },

    resolve(id, decision, reason) {
      const entry = held.get(id);
      if (!entry) return false;
      clearTimeout(entry.timer);
      held.delete(id);
      entry.settle(decision, reason);
      return true;
    },

    list() {
      return [...held.values()].map((e) => e.permit);
    },
  };
}
```

```ts
// src/server/control/mailbox.ts
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { readJsonSafe } from '../watch/jsonfile.js';
import type { InboxEntry } from '../../shared/mailbox.js';
import type { TeamConfig } from '../../shared/roster.js';

// The pinned sendToInbox signature carries no base directory, so the teams root
// is module state — set once at startup and overridden by tests.
let teamsRoot = path.join(os.homedir(), '.claude', 'teams');

export function setTeamsRoot(root: string): void {
  teamsRoot = root;
}

export function getTeamsRoot(): string {
  return teamsRoot;
}

export async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, filePath);
}

async function colorOf(teamName: string, agent: string): Promise<string | undefined> {
  const config = await readJsonSafe<TeamConfig>(path.join(teamsRoot, teamName, 'config.json'));
  return config?.members.find((m) => m.name === agent)?.color;
}

export async function sendToInbox(
  teamName: string,
  toAgent: string,
  body: { text: string; summary?: string; from?: string },
): Promise<{ msgId: string }> {
  const from = body.from ?? 'team-lead';
  const dir = path.join(teamsRoot, teamName, 'inboxes');
  await fs.mkdir(dir, { recursive: true });

  const file = path.join(dir, `${toAgent}.json`);
  try {
    await fs.access(file);
  } catch {
    await atomicWrite(file, '[]');
  }

  const color = await colorOf(teamName, from);
  const msgId = randomUUID();

  const release = await lockfile.lock(file, {
    lockfilePath: `${file}.lock`,
    realpath: false,
    retries: { retries: 20, minTimeout: 10, maxTimeout: 200 },
  });
  try {
    const existing = (await readJsonSafe<InboxEntry[]>(file)) ?? [];
    // Key order matches the on-disk shape Claude Code writes; JSON.stringify
    // drops the undefined ones, so absent summary/colour leave no empty keys.
    const entry: InboxEntry = {
      from,
      text: body.text,
      summary: body.summary,
      timestamp: new Date().toISOString(),
      color,
      msgV: 1,
      msg_id: msgId,
      type: 'message',
      read: false,
    };
    await atomicWrite(file, JSON.stringify([...(Array.isArray(existing) ? existing : []), entry], null, 2));
  } finally {
    await release();
  }

  return { msgId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/control/permits.test.ts src/server/control/mailbox.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/control/mailbox.ts src/server/control/permits.ts src/server/control/mailbox.test.ts src/server/control/permits.test.ts && git commit -m "feat: locked inbox writer and permission hold registry with auto-deny at 90% of the hook timeout"
```

---

### Task 16: SSE stream and the HTTP surface

**Files:**
- Create: `src/server/stream.ts`
- Create: `src/server/http.ts`
- Test: `src/server/http.test.ts`

**Interfaces:**
- Consumes: `Store` from `src/server/store.ts`; `Permits` from `src/server/control/permits.ts`; `HookHandlers` from `src/server/ingest/hooks.ts`; `sendToInbox`, `setTeamsRoot` from `src/server/control/mailbox.ts`; `TeamState` from `src/shared/domain.ts`
- Produces: `interface StreamHub { subscribe(res: ServerResponse): void; publish(): void; close(): void; readonly clients: number }`, `createStream(snapshot: () => TeamState, coalesceMs?: number): StreamHub`, `COALESCE_MS`, `interface HttpDeps { permits: Permits; hooks: HookHandlers; stream: StreamHub; state: () => TeamState; readOnly: boolean; leadName?: string }`, `createHttpServer(deps: HttpDeps): http.Server`, `listen(server: http.Server, port: number): Promise<number>`, `READ_ONLY_BODY`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/http.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { openStore, type Store } from './store.js';
import { createPermits, type Permits } from './control/permits.js';
import { createHookHandlers } from './ingest/hooks.js';
import { createStream, type StreamHub } from './stream.js';
import { createHttpServer, listen, READ_ONLY_BODY } from './http.js';
import { setTeamsRoot } from './control/mailbox.js';
import type { InboxEntry } from '../shared/mailbox.js';
import type { TeamState } from '../shared/domain.js';

const FIXTURES = path.resolve(process.cwd(), 'fixtures');
const TEAM = 'session-98b0b4a7';

let dir: string;
let store: Store;
let permits: Permits;
let hub: StreamHub;
let state: TeamState;

function emptyState(readOnly: boolean): TeamState {
  return {
    teamName: TEAM,
    leadSessionId: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283',
    startedAt: 1787798107581,
    totalTokens: 734808,
    totalCostUsd: 0.898893,
    agents: [],
    tasks: [],
    mail: [],
    needsYou: [
      { id: 'plan-1', kind: 'plan', agent: 'probe-alpha', reason: 'plan approval', detail: '4 steps' },
    ],
    readOnly,
  };
}

async function boot(readOnly: boolean): Promise<{ server: Server; url: string }> {
  state = emptyState(readOnly);
  hub = createStream(() => state, 50);
  const server = createHttpServer({
    permits,
    hooks: createHookHandlers({ store, permits }),
    stream: hub,
    state: () => state,
    readOnly,
  });
  const port = await listen(server, 0);
  return { server, url: `http://127.0.0.1:${port}` };
}

function shutdown(server: Server): Promise<void> {
  hub.close();
  return new Promise((r) => server.close(() => r()));
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'http-'));
  await fs.mkdir(path.join(dir, TEAM, 'inboxes'), { recursive: true });
  await fs.copyFile(path.join(FIXTURES, 'config-4-members.json'), path.join(dir, TEAM, 'config.json'));
  setTeamsRoot(dir);
  store = openStore(path.join(dir, 'events.db'));
  permits = createPermits();
});

afterEach(async () => {
  store.close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('GET /stream', () => {
  it('emits a snapshot event first, then coalesced state events', async () => {
    const { server, url } = await boot(false);
    try {
      const res = await fetch(`${url}/stream`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/event-stream');

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const first = decoder.decode((await reader.read()).value);
      expect(first).toContain('event: snapshot');
      expect(first).toContain('"teamName":"session-98b0b4a7"');

      hub.publish();
      hub.publish();
      const second = decoder.decode((await reader.read()).value);
      expect(second).toContain('event: state');
      expect(second.match(/event: state/g)).toHaveLength(1);

      await reader.cancel();
    } finally {
      await shutdown(server);
    }
  });
});

describe('control routes', () => {
  it('POST /api/agents/:name/message writes the inbox and returns the msgId', async () => {
    const { server, url } = await boot(false);
    try {
      const res = await fetch(`${url}/api/agents/probe-charlie/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'stand down', summary: 'stand down' }),
      });
      expect(res.status).toBe(200);
      const { msgId } = (await res.json()) as { msgId: string };

      const entries = JSON.parse(
        await fs.readFile(path.join(dir, TEAM, 'inboxes', 'probe-charlie.json'), 'utf8'),
      ) as InboxEntry[];
      expect(entries).toHaveLength(1);
      expect(entries[0].msg_id).toBe(msgId);
      expect(entries[0].from).toBe('team-lead');
      expect(entries[0].text).toBe('stand down');
    } finally {
      await shutdown(server);
    }
  });

  it('POST /api/plans/:requestId/approve writes a plan_approval_response frame', async () => {
    const { server, url } = await boot(false);
    try {
      const res = await fetch(`${url}/api/plans/plan-1/approve`, { method: 'POST' });
      expect(res.status).toBe(200);
      const entries = JSON.parse(
        await fs.readFile(path.join(dir, TEAM, 'inboxes', 'probe-alpha.json'), 'utf8'),
      ) as InboxEntry[];
      const frame = JSON.parse(entries[0].text) as Record<string, unknown>;
      expect(frame.type).toBe('plan_approval_response');
      expect(frame.requestId).toBe('plan-1');
      expect(frame.approved).toBe(true);
    } finally {
      await shutdown(server);
    }
  });

  it('POST /api/plans/:requestId/reject carries the feedback', async () => {
    const { server, url } = await boot(false);
    try {
      await fetch(`${url}/api/plans/plan-1/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feedback: 'do not drop migrations/legacy' }),
      });
      const entries = JSON.parse(
        await fs.readFile(path.join(dir, TEAM, 'inboxes', 'probe-alpha.json'), 'utf8'),
      ) as InboxEntry[];
      const frame = JSON.parse(entries[0].text) as Record<string, unknown>;
      expect(frame.approved).toBe(false);
      expect(frame.feedback).toBe('do not drop migrations/legacy');
    } finally {
      await shutdown(server);
    }
  });

  it('404s a plan id that is not on the needs-you strip', async () => {
    const { server, url } = await boot(false);
    try {
      const res = await fetch(`${url}/api/plans/nope/approve`, { method: 'POST' });
      expect(res.status).toBe(404);
    } finally {
      await shutdown(server);
    }
  });

  it('POST /api/permits/:id/allow releases the held hook', async () => {
    const { server, url } = await boot(false);
    try {
      const held = permits.hold('probe-bravo', 'Bash', {}, 600000);
      const res = await fetch(`${url}/api/permits/${held.id}/allow`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await held.promise).toEqual({ decision: 'allow', reason: undefined });

      const missing = await fetch(`${url}/api/permits/${held.id}/deny`, { method: 'POST' });
      expect(missing.status).toBe(404);
    } finally {
      await shutdown(server);
    }
  });

  it('POST /api/agents/:name/stop writes a shutdown_request frame', async () => {
    const { server, url } = await boot(false);
    try {
      await fetch(`${url}/api/agents/probe-bravo/stop`, { method: 'POST' });
      const entries = JSON.parse(
        await fs.readFile(path.join(dir, TEAM, 'inboxes', 'probe-bravo.json'), 'utf8'),
      ) as InboxEntry[];
      const frame = JSON.parse(entries[0].text) as Record<string, unknown>;
      expect(frame.type).toBe('shutdown_request');
      expect(frame.reason).toBe('stop');
    } finally {
      await shutdown(server);
    }
  });

  it('POST /api/agents/:name/respawn asks the lead, not the dead teammate', async () => {
    const { server, url } = await boot(false);
    try {
      await fetch(`${url}/api/agents/probe-charlie/respawn`, { method: 'POST' });
      const entries = JSON.parse(
        await fs.readFile(path.join(dir, TEAM, 'inboxes', 'team-lead.json'), 'utf8'),
      ) as InboxEntry[];
      expect(entries[0].text).toContain('probe-charlie');
      expect(entries[0].summary).toBe('respawn probe-charlie');
    } finally {
      await shutdown(server);
    }
  });
});

describe('--read-only', () => {
  it('409s every control route with an explanatory body', async () => {
    const { server, url } = await boot(true);
    try {
      const routes: Array<[string, unknown]> = [
        ['/api/agents/probe-alpha/message', { text: 'hi' }],
        ['/api/plans/plan-1/approve', {}],
        ['/api/plans/plan-1/reject', { feedback: 'no' }],
        ['/api/permits/x/allow', {}],
        ['/api/agents/probe-alpha/interrupt', {}],
        ['/api/agents/probe-alpha/stop', {}],
        ['/api/agents/probe-alpha/respawn', {}],
      ];
      for (const [route, body] of routes) {
        const res = await fetch(url + route, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual(READ_ONLY_BODY);
      }
      await expect(fs.stat(path.join(dir, TEAM, 'inboxes', 'probe-alpha.json'))).rejects.toThrow();
    } finally {
      await shutdown(server);
    }
  });

  it('leaves the observer routes working', async () => {
    const { server, url } = await boot(true);
    try {
      const res = await fetch(`${url}/hook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({});
      expect(store.replay().filter((e) => e.kind === 'hook')).toHaveLength(1);
    } finally {
      await shutdown(server);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/http.test.ts`
Expected: FAIL with "Failed to resolve import \"./stream.js\" from \"src/server/http.test.ts\""

- [ ] **Step 3: Write the implementation**

```ts
// src/server/stream.ts
import type { ServerResponse } from 'node:http';
import type { TeamState } from '../shared/domain.js';

export const COALESCE_MS = 250;
const HEARTBEAT_MS = 15_000;

export interface StreamHub {
  subscribe(res: ServerResponse): void;
  publish(): void;
  close(): void;
  readonly clients: number;
}

function frame(event: string, state: TeamState): string {
  return `event: ${event}\ndata: ${JSON.stringify(state)}\n\n`;
}

export function createStream(snapshot: () => TeamState, coalesceMs = COALESCE_MS): StreamHub {
  const clients = new Set<ServerResponse>();
  let timer: NodeJS.Timeout | null = null;
  let lastFlush = 0;
  let closed = false;

  const flush = () => {
    if (clients.size === 0) return;
    const payload = frame('state', snapshot());
    for (const res of clients) res.write(payload);
  };

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': keepalive\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    subscribe(res) {
      if (closed) {
        res.end();
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write(frame('snapshot', snapshot()));
      clients.add(res);
      res.on('close', () => clients.delete(res));
    },

    publish() {
      if (closed || timer) return;
      const wait = Math.max(0, coalesceMs - (Date.now() - lastFlush));
      timer = setTimeout(() => {
        timer = null;
        lastFlush = Date.now();
        flush();
      }, wait);
      timer.unref?.();
    },

    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      clearInterval(heartbeat);
      for (const res of clients) res.end();
      clients.clear();
    },

    get clients() {
      return clients.size;
    },
  };
}
```

```ts
// src/server/http.ts
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Permits } from './control/permits.js';
import type { HookHandlers } from './ingest/hooks.js';
import type { StreamHub } from './stream.js';
import { sendToInbox } from './control/mailbox.js';
import type { TeamState } from '../shared/domain.js';

export const READ_ONLY_BODY = {
  error: 'read-only',
  message: 'the console was started with --read-only; control routes are disabled',
};

export interface HttpDeps {
  permits: Permits;
  hooks: HookHandlers;
  stream: StreamHub;
  state: () => TeamState;
  readOnly: boolean;
  leadName?: string;
}

const AGENT_ROUTE = /^\/api\/agents\/([^/]+)\/(message|interrupt|stop|respawn)$/;
const PLAN_ROUTE = /^\/api\/plans\/([^/]+)\/(approve|reject)$/;
const PERMIT_ROUTE = /^\/api\/permits\/([^/]+)\/(allow|deny)$/;

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function createHttpServer(deps: HttpDeps): Server {
  const leadName = deps.leadName ?? 'team-lead';
  const team = () => deps.state().teamName;

  return http.createServer((req, res) => {
    void (async () => {
      try {
        const method = req.method ?? 'GET';
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const route = url.pathname;

        if (method === 'GET' && route === '/stream') {
          deps.stream.subscribe(res);
          return;
        }

        if (method === 'POST' && (route === '/hook' || route === '/statusline' || route === '/substatus')) {
          const body = await readBody(req);
          const out =
            route === '/hook'
              ? await deps.hooks.hook(body)
              : route === '/statusline'
                ? await deps.hooks.statusline(body)
                : await deps.hooks.substatus(body);
          deps.stream.publish();
          json(res, out.status, out.body);
          return;
        }

        if (method !== 'POST' || !route.startsWith('/api/')) {
          json(res, 404, { error: 'not found', message: `no route for ${method} ${route}` });
          return;
        }

        // Every /api/ route is a control write, so the read-only gate is one check.
        if (deps.readOnly) {
          json(res, 409, READ_ONLY_BODY);
          return;
        }

        const body = await readBody(req);
        const timestamp = new Date().toISOString();

        const agentMatch = AGENT_ROUTE.exec(route);
        if (agentMatch) {
          const name = decodeURIComponent(agentMatch[1]);
          const action = agentMatch[2];
          if (action === 'message') {
            const text = str(body.text);
            if (!text) {
              json(res, 400, { error: 'bad request', message: 'text is required' });
              return;
            }
            const out = await sendToInbox(team(), name, { text, summary: str(body.summary), from: leadName });
            deps.stream.publish();
            json(res, 200, out);
            return;
          }
          if (action === 'respawn') {
            // There is no external respawn path; the lead has to do it, and the
            // card says so rather than pretending this is direct.
            const out = await sendToInbox(team(), leadName, {
              text: `Teammate ${name} needs respawning. Re-spawn it with the same role and prompt.`,
              summary: `respawn ${name}`,
              from: leadName,
            });
            deps.stream.publish();
            json(res, 200, out);
            return;
          }
          const out = await sendToInbox(team(), name, {
            text: JSON.stringify({ type: 'shutdown_request', reason: action, from: leadName, timestamp }),
            summary: `${action} ${name}`,
            from: leadName,
          });
          deps.stream.publish();
          json(res, 200, out);
          return;
        }

        const planMatch = PLAN_ROUTE.exec(route);
        if (planMatch) {
          const requestId = decodeURIComponent(planMatch[1]);
          const approved = planMatch[2] === 'approve';
          const card = deps.state().needsYou.find((n) => n.id === requestId);
          if (!card) {
            json(res, 404, { error: 'not found', message: `no pending plan ${requestId}` });
            return;
          }
          const out = await sendToInbox(team(), card.agent, {
            text: JSON.stringify({
              type: 'plan_approval_response',
              requestId,
              approved,
              feedback: str(body.feedback),
              timestamp,
            }),
            summary: `plan ${approved ? 'approved' : 'rejected'}`,
            from: leadName,
          });
          deps.stream.publish();
          json(res, 200, out);
          return;
        }

        const permitMatch = PERMIT_ROUTE.exec(route);
        if (permitMatch) {
          const id = decodeURIComponent(permitMatch[1]);
          const decision = permitMatch[2] === 'allow' ? 'allow' : 'deny';
          const ok = deps.permits.resolve(id, decision, str(body.reason));
          if (!ok) {
            json(res, 404, { error: 'not found', message: `no held permit ${id}` });
            return;
          }
          deps.stream.publish();
          json(res, 200, {});
          return;
        }

        json(res, 404, { error: 'not found', message: `no route for ${method} ${route}` });
      } catch (err) {
        json(res, 500, { error: 'server error', message: (err as Error).message });
      }
    })();
  });
}

export function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/http.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/stream.ts src/server/http.ts src/server/http.test.ts && git commit -m "feat: coalesced SSE stream and the control HTTP surface with a read-only gate"
```

---

### Task 17: Setup command and CLI entry

**Files:**
- Create: `src/server/setup.ts`
- Create: `src/server/index.ts`
- Test: `src/server/setup.test.ts`
- Test: `src/server/index.test.ts`

**Interfaces:**
- Consumes: `openStore`, `Store` from `src/server/store.ts`; `project` from `src/server/project.ts`; `startFileIngest` from `src/server/ingest/files.ts`; `createHookHandlers` from `src/server/ingest/hooks.ts`; `createPermits` from `src/server/control/permits.ts`; `setTeamsRoot` from `src/server/control/mailbox.ts`; `createStream` from `src/server/stream.ts`; `createHttpServer`, `listen` from `src/server/http.ts`; `readJsonSafe` from `src/server/watch/jsonfile.ts`
- Produces: `PINNED_CLAUDE_VERSION`, `HOOK_EVENTS`, `HOOK_TIMEOUT_MS`, `PERMISSION_HOOK_TIMEOUT_MS`, `hookBlock(port: number): HookBlock`, `mergeHookBlock(settings, port)`, `removeHookBlock(settings)`, `checkClaudeVersion(raw: string | null)`, `runSetup(opts)`, and from index.ts `parseArgs(argv: string[]): Cli`, `main(argv: string[]): Promise<number>`

- [ ] **Step 1: Add the server bundle step**

`npm run build` currently builds only the web. The lifecycle launcher (Task 30) starts the
server with `node dist/server/index.js`, and plain Node ESM rejects this repo's extensionless
relative imports — so the server must be bundled into one self-contained file, not emitted
file-by-file by tsc.

```bash
npm i -D esbuild
```

Add to `package.json` scripts:

```json
{
  "build:server": "esbuild src/server/index.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/server/index.js --external:better-sqlite3 --external:proper-lockfile --banner:js=\"import{createRequire}from'module';const require=createRequire(import.meta.url);\"",
  "build": "vite build && npm run build:server"
}
```

`better-sqlite3` is native and `proper-lockfile` is CJS, so both stay external; the banner
gives the bundle a working `require` for them. Verify:

```bash
npm run build:server && node dist/server/index.js --help
```

Expected: the bundle runs and prints usage — no `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 2: Write the failing test**

```ts
// src/server/setup.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HOOK_EVENTS,
  HOOK_TIMEOUT_MS,
  PERMISSION_HOOK_TIMEOUT_MS,
  PINNED_CLAUDE_VERSION,
  checkClaudeVersion,
  hookBlock,
  mergeHookBlock,
  removeHookBlock,
  runSetup,
} from './setup.js';

interface HttpHook { type: string; url: string; timeout: number }
interface HookEntry { matcher?: string; hooks: HttpHook[] }

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('hookBlock', () => {
  const block = hookBlock(4317);

  it('round-trips as valid JSON', () => {
    expect(JSON.parse(JSON.stringify(block))).toEqual(block);
  });

  it('registers every event as an http hook at the right port', () => {
    expect(Object.keys(block.hooks)).toEqual([...HOOK_EVENTS]);
    for (const event of HOOK_EVENTS) {
      const entries = block.hooks[event] as HookEntry[];
      expect(entries).toHaveLength(1);
      expect(entries[0].hooks).toHaveLength(1);
      expect(entries[0].hooks[0].type).toBe('http');
      expect(entries[0].hooks[0].url).toBe('http://127.0.0.1:4317/hook');
    }
  });

  it('sets an explicit timeout on every entry, long only for the deliberate hold', () => {
    for (const event of HOOK_EVENTS) {
      const hook = (block.hooks[event] as HookEntry[])[0].hooks[0];
      expect(typeof hook.timeout).toBe('number');
      expect(hook.timeout).toBe(
        event === 'PermissionRequest' ? PERMISSION_HOOK_TIMEOUT_MS : HOOK_TIMEOUT_MS,
      );
    }
    expect(HOOK_TIMEOUT_MS).toBe(5000);
    expect(PERMISSION_HOOK_TIMEOUT_MS).toBe(600000);
  });

  it('carries a matcher only on the tool events', () => {
    expect((block.hooks.PreToolUse as HookEntry[])[0].matcher).toBe('*');
    expect((block.hooks.PostToolUse as HookEntry[])[0].matcher).toBe('*');
    expect((block.hooks.PermissionRequest as HookEntry[])[0].matcher).toBe('*');
    expect((block.hooks.SessionStart as HookEntry[])[0].matcher).toBeUndefined();
  });

  it('points both status lines at their own endpoints', () => {
    expect(block.statusLine.type).toBe('command');
    expect(block.statusLine.command).toContain('http://127.0.0.1:4317/statusline');
    expect(block.subagentStatusLine.command).toContain('http://127.0.0.1:4317/substatus');
  });

  it('honours a non-default port', () => {
    const other = hookBlock(4400);
    expect(((other.hooks.Stop as HookEntry[])[0].hooks[0]).url).toBe('http://127.0.0.1:4400/hook');
    expect(other.statusLine.command).toContain(':4400/statusline');
  });
});

describe('mergeHookBlock / removeHookBlock', () => {
  it('adds the block without disturbing unrelated settings', () => {
    const merged = mergeHookBlock({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }, 4317);
    expect(merged.model).toBe('opus');
    const stop = (merged.hooks as Record<string, HookEntry[]>).Stop;
    expect(stop).toHaveLength(2);
    expect((stop[0].hooks[0] as unknown as { command: string }).command).toBe('say done');
    expect(stop[1].hooks[0].url).toBe('http://127.0.0.1:4317/hook');
  });

  it('is idempotent', () => {
    const once = mergeHookBlock({}, 4317);
    expect(mergeHookBlock(once, 4317)).toEqual(once);
  });

  it('removes exactly what it added', () => {
    const original = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } };
    expect(removeHookBlock(mergeHookBlock(original, 4317))).toEqual(original);
  });

  it('leaves a settings file with no console hooks untouched', () => {
    const original = { model: 'opus', statusLine: { type: 'command', command: 'my-prompt' } };
    expect(removeHookBlock(original)).toEqual(original);
  });
});

describe('checkClaudeVersion', () => {
  it('accepts the pinned version', () => {
    expect(PINNED_CLAUDE_VERSION).toBe('2.1.231');
    expect(checkClaudeVersion('2.1.231 (Claude Code)')).toEqual({
      ok: true,
      message: 'claude 2.1.231 matches the pinned contract',
    });
  });

  it('warns on any other version', () => {
    expect(checkClaudeVersion('2.2.0 (Claude Code)')).toEqual({
      ok: false,
      message: 'claude 2.2.0 does not match the pinned 2.1.231; the control plane writes internal protocols and may be wrong',
    });
  });

  it('warns when the version cannot be read', () => {
    expect(checkClaudeVersion(null)).toEqual({
      ok: false,
      message: 'could not read `claude --version`; the console is pinned to 2.1.231 internals',
    });
    expect(checkClaudeVersion('command not found').ok).toBe(false);
  });
});

describe('runSetup', () => {
  it('prints the block and writes nothing without confirmation', async () => {
    const settingsPath = path.join(dir, 'settings.json');
    const output = await runSetup({ settingsPath, port: 4317, confirm: false });
    expect(output).toContain('"type": "http"');
    expect(output).toContain('http://127.0.0.1:4317/hook');
    expect(output).toContain('nothing was written');
    await expect(fs.stat(settingsPath)).rejects.toThrow();
  });

  it('writes on confirmation and restores on uninstall', async () => {
    const settingsPath = path.join(dir, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({ model: 'opus' }, null, 2));

    await runSetup({ settingsPath, port: 4317, confirm: true });
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as Record<string, unknown>;
    expect(written.model).toBe('opus');
    expect(Object.keys(written.hooks as object)).toEqual([...HOOK_EVENTS]);

    await runSetup({ settingsPath, port: 4317, confirm: true, uninstall: true });
    expect(JSON.parse(await fs.readFile(settingsPath, 'utf8'))).toEqual({ model: 'opus' });
  });

  it('creates a settings file that does not exist yet', async () => {
    const settingsPath = path.join(dir, 'nested', 'settings.json');
    await runSetup({ settingsPath, port: 4400, confirm: true });
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as { hooks: Record<string, HookEntry[]> };
    expect(written.hooks.PreToolUse[0].hooks[0].url).toBe('http://127.0.0.1:4400/hook');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/server/setup.test.ts`
Expected: FAIL with "Failed to resolve import \"./setup.js\" from \"src/server/setup.test.ts\""

- [ ] **Step 4: Write the implementation**

```ts
// src/server/setup.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const PINNED_CLAUDE_VERSION = '2.1.231';
export const HOOK_TIMEOUT_MS = 5000;
export const PERMISSION_HOOK_TIMEOUT_MS = 600_000;

export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'PreCompact',
] as const;

const MATCHER_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PermissionRequest']);
const CONSOLE_HOOK_URL = /^http:\/\/127\.0\.0\.1:\d+\/hook$/;

export interface HttpHook {
  type: 'http';
  url: string;
  timeout: number;
}
export interface HookEntry {
  matcher?: string;
  hooks: HttpHook[];
}
export interface StatusLineCommand {
  type: 'command';
  command: string;
  refreshInterval?: number;
}
export interface HookBlock {
  hooks: Record<string, HookEntry[]>;
  statusLine: StatusLineCommand;
  subagentStatusLine: StatusLineCommand;
}

function post(port: number, route: string): string {
  return `curl -sS -m 2 -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:${port}/${route} >/dev/null 2>&1; printf ''`;
}

export function hookBlock(port: number): HookBlock {
  const hooks: Record<string, HookEntry[]> = {};
  for (const event of HOOK_EVENTS) {
    const entry: HookEntry = {
      hooks: [
        {
          type: 'http',
          url: `http://127.0.0.1:${port}/hook`,
          // PermissionRequest is deliberately held for the operator; every other
          // event must not be able to stall the agent's turn.
          timeout: event === 'PermissionRequest' ? PERMISSION_HOOK_TIMEOUT_MS : HOOK_TIMEOUT_MS,
        },
      ],
    };
    if (MATCHER_EVENTS.has(event)) entry.matcher = '*';
    hooks[event] = [entry];
  }
  return {
    hooks,
    statusLine: { type: 'command', command: post(port, 'statusline'), refreshInterval: 5 },
    subagentStatusLine: { type: 'command', command: post(port, 'substatus') },
  };
}

function isConsoleEntry(entry: unknown): boolean {
  const hooks = (entry as HookEntry | undefined)?.hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((h) => h?.type === 'http' && typeof h.url === 'string' && CONSOLE_HOOK_URL.test(h.url));
}

function isConsoleStatusLine(value: unknown, route: string): boolean {
  const command = (value as StatusLineCommand | undefined)?.command;
  return typeof command === 'string' && command.includes(`127.0.0.1:`) && command.includes(`/${route}`);
}

export function mergeHookBlock(
  settings: Record<string, unknown>,
  port: number,
): Record<string, unknown> {
  const block = hookBlock(port);
  const existing = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const hooks: Record<string, unknown[]> = {};
  for (const [event, entries] of Object.entries(existing)) {
    hooks[event] = (Array.isArray(entries) ? entries : []).filter((e) => !isConsoleEntry(e));
  }
  for (const event of HOOK_EVENTS) {
    hooks[event] = [...(hooks[event] ?? []), ...block.hooks[event]];
  }
  return {
    ...settings,
    hooks,
    statusLine: block.statusLine,
    subagentStatusLine: block.subagentStatusLine,
  };
}

export function removeHookBlock(settings: Record<string, unknown>): Record<string, unknown> {
  const out = { ...settings };
  const existing = settings.hooks as Record<string, unknown[]> | undefined;
  if (existing) {
    const hooks: Record<string, unknown[]> = {};
    for (const [event, entries] of Object.entries(existing)) {
      const kept = (Array.isArray(entries) ? entries : []).filter((e) => !isConsoleEntry(e));
      if (kept.length > 0) hooks[event] = kept;
    }
    if (Object.keys(hooks).length > 0) out.hooks = hooks;
    else delete out.hooks;
  }
  if (isConsoleStatusLine(out.statusLine, 'statusline')) delete out.statusLine;
  if (isConsoleStatusLine(out.subagentStatusLine, 'substatus')) delete out.subagentStatusLine;
  return out;
}

export function checkClaudeVersion(raw: string | null): { ok: boolean; message: string } {
  const version = raw ? /(\d+\.\d+\.\d+)/.exec(raw)?.[1] : undefined;
  if (!version) {
    return {
      ok: false,
      message: `could not read \`claude --version\`; the console is pinned to ${PINNED_CLAUDE_VERSION} internals`,
    };
  }
  if (version === PINNED_CLAUDE_VERSION) {
    return { ok: true, message: `claude ${version} matches the pinned contract` };
  }
  return {
    ok: false,
    message: `claude ${version} does not match the pinned ${PINNED_CLAUDE_VERSION}; the control plane writes internal protocols and may be wrong`,
  };
}

export async function readClaudeVersion(): Promise<string | null> {
  try {
    const { stdout } = await run('claude', ['--version'], { timeout: 5000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function runSetup(opts: {
  settingsPath: string;
  port: number;
  confirm: boolean;
  uninstall?: boolean;
}): Promise<string> {
  const block = hookBlock(opts.port);
  const lines: string[] = [];

  if (!opts.uninstall) {
    lines.push(`This block goes into ${opts.settingsPath}:`, '', JSON.stringify(block, null, 2), '');
  } else {
    lines.push(`This removes the console's hooks and status lines from ${opts.settingsPath}.`, '');
  }

  if (!opts.confirm) {
    lines.push('nothing was written — re-run with --yes to apply.');
    return lines.join('\n');
  }

  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(await fs.readFile(opts.settingsPath, 'utf8')) as Record<string, unknown>;
  } catch {
    current = {};
  }

  const next = opts.uninstall ? removeHookBlock(current) : mergeHookBlock(current, opts.port);
  await fs.mkdir(path.dirname(opts.settingsPath), { recursive: true });
  await fs.writeFile(opts.settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  lines.push(opts.uninstall ? 'removed.' : 'written.');
  return lines.join('\n');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/server/setup.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/setup.ts src/server/setup.test.ts && git commit -m "feat: explicit setup/uninstall that prints the settings.json hook block before writing it"
```

- [ ] **Step 7: Write the failing test for the CLI entry**

```ts
// src/server/index.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, discoverTeam, DEFAULT_PORT } from './index.js';

const FIXTURES = path.resolve(process.cwd(), 'fixtures');

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('parseArgs', () => {
  it('defaults to running the console on 4317', () => {
    const cli = parseArgs([]);
    expect(cli.command).toBe('run');
    expect(cli.port).toBe(DEFAULT_PORT);
    expect(DEFAULT_PORT).toBe(4317);
    expect(cli.readOnly).toBe(false);
    expect(cli.confirm).toBe(false);
    expect(cli.claudeHome.endsWith(path.join('.claude'))).toBe(true);
  });

  it('reads the setup command with an explicit port and confirmation', () => {
    const cli = parseArgs(['setup', '--port', '4400', '--yes']);
    expect(cli.command).toBe('setup');
    expect(cli.port).toBe(4400);
    expect(cli.confirm).toBe(true);
  });

  it('reads uninstall and --read-only', () => {
    expect(parseArgs(['uninstall']).command).toBe('uninstall');
    expect(parseArgs(['--read-only']).readOnly).toBe(true);
    expect(parseArgs(['--read-only']).command).toBe('run');
  });

  it('accepts --port=NNNN and an overridden claude home', () => {
    const cli = parseArgs(['--port=4500', '--claude-home', '/tmp/fake-claude']);
    expect(cli.port).toBe(4500);
    expect(cli.claudeHome).toBe('/tmp/fake-claude');
    expect(cli.settingsPath).toBe('/tmp/fake-claude/settings.json');
    expect(cli.dbPath).toBe('/tmp/fake-claude/agent-teams-console/events.db');
  });
});

describe('discoverTeam', () => {
  it('returns null when no team directory exists', async () => {
    await fs.mkdir(path.join(dir, 'teams'), { recursive: true });
    expect(await discoverTeam(path.join(dir, 'teams'))).toBeNull();
  });

  it('picks the newest team by createdAt and derives the project slug', async () => {
    const teams = path.join(dir, 'teams');
    await fs.mkdir(path.join(teams, 'session-98b0b4a7'), { recursive: true });
    await fs.mkdir(path.join(teams, 'session-older11'), { recursive: true });
    await fs.copyFile(
      path.join(FIXTURES, 'config-4-members.json'),
      path.join(teams, 'session-98b0b4a7', 'config.json'),
    );
    await fs.writeFile(
      path.join(teams, 'session-older11', 'config.json'),
      JSON.stringify({
        name: 'session-older11',
        createdAt: 1,
        leadAgentId: 'team-lead@session-older11',
        leadSessionId: 'older',
        members: [],
      }),
    );

    const found = (await discoverTeam(teams))!;
    expect(found.teamName).toBe('session-98b0b4a7');
    expect(found.leadSessionId).toBe('98b0b4a7-3206-455b-aaf6-a5a81ad1e283');
    expect(found.projectSlug).toBe('-Users-alanoliv-code-agents-team-ui');
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npx vitest run src/server/index.test.ts`
Expected: FAIL with "Failed to resolve import \"./index.js\" from \"src/server/index.test.ts\""

- [ ] **Step 9: Write the CLI entry**

```ts
// src/server/index.ts
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { openStore, type Store, type EventKind, type StoredEvent } from './store.js';
import { project } from './project.js';
import { startFileIngest } from './ingest/files.js';
import { createHookHandlers } from './ingest/hooks.js';
import { createPermits } from './control/permits.js';
import { setTeamsRoot } from './control/mailbox.js';
import { createStream } from './stream.js';
import { createHttpServer, listen } from './http.js';
import { readJsonSafe } from './watch/jsonfile.js';
import { checkClaudeVersion, readClaudeVersion, runSetup } from './setup.js';
import type { TeamConfig } from '../shared/roster.js';

export const DEFAULT_PORT = 4317;

export interface Cli {
  command: 'run' | 'setup' | 'uninstall';
  port: number;
  readOnly: boolean;
  confirm: boolean;
  claudeHome: string;
  settingsPath: string;
  dbPath: string;
}

export function parseArgs(argv: string[]): Cli {
  let command: Cli['command'] = 'run';
  let port = DEFAULT_PORT;
  let readOnly = false;
  let confirm = false;
  let claudeHome = path.join(os.homedir(), '.claude');

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === 'setup' || arg === 'uninstall') command = arg;
    else if (arg === '--read-only') readOnly = true;
    else if (arg === '--yes') confirm = true;
    else if (arg === '--port') port = Number(argv[++i]);
    else if (arg.startsWith('--port=')) port = Number(arg.slice('--port='.length));
    else if (arg === '--claude-home') claudeHome = argv[++i];
    else if (arg.startsWith('--claude-home=')) claudeHome = arg.slice('--claude-home='.length);
  }

  return {
    command,
    port,
    readOnly,
    confirm,
    claudeHome,
    settingsPath: path.join(claudeHome, 'settings.json'),
    dbPath: path.join(claudeHome, 'agent-teams-console', 'events.db'),
  };
}

export interface DiscoveredTeam {
  teamName: string;
  leadSessionId: string;
  projectSlug: string;
}

export async function discoverTeam(teamsRoot: string): Promise<DiscoveredTeam | null> {
  let dirs: string[];
  try {
    dirs = (await fs.readdir(teamsRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return null;
  }

  let best: TeamConfig | null = null;
  for (const name of dirs) {
    const config = await readJsonSafe<TeamConfig>(path.join(teamsRoot, name, 'config.json'));
    if (!config) continue;
    if (!best || config.createdAt > best.createdAt) best = config;
  }
  if (!best) return null;

  const leadCwd = best.members.find((m) => m.agentId === best!.leadAgentId)?.cwd ?? '';
  return {
    teamName: best.name,
    leadSessionId: best.leadSessionId,
    projectSlug: leadCwd.replace(/[^a-zA-Z0-9]/g, '-'),
  };
}

export async function main(argv: string[]): Promise<number> {
  const cli = parseArgs(argv);

  if (cli.command === 'setup' || cli.command === 'uninstall') {
    const guard = checkClaudeVersion(await readClaudeVersion());
    if (!guard.ok) console.warn(`warning: ${guard.message}`);
    console.log(
      await runSetup({
        settingsPath: cli.settingsPath,
        port: cli.port,
        confirm: cli.confirm,
        uninstall: cli.command === 'uninstall',
      }),
    );
    return 0;
  }

  const guard = checkClaudeVersion(await readClaudeVersion());
  console.log(guard.ok ? guard.message : `warning: ${guard.message}`);

  const teamsRoot = path.join(cli.claudeHome, 'teams');
  setTeamsRoot(teamsRoot);

  const store = openStore(cli.dbPath);
  const permits = createPermits();
  const hub = createStream(() => project(store.replay(), cli.readOnly));

  // Every append is a state change, so the store is the single publish point;
  // the fold runs per coalesced flush rather than being cached, which at a few
  // events a second is cheaper than keeping a second copy of the truth.
  const live: Store = {
    append(kind: EventKind, payload: unknown, agent?: string): StoredEvent {
      const ev = store.append(kind, payload, agent);
      hub.publish();
      return ev;
    },
    replay: () => store.replay(),
    close: () => store.close(),
  };

  const discovered = await discoverTeam(teamsRoot);
  const ingest = startFileIngest(live, {
    paths: {
      projects: path.join(cli.claudeHome, 'projects'),
      teams: teamsRoot,
      tasks: path.join(cli.claudeHome, 'tasks'),
      sessions: path.join(cli.claudeHome, 'sessions'),
    },
    teamName: discovered?.teamName,
    leadSessionId: discovered?.leadSessionId,
  });
  await ingest.sweep();

  const server = createHttpServer({
    permits,
    hooks: createHookHandlers({ store: live, permits }),
    stream: hub,
    state: () => project(store.replay(), cli.readOnly),
    readOnly: cli.readOnly,
  });

  const port = await listen(server, cli.port);
  console.log(`agent teams console on http://127.0.0.1:${port}${cli.readOnly ? ' (read-only)' : ''}`);

  const stop = () => {
    ingest.close();
    hub.close();
    server.close();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  return 0;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  void main(process.argv.slice(2));
}
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `npx vitest run src/server/index.test.ts`
Expected: PASS

- [ ] **Step 11: Run the whole server suite**

Run: `npx vitest run src/server`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add src/server/index.ts src/server/index.test.ts && git commit -m "feat: CLI entry wiring store, ingest, hooks, stream and http with team discovery"
```


### Task 18: Web shell — theme tokens, Vite/Vitest config, App mount

**Files:**
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `src/web/tsconfig.json`
- Create: `src/web/index.html`
- Create: `src/web/theme.css`
- Create: `src/web/main.tsx`
- Create: `src/web/App.tsx`
- Test: `src/web/App.test.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `export function App(): JSX.Element` (`src/web/App.tsx`); `src/web/theme.css` custom properties — the full Nocturne token set (`--color-bg`, `--color-surface`, `--color-text`, `--color-accent`, `--color-accent-2`, `--color-divider`, `--color-neutral-100…900`, `--color-accent-100…900`, `--color-accent-2-100…900`, `--radius-sm|md|lg`, `--shadow-sm|md|lg`, `--font-heading`, `--font-body`, `--space-1…8`) plus the five non-token names `--terminal-ground`, `--row-hairline`, `--attention`, `--attention-border`, `--failure-rose`; CSS classes `.console`, `.console-body`; global `:focus-visible` outline and a full `button` reset. The Nocturne deck-only `--color-section*` fills are deliberately omitted — the source file marks them "Deck-scale fills only — not interface colors".


> **Fonts are self-hosted, not loaded from a CDN.** This console watches local files and must
> render correctly with no network. The design's ASCII meters (`█`/`░`) and its tuned
> `letter-spacing: -.5px` depend on JetBrains Mono's metrics — a fallback to `ui-monospace`
> silently changes every meter's width. Install them as packages instead of linking Google Fonts:
>
> ```bash
> npm i @fontsource/jetbrains-mono @fontsource/inter
> ```
>
> and import the weights the design actually uses at the top of `src/web/main.tsx`:
>
> ```ts
> import '@fontsource/jetbrains-mono/400.css';
> import '@fontsource/jetbrains-mono/500.css';
> import '@fontsource/jetbrains-mono/700.css';
> import '@fontsource/inter/400.css';
> import '@fontsource/inter/500.css';
> ```
>
> Do NOT add any `<link>` to fonts.googleapis.com anywhere, including `index.html`.

- [ ] **Step 1: Write the failing test**

```bash
npm i react react-dom
npm i -D vite @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/dom @types/react @types/react-dom
```

```tsx
// src/web/App.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from './App.js';

it('renders the console shell with a body slot', () => {
  render(<App />);
  expect(screen.getByRole('main')).toBeTruthy();
});

it('paints the root on the terminal ground #12141f', () => {
  render(<App />);
  expect(getComputedStyle(document.documentElement).backgroundColor).toBe('rgb(18, 20, 31)');
});

it('gives the five non-token colours explicit custom-property homes', async () => {
  const css = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('./theme.css', import.meta.url), 'utf8'),
  );
  expect(css).toContain('--terminal-ground: #12141f;');
  expect(css).toContain('--row-hairline: #1b1d2b;');
  expect(css).toContain('--attention: #d99e5c;');
  expect(css).toContain('--attention-border: #6b4f2c;');
  expect(css).toContain('--failure-rose: #c98d8d;');
  expect(css).toContain('outline: 2px solid var(--color-accent);');
  expect(css).toContain('outline-offset: 2px;');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/App.test.tsx`
Expected: FAIL with `Failed to resolve import "./App.js" from "src/web/App.test.tsx"`

- [ ] **Step 3: Write the implementation**

```ts
// vitest.config.ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    css: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SERVER = 'http://127.0.0.1:4823';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': SERVER, '/stream': SERVER, '/hook': SERVER },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
```

```json
// src/web/tsconfig.json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["."]
}
```

```html
<!-- src/web/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agent Teams Console</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

```css
/* src/web/theme.css */
:root {
  /* Nocturne — _ds/nocturne-4bc22666-5c49-4c20-81d3-6a17ba2f206d/styles.css */
  --color-bg: #161826;
  --color-surface: #232532;
  --color-text: #e9e9ed;
  --color-accent: #9184d9;
  --color-accent-2: #a7a1db;
  --color-divider: color-mix(in srgb, #e9e9ed 16%, transparent);

  --color-neutral-100: #f3f5fe;
  --color-neutral-200: #e4e7f5;
  --color-neutral-300: #cfd3e5;
  --color-neutral-400: #b2b6ca;
  --color-neutral-500: #9397ab;
  --color-neutral-600: #75798c;
  --color-neutral-700: #595d6c;
  --color-neutral-800: #3f424d;
  --color-neutral-900: #292b31;

  --color-accent-100: #f5f4ff;
  --color-accent-200: #e7e5fe;
  --color-accent-300: #d2cefd;
  --color-accent-400: #b5abfc;
  --color-accent-500: #968ae0;
  --color-accent-600: #796cbf;
  --color-accent-700: #5d5294;
  --color-accent-800: #423a6a;
  --color-accent-900: #2b2741;

  --color-accent-2-100: #f5f4ff;
  --color-accent-2-200: #e7e5fe;
  --color-accent-2-300: #d2cefd;
  --color-accent-2-400: #b5afe8;
  --color-accent-2-500: #9690c9;
  --color-accent-2-600: #7972a9;
  --color-accent-2-700: #5c5783;
  --color-accent-2-800: #423e5d;
  --color-accent-2-900: #2b293a;

  --font-heading: "Inter", system-ui, sans-serif;
  --font-heading-weight: 500;
  --font-body: "Inter", system-ui, sans-serif;

  --space-1: 2.8px;
  --space-2: 5.6px;
  --space-3: 8.4px;
  --space-4: 11.2px;
  --space-6: 16.8px;
  --space-8: 22.4px;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 14px;

  --shadow-sm: 0 0 0 1px #3f424d;
  --shadow-md: 0 0 0 1px #595d6c, 0 6px 18px rgba(0, 0, 0, 0.55);
  --shadow-lg: 0 0 0 1px #9397ab, 0 16px 40px rgba(0, 0, 0, 0.65);

  /* the five colours the design uses outside the token set — spec §6 */
  --terminal-ground: #12141f;
  --row-hairline: #1b1d2b;
  --attention: #d99e5c;
  --attention-border: #6b4f2c;
  --failure-rose: #c98d8d;

  background-color: #12141f;
  color: var(--color-text);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.55;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  background-color: var(--terminal-ground);
  color: inherit;
  font: inherit;
}

button {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  line-height: inherit;
  text-align: inherit;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}

:focus {
  outline: none;
}

:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

::selection {
  background: color-mix(in srgb, var(--color-accent) 30%, transparent);
}

.console {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--terminal-ground);
  color: var(--color-text);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.55;
}

.console-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
```

```tsx
// src/web/App.tsx
import './theme.css';

export function App() {
  return (
    <div className="console">
      <main className="console-body" />
    </div>
  );
}
```

```tsx
// src/web/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const host = document.getElementById('root');
if (!host) throw new Error('#root missing from index.html');
createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/App.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts vitest.config.ts src/web/tsconfig.json src/web/index.html src/web/theme.css src/web/main.tsx src/web/App.tsx src/web/App.test.tsx package.json package-lock.json && git commit -m "feat(web): nocturne theme tokens and console shell"
```

---

### Task 19: SSE client and URL-persisted view/focus

**Files:**
- Create: `src/web/state/useTeamState.ts`
- Create: `src/web/test/mockEventSource.ts`
- Create: `src/web/test/state-fixture.ts`
- Test: `src/web/state/useTeamState.test.tsx`

**Interfaces:**
- Consumes: `TeamState`, `ViewId` from `src/shared/domain.ts`; `GET /stream` emitting a `snapshot` event then `state` events
- Produces:
  - `export const VIEW_IDS: readonly ViewId[]` = `['wall','overview','tasks','rail','grid']`
  - `export interface TeamStateStore { state: TeamState | null; connected: boolean; view: ViewId; agent: string | null; setView(v: ViewId): void; setAgent(name: string | null): void }`
  - `export function useTeamState(url?: string): TeamStateStore` (url defaults to `'/stream'`)
  - `export function readUrlState(search: string): { view: ViewId; agent: string | null }`
  - `export function writeUrlState(view: ViewId, agent: string | null): void`
  - test helpers (defined in this phase, not in the contract): `MockEventSource`, `installMockEventSource()`, `sampleTeamState(): TeamState`, `FIXTURE_NOW: number`

- [ ] **Step 1: Write the failing test**

```tsx
// src/web/state/useTeamState.test.tsx
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MockEventSource, installMockEventSource } from '../test/mockEventSource.js';
import { sampleTeamState } from '../test/state-fixture.js';
import { useTeamState } from './useTeamState.js';

beforeEach(() => {
  installMockEventSource();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('opens /stream, lands the snapshot, then applies state updates', () => {
  const { result } = renderHook(() => useTeamState());
  expect(MockEventSource.last().url).toBe('/stream');
  expect(result.current.state).toBeNull();

  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));
  expect(result.current.connected).toBe(true);
  expect(result.current.state?.teamName).toBe('session-98b0b4a7');
  expect(result.current.state?.leadSessionId).toBe('98b0b4a7-3206-455b-aaf6-a5a81ad1e283');
  expect(result.current.state?.agents.map((a) => a.name)).toEqual([
    'team-lead',
    'probe-alpha',
    'probe-bravo',
    'probe-charlie',
  ]);

  act(() => MockEventSource.last().emit('state', { ...sampleTeamState(), totalCostUsd: 9.99 }));
  expect(result.current.state?.totalCostUsd).toBe(9.99);
});

it('reads view and focused agent out of the URL on mount', () => {
  window.history.replaceState(null, '', '/?view=tasks&agent=probe-bravo');
  const { result } = renderHook(() => useTeamState());
  expect(result.current.view).toBe('tasks');
  expect(result.current.agent).toBe('probe-bravo');
});

it('falls back to the wall view for an unknown ?view', () => {
  window.history.replaceState(null, '', '/?view=nonsense');
  const { result } = renderHook(() => useTeamState());
  expect(result.current.view).toBe('wall');
});

it('writes the view and focused agent back into the URL', () => {
  const { result } = renderHook(() => useTeamState());
  expect(window.location.search).toBe('?view=wall');

  act(() => result.current.setView('grid'));
  expect(result.current.view).toBe('grid');
  expect(window.location.search).toBe('?view=grid');

  act(() => result.current.setAgent('probe-alpha'));
  expect(window.location.search).toBe('?view=grid&agent=probe-alpha');

  act(() => result.current.setAgent(null));
  expect(window.location.search).toBe('?view=grid');
});

it('reconnects with exponential backoff after an error', () => {
  vi.useFakeTimers();
  renderHook(() => useTeamState());
  expect(MockEventSource.instances).toHaveLength(1);

  act(() => MockEventSource.last().emitError());
  expect(MockEventSource.instances).toHaveLength(1);
  act(() => void vi.advanceTimersByTime(499));
  expect(MockEventSource.instances).toHaveLength(1);
  act(() => void vi.advanceTimersByTime(1));
  expect(MockEventSource.instances).toHaveLength(2);

  act(() => MockEventSource.last().emitError());
  act(() => void vi.advanceTimersByTime(999));
  expect(MockEventSource.instances).toHaveLength(2);
  act(() => void vi.advanceTimersByTime(1));
  expect(MockEventSource.instances).toHaveLength(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/state/useTeamState.test.tsx`
Expected: FAIL with `Failed to resolve import "../test/mockEventSource.js"`

- [ ] **Step 3: Write the implementation**

```ts
// src/web/test/mockEventSource.ts
import { vi } from 'vitest';

type Listener = (ev: MessageEvent | Event) => void;

export class MockEventSource {
  static instances: MockEventSource[] = [];

  static last(): MockEventSource {
    const es = MockEventSource.instances.at(-1);
    if (!es) throw new Error('no EventSource was constructed');
    return es;
  }

  readonly listeners = new Map<string, Set<Listener>>();
  closed = false;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    const ev = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(ev);
  }

  emitError(): void {
    const ev = new Event('error');
    for (const fn of [...(this.listeners.get('error') ?? [])]) fn(ev);
  }
}

export function installMockEventSource(): void {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
}
```

```ts
// src/web/test/state-fixture.ts
import config from '../../../fixtures/config-4-members.json';
import sidecars from '../../../fixtures/meta-sidecars.json';
import rawTasks from '../../../fixtures/tasks.json';
import type { Agent, AgentStatus, Task, TeamState } from '../../shared/domain.js';

const OPUS = { contextLimit: 1_000_000, compactAt: 967_000 };
const HAIKU = { contextLimit: 200_000, compactAt: 167_000 };

const ROLES = new Map(sidecars.map((s) => [s.name, s.description]));

interface Tuning {
  status: AgentStatus;
  contextTokens: number;
  contextLimit: number;
  compactAt: number;
  costUsd: number;
  model: string;
}

const TUNING: Record<string, Tuning> = {
  'team-lead': { status: 'working', contextTokens: 53_100, costUsd: 1.31, model: 'claude-opus-5', ...OPUS },
  'probe-alpha': { status: 'idle', contextTokens: 120_000, costUsd: 0.42, model: 'claude-opus-5', ...OPUS },
  'probe-bravo': { status: 'working', contextTokens: 500_000, costUsd: 0.61, model: 'claude-opus-5', ...OPUS },
  'probe-charlie': { status: 'idle', contextTokens: 156_000, costUsd: 0.22, model: 'claude-haiku-4-5', ...HAIKU },
};

/** epoch ms 45m 12s after the fixture team was created */
export const FIXTURE_NOW = config.createdAt + 2_712_000;

export function sampleTeamState(): TeamState {
  const agents: Agent[] = config.members.map((m) => {
    const t = TUNING[m.name];
    return {
      name: m.name,
      agentId: m.agentId,
      isLead: m.agentId === config.leadAgentId,
      agentType: m.agentType,
      model: t.model,
      role: ROLES.get(m.name) ?? 'team lead',
      color: 'color' in m ? m.color : undefined,
      status: t.status,
      contextTokens: t.contextTokens,
      contextLimit: t.contextLimit,
      compactAt: t.compactAt,
      costUsd: t.costUsd,
      startedAt: m.joinedAt,
      transcript: [],
      unread: 0,
    };
  });

  const done = rawTasks[4];
  const running = rawTasks[3];
  const tasks: Task[] = [
    {
      id: done.id,
      subject: done.subject,
      description: done.description,
      activeForm: done.activeForm,
      owner: 'probe-alpha',
      state: 'completed',
      blocks: [],
      blockedBy: [],
    },
    {
      id: running.id,
      subject: running.subject,
      description: running.description,
      activeForm: running.activeForm,
      owner: 'probe-bravo',
      state: 'in_progress',
      blocks: [],
      blockedBy: [],
    },
  ];

  return {
    teamName: config.name,
    leadSessionId: config.leadSessionId,
    startedAt: config.createdAt,
    totalTokens: agents.reduce((n, a) => n + a.contextTokens, 0),
    totalCostUsd: 2.56,
    rateLimits: { fiveHourPct: 41, sevenDayPct: 12 },
    agents,
    tasks,
    mail: [],
    needsYou: [],
    readOnly: false,
  };
}
```

```ts
// src/web/state/useTeamState.ts
import { useEffect, useState } from 'react';
import type { TeamState, ViewId } from '../../shared/domain.js';

export const VIEW_IDS: readonly ViewId[] = ['wall', 'overview', 'tasks', 'rail', 'grid'];

export interface TeamStateStore {
  state: TeamState | null;
  connected: boolean;
  view: ViewId;
  agent: string | null;
  setView(v: ViewId): void;
  setAgent(name: string | null): void;
}

export function readUrlState(search: string): { view: ViewId; agent: string | null } {
  const params = new URLSearchParams(search);
  const raw = params.get('view');
  const view = VIEW_IDS.find((v) => v === raw) ?? 'wall';
  return { view, agent: params.get('agent') };
}

export function writeUrlState(view: ViewId, agent: string | null): void {
  const params = new URLSearchParams();
  params.set('view', view);
  if (agent) params.set('agent', agent);
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30_000;

export function useTeamState(url = '/stream'): TeamStateStore {
  const [initial] = useState(() => readUrlState(window.location.search));
  const [state, setState] = useState<TeamState | null>(null);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<ViewId>(initial.view);
  const [agent, setAgent] = useState<string | null>(initial.agent);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const es = new EventSource(url);
      source = es;

      const onState = (ev: Event) => {
        attempt = 0;
        setConnected(true);
        setState(JSON.parse((ev as MessageEvent<string>).data) as TeamState);
      };
      es.addEventListener('snapshot', onState);
      es.addEventListener('state', onState);
      es.addEventListener('error', () => {
        setConnected(false);
        es.close();
        if (stopped) return;
        const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
        attempt += 1;
        retry = setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      source?.close();
    };
  }, [url]);

  useEffect(() => {
    writeUrlState(view, agent);
  }, [view, agent]);

  return { state, connected, view, agent, setView, setAgent };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/state/useTeamState.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/web/state/useTeamState.ts src/web/state/useTeamState.test.tsx src/web/test/mockEventSource.ts src/web/test/state-fixture.ts && git commit -m "feat(web): SSE team-state client with view and focus in the URL"
```

---

### Task 20: Shared components — format helpers, Portrait, StatusGlyph, ContextMeter

**Files:**
- Create: `src/web/format.ts`
- Create: `src/web/components/Portrait.tsx`
- Create: `src/web/components/StatusGlyph.tsx`
- Create: `src/web/components/ContextMeter.tsx`
- Test: `src/web/format.test.ts`
- Test: `src/web/components/Portrait.test.tsx`
- Test: `src/web/components/StatusGlyph.test.tsx`
- Test: `src/web/components/ContextMeter.test.tsx`

**Interfaces:**
- Consumes: `portraitFor(agent: { name: string; agentType: string; isLead: boolean }): { portrait: PortraitId; skinIndex: number }` and `portraitSvg(portrait: PortraitId, skinIndex: number): string` from `src/shared/portrait.ts`; `AGENT_STATUS: Record<AgentStatus, StatusStyle>` from `src/shared/status.ts`; `AgentStatus` from `src/shared/domain.ts`
- Produces (all of `src/web/format.ts` is defined in this phase — the pinned contract has no formatting module):
  - `export function meterCells(ratio: number): string` — 16 cells, `█`/`░`
  - `export function contextBar(tokens: number, limit: number, compactAt: number): string` — `meterCells` with the compact tick forced on at `Math.min(15, Math.floor(compactAt / limit * 16))`
  - `export function formatTokens(n: number): string`
  - `export function formatPct(ratio: number): string`
  - `export function formatCost(usd: number): string`
  - `export function formatElapsed(ms: number): string`
  - `export type PortraitSlot = 'wall' | 'rail-row' | 'default'` and `export function Portrait(props: { agent: { name: string; agentType: string; isLead: boolean }; slot?: PortraitSlot }): JSX.Element`
  - `export function StatusGlyph(props: { status: AgentStatus; size?: number }): JSX.Element`
  - `export function ContextMeter(props: { contextTokens: number; contextLimit: number; compactAt: number; barSize?: number; textSize?: number }): JSX.Element` — returns a fragment of four sibling spans, because the design's line 3 puts the cost span after a flex spacer in the same row

- [ ] **Step 1: Write the failing test**

```ts
// src/web/format.test.ts
import { expect, it } from 'vitest';
import { contextBar, formatCost, formatElapsed, formatPct, formatTokens, meterCells } from './format.js';

it('fills the 16-cell bar at 0%, 50% and 100%', () => {
  expect(meterCells(0)).toBe('░░░░░░░░░░░░░░░░');
  expect(meterCells(0.5)).toBe('████████░░░░░░░░');
  expect(meterCells(1)).toBe('████████████████');
  expect(meterCells(0).length).toBe(16);
});

it('clamps the bar outside 0..1', () => {
  expect(meterCells(-0.4)).toBe('░░░░░░░░░░░░░░░░');
  expect(meterCells(2)).toBe('████████████████');
});

it('marks the auto-compact tick inside the bar', () => {
  // opus-5: compact at 967k of 1M -> floor(0.967 * 16) = cell 15
  expect(contextBar(0, 1_000_000, 967_000)).toBe('░░░░░░░░░░░░░░░█');
  expect(contextBar(500_000, 1_000_000, 967_000)).toBe('████████░░░░░░░█');
  expect(contextBar(1_000_000, 1_000_000, 967_000)).toBe('████████████████');
  // haiku-4-5: compact at 167k of 200k -> floor(0.835 * 16) = cell 13
  expect(contextBar(156_000, 200_000, 167_000)).toBe('████████████░█░░');
});

it('formats token counts the way the design writes them', () => {
  expect(formatTokens(53_100)).toBe('53.1k');
  expect(formatTokens(156_000)).toBe('156k');
  expect(formatTokens(200_000)).toBe('200k');
  expect(formatTokens(829_100)).toBe('829k');
  expect(formatTokens(1_000_000)).toBe('1M');
  expect(formatTokens(1_250_000)).toBe('1.3M');
  expect(formatTokens(412)).toBe('412');
});

it('formats percentages, cost and elapsed', () => {
  expect(formatPct(53_100 / 1_000_000)).toBe('5%');
  expect(formatPct(156_000 / 200_000)).toBe('78%');
  expect(formatCost(1.31)).toBe('≈$1.31');
  expect(formatCost(2.56)).toBe('≈$2.56');
  expect(formatElapsed(2_712_000)).toBe('45m 12s');
  expect(formatElapsed(45_000)).toBe('0m 45s');
  expect(formatElapsed(3_660_000)).toBe('1h 01m');
});
```

```tsx
// src/web/components/Portrait.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Portrait } from './Portrait.js';

const LEAD = { name: 'team-lead', agentType: 'team-lead', isLead: true };
const ALPHA = { name: 'probe-alpha', agentType: 'general-purpose', isLead: false };

it('hosts the inline SVG in a 24x24 relative box', () => {
  render(<Portrait agent={LEAD} />);
  const host = screen.getByTestId('portrait');
  expect(host.style.width).toBe('24px');
  expect(host.style.height).toBe('24px');
  expect(host.style.position).toBe('relative');
  expect(host.style.flex).toBe('none');
  expect(host.querySelector('svg')).not.toBeNull();
});

it('gives the lead the crown portrait', () => {
  render(<Portrait agent={LEAD} />);
  expect(screen.getByTestId('portrait').getAttribute('data-portrait')).toBe('lead');
});

it('applies the per-slot margin-top', () => {
  const { unmount } = render(<Portrait agent={ALPHA} slot="wall" />);
  expect(screen.getByTestId('portrait').style.marginTop).toBe('3px');
  unmount();

  const rail = render(<Portrait agent={ALPHA} slot="rail-row" />);
  expect(screen.getByTestId('portrait').style.marginTop).toBe('1px');
  rail.unmount();

  render(<Portrait agent={ALPHA} />);
  expect(screen.getByTestId('portrait').style.marginTop).toBe('0px');
});

it('draws the same agent identically every time', () => {
  const first = render(<Portrait agent={ALPHA} />);
  const html = screen.getByTestId('portrait').innerHTML;
  first.unmount();
  render(<Portrait agent={ALPHA} />);
  expect(screen.getByTestId('portrait').innerHTML).toBe(html);
});
```

```tsx
// src/web/components/StatusGlyph.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AGENT_STATUS } from '../../shared/status.js';
import { StatusGlyph } from './StatusGlyph.js';

it('renders the design glyph for every agent status', () => {
  const cases: Array<[Parameters<typeof StatusGlyph>[0]['status'], string]> = [
    ['working', '●'],
    ['idle', '○'],
    ['plan_pending', '▲'],
    ['failed', '✗'],
    ['blocked', '⊘'],
  ];
  for (const [status, glyph] of cases) {
    const view = render(<StatusGlyph status={status} />);
    const el = screen.getByTestId('status-glyph');
    expect(el.textContent).toBe(glyph);
    expect(el.style.color).toBe(AGENT_STATUS[status].color);
    view.unmount();
  }
});

it('labels the glyph and takes an explicit size', () => {
  render(<StatusGlyph status="working" size={10} />);
  const el = screen.getByTestId('status-glyph');
  expect(el.getAttribute('aria-label')).toBe(AGENT_STATUS.working.label);
  expect(el.style.fontSize).toBe('10px');
});
```

```tsx
// src/web/components/ContextMeter.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ContextMeter } from './ContextMeter.js';

it('renders the bar, percent and "53.1k / 1M" for an opus agent', () => {
  render(<ContextMeter contextTokens={53_100} contextLimit={1_000_000} compactAt={967_000} />);
  expect(screen.getByTestId('context-bar').textContent).toBe('░░░░░░░░░░░░░░░█');
  expect(screen.getByTestId('context-bar').style.fontSize).toBe('11.5px');
  expect(screen.getByTestId('context-bar').style.letterSpacing).toBe('-.5px');
  expect(screen.getByTestId('context-bar').style.color).toBe('var(--color-accent-600)');
  expect(screen.getByText('5%')).toBeTruthy();
  expect(screen.getByText('53.1k / 1M')).toBeTruthy();
});

it('shows the warn glyph exactly at and past compactAt', () => {
  const below = render(
    <ContextMeter contextTokens={166_999} contextLimit={200_000} compactAt={167_000} />,
  );
  expect(screen.getByTestId('context-warn').textContent).toBe('');
  below.unmount();

  const at = render(<ContextMeter contextTokens={167_000} contextLimit={200_000} compactAt={167_000} />);
  expect(screen.getByTestId('context-warn').textContent).toBe('!');
  expect(screen.getByTestId('context-warn').style.color).toBe('var(--attention)');
  expect(screen.getByTestId('context-warn').style.width).toBe('7px');
  at.unmount();

  render(<ContextMeter contextTokens={199_000} contextLimit={200_000} compactAt={167_000} />);
  expect(screen.getByTestId('context-warn').textContent).toBe('!');
});

it('takes explicit bar and text sizes for the grid pane', () => {
  render(
    <ContextMeter
      contextTokens={156_000}
      contextLimit={200_000}
      compactAt={167_000}
      barSize={10.5}
      textSize={10}
    />,
  );
  expect(screen.getByTestId('context-bar').textContent).toBe('████████████░█░░');
  expect(screen.getByTestId('context-bar').style.fontSize).toBe('10.5px');
  expect(screen.getByText('78%').style.fontSize).toBe('10px');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/format.test.ts src/web/components`
Expected: FAIL with `Failed to resolve import "./format.js"` and `Failed to resolve import "./Portrait.js"`

- [ ] **Step 3: Write the implementation**

```ts
// src/web/format.ts
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
```

```tsx
// src/web/components/Portrait.tsx
import { portraitFor, portraitSvg } from '../../shared/portrait.js';

export type PortraitSlot = 'wall' | 'rail-row' | 'default';

const SLOT_MARGIN: Record<PortraitSlot, number> = { wall: 3, 'rail-row': 1, default: 0 };

export interface PortraitProps {
  agent: { name: string; agentType: string; isLead: boolean };
  slot?: PortraitSlot;
}

export function Portrait({ agent, slot = 'default' }: PortraitProps) {
  const { portrait, skinIndex } = portraitFor(agent);
  return (
    <div
      data-testid="portrait"
      data-portrait={portrait}
      aria-hidden="true"
      style={{
        width: 24,
        height: 24,
        position: 'relative',
        flex: 'none',
        marginTop: SLOT_MARGIN[slot],
      }}
      dangerouslySetInnerHTML={{ __html: portraitSvg(portrait, skinIndex) }}
    />
  );
}
```

```tsx
// src/web/components/StatusGlyph.tsx
import type { AgentStatus } from '../../shared/domain.js';
import { AGENT_STATUS } from '../../shared/status.js';

export interface StatusGlyphProps {
  status: AgentStatus;
  size?: number;
}

export function StatusGlyph({ status, size = 11 }: StatusGlyphProps) {
  const style = AGENT_STATUS[status];
  return (
    <span
      data-testid="status-glyph"
      role="img"
      aria-label={style.label}
      style={{ color: style.color, fontSize: size }}
    >
      {style.glyph}
    </span>
  );
}
```

```tsx
// src/web/components/ContextMeter.tsx
import { contextBar, formatPct, formatTokens } from '../format.js';

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
        {contextBar(contextTokens, contextLimit, compactAt)}
      </span>
      <span style={{ color: 'var(--color-neutral-500)', fontSize: textSize }}>
        {formatPct(contextTokens / contextLimit)}
      </span>
      <span
        data-testid="context-warn"
        style={{ color: 'var(--attention)', fontSize: textSize, width: 7 }}
      >
        {contextTokens >= compactAt ? '!' : ''}
      </span>
      <span style={{ color: 'var(--color-neutral-600)', fontSize: textSize }}>
        {`${formatTokens(contextTokens)} / ${formatTokens(contextLimit)}`}
      </span>
    </>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/format.test.ts src/web/components`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/web/format.ts src/web/format.test.ts src/web/components && git commit -m "feat(web): portrait, status glyph, context meter and terminal formatters"
```

---

### Task 21: Status bar with the five-view switcher

**Files:**
- Create: `src/web/chrome/StatusBar.tsx`
- Modify: `src/web/theme.css`
- Test: `src/web/chrome/StatusBar.test.tsx`

**Interfaces:**
- Consumes: `TeamState`, `ViewId` from `src/shared/domain.ts`; `VIEW_IDS` from `src/web/state/useTeamState.ts`; `meterCells`, `formatTokens`, `formatCost`, `formatElapsed` from `src/web/format.ts`; `sampleTeamState`, `FIXTURE_NOW` from `src/web/test/state-fixture.ts`
- Produces: `export interface StatusBarProps { state: TeamState; view: ViewId; onViewChange(view: ViewId): void; now: number }` and `export function StatusBar(props: StatusBarProps): JSX.Element`

- [ ] **Step 1: Write the failing test**

```tsx
// src/web/chrome/StatusBar.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FIXTURE_NOW, sampleTeamState } from '../test/state-fixture.js';
import { StatusBar } from './StatusBar.js';

function renderBar(view: Parameters<typeof StatusBar>[0]['view'] = 'wall') {
  const onViewChange = vi.fn();
  render(
    <StatusBar state={sampleTeamState()} view={view} onViewChange={onViewChange} now={FIXTURE_NOW} />,
  );
  return onViewChange;
}

it('exposes the switcher as a tablist with the five views', () => {
  renderBar();
  const tablist = screen.getByRole('tablist');
  expect(within(tablist).getAllByRole('tab').map((t) => t.textContent)).toEqual([
    'wall',
    'overview',
    'tasks',
    'rail',
    'grid',
  ]);
  expect(screen.getByRole('tab', { name: 'wall' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tab', { name: 'grid' }).getAttribute('aria-selected')).toBe('false');
});

it('fires the view change when a tab is clicked', () => {
  const onViewChange = renderBar();
  fireEvent.click(screen.getByRole('tab', { name: 'grid' }));
  expect(onViewChange).toHaveBeenCalledWith('grid');
  fireEvent.click(screen.getByRole('tab', { name: 'tasks' }));
  expect(onViewChange).toHaveBeenLastCalledWith('tasks');
});

it('renders the wordmark, team name and experimental pill', () => {
  renderBar();
  const wordmark = screen.getByText('TEAM');
  expect(wordmark.style.color).toBe('var(--color-accent)');
  expect(wordmark.style.letterSpacing).toBe('.14em');
  expect(wordmark.style.fontWeight).toBe('700');
  expect(wordmark.style.fontSize).toBe('11px');
  expect(screen.getByText('session-98b0b4a7')).toBeTruthy();
  expect(screen.getByText('experimental')).toBeTruthy();
});

it('renders the right-hand readouts from the fixture team', () => {
  renderBar();
  expect(screen.getByText('tasks 1/2')).toBeTruthy();
  expect(screen.getByText('4 windows')).toBeTruthy();
  expect(screen.getByText('829k')).toBeTruthy();
  expect(screen.getByTestId('aggregate-meter').textContent).toBe('████░░░░░░░░░░░░');
  expect(screen.getByTestId('aggregate-meter').style.color).toBe('var(--color-accent-500)');
  expect(screen.getByText('45m 12s')).toBeTruthy();
  expect(screen.getByText('≈$2.56 api-equiv')).toBeTruthy();
  expect(screen.getByText('5h 41% · 7d 12%')).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/chrome/StatusBar.test.tsx`
Expected: FAIL with `Failed to resolve import "./StatusBar.js" from "src/web/chrome/StatusBar.test.tsx"`

- [ ] **Step 3: Write the implementation**

```tsx
// src/web/chrome/StatusBar.tsx
import type { TeamState, ViewId } from '../../shared/domain.js';
import { formatCost, formatElapsed, formatTokens, meterCells } from '../format.js';
import { VIEW_IDS } from '../state/useTeamState.js';

export interface StatusBarProps {
  state: TeamState;
  view: ViewId;
  onViewChange(view: ViewId): void;
  now: number;
}

export function StatusBar({ state, view, onViewChange, now }: StatusBarProps) {
  const done = state.tasks.filter((t) => t.state === 'completed').length;
  const totalLimit = state.agents.reduce((n, a) => n + a.contextLimit, 0);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '9px 14px',
        borderBottom: '1px solid var(--color-neutral-900)',
        background: 'var(--color-bg)',
        fontSize: 12.5,
      }}
    >
      <span
        style={{
          color: 'var(--color-accent)',
          letterSpacing: '.14em',
          fontWeight: 700,
          fontSize: 11,
        }}
      >
        TEAM
      </span>
      <span style={{ color: 'var(--color-text)' }}>{state.teamName}</span>
      <span
        style={{
          border: '1px solid var(--color-accent-700)',
          color: 'var(--color-accent-300)',
          borderRadius: 'var(--radius-sm)',
          padding: '1px 6px',
          fontSize: 10,
        }}
      >
        experimental
      </span>

      <div role="tablist" aria-label="view" style={{ display: 'flex', gap: 2, marginLeft: 6 }}>
        {VIEW_IDS.map((id) => (
          <button
            key={id}
            className="tab"
            type="button"
            role="tab"
            aria-selected={id === view}
            onClick={() => onViewChange(id)}
            style={{
              padding: '3px 9px 4px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
            }}
          >
            <span
              style={{
                fontSize: 11.5,
                color: id === view ? 'var(--color-text)' : 'var(--color-neutral-600)',
              }}
            >
              {id}
            </span>
            <span
              style={{
                height: 2,
                borderRadius: 1,
                background: id === view ? 'var(--color-accent)' : 'transparent',
              }}
            />
          </button>
        ))}
      </div>

      <span style={{ flex: 1 }} />

      <span style={{ color: 'var(--color-neutral-600)' }}>{`tasks ${done}/${state.tasks.length}`}</span>
      <span style={{ color: 'var(--color-neutral-600)' }}>{`${state.agents.length} windows`}</span>
      <span style={{ color: 'var(--color-neutral-500)' }}>{formatTokens(state.totalTokens)}</span>
      <span
        data-testid="aggregate-meter"
        style={{ color: 'var(--color-accent-500)', letterSpacing: '-.5px' }}
      >
        {meterCells(totalLimit > 0 ? state.totalTokens / totalLimit : 0)}
      </span>
      <span style={{ color: 'var(--color-neutral-500)' }}>{formatElapsed(now - state.startedAt)}</span>
      <span style={{ color: 'var(--color-neutral-500)' }}>
        {`${formatCost(state.totalCostUsd)} api-equiv`}
      </span>
      {state.rateLimits && (
        <span style={{ color: 'var(--color-neutral-600)' }}>
          {`5h ${Math.round(state.rateLimits.fiveHourPct)}% · 7d ${Math.round(
            state.rateLimits.sevenDayPct,
          )}%`}
        </span>
      )}
    </div>
  );
}
```

Append to `src/web/theme.css`:

```css
.tab:hover {
  background: var(--color-neutral-900);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/chrome/StatusBar.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/web/chrome/StatusBar.tsx src/web/chrome/StatusBar.test.tsx src/web/theme.css && git commit -m "feat(web): status bar with the five-view switcher"
```

---

### Task 22: Needs-you strip and the control-plane POST helper

**Files:**
- Create: `src/web/api.ts`
- Create: `src/web/chrome/NeedsYou.tsx`
- Modify: `src/web/theme.css`
- Test: `src/web/chrome/NeedsYou.test.tsx` (covers `postJson` through the card buttons)

**Interfaces:**
- Consumes: `NeedsYouItem` from `src/shared/domain.ts`; `FIXTURE_NOW` from `src/web/test/state-fixture.ts`; the routes `POST /api/plans/:requestId/approve`, `POST /api/plans/:requestId/reject`, `POST /api/permits/:id/allow`, `POST /api/permits/:id/deny`, `POST /api/agents/:name/respawn`
- Produces (defined in this phase — the contract has no browser fetch helper):
  - `export function postJson(path: string, body?: unknown): Promise<Response>`
  - `export interface NeedsYouProps { items: NeedsYouItem[]; readOnly: boolean; now: number }`
  - `export function NeedsYou(props: NeedsYouProps): JSX.Element`
  - Empty-state copy is `nothing waiting` in neutral-700, so the strip stays mounted and the chrome never moves when the queue drains.

- [ ] **Step 1: Write the failing test**

```tsx
// src/web/chrome/NeedsYou.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NeedsYouItem } from '../../shared/domain.js';
import { FIXTURE_NOW } from '../test/state-fixture.js';
import { NeedsYou } from './NeedsYou.js';

const PLAN: NeedsYouItem = {
  id: 'req-7f3',
  kind: 'plan',
  agent: 'probe-bravo',
  reason: 'plan approval',
  detail: '4 steps · step 4 drops migrations/legacy/',
};
const FAILURE: NeedsYouItem = {
  id: 'fail-1',
  kind: 'failure',
  agent: 'probe-charlie',
  reason: 'failed',
  detail: '529 overloaded_error',
};
const PERMISSION: NeedsYouItem = {
  id: 'permit-9',
  kind: 'permission',
  agent: 'probe-alpha',
  reason: 'permission',
  detail: 'Bash(rm -rf migrations/legacy)',
  expiresAt: FIXTURE_NOW + 90_000,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('labels the strip with the pending count in the attention colour', () => {
  render(<NeedsYou items={[PLAN, FAILURE, PERMISSION]} readOnly={false} now={FIXTURE_NOW} />);
  const label = screen.getByText('NEEDS YOU · 3');
  expect(label.style.color).toBe('var(--attention)');
  expect(label.style.fontSize).toBe('10.5px');
  expect(label.style.letterSpacing).toBe('.12em');
});

it('renders the three card kinds', () => {
  render(<NeedsYou items={[PLAN, FAILURE, PERMISSION]} readOnly={false} now={FIXTURE_NOW} />);
  expect(screen.getByText('probe-bravo · plan approval')).toBeTruthy();
  expect(screen.getByText('4 steps · step 4 drops migrations/legacy/')).toBeTruthy();
  expect(screen.getByText('probe-charlie · failed').style.color).toBe('var(--failure-rose)');
  expect(screen.getByText('529 overloaded_error')).toBeTruthy();
  expect(screen.getByTestId('card-plan').style.border).toBe('1px solid var(--attention-border)');
});

it('counts the permission hold down to expiresAt', () => {
  render(<NeedsYou items={[PERMISSION]} readOnly={false} now={FIXTURE_NOW} />);
  expect(screen.getByTestId('permit-countdown').textContent).toBe('90s');

  screen.getByTestId('permit-countdown').remove();
  render(<NeedsYou items={[PERMISSION]} readOnly={false} now={FIXTURE_NOW + 89_400} />);
  expect(screen.getByTestId('permit-countdown').textContent).toBe('1s');
});

it('POSTs approve to the plan endpoint', () => {
  render(<NeedsYou items={[PLAN]} readOnly={false} now={FIXTURE_NOW} />);
  fireEvent.click(screen.getByRole('button', { name: 'approve' }));
  expect(fetchMock).toHaveBeenCalledWith('/api/plans/req-7f3/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
});

it('POSTs the collected feedback on reject, and sends nothing when cancelled', () => {
  vi.spyOn(window, 'prompt').mockReturnValueOnce('step 4 is unsafe');
  render(<NeedsYou items={[PLAN]} readOnly={false} now={FIXTURE_NOW} />);
  fireEvent.click(screen.getByRole('button', { name: 'reject with feedback' }));
  expect(fetchMock).toHaveBeenCalledWith('/api/plans/req-7f3/reject', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ feedback: 'step 4 is unsafe' }),
  });

  vi.spyOn(window, 'prompt').mockReturnValueOnce(null);
  fireEvent.click(screen.getByRole('button', { name: 'reject with feedback' }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('POSTs respawn and permission decisions to their own endpoints', () => {
  render(<NeedsYou items={[FAILURE, PERMISSION]} readOnly={false} now={FIXTURE_NOW} />);
  fireEvent.click(screen.getByRole('button', { name: 'respawn' }));
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/agents/probe-charlie/respawn',
    expect.objectContaining({ method: 'POST' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'allow' }));
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/permits/permit-9/allow',
    expect.objectContaining({ method: 'POST' }),
  );
});

it('disables every button in read-only mode instead of failing on click', () => {
  render(<NeedsYou items={[PLAN, FAILURE, PERMISSION]} readOnly now={FIXTURE_NOW} />);
  const buttons = screen.getAllByRole('button');
  expect(buttons.length).toBeGreaterThan(0);
  for (const b of buttons) expect((b as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'approve' }));
  expect(fetchMock).not.toHaveBeenCalled();
});

it('stays mounted with an empty queue', () => {
  render(<NeedsYou items={[]} readOnly={false} now={FIXTURE_NOW} />);
  expect(screen.getByText('NEEDS YOU · 0')).toBeTruthy();
  expect(screen.getByText('nothing waiting')).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/chrome/NeedsYou.test.tsx`
Expected: FAIL with `Failed to resolve import "./NeedsYou.js" from "src/web/chrome/NeedsYou.test.tsx"`

- [ ] **Step 3: Write the implementation**

```ts
// src/web/api.ts
export function postJson(path: string, body: unknown = {}): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
```

```tsx
// src/web/chrome/NeedsYou.tsx
import type { NeedsYouItem } from '../../shared/domain.js';
import { postJson } from '../api.js';

export interface NeedsYouProps {
  items: NeedsYouItem[];
  readOnly: boolean;
  now: number;
}

const CARD_BASE = {
  borderRadius: 'var(--radius-sm)',
  padding: '6px 10px',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
} as const;

const DETAIL = { fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

function Action({
  label,
  tone,
  readOnly,
  onClick,
}: {
  label: string;
  tone: 'accent' | 'neutral';
  readOnly: boolean;
  onClick(): void;
}) {
  const accent = tone === 'accent';
  return (
    <button
      type="button"
      className={accent ? 'btn-approve' : 'btn-neutral'}
      disabled={readOnly}
      onClick={onClick}
      style={{
        border: `1px solid var(--color-${accent ? 'accent-700' : 'neutral-800'})`,
        color: `var(--color-${accent ? 'accent-300' : 'neutral-500'})`,
        borderRadius: 'var(--radius-sm)',
        padding: '1px 8px',
        fontSize: 10.5,
        whiteSpace: 'nowrap',
        opacity: readOnly ? 0.45 : 1,
        cursor: readOnly ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function Card({ item, readOnly, now }: { item: NeedsYouItem; readOnly: boolean; now: number }) {
  if (item.kind === 'failure') {
    return (
      <div
        data-testid="card-failure"
        style={{ ...CARD_BASE, flex: 'none', border: '1px solid var(--color-neutral-800)' }}
      >
        <span style={{ color: 'var(--failure-rose)', fontSize: 11, whiteSpace: 'nowrap' }}>
          {`${item.agent} · ${item.reason}`}
        </span>
        <span style={{ ...DETAIL, color: 'var(--color-neutral-600)' }}>{item.detail}</span>
        <Action
          label="respawn"
          tone="accent"
          readOnly={readOnly}
          onClick={() => void postJson(`/api/agents/${item.agent}/respawn`)}
        />
      </div>
    );
  }

  const permission = item.kind === 'permission';
  return (
    <div
      data-testid={permission ? 'card-permission' : 'card-plan'}
      style={{ ...CARD_BASE, flex: 1, minWidth: 0, border: '1px solid var(--attention-border)' }}
    >
      <span style={{ color: 'var(--attention)', fontSize: 11, whiteSpace: 'nowrap' }}>
        {`${item.agent} · ${item.reason}`}
      </span>
      <span style={{ ...DETAIL, color: 'var(--color-neutral-500)' }}>{item.detail}</span>
      <span style={{ flex: 1 }} />
      {permission && item.expiresAt !== undefined && (
        <span
          data-testid="permit-countdown"
          style={{ color: 'var(--color-neutral-600)', fontSize: 10.5, whiteSpace: 'nowrap' }}
        >
          {`${Math.max(0, Math.ceil((item.expiresAt - now) / 1000))}s`}
        </span>
      )}
      {permission ? (
        <>
          <Action
            label="allow"
            tone="accent"
            readOnly={readOnly}
            onClick={() => void postJson(`/api/permits/${item.id}/allow`)}
          />
          <Action
            label="deny with reason"
            tone="neutral"
            readOnly={readOnly}
            onClick={() => {
              const reason = window.prompt(`reason for denying ${item.agent}`);
              if (reason === null) return;
              void postJson(`/api/permits/${item.id}/deny`, { reason });
            }}
          />
        </>
      ) : (
        <>
          <Action
            label="approve"
            tone="accent"
            readOnly={readOnly}
            onClick={() => void postJson(`/api/plans/${item.id}/approve`)}
          />
          <Action
            label="reject with feedback"
            tone="neutral"
            readOnly={readOnly}
            onClick={() => {
              const feedback = window.prompt(`feedback for ${item.agent}`);
              if (feedback === null) return;
              void postJson(`/api/plans/${item.id}/reject`, { feedback });
            }}
          />
        </>
      )}
    </div>
  );
}

export function NeedsYou({ items, readOnly, now }: NeedsYouProps) {
  return (
    <div
      style={{
        borderTop: '1px solid var(--color-neutral-900)',
        background: 'var(--color-bg)',
        padding: '9px 14px',
        display: 'flex',
        alignItems: 'stretch',
        gap: 10,
      }}
    >
      <span
        style={{
          color: 'var(--attention)',
          fontSize: 10.5,
          letterSpacing: '.12em',
          alignSelf: 'center',
          whiteSpace: 'nowrap',
        }}
      >
        {`NEEDS YOU · ${items.length}`}
      </span>
      <div style={{ flex: 1, display: 'flex', gap: 8, minWidth: 0, alignItems: 'center' }}>
        {items.length === 0 ? (
          <span style={{ color: 'var(--color-neutral-700)', fontSize: 11 }}>nothing waiting</span>
        ) : (
          items.map((item) => <Card key={item.id} item={item} readOnly={readOnly} now={now} />)
        )}
      </div>
    </div>
  );
}
```

Append to `src/web/theme.css`:

```css
.btn-approve:not(:disabled):hover {
  background: var(--color-accent-900);
}

.btn-neutral:not(:disabled):hover {
  background: var(--color-neutral-900);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/chrome/NeedsYou.test.tsx`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/web/api.ts src/web/chrome/NeedsYou.tsx src/web/chrome/NeedsYou.test.tsx src/web/theme.css && git commit -m "feat(web): needs-you strip with plan, permission and failure cards"
```

---

### Task 23: Agent panel and the mounted-once chrome

**Files:**
- Create: `src/web/chrome/Panel.tsx`
- Modify: `src/web/theme.css`
- Modify: `src/web/App.tsx`
- Test: `src/web/chrome/Panel.test.tsx`
- Test: `src/web/App.test.tsx` (extended with the chrome-composition case)

**Interfaces:**
- Consumes: `Agent` from `src/shared/domain.ts`; `StatusGlyph` from `src/web/components/StatusGlyph.tsx`; `formatPct` from `src/web/format.ts`; `useTeamState` from `src/web/state/useTeamState.ts`; `StatusBar`, `NeedsYou` from Tasks 21–22; `MockEventSource`, `installMockEventSource`, `sampleTeamState` test helpers
- Produces: `export interface PanelProps { agents: Agent[]; focusedAgent: string | null; onFocusAgent(name: string): void }`; `export function Panel(props: PanelProps): JSX.Element`; the final `App` composition — `StatusBar` / `<main class="console-body">` / `NeedsYou` / `Panel`, with a 1 s `now` tick that feeds the status bar's elapsed and the permission countdown

- [ ] **Step 1: Write the failing test**

```tsx
// src/web/chrome/Panel.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Agent, AgentStatus } from '../../shared/domain.js';
import { Panel } from './Panel.js';

function agent(name: string, status: AgentStatus, contextTokens: number): Agent {
  return {
    name,
    agentId: `${name}@session-98b0b4a7`,
    isLead: name === 'team-lead',
    agentType: 'general-purpose',
    model: 'claude-opus-5',
    role: `Spike ${name}`,
    status,
    contextTokens,
    contextLimit: 1_000_000,
    compactAt: 967_000,
    costUsd: 0.42,
    startedAt: 1_787_843_382_976,
    transcript: [],
    unread: 0,
  };
}

it('shows one chip per agent while three or fewer are idle', () => {
  render(
    <Panel
      agents={[
        agent('probe-alpha', 'idle', 120_000),
        agent('probe-bravo', 'idle', 500_000),
        agent('probe-charlie', 'idle', 156_000),
      ]}
      focusedAgent={null}
      onFocusAgent={vi.fn()}
    />,
  );
  expect(screen.getAllByTestId('agent-chip')).toHaveLength(3);
  expect(screen.queryByTestId('idle-chip')).toBeNull();
});

it('collapses the surplus into a dashed chip once four agents are idle', () => {
  render(
    <Panel
      agents={[
        agent('team-lead', 'idle', 53_100),
        agent('probe-alpha', 'idle', 120_000),
        agent('probe-bravo', 'idle', 500_000),
        agent('probe-charlie', 'idle', 156_000),
      ]}
      focusedAgent={null}
      onFocusAgent={vi.fn()}
    />,
  );
  expect(screen.queryAllByTestId('agent-chip')).toHaveLength(0);
  const idleChip = screen.getByTestId('idle-chip');
  expect(idleChip.textContent).toBe('4 idle agents');
  expect(idleChip.style.border).toBe('1px dashed var(--color-neutral-800)');

  fireEvent.click(idleChip);
  expect(screen.getAllByTestId('agent-chip')).toHaveLength(4);
  expect(screen.queryByTestId('idle-chip')).toBeNull();
});

it('keeps busy agents visible while the idle ones are collapsed', () => {
  render(
    <Panel
      agents={[
        agent('team-lead', 'working', 53_100),
        agent('probe-alpha', 'idle', 120_000),
        agent('probe-bravo', 'idle', 500_000),
        agent('probe-charlie', 'idle', 156_000),
        agent('probe-delta', 'idle', 40_000),
      ]}
      focusedAgent={null}
      onFocusAgent={vi.fn()}
    />,
  );
  expect(screen.getAllByTestId('agent-chip')).toHaveLength(1);
  expect(screen.getByTestId('idle-chip').textContent).toBe('4 idle agents');
});

it('shows the glyph, name and context percent on each chip and focuses on click', () => {
  const onFocusAgent = vi.fn();
  render(
    <Panel
      agents={[agent('probe-alpha', 'working', 120_000)]}
      focusedAgent="probe-alpha"
      onFocusAgent={onFocusAgent}
    />,
  );
  const chip = screen.getByTestId('agent-chip');
  expect(chip.getAttribute('aria-pressed')).toBe('true');
  expect(chip.style.padding).toBe('2px 7px');
  expect(chip.style.border).toBe('1px solid var(--color-neutral-900)');
  expect(screen.getByTestId('status-glyph').textContent).toBe('●');
  expect(screen.getByText('probe-alpha')).toBeTruthy();
  expect(screen.getByText('12%')).toBeTruthy();

  fireEvent.click(chip);
  expect(onFocusAgent).toHaveBeenCalledWith('probe-alpha');
});

it('renders the PANEL label and the key legend', () => {
  render(<Panel agents={[]} focusedAgent={null} onFocusAgent={vi.fn()} />);
  const label = screen.getByText('PANEL');
  expect(label.style.color).toBe('var(--color-neutral-700)');
  expect(label.style.letterSpacing).toBe('.12em');
  expect(screen.getByText('↑↓ select · ⏎ open · esc interrupt · x stop · ⌃T tasks')).toBeTruthy();
});
```

```tsx
// src/web/App.test.tsx  (replaces the Task 18 file)
// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { MockEventSource, installMockEventSource } from './test/mockEventSource.js';
import { sampleTeamState } from './test/state-fixture.js';

beforeEach(() => {
  installMockEventSource();
  window.history.replaceState(null, '', '/');
});

afterEach(() => vi.unstubAllGlobals());

it('renders the console shell with a body slot', () => {
  render(<App />);
  expect(screen.getByRole('main')).toBeTruthy();
});

it('paints the root on the terminal ground #12141f', () => {
  render(<App />);
  expect(getComputedStyle(document.documentElement).backgroundColor).toBe('rgb(18, 20, 31)');
});

it('gives the five non-token colours explicit custom-property homes', async () => {
  const css = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('./theme.css', import.meta.url), 'utf8'),
  );
  expect(css).toContain('--terminal-ground: #12141f;');
  expect(css).toContain('--row-hairline: #1b1d2b;');
  expect(css).toContain('--attention: #d99e5c;');
  expect(css).toContain('--attention-border: #6b4f2c;');
  expect(css).toContain('--failure-rose: #c98d8d;');
  expect(css).toContain('outline: 2px solid var(--color-accent);');
  expect(css).toContain('outline-offset: 2px;');
});

it('mounts status bar, body, needs-you strip and panel once the snapshot lands', () => {
  render(<App />);
  act(() => MockEventSource.last().emit('snapshot', sampleTeamState()));

  expect(screen.getByRole('tablist')).toBeTruthy();
  expect(screen.getByText('session-98b0b4a7')).toBeTruthy();
  expect(screen.getByRole('main')).toBeTruthy();
  expect(screen.getByText('NEEDS YOU · 0')).toBeTruthy();
  expect(screen.getByText('PANEL')).toBeTruthy();
  expect(screen.getAllByTestId('agent-chip')).toHaveLength(4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/chrome/Panel.test.tsx src/web/App.test.tsx`
Expected: FAIL with `Failed to resolve import "./Panel.js" from "src/web/chrome/Panel.test.tsx"`, and `Unable to find an element with the role "tablist"` in `App.test.tsx`

- [ ] **Step 3: Write the implementation**

```tsx
// src/web/chrome/Panel.tsx
import { useState } from 'react';
import type { Agent } from '../../shared/domain.js';
import { StatusGlyph } from '../components/StatusGlyph.js';
import { formatPct } from '../format.js';

const IDLE_COLLAPSE_AT = 3;
const LEGEND = '↑↓ select · ⏎ open · esc interrupt · x stop · ⌃T tasks';

export interface PanelProps {
  agents: Agent[];
  focusedAgent: string | null;
  onFocusAgent(name: string): void;
}

export function Panel({ agents, focusedAgent, onFocusAgent }: PanelProps) {
  const [expanded, setExpanded] = useState(false);
  const idle = agents.filter((a) => a.status === 'idle');
  const collapsed = idle.length > IDLE_COLLAPSE_AT && !expanded;
  const shown = collapsed ? agents.filter((a) => a.status !== 'idle') : agents;

  return (
    <div
      style={{
        borderTop: '1px solid var(--color-neutral-900)',
        background: 'var(--terminal-ground)',
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 10.5,
      }}
    >
      <span style={{ color: 'var(--color-neutral-700)', letterSpacing: '.12em' }}>PANEL</span>
      <div style={{ display: 'flex', gap: 6, flex: 1, overflow: 'hidden' }}>
        {shown.map((a) => (
          <button
            key={a.name}
            type="button"
            className="chip"
            data-testid="agent-chip"
            aria-pressed={a.name === focusedAgent}
            onClick={() => onFocusAgent(a.name)}
            style={{
              border: '1px solid var(--color-neutral-900)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 7px',
              display: 'flex',
              gap: 5,
              alignItems: 'baseline',
              whiteSpace: 'nowrap',
            }}
          >
            <StatusGlyph status={a.status} size={10} />
            <span style={{ color: 'var(--color-neutral-400)' }}>{a.name}</span>
            <span style={{ color: 'var(--color-neutral-700)' }}>
              {formatPct(a.contextTokens / a.contextLimit)}
            </span>
          </button>
        ))}
        {collapsed && (
          <button
            type="button"
            className="chip"
            data-testid="idle-chip"
            onClick={() => setExpanded(true)}
            style={{
              border: '1px dashed var(--color-neutral-800)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 7px',
              color: 'var(--color-neutral-700)',
              whiteSpace: 'nowrap',
            }}
          >
            {`${idle.length} idle agents`}
          </button>
        )}
      </div>
      <span style={{ color: 'var(--color-neutral-700)', whiteSpace: 'nowrap' }}>{LEGEND}</span>
    </div>
  );
}
```

```tsx
// src/web/App.tsx
import { useEffect, useState } from 'react';
import './theme.css';
import { NeedsYou } from './chrome/NeedsYou.js';
import { Panel } from './chrome/Panel.js';
import { StatusBar } from './chrome/StatusBar.js';
import { useTeamState } from './state/useTeamState.js';

export function App() {
  const store = useTeamState();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const state = store.state;
  if (!state) {
    return (
      <div className="console">
        <main className="console-body" />
      </div>
    );
  }

  return (
    <div className="console">
      <StatusBar state={state} view={store.view} onViewChange={store.setView} now={now} />
      <main className="console-body" />
      <NeedsYou items={state.needsYou} readOnly={state.readOnly} now={now} />
      <Panel
        agents={state.agents}
        focusedAgent={store.agent}
        onFocusAgent={(name) => store.setAgent(name)}
      />
    </div>
  );
}
```

Append to `src/web/theme.css`:

```css
.chip:hover {
  border-color: var(--color-accent-700);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web`
Expected: PASS — `App.test.tsx` (4), `useTeamState.test.tsx` (5), `format.test.ts` (5), `Portrait.test.tsx` (4), `StatusGlyph.test.tsx` (2), `ContextMeter.test.tsx` (3), `StatusBar.test.tsx` (4), `NeedsYou.test.tsx` (8), `Panel.test.tsx` (5)

- [ ] **Step 5: Commit**

```bash
git add src/web/chrome/Panel.tsx src/web/chrome/Panel.test.tsx src/web/App.tsx src/web/App.test.tsx src/web/theme.css && git commit -m "feat(web): agent panel and the mounted-once console chrome"
```


### Task 24: TranscriptFeed, Composer and the view format helpers

**Files:**
- Modify: `src/web/format.ts` (created in Task 20 — APPEND to it; do not recreate)
- Create: `src/web/agents.fixture.ts`
- Create: `src/web/components/TranscriptFeed.tsx`
- Create: `src/web/components/Composer.tsx`
- Test: `src/web/format.test.ts`
- Test: `src/web/components/TranscriptFeed.test.tsx`
- Test: `src/web/components/Composer.test.tsx`

**Interfaces:**
- Consumes:
  - `src/shared/domain.ts` → `Agent`, `TranscriptLine`, `Marker`, `AgentStatus`, `TaskState`, `Task`, `MailMessage`, `TeamState`, `ViewId`
  - `src/shared/roster.ts` → `TeamConfig`, `Sidecar`
  - `POST /api/agents/:name/message` with body `{ text, summary? }` (Task 1-23 server)
- Produces:
  - `src/web/format.ts` — **defined by this phase, not in the pinned contract**: `tokensLabel(n: number): string`, `pctLabel(tokens: number, limit: number): string`, `ctxLabel(tokens: number, limit: number): string`, `warnMark(tokens: number, compactAt: number): string`, `costLabel(usd: number): string`, `elapsedLabel(startedAt: number, now: number): string`, `clockLabel(ts: number): string`
  - `src/web/agents.fixture.ts` — **defined by this phase, test-support only**: `FIXTURE_NOW: number`, `fixtureAgents(): Agent[]`, `padAgents(agents: Agent[], count: number): Agent[]`
  - `src/web/components/TranscriptFeed.tsx` — `type FeedSize = 'wall' | 'overview' | 'grid' | 'rail'`, `function TranscriptFeed(props: { lines: TranscriptLine[]; size: FeedSize }): JSX.Element`
  - `src/web/components/Composer.tsx` — `function Composer(props: { agent: Agent; variant: 'wall' | 'rail' }): JSX.Element`

- [ ] **Step 1: Write the failing test**

```ts
// src/web/format.test.ts
import { describe, it, expect } from 'vitest';
import {
  tokensLabel, pctLabel, ctxLabel, warnMark, costLabel, elapsedLabel, clockLabel,
} from './format';

describe('tokensLabel', () => {
  it('renders the spec §4.3 meter figures', () => {
    expect(tokensLabel(53_100)).toBe('53.1k');
    expect(tokensLabel(1_000_000)).toBe('1M');
    expect(tokensLabel(200_000)).toBe('200k');
    expect(tokensLabel(156_000)).toBe('156k');
    expect(tokensLabel(167_000)).toBe('167k');
    expect(tokensLabel(940)).toBe('940');
  });

  it('renders the real captured occupancies from usage-records.json', () => {
    expect(tokensLabel(34_469)).toBe('34.5k');
    expect(tokensLabel(34_561)).toBe('34.6k');
    expect(tokensLabel(23_639)).toBe('23.6k');
  });
});

describe('pctLabel and ctxLabel', () => {
  it('matches the two spec §4.3 example rows', () => {
    expect(pctLabel(53_100, 1_000_000)).toBe('5%');
    expect(ctxLabel(53_100, 1_000_000)).toBe('53.1k / 1M');
    expect(pctLabel(156_000, 200_000)).toBe('78%');
    expect(ctxLabel(156_000, 200_000)).toBe('156k / 200k');
  });

  it('matches probe-alpha and probe-charlie from the captured usage records', () => {
    expect(pctLabel(34_469, 1_000_000)).toBe('3%');
    expect(ctxLabel(34_469, 1_000_000)).toBe('34.5k / 1M');
    expect(pctLabel(23_639, 200_000)).toBe('12%');
    expect(ctxLabel(23_639, 200_000)).toBe('23.6k / 200k');
  });
});

describe('warnMark', () => {
  it('fires relative to compactAt, not a fixed window fraction', () => {
    expect(warnMark(156_000, 167_000)).toBe('!');
    expect(warnMark(53_100, 967_000)).toBe('');
    expect(warnMark(34_469, 967_000)).toBe('');
    expect(warnMark(23_639, 167_000)).toBe('');
  });
});

describe('costLabel', () => {
  it('renders the real per-agent costs computed from usage-records.json', () => {
    expect(costLabel(0.464434)).toBe('≈$0.46');
    expect(costLabel(0.390121)).toBe('≈$0.39');
    expect(costLabel(0.044338)).toBe('≈$0.04');
    expect(costLabel(0)).toBe('≈$0.00');
  });
});

describe('elapsedLabel', () => {
  it('measures probe-alpha from its real joinedAt', () => {
    expect(elapsedLabel(1787843382976, 1787843425000)).toBe('0m 42s');
  });

  it('switches to hours for the lead, whose team was created much earlier', () => {
    expect(elapsedLabel(1787798107581, 1787843425000)).toBe('12h 35m');
  });
});

describe('clockLabel', () => {
  it('renders the SENT time of the real probe-alpha inbox entry', () => {
    expect(clockLabel(Date.parse('2026-08-27T15:10:17.891Z'))).toBe('15:10:17');
  });

  it('renders the batched delivery time of the lead-transcript frames', () => {
    expect(clockLabel(Date.parse('2026-08-27T15:12:17.951Z'))).toBe('15:12:17');
  });
});
```

```tsx
// src/web/components/TranscriptFeed.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { TranscriptLine } from '../../shared/domain';
import { TranscriptFeed } from './TranscriptFeed';

afterEach(cleanup);

const LINES: TranscriptLine[] = [
  { id: 'alpha-0', marker: '❯', text: 'Spike probe alpha', ts: 1787843382976 },
  { id: 'alpha-1', marker: '⏺', text: 'Bash(sleep 10)', ts: 1787843383000 },
  { id: 'alpha-2', marker: '⏺', text: 'TaskUpdate(1) owner=probe-alpha status=in_progress', ts: 1787843399360 },
];

describe('TranscriptFeed', () => {
  it('is a bottom-anchored one-pixel-gap column', () => {
    render(<TranscriptFeed lines={LINES} size="wall" />);
    const feed = screen.getByTestId('transcript-feed');
    expect(feed.style.display).toBe('flex');
    expect(feed.style.flexDirection).toBe('column');
    expect(feed.style.justifyContent).toBe('flex-end');
    expect(feed.style.overflow).toBe('hidden');
  });

  it('ellipsises every line: nowrap row, hidden overflow, ellipsis text', () => {
    render(<TranscriptFeed lines={LINES} size="wall" />);
    const rows = screen.getAllByTestId('transcript-row');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.style.whiteSpace).toBe('nowrap');

    const texts = screen.getAllByTestId('transcript-text');
    for (const text of texts) {
      expect(text.style.overflow).toBe('hidden');
      expect(text.style.textOverflow).toBe('ellipsis');
    }
  });

  it('uses the wall marker column of 9px at 11px', () => {
    render(<TranscriptFeed lines={LINES} size="wall" />);
    const markers = screen.getAllByTestId('transcript-marker');
    expect(markers[0].textContent).toBe('❯');
    expect(markers[0].style.width).toBe('9px');
    expect(markers[0].style.fontSize).toBe('11px');
    expect(screen.getAllByTestId('transcript-text')[1].style.fontSize).toBe('11.5px');
  });

  it('uses the overview marker column of 8px at 9.5px with 10px text', () => {
    render(<TranscriptFeed lines={LINES} size="overview" />);
    const marker = screen.getAllByTestId('transcript-marker')[0];
    expect(marker.style.width).toBe('8px');
    expect(marker.style.fontSize).toBe('9.5px');
    expect(screen.getAllByTestId('transcript-text')[0].style.fontSize).toBe('10px');
  });

  it('uses the grid marker column of 8px at 10px with 11px text', () => {
    render(<TranscriptFeed lines={LINES} size="grid" />);
    const marker = screen.getAllByTestId('transcript-marker')[0];
    expect(marker.style.width).toBe('8px');
    expect(marker.style.fontSize).toBe('10px');
    expect(screen.getAllByTestId('transcript-text')[0].style.fontSize).toBe('11px');
  });

  it('uses the rail marker column of 10px at 11px and inherits the text size', () => {
    render(<TranscriptFeed lines={LINES} size="rail" />);
    const marker = screen.getAllByTestId('transcript-marker')[0];
    expect(marker.style.width).toBe('10px');
    expect(marker.style.fontSize).toBe('11px');
    expect(screen.getAllByTestId('transcript-text')[0].style.fontSize).toBe('');
  });
});
```

```tsx
// src/web/components/Composer.test.tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fixtureAgents } from '../agents.fixture';
import { Composer } from './Composer';

const agents = fixtureAgents();
const alpha = agents.find((a) => a.name === 'probe-alpha')!;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ msgId: 'stub' }) }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Composer', () => {
  it('posts to the teammate message endpoint on ⌘⏎', async () => {
    render(<Composer agent={alpha} variant="wall" />);
    const input = screen.getByTestId('composer-input');
    fireEvent.change(input, { target: { value: 'stop after task 1' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/agents/probe-alpha/message');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ text: 'stop after task 1' });
  });

  it('clears the input once the send is accepted', async () => {
    render(<Composer agent={alpha} variant="wall" />);
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'stop after task 1' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('does not send on a plain Enter', () => {
    render(<Composer agent={alpha} variant="wall" />);
    const input = screen.getByTestId('composer-input');
    fireEvent.change(input, { target: { value: 'stop after task 1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send an empty message', () => {
    render(<Composer agent={alpha} variant="wall" />);
    fireEvent.keyDown(screen.getByTestId('composer-input'), { key: 'Enter', metaKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the ⌘⏎ hint in the wall variant and the placeholder names the teammate', () => {
    render(<Composer agent={alpha} variant="wall" />);
    expect(screen.getByTestId('composer-input')).toHaveProperty('placeholder', 'message probe-alpha');
    expect(screen.getByText('⌘⏎')).toBeTruthy();
    expect(screen.queryByTestId('composer-caret')).toBeNull();
  });

  it('shows the blinking caret and the current tool in the rail variant', () => {
    render(<Composer agent={alpha} variant="rail" />);
    const caret = screen.getByTestId('composer-caret');
    expect(caret.style.width).toBe('7px');
    expect(caret.style.height).toBe('15px');
    expect(screen.getByTestId('composer-tool').textContent).toBe('Bash(sleep 20)');
    expect(screen.getByTestId('composer-input')).toHaveProperty(
      'placeholder', 'message probe-alpha directly',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm i -D @testing-library/react @testing-library/dom jsdom && npx vitest run src/web/format.test.ts src/web/components/TranscriptFeed.test.tsx src/web/components/Composer.test.tsx`
Expected: FAIL with `Failed to resolve import "./format"`, `"./TranscriptFeed"`, `"../agents.fixture"` and `"./Composer"` — none of the four modules exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/web/format.ts — APPEND. Task 20 already created this file with
// meterCells(), contextBar() and formatTokens(). Keep every existing export
// intact (ContextMeter imports them) and reuse formatTokens rather than
// adding a second token formatter.

function scaled(value: number, suffix: string): string {
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}${suffix}`;
}

export function tokensLabel(n: number): string {
  if (n >= 1_000_000) return scaled(n / 1_000_000, 'M');
  if (n >= 1_000) return scaled(n / 1_000, 'k');
  return String(n);
}

export function pctLabel(tokens: number, limit: number): string {
  if (limit <= 0) return '0%';
  return `${Math.round((tokens / limit) * 100)}%`;
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
  return `≈$${usd.toFixed(2)}`;
}

export function elapsedLabel(startedAt: number, now: number): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hours = Math.floor(total / 3600);
  if (hours > 0) return `${hours}h ${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}m`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

// UTC so the rendered clock is identical on every machine that reads a captured log.
export function clockLabel(ts: number): string {
  return new Date(ts).toISOString().slice(11, 19);
}
```

```ts
// src/web/agents.fixture.ts
// Test support only. Builds the four real spike agents from the captured corpus.
import { readFileSync } from 'node:fs';
import type { Agent, AgentStatus, Marker, TranscriptLine } from '../shared/domain';
import type { Sidecar, TeamConfig } from '../shared/roster';

const CONFIG_PATH = new URL('../../fixtures/config-4-members.json', import.meta.url);
const SIDECAR_PATH = new URL('../../fixtures/meta-sidecars.json', import.meta.url);

// probe-alpha is mid-`sleep 20`; probe-charlie has already sent its idle_notification.
export const FIXTURE_NOW = 1787843425000;

const MODEL: Record<string, string> = {
  'team-lead': 'claude-opus-5',
  'probe-alpha': 'claude-opus-5',
  'probe-bravo': 'claude-opus-5',
  'probe-charlie': 'claude-haiku-4-5',
};

// input_tokens + cache_read + cache_creation of the last record per agent in usage-records.json.
const CONTEXT_TOKENS: Record<string, number> = {
  'team-lead': 0,
  'probe-alpha': 34_469,
  'probe-bravo': 34_561,
  'probe-charlie': 23_639,
};

// Spec §4.1 cost formula over the deduped records in usage-records.json.
const COST_USD: Record<string, number> = {
  'team-lead': 0,
  'probe-alpha': 0.464434,
  'probe-bravo': 0.390121,
  'probe-charlie': 0.044338,
};

const RUN_STATE: Record<string, { status: AgentStatus; currentTool?: string }> = {
  'team-lead': { status: 'working', currentTool: 'Task(probe-charlie)' },
  'probe-alpha': { status: 'working', currentTool: 'Bash(sleep 20)' },
  'probe-bravo': { status: 'working', currentTool: 'Bash(sleep 20)' },
  'probe-charlie': { status: 'idle' },
};

const TRANSCRIPTS: Record<string, Array<[Marker, string]>> = {
  'team-lead': [
    ['❯', 'run the agent-teams data-capture spike'],
    ['⏺', 'Task(probe-alpha) general-purpose'],
    ['⏺', 'Task(probe-bravo) Explore'],
    ['⏺', 'Task(probe-charlie) general-purpose'],
    ['⎿', 'probe-charlie alive'],
    ['⎿', 'probe-alpha claimed task 1'],
  ],
  'probe-alpha': [
    ['❯', 'Spike probe alpha'],
    ['⏺', 'Bash(sleep 10)'],
    ['⏺', 'TaskList'],
    ['⏺', 'TaskUpdate(1) owner=probe-alpha status=in_progress'],
    ['⏺', 'SendMessage(team-lead) probe-alpha claimed task 1'],
    ['⏺', 'Bash(sleep 20)'],
  ],
  'probe-bravo': [
    ['❯', 'Spike probe bravo'],
    ['⏺', 'Bash(sleep 12)'],
    ['⏺', 'TaskUpdate(2) owner=probe-bravo status=in_progress'],
    ['⏺', 'SendMessage(probe-alpha) bravo greets alpha'],
    ['⏺', 'SendMessage(team-lead) probe-bravo claimed task 2'],
    ['⏺', 'Bash(sleep 20)'],
  ],
  'probe-charlie': [
    ['❯', 'Spike probe charlie'],
    ['⏺', 'Bash(sleep 14)'],
    ['⏺', 'SendMessage(team-lead) probe-charlie alive'],
    ['⏺', 'Bash(sleep 30)'],
    ['✓', 'probe-charlie done'],
  ],
};

function linesFor(name: string, joinedAt: number): TranscriptLine[] {
  return (TRANSCRIPTS[name] ?? []).map(([marker, text], i) => ({
    id: `${name}-${i}`,
    marker,
    text,
    ts: joinedAt + i * 1000,
  }));
}

export function fixtureAgents(): Agent[] {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as TeamConfig;
  const sidecars = JSON.parse(readFileSync(SIDECAR_PATH, 'utf8')) as Sidecar[];

  return config.members.map((m): Agent => {
    const model = MODEL[m.name];
    const contextLimit = model === 'claude-haiku-4-5' ? 200_000 : 1_000_000;
    const run = RUN_STATE[m.name];
    return {
      name: m.name,
      agentId: m.agentId,
      isLead: m.agentId === config.leadAgentId,
      agentType: m.agentType ?? 'team-lead',
      model,
      role: sidecars.find((s) => s.name === m.name)?.description ?? 'team lead',
      color: m.color,
      status: run.status,
      currentTool: run.currentTool,
      contextTokens: CONTEXT_TOKENS[m.name],
      contextLimit,
      compactAt: contextLimit - 33_000,
      costUsd: COST_USD[m.name],
      startedAt: m.joinedAt,
      transcript: linesFor(m.name, m.joinedAt),
      unread: 0,
    };
  });
}

export function padAgents(agents: Agent[], count: number): Agent[] {
  const out = agents.slice();
  while (out.length < count) {
    const src = agents[out.length % agents.length];
    const name = `${src.name}-${out.length}`;
    out.push({ ...src, name, agentId: `${name}@session-98b0b4a7`, isLead: false });
  }
  return out;
}
```

```tsx
// src/web/components/TranscriptFeed.tsx
import type { CSSProperties } from 'react';
import type { TranscriptLine } from '../../shared/domain';

export type FeedSize = 'wall' | 'overview' | 'grid' | 'rail';

interface FeedStyle {
  padding: string;
  gap: number;
  markerWidth: string;
  markerColor: string;
  markerSize: string;
  textColor: string;
  textSize?: string;
}

const FEED: Record<FeedSize, FeedStyle> = {
  wall: {
    padding: '9px 12px', gap: 7,
    markerWidth: '9px', markerColor: 'var(--color-accent-600)', markerSize: '11px',
    textColor: 'var(--color-neutral-500)', textSize: '11.5px',
  },
  overview: {
    padding: '8px 10px', gap: 5,
    markerWidth: '8px', markerColor: 'var(--color-accent-700)', markerSize: '9.5px',
    textColor: 'var(--color-neutral-600)', textSize: '10px',
  },
  grid: {
    padding: '8px 11px', gap: 6,
    markerWidth: '8px', markerColor: 'var(--color-accent-700)', markerSize: '10px',
    textColor: 'var(--color-neutral-600)', textSize: '11px',
  },
  rail: {
    padding: '12px 18px', gap: 9,
    markerWidth: '10px', markerColor: 'var(--color-accent-600)', markerSize: '11px',
    textColor: 'var(--color-neutral-400)',
  },
};

// No view shows more than ~20 rows; the store keeps 2000 per agent (spec §10).
const RENDER_LIMIT = 60;

export function TranscriptFeed({ lines, size }: { lines: TranscriptLine[]; size: FeedSize }) {
  const s = FEED[size];
  const container: CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    padding: s.padding,
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    justifyContent: 'flex-end',
  };

  return (
    <div data-testid="transcript-feed" style={container}>
      {lines.slice(-RENDER_LIMIT).map((line) => (
        <div
          key={line.id}
          data-testid="transcript-row"
          style={{ display: 'flex', gap: `${s.gap}px`, alignItems: 'baseline', whiteSpace: 'nowrap' }}
        >
          <span
            data-testid="transcript-marker"
            style={{ color: s.markerColor, width: s.markerWidth, flex: 'none', fontSize: s.markerSize }}
          >
            {line.marker}
          </span>
          <span
            data-testid="transcript-text"
            style={{
              color: s.textColor,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              ...(s.textSize ? { fontSize: s.textSize } : {}),
            }}
          >
            {line.text}
          </span>
        </div>
      ))}
    </div>
  );
}
```

```tsx
// src/web/components/Composer.tsx
import { useState, type KeyboardEvent } from 'react';
import type { Agent } from '../../shared/domain';

interface Variant {
  padding: string;
  gap: string;
  promptColor: string;
  promptSize: string;
  placeholder: (name: string) => string;
  placeholderColor: string;
}

const VARIANT: Record<'wall' | 'rail', Variant> = {
  wall: {
    padding: '8px 12px', gap: '7px',
    promptColor: 'var(--color-accent-600)', promptSize: '11px',
    placeholder: (n) => `message ${n}`,
    placeholderColor: 'var(--color-neutral-700)',
  },
  rail: {
    padding: '11px 18px', gap: '9px',
    promptColor: 'var(--color-accent)', promptSize: '12px',
    placeholder: (n) => `message ${n} directly`,
    placeholderColor: 'var(--color-neutral-600)',
  },
};

export function Composer({ agent, variant }: { agent: Agent; variant: 'wall' | 'rail' }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const v = VARIANT[variant];

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.name)}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: body }),
      });
      if (res.ok) setText('');
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div
      style={{
        borderTop: '1px solid var(--color-neutral-900)',
        background: 'var(--color-bg)',
        padding: v.padding,
        display: 'flex',
        alignItems: 'center',
        gap: v.gap,
      }}
    >
      <span style={{ color: v.promptColor, fontSize: v.promptSize }}>❯</span>
      <textarea
        data-testid="composer-input"
        rows={1}
        value={text}
        placeholder={v.placeholder(agent.name)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        style={{
          flex: 1,
          minWidth: 0,
          resize: 'none',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          font: 'inherit',
          fontSize: '11px',
          lineHeight: '15px',
          padding: 0,
          color: 'var(--color-text)',
        }}
      />
      {variant === 'rail' && text === '' && (
        <span
          data-testid="composer-caret"
          style={{
            width: '7px',
            height: '15px',
            flex: 'none',
            background: 'var(--color-accent-400)',
            animation: 'blink 1.1s step-end infinite',
          }}
        />
      )}
      {variant === 'wall' ? (
        <span style={{ color: 'var(--color-neutral-800)', fontSize: '10px' }}>⌘⏎</span>
      ) : (
        <span
          data-testid="composer-tool"
          style={{
            color: 'var(--color-neutral-700)',
            fontSize: '11px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {agent.currentTool ?? ''}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/format.test.ts src/web/components/TranscriptFeed.test.tsx src/web/components/Composer.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/format.ts src/web/format.test.ts src/web/agents.fixture.ts src/web/components/TranscriptFeed.tsx src/web/components/TranscriptFeed.test.tsx src/web/components/Composer.tsx src/web/components/Composer.test.tsx package.json package-lock.json && git commit -m "feat: transcript feed, composer and view format helpers"
```

---

### Task 25: Wall view

**Files:**
- Create: `src/web/views/Wall.tsx`
- Test: `src/web/views/Wall.test.tsx`

**Interfaces:**
- Consumes:
  - `src/shared/domain.ts` → `Agent`
  - `src/shared/status.ts` → `AGENT_STATUS: Record<AgentStatus, StatusStyle>`
  - `src/web/components/Portrait.tsx` → `function Portrait(props: { agent: Agent; size: number }): JSX.Element`
  - `src/web/components/StatusGlyph.tsx` → `function StatusGlyph(props: { status: AgentStatus; size: number }): JSX.Element`
  - `src/web/components/ContextMeter.tsx` → `function ContextMeter(props: { agent: Agent; fontSize: number }): JSX.Element` (renders the 16-cell `█`/`░` bar only)
  - `src/web/components/TranscriptFeed.tsx` → `TranscriptFeed({ lines, size })`
  - `src/web/components/Composer.tsx` → `Composer({ agent, variant })`
  - `src/web/format.ts` → `pctLabel`, `ctxLabel`, `warnMark`, `costLabel`, `elapsedLabel`
  - `src/web/agents.fixture.ts` → `fixtureAgents`, `FIXTURE_NOW`
- Produces: `function Wall(props: { agents: Agent[]; focused: string | null; onFocus: (name: string) => void; now: number }): JSX.Element`. Views take explicit props; `App.tsx` (Task 1-23) wires them from `useTeamState()`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/web/views/Wall.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FIXTURE_NOW, fixtureAgents } from '../agents.fixture';
import { Wall } from './Wall';

afterEach(cleanup);

const agents = fixtureAgents();

function renderWall(onFocus = vi.fn()) {
  render(<Wall agents={agents} focused="probe-alpha" onFocus={onFocus} now={FIXTURE_NOW} />);
  return onFocus;
}

describe('Wall', () => {
  it('renders one 366px column per team member', () => {
    renderWall();
    const columns = screen.getAllByTestId('wall-column');
    expect(columns).toHaveLength(4);
    for (const column of columns) expect(column.style.width).toBe('366px');
  });

  it('pins only the lead column', () => {
    renderWall();
    const columns = screen.getAllByTestId('wall-column');
    expect(columns[0].style.left).toBe('0px');
    expect(columns[0].style.zIndex).toBe('2');
    expect(columns[1].style.left).toBe('');
    expect(columns[1].style.zIndex).toBe('');
    expect(columns[2].style.left).toBe('');
  });

  it('scrolls horizontally only', () => {
    renderWall();
    const wall = screen.getByTestId('wall');
    expect(wall.style.overflowX).toBe('auto');
    expect(wall.style.overflowY).toBe('hidden');
  });

  it('renders the three header lines for probe-alpha', () => {
    renderWall();
    const alpha = within(screen.getAllByTestId('wall-column')[1]);
    expect(alpha.getByTestId('wall-name').textContent).toBe('probe-alpha');
    expect(alpha.getByTestId('wall-type').textContent).toBe('general-purpose');
    expect(alpha.getByTestId('wall-model').textContent).toBe('claude-opus-5');
    expect(alpha.getByTestId('wall-role').textContent).toBe('Spike probe alpha');
    expect(alpha.getByTestId('wall-elapsed').textContent).toBe('0m 42s');
    expect(alpha.getByTestId('wall-pct').textContent).toBe('3%');
    expect(alpha.getByTestId('wall-ctx').textContent).toBe('34.5k / 1M');
    expect(alpha.getByTestId('wall-cost').textContent).toBe('≈$0.46');
    expect(alpha.getByTestId('wall-warn').textContent).toBe('');
    expect(alpha.getByTestId('wall-warn').style.width).toBe('7px');
  });

  it('renders the current-tool row folded back from the README', () => {
    renderWall();
    const columns = screen.getAllByTestId('wall-column');
    const alphaTool = within(columns[1]).getByTestId('wall-current-tool');
    expect(alphaTool.textContent).toBe('Bash(sleep 20)');
    expect(alphaTool.style.whiteSpace).toBe('nowrap');
    expect(alphaTool.style.overflow).toBe('hidden');
    expect(alphaTool.style.textOverflow).toBe('ellipsis');
    // probe-charlie is idle and has no tool in flight
    expect(within(columns[3]).getByTestId('wall-current-tool').textContent).toBe('');
  });

  it('gives every column a composer aimed at that teammate', () => {
    renderWall();
    const inputs = screen.getAllByTestId('composer-input') as HTMLTextAreaElement[];
    expect(inputs).toHaveLength(4);
    expect(inputs[1].placeholder).toBe('message probe-alpha');
    expect(inputs[3].placeholder).toBe('message probe-charlie');
  });

  it('focuses a column on click', () => {
    const onFocus = renderWall();
    fireEvent.click(screen.getAllByTestId('wall-column')[2]);
    expect(onFocus).toHaveBeenCalledWith('probe-bravo');
  });

  it('tints a column on hover and clears the tint on leave', () => {
    renderWall();
    const charlie = screen.getAllByTestId('wall-column')[3];
    expect(charlie.style.background).toBe('rgb(18, 20, 31)');
    fireEvent.mouseEnter(charlie);
    expect(charlie.style.background).toBe('var(--color-bg)');
    fireEvent.mouseLeave(charlie);
    expect(charlie.style.background).toBe('rgb(18, 20, 31)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/views/Wall.test.tsx`
Expected: FAIL with `Failed to resolve import "./Wall" from "src/web/views/Wall.test.tsx"`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/web/views/Wall.tsx
import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Agent } from '../../shared/domain';
import { AGENT_STATUS } from '../../shared/status';
import { ContextMeter } from '../components/ContextMeter';
import { Composer } from '../components/Composer';
import { Portrait } from '../components/Portrait';
import { StatusGlyph } from '../components/StatusGlyph';
import { TranscriptFeed } from '../components/TranscriptFeed';
import { costLabel, ctxLabel, elapsedLabel, pctLabel, warnMark } from '../format';

const GROUND = '#12141f';

const HEADER: CSSProperties = {
  padding: '9px 12px 8px',
  background: 'var(--color-bg)',
  borderBottom: '1px solid var(--color-neutral-900)',
  display: 'flex',
  gap: '11px',
  alignItems: 'flex-start',
};

const LINE: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: '7px' };

export function Wall({
  agents, focused, onFocus, now,
}: {
  agents: Agent[];
  focused: string | null;
  onFocus: (name: string) => void;
  now: number;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div
      data-testid="wall"
      style={{
        flex: 1,
        display: 'flex',
        overflowX: 'auto',
        overflowY: 'hidden',
        minHeight: 0,
        gap: '1px',
        background: 'var(--color-neutral-900)',
      }}
    >
      {agents.map((agent, index) => {
        const status = AGENT_STATUS[agent.status];
        const isLeadColumn = index === 0;
        const isFocused = agent.name === focused;
        const isTinted = isFocused || hovered === agent.name;

        const shadows: string[] = [];
        if (isLeadColumn) shadows.push('1px 0 0 var(--color-neutral-800)', '8px 0 18px rgba(0,0,0,.5)');
        if (isFocused) shadows.push('inset 0 2px 0 var(--color-accent-600)');

        const column: CSSProperties = {
          flex: 'none',
          width: '366px',
          background: isTinted ? 'var(--color-bg)' : GROUND,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          cursor: 'pointer',
          ...(shadows.length ? { boxShadow: shadows.join(',') } : {}),
          ...(isLeadColumn ? { position: 'sticky', left: 0, zIndex: 2 } : {}),
        };

        function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onFocus(agent.name);
          }
        }

        return (
          <div
            key={agent.name}
            data-testid="wall-column"
            role="button"
            tabIndex={0}
            aria-current={isFocused}
            style={column}
            onClick={() => onFocus(agent.name)}
            onKeyDown={onKeyDown}
            onMouseEnter={() => setHovered(agent.name)}
            onMouseLeave={() => setHovered((h) => (h === agent.name ? null : h))}
          >
            <div style={HEADER}>
              <div style={{ flex: 'none', marginTop: '3px' }}>
                <Portrait agent={agent} size={24} />
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <div style={LINE}>
                  <StatusGlyph status={agent.status} size={11} />
                  <span
                    data-testid="wall-name"
                    style={{ color: 'var(--color-text)', fontWeight: 500, fontSize: '13px' }}
                  >
                    {agent.name}
                  </span>
                  <span
                    data-testid="wall-type"
                    style={{
                      border: '1px solid var(--color-neutral-800)',
                      color: 'var(--color-neutral-500)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0 5px',
                      fontSize: '9.5px',
                    }}
                  >
                    {agent.agentType}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span
                    data-testid="wall-model"
                    style={{ color: 'var(--color-neutral-700)', fontSize: '10.5px' }}
                  >
                    {agent.model}
                  </span>
                </div>

                <div style={LINE}>
                  <span style={{ fontSize: '11px', color: status.color }}>{status.label}</span>
                  <span
                    data-testid="wall-role"
                    style={{
                      color: 'var(--color-neutral-600)',
                      fontSize: '11px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {agent.role}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span
                    data-testid="wall-elapsed"
                    style={{ color: 'var(--color-neutral-700)', fontSize: '10.5px' }}
                  >
                    {elapsedLabel(agent.startedAt, now)}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                  <ContextMeter agent={agent} fontSize={11.5} />
                  <span
                    data-testid="wall-pct"
                    style={{ color: 'var(--color-neutral-500)', fontSize: '10.5px' }}
                  >
                    {pctLabel(agent.contextTokens, agent.contextLimit)}
                  </span>
                  <span
                    data-testid="wall-warn"
                    style={{ color: '#d99e5c', fontSize: '10.5px', width: '7px' }}
                  >
                    {warnMark(agent.contextTokens, agent.compactAt)}
                  </span>
                  <span
                    data-testid="wall-ctx"
                    style={{ color: 'var(--color-neutral-600)', fontSize: '10.5px' }}
                  >
                    {ctxLabel(agent.contextTokens, agent.contextLimit)}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span
                    data-testid="wall-cost"
                    style={{ color: 'var(--color-neutral-600)', fontSize: '10.5px' }}
                  >
                    {costLabel(agent.costUsd)}
                  </span>
                </div>
              </div>
            </div>

            <TranscriptFeed lines={agent.transcript} size="wall" />

            <div
              data-testid="wall-current-tool"
              style={{
                borderTop: '1px solid var(--color-neutral-900)',
                padding: '7px 12px',
                color: 'var(--color-neutral-700)',
                fontSize: '10.5px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {agent.currentTool ?? ''}
            </div>

            <Composer agent={agent} variant="wall" />
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/views/Wall.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/views/Wall.tsx src/web/views/Wall.test.tsx && git commit -m "feat: wall view with sticky lead column and current-tool row"
```

---

### Task 26: Overview view

**Files:**
- Create: `src/web/views/Overview.tsx`
- Test: `src/web/views/Overview.test.tsx`

**Interfaces:**
- Consumes: `Agent`; `AGENT_STATUS`; `Portrait({ agent, size })`; `StatusGlyph({ status, size })`; `TranscriptFeed({ lines, size })`; `pctLabel`, `costLabel`, `elapsedLabel` from `src/web/format.ts`; `fixtureAgents`, `padAgents`, `FIXTURE_NOW` from `src/web/agents.fixture.ts`
- Produces: `function Overview(props: { agents: Agent[]; focused: string | null; onFocus: (name: string) => void; now: number }): JSX.Element`

- [ ] **Step 1: Write the failing test**

```tsx
// src/web/views/Overview.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FIXTURE_NOW, fixtureAgents, padAgents } from '../agents.fixture';
import { Overview } from './Overview';

afterEach(cleanup);

const four = fixtureAgents();
const six = padAgents(four, 6);

describe('Overview', () => {
  it('fits six tiles without horizontal scroll', () => {
    render(<Overview agents={six} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const tiles = screen.getAllByTestId('overview-tile');
    expect(tiles).toHaveLength(6);
    for (const tile of tiles) {
      expect(tile.style.width).toBe('');
      expect(tile.style.minWidth).toBe('0px');
    }
    const root = screen.getByTestId('overview');
    expect(root.style.overflowX).toBe('');
    expect(root.style.display).toBe('flex');
  });

  it('renders the header, type and status row for probe-alpha', () => {
    render(<Overview agents={four} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const alpha = within(screen.getAllByTestId('overview-tile')[1]);
    expect(alpha.getByTestId('overview-name').textContent).toBe('probe-alpha');
    expect(alpha.getByTestId('overview-type').textContent).toBe('general-purpose');
    expect(alpha.getByTestId('overview-pct').textContent).toBe('3%');
    expect(alpha.getByTestId('overview-status').style.fontSize).toBe('');
    expect(alpha.getByTestId('overview-status-row').style.justifyContent).toBe('space-between');
    expect(alpha.getByTestId('overview-status-row').style.fontSize).toBe('10px');
  });

  it('draws a 4px progress bar filled to the context percentage', () => {
    render(<Overview agents={four} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const tiles = screen.getAllByTestId('overview-tile');
    const alphaTrack = within(tiles[1]).getByTestId('overview-track');
    expect(alphaTrack.style.height).toBe('4px');
    expect(within(tiles[1]).getByTestId('overview-fill').style.width).toBe('3%');
    // probe-charlie is on haiku, so the same token count reads much fuller
    expect(within(tiles[3]).getByTestId('overview-fill').style.width).toBe('12%');
  });

  it('puts elapsed left and cost right in the footer', () => {
    render(<Overview agents={four} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const alpha = within(screen.getAllByTestId('overview-tile')[1]);
    const footer = alpha.getByTestId('overview-footer');
    expect(footer.style.padding).toBe('6px 10px');
    expect(footer.style.fontSize).toBe('9.5px');
    expect(alpha.getByTestId('overview-elapsed').textContent).toBe('0m 42s');
    expect(alpha.getByTestId('overview-cost').textContent).toBe('≈$0.46');
  });

  it('sets the focused agent when a tile is clicked', () => {
    const onFocus = vi.fn();
    render(<Overview agents={four} focused={null} onFocus={onFocus} now={FIXTURE_NOW} />);
    fireEvent.click(screen.getAllByTestId('overview-tile')[3]);
    expect(onFocus).toHaveBeenCalledWith('probe-charlie');
  });

  it('tints a tile on hover', () => {
    render(<Overview agents={four} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const tile = screen.getAllByTestId('overview-tile')[0];
    expect(tile.style.background).toBe('rgb(18, 20, 31)');
    fireEvent.mouseEnter(tile);
    expect(tile.style.background).toBe('var(--color-bg)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/views/Overview.test.tsx`
Expected: FAIL with `Failed to resolve import "./Overview" from "src/web/views/Overview.test.tsx"`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/web/views/Overview.tsx
import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Agent } from '../../shared/domain';
import { AGENT_STATUS } from '../../shared/status';
import { Portrait } from '../components/Portrait';
import { StatusGlyph } from '../components/StatusGlyph';
import { TranscriptFeed } from '../components/TranscriptFeed';
import { costLabel, elapsedLabel, pctLabel } from '../format';

const GROUND = '#12141f';

export function Overview({
  agents, focused, onFocus, now,
}: {
  agents: Agent[];
  focused: string | null;
  onFocus: (name: string) => void;
  now: number;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div
      data-testid="overview"
      style={{ flex: 1, display: 'flex', gap: '1px', background: 'var(--color-neutral-900)', minHeight: 0 }}
    >
      {agents.map((agent) => {
        const status = AGENT_STATUS[agent.status];
        const pct = pctLabel(agent.contextTokens, agent.contextLimit);
        const isTinted = agent.name === focused || hovered === agent.name;

        const tile: CSSProperties = {
          flex: 1,
          minWidth: 0,
          background: isTinted ? 'var(--color-bg)' : GROUND,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          cursor: 'pointer',
        };

        function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onFocus(agent.name);
          }
        }

        return (
          <div
            key={agent.name}
            data-testid="overview-tile"
            role="button"
            tabIndex={0}
            aria-current={agent.name === focused}
            style={tile}
            onClick={() => onFocus(agent.name)}
            onKeyDown={onKeyDown}
            onMouseEnter={() => setHovered(agent.name)}
            onMouseLeave={() => setHovered((h) => (h === agent.name ? null : h))}
          >
            <div
              style={{
                padding: '9px 10px 8px',
                borderBottom: '1px solid var(--color-neutral-900)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <div style={{ flex: 'none' }}>
                  <Portrait agent={agent} size={24} />
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', gap: '5px', alignItems: 'baseline' }}>
                    <StatusGlyph status={agent.status} size={10} />
                    <span
                      data-testid="overview-name"
                      style={{ color: 'var(--color-text)', fontWeight: 500, fontSize: '12px' }}
                    >
                      {agent.name}
                    </span>
                  </div>
                  <span
                    data-testid="overview-type"
                    style={{
                      color: 'var(--color-neutral-600)',
                      fontSize: '9.5px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {agent.agentType}
                  </span>
                </div>
              </div>

              <div
                data-testid="overview-status-row"
                style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}
              >
                <span data-testid="overview-status" style={{ color: status.color }}>{status.label}</span>
                <span data-testid="overview-pct" style={{ color: 'var(--color-neutral-600)' }}>{pct}</span>
              </div>

              <div
                data-testid="overview-track"
                style={{
                  height: '4px',
                  borderRadius: '2px',
                  background: 'var(--color-neutral-900)',
                  overflow: 'hidden',
                }}
              >
                <div
                  data-testid="overview-fill"
                  style={{ height: '100%', background: 'var(--color-accent-600)', width: pct }}
                />
              </div>
            </div>

            <TranscriptFeed lines={agent.transcript} size="overview" />

            <div
              data-testid="overview-footer"
              style={{
                borderTop: '1px solid var(--color-neutral-900)',
                padding: '6px 10px',
                display: 'flex',
                gap: '6px',
                color: 'var(--color-neutral-700)',
                fontSize: '9.5px',
              }}
            >
              <span data-testid="overview-elapsed">{elapsedLabel(agent.startedAt, now)}</span>
              <span style={{ flex: 1 }} />
              <span data-testid="overview-cost">{costLabel(agent.costUsd)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/views/Overview.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/views/Overview.tsx src/web/views/Overview.test.tsx && git commit -m "feat: overview view with per-tile progress bars"
```

---

### Task 27: Tasks view — task table and mailbox traffic

**Files:**
- Create: `src/web/views/Tasks.tsx`
- Test: `src/web/views/Tasks.test.tsx`

**Interfaces:**
- Consumes: `Task`, `TaskState`, `MailMessage` from `src/shared/domain.ts`; `TASK_STATUS: Record<TaskState, StatusStyle>` from `src/shared/status.ts`; `clockLabel` from `src/web/format.ts`
- Produces: `function Tasks(props: { tasks: Task[]; mail: MailMessage[]; teamName: string }): JSX.Element`

- [ ] **Step 1: Write the failing test**

```tsx
// src/web/views/Tasks.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { MailMessage, Task } from '../../shared/domain';
import { Tasks } from './Tasks';

afterEach(cleanup);

// fixtures/tasks.json: task 1 was claimed and completed by probe-alpha; task 2 in
// its unclaimed pending snapshot.
const TASKS: Task[] = [
  {
    id: '1',
    subject: 'SPIKE probe A — report your identity',
    description:
      'Throwaway spike task. Claim this task with TaskUpdate (set owner to your own name and status to in_progress), then use SendMessage to send team-lead a one-line message saying which task you claimed. Then mark it completed. Do nothing else.',
    activeForm: 'Probing identity A',
    owner: 'probe-alpha',
    state: 'completed',
    blocks: [],
    blockedBy: [],
  },
  {
    id: '2',
    subject: 'SPIKE probe B — report your identity',
    description:
      'Throwaway spike task. Claim this task with TaskUpdate (set owner to your own name and status to in_progress), then use SendMessage to send team-lead a one-line message saying which task you claimed. Then mark it completed. Do nothing else.',
    activeForm: 'Probing identity B',
    state: 'pending',
    blocks: [],
    blockedBy: [],
  },
];

// fixtures/inbox-snapshots.json (sent times) plus the batched delivery time from
// fixtures/lead-transcript-teammate-frames.json for the backfilled frame.
const MAIL: MailMessage[] = [
  {
    msgId: '48ba3528-7a03-4d43-ab32-b3ef759ff2bd',
    from: 'probe-charlie',
    to: 'team-lead',
    text: 'probe-charlie reporting: running on a different model so the console can prove per-agent model resolution.',
    summary: 'probe-charlie alive',
    ts: Date.parse('2026-08-27T15:10:15.734Z'),
    tsIsDelivery: false,
    color: 'yellow',
  },
  {
    msgId: '4a236089-e8f5-4688-bca2-e47c6f0d8310',
    from: 'probe-alpha',
    to: 'team-lead',
    text: 'probe-alpha reporting: I claimed task 1. This is spike traffic.',
    summary: 'probe-alpha claimed task 1',
    ts: Date.parse('2026-08-27T15:10:17.891Z'),
    tsIsDelivery: false,
    color: 'blue',
  },
  {
    msgId: 'c6390c86-1b02-43f4-b8bb-0a58ef1afd66',
    from: 'probe-charlie',
    to: 'team-lead',
    text: '{"type":"idle_notification","from":"probe-charlie","timestamp":"2026-08-27T15:10:22.099Z","idleReason":"available"}',
    ts: Date.parse('2026-08-27T15:12:17.951Z'),
    tsIsDelivery: true,
    color: 'yellow',
    protocol: { type: 'idle_notification', data: { from: 'probe-charlie', idleReason: 'available' } },
  },
];

function renderTasks() {
  render(<Tasks tasks={TASKS} mail={MAIL} teamName="session-98b0b4a7" />);
}

describe('Tasks — left pane', () => {
  it('uses the design column widths', () => {
    renderTasks();
    expect(screen.getByText('TASK').style.width).toBe('44px');
    expect(screen.getByText('DESCRIPTION').style.flex).toBe('1');
    expect(screen.getByText('STATE').style.width).toBe('92px');
    expect(screen.getByText('OWNER').style.width).toBe('80px');
    expect(screen.getByText('DEPENDS ON').style.width).toBe('88px');
  });

  it('renders each task as a hairline-bottomed row', () => {
    renderTasks();
    const rows = screen.getAllByTestId('task-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].style.padding).toBe('7px 16px');
    expect(rows[0].style.fontSize).toBe('11.5px');
    expect(rows[0].style.borderBottom).toBe('1px solid var(--row-hairline)');
  });

  it('shows the owner, or "unassigned" when nobody has claimed it', () => {
    renderTasks();
    const rows = screen.getAllByTestId('task-row');
    expect(within(rows[0]).getByTestId('task-owner').textContent).toBe('probe-alpha');
    expect(within(rows[1]).getByTestId('task-owner').textContent).toBe('unassigned');
  });

  it('shows the state glyph and label, and an em dash for no dependencies', () => {
    renderTasks();
    const rows = screen.getAllByTestId('task-row');
    expect(within(rows[0]).getByTestId('task-state').textContent).toBe('✓completed');
    expect(within(rows[1]).getByTestId('task-state').textContent).toBe('○pending');
    expect(within(rows[0]).getByTestId('task-deps').textContent).toBe('—');
  });

  it('names the on-disk task directory and the locking rule in the footer', () => {
    renderTasks();
    const footer = screen.getByTestId('tasks-footer');
    expect(within(footer).getByText('~/.claude/tasks/session-98b0b4a7/')).toBeTruthy();
    expect(
      within(footer).getByText('claiming is file-locked · completing a task unblocks its dependents'),
    ).toBeTruthy();
  });
});

describe('Tasks — mailbox pane', () => {
  it('is a 404px pane headed MAILBOX TRAFFIC', () => {
    renderTasks();
    expect(screen.getByTestId('mailbox').style.width).toBe('404px');
    expect(screen.getByText('MAILBOX TRAFFIC')).toBeTruthy();
  });

  it('shows the SENT time of a message recovered from the inbox', () => {
    renderTasks();
    const entries = screen.getAllByTestId('mail-entry');
    expect(within(entries[1]).getByTestId('mail-ts').textContent).toBe('15:10:17');
    expect(within(entries[1]).getByTestId('mail-from').textContent).toBe('probe-alpha');
    expect(within(entries[1]).getByTestId('mail-to').textContent).toBe('team-lead');
    expect(within(entries[1]).getByTestId('mail-body').textContent).toBe(
      'probe-alpha reporting: I claimed task 1. This is spike traffic.',
    );
  });

  it('marks a backfilled entry whose only timestamp is the delivery batch time', () => {
    renderTasks();
    const entries = screen.getAllByTestId('mail-entry');
    expect(within(entries[2]).getByTestId('mail-ts').textContent).toBe('~15:12:17');
    expect(within(entries[2]).getByTestId('mail-ts').title).toBe('delivery time — send time unknown');
  });

  it('renders a protocol frame by type rather than as raw JSON', () => {
    renderTasks();
    const body = within(screen.getAllByTestId('mail-entry')[2]).getByTestId('mail-body');
    expect(body.textContent).toBe('idle_notification');
    expect(body.textContent).not.toContain('{');
  });

  it('has a two-line footer naming the inboxes and the no-relay rule', () => {
    renderTasks();
    const footer = screen.getByTestId('mailbox-footer');
    expect(footer.style.flexDirection).toBe('column');
    expect(footer.style.gap).toBe('3px');
    expect(footer.children).toHaveLength(2);
    expect(footer.children[0].textContent).toBe('~/.claude/teams/session-98b0b4a7/inboxes/');
    expect(footer.children[1].textContent).toBe(
      "teammates message each other directly — the lead doesn't relay",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/views/Tasks.test.tsx`
Expected: FAIL with `Failed to resolve import "./Tasks" from "src/web/views/Tasks.test.tsx"`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/web/views/Tasks.tsx
import { useState, type CSSProperties } from 'react';
import type { MailMessage, Task } from '../../shared/domain';
import { TASK_STATUS } from '../../shared/status';
import { clockLabel } from '../format';

const COLUMN_HEAD: CSSProperties = {
  display: 'flex',
  gap: '10px',
  padding: '10px 16px 8px',
  color: 'var(--color-neutral-700)',
  fontSize: '10.5px',
  letterSpacing: '.12em',
  borderBottom: '1px solid var(--color-neutral-900)',
};

const FOOTER: CSSProperties = {
  borderTop: '1px solid var(--color-neutral-900)',
  padding: '9px 16px',
  display: 'flex',
  gap: '14px',
  color: 'var(--color-neutral-700)',
  fontSize: '10.5px',
};

export function Tasks({
  tasks, mail, teamName,
}: {
  tasks: Task[];
  mail: MailMessage[];
  teamName: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div data-testid="tasks" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--color-neutral-900)',
        }}
      >
        <div style={COLUMN_HEAD}>
          <span style={{ width: '44px' }}>TASK</span>
          <span style={{ flex: 1 }}>DESCRIPTION</span>
          <span style={{ width: '92px' }}>STATE</span>
          <span style={{ width: '80px' }}>OWNER</span>
          <span style={{ width: '88px' }}>DEPENDS ON</span>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {tasks.map((task) => {
            const state = TASK_STATUS[task.state];
            return (
              <div
                key={task.id}
                data-testid="task-row"
                style={{
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'baseline',
                  padding: '7px 16px',
                  borderBottom: '1px solid var(--row-hairline)',
                  fontSize: '11.5px',
                  background: hovered === task.id ? 'var(--color-bg)' : 'transparent',
                }}
                onMouseEnter={() => setHovered(task.id)}
                onMouseLeave={() => setHovered((h) => (h === task.id ? null : h))}
              >
                <span style={{ width: '44px', color: 'var(--color-neutral-600)' }}>{task.id}</span>
                <span
                  data-testid="task-description"
                  style={{
                    flex: 1,
                    color: 'var(--color-neutral-300)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {task.subject}
                </span>
                <span
                  data-testid="task-state"
                  style={{
                    width: '92px',
                    display: 'flex',
                    gap: '5px',
                    alignItems: 'baseline',
                    color: state.color,
                  }}
                >
                  <span style={{ fontSize: '10px' }}>{state.glyph}</span>
                  <span>{state.label}</span>
                </span>
                <span data-testid="task-owner" style={{ width: '80px', color: 'var(--color-neutral-500)' }}>
                  {task.owner ?? 'unassigned'}
                </span>
                <span data-testid="task-deps" style={{ width: '88px', color: 'var(--color-neutral-700)' }}>
                  {task.blockedBy.length > 0 ? task.blockedBy.join(' ') : '—'}
                </span>
              </div>
            );
          })}
        </div>

        <div data-testid="tasks-footer" style={FOOTER}>
          <span>{`~/.claude/tasks/${teamName}/`}</span>
          <span style={{ flex: 1 }} />
          <span>claiming is file-locked · completing a task unblocks its dependents</span>
        </div>
      </div>

      <div
        data-testid="mailbox"
        style={{ width: '404px', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' }}
      >
        <div
          style={{
            padding: '10px 14px 8px',
            color: 'var(--color-neutral-700)',
            fontSize: '10.5px',
            letterSpacing: '.12em',
            borderBottom: '1px solid var(--color-neutral-900)',
          }}
        >
          MAILBOX TRAFFIC
        </div>

        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '9px',
            justifyContent: 'flex-end',
          }}
        >
          {mail.map((m) => (
            <div
              key={m.msgId}
              data-testid="mail-entry"
              style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}
            >
              <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline', fontSize: '10.5px' }}>
                <span
                  data-testid="mail-ts"
                  title={m.tsIsDelivery ? 'delivery time — send time unknown' : undefined}
                  style={{ color: 'var(--color-neutral-800)' }}
                >
                  {`${m.tsIsDelivery ? '~' : ''}${clockLabel(m.ts)}`}
                </span>
                <span data-testid="mail-from" style={{ color: 'var(--color-accent-400)' }}>{m.from}</span>
                <span style={{ color: 'var(--color-neutral-700)' }}>→</span>
                <span data-testid="mail-to" style={{ color: 'var(--color-accent-400)' }}>{m.to}</span>
              </div>
              <div
                data-testid="mail-body"
                style={{
                  color: 'var(--color-neutral-500)',
                  fontSize: '11.5px',
                  paddingLeft: '2px',
                  textWrap: 'pretty',
                }}
              >
                {m.protocol ? m.protocol.type : m.text}
              </div>
            </div>
          ))}
        </div>

        <div
          data-testid="mailbox-footer"
          style={{
            borderTop: '1px solid var(--color-neutral-900)',
            padding: '9px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
            color: 'var(--color-neutral-700)',
            fontSize: '10.5px',
          }}
        >
          <span>{`~/.claude/teams/${teamName}/inboxes/`}</span>
          <span>teammates message each other directly — the lead doesn&apos;t relay</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/views/Tasks.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/views/Tasks.tsx src/web/views/Tasks.test.tsx && git commit -m "feat: tasks view with task table and mailbox traffic pane"
```

---

### Task 28: Rail view

**Files:**
- Create: `src/web/views/Rail.tsx`
- Test: `src/web/views/Rail.test.tsx`

**Interfaces:**
- Consumes: `Agent`; `AGENT_STATUS`; `Portrait({ agent, size })`; `StatusGlyph({ status, size })`; `ContextMeter({ agent, fontSize })`; `TranscriptFeed({ lines, size })`; `Composer({ agent, variant })`; `costLabel`, `ctxLabel`, `elapsedLabel`, `pctLabel` from `src/web/format.ts`; `fixtureAgents`, `FIXTURE_NOW`
- Produces: `function Rail(props: { agents: Agent[]; focused: string | null; onFocus: (name: string) => void; now: number }): JSX.Element`

- [ ] **Step 1: Write the failing test**

```tsx
// src/web/views/Rail.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FIXTURE_NOW, fixtureAgents } from '../agents.fixture';
import { Rail } from './Rail';

afterEach(cleanup);

const agents = fixtureAgents();

function renderRail(onFocus = vi.fn(), focused: string | null = 'team-lead') {
  render(<Rail agents={agents} focused={focused} onFocus={onFocus} now={FIXTURE_NOW} />);
  return onFocus;
}

describe('Rail — left list', () => {
  it('is a 348px listbox headed with the team size', () => {
    renderRail();
    expect(screen.getByTestId('rail-left').style.width).toBe('348px');
    expect(screen.getByText('TEAM · 4')).toBeTruthy();
    expect(screen.getByText('click to attach')).toBeTruthy();
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('marks the attached agent with a left selection bar', () => {
    renderRail();
    const rows = screen.getAllByRole('option');
    expect(rows).toHaveLength(4);
    expect(rows[0].getAttribute('aria-selected')).toBe('true');
    expect(rows[0].style.borderLeft).toBe('2px solid var(--color-accent-600)');
    expect(rows[1].getAttribute('aria-selected')).toBe('false');
    expect(rows[1].style.borderLeft).toBe('2px solid transparent');
    expect(rows[0].style.padding).toBe('8px 10px');
  });

  it('renders the two per-row lines for probe-alpha', () => {
    renderRail();
    const alpha = within(screen.getAllByRole('option')[1]);
    expect(alpha.getByTestId('rail-name').textContent).toBe('probe-alpha');
    expect(alpha.getByTestId('rail-type').textContent).toBe('general-purpose');
    expect(alpha.getByTestId('rail-elapsed').textContent).toBe('0m 42s');
    expect(alpha.getByTestId('rail-pct').textContent).toBe('3%');
    expect(alpha.getByTestId('rail-cost').textContent).toBe('≈$0.46');
  });

  it('lists the key legend in the footer', () => {
    renderRail();
    const footer = screen.getByTestId('rail-footer');
    expect(within(footer).getByText('↑↓ select')).toBeTruthy();
    expect(within(footer).getByText('⏎ attach')).toBeTruthy();
    expect(within(footer).getByText('esc interrupt')).toBeTruthy();
  });

  it('moves the cursor with the arrow keys', () => {
    renderRail();
    const listbox = screen.getByRole('listbox');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('rail-option-team-lead');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe('rail-option-probe-alpha');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe('rail-option-probe-bravo');
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe('rail-option-probe-alpha');
  });

  it('does not run the cursor off either end', () => {
    renderRail();
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe('rail-option-team-lead');
    for (let i = 0; i < 8; i += 1) fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe('rail-option-probe-charlie');
  });

  it('attaches the cursor agent on Enter', () => {
    const onFocus = renderRail();
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onFocus).toHaveBeenCalledWith('probe-alpha');
  });

  it('attaches on click too', () => {
    const onFocus = renderRail();
    fireEvent.click(screen.getAllByRole('option')[2]);
    expect(onFocus).toHaveBeenCalledWith('probe-bravo');
  });
});

describe('Rail — attached pane', () => {
  it('heads the pane with the attached agent', () => {
    renderRail(vi.fn(), 'probe-charlie');
    const header = screen.getByTestId('rail-detail-header');
    expect(header.style.padding).toBe('10px 18px');
    expect(within(header).getByTestId('rail-detail-name').textContent).toBe('probe-charlie');
    expect(within(header).getByTestId('rail-detail-type').textContent).toBe('general-purpose');
    expect(within(header).getByTestId('rail-detail-role').textContent).toBe('Spike probe charlie');
    expect(within(header).getByTestId('rail-detail-ctx').textContent).toBe('23.6k / 200k');
    expect(within(header).getByTestId('rail-detail-cost').textContent).toBe('≈$0.04');
  });

  it('renders the attached transcript at rail size and a rail composer', () => {
    renderRail(vi.fn(), 'probe-charlie');
    expect(screen.getAllByTestId('transcript-marker')[0].style.width).toBe('10px');
    expect(screen.getByTestId('composer-input')).toHaveProperty(
      'placeholder', 'message probe-charlie directly',
    );
    expect(screen.getByTestId('composer-caret')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/views/Rail.test.tsx`
Expected: FAIL with `Failed to resolve import "./Rail" from "src/web/views/Rail.test.tsx"`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/web/views/Rail.tsx
import { useState, type KeyboardEvent } from 'react';
import type { Agent } from '../../shared/domain';
import { AGENT_STATUS } from '../../shared/status';
import { Composer } from '../components/Composer';
import { ContextMeter } from '../components/ContextMeter';
import { Portrait } from '../components/Portrait';
import { StatusGlyph } from '../components/StatusGlyph';
import { TranscriptFeed } from '../components/TranscriptFeed';
import { costLabel, ctxLabel, elapsedLabel, pctLabel } from '../format';

export function Rail({
  agents, focused, onFocus, now,
}: {
  agents: Agent[];
  focused: string | null;
  onFocus: (name: string) => void;
  now: number;
}) {
  const startAt = Math.max(0, agents.findIndex((a) => a.name === focused));
  const [cursor, setCursor] = useState(startAt);

  if (agents.length === 0) return null;

  const attached = agents.find((a) => a.name === focused) ?? agents[0];
  const attachedStatus = AGENT_STATUS[attached.status];
  const cursorAgent = agents[Math.min(cursor, agents.length - 1)];

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(agents.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onFocus(cursorAgent.name);
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div
        data-testid="rail-left"
        style={{
          width: '348px',
          borderRight: '1px solid var(--color-neutral-900)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '10px 14px 8px',
            color: 'var(--color-neutral-600)',
            fontSize: '10.5px',
            letterSpacing: '.12em',
          }}
        >
          <span>{`TEAM · ${agents.length}`}</span>
          <span>click to attach</span>
        </div>

        <div
          role="listbox"
          tabIndex={0}
          aria-activedescendant={`rail-option-${cursorAgent.name}`}
          onKeyDown={onListKeyDown}
          style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            padding: '0 8px 8px',
            outline: 'none',
          }}
        >
          {agents.map((agent) => {
            const selected = agent.name === focused;
            return (
              <div
                key={agent.name}
                id={`rail-option-${agent.name}`}
                role="option"
                aria-selected={selected}
                onClick={() => onFocus(agent.name)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'flex-start',
                  background: selected ? 'var(--color-bg)' : 'transparent',
                  borderLeft: `2px solid ${selected ? 'var(--color-accent-600)' : 'transparent'}`,
                }}
              >
                <div style={{ flex: 'none', marginTop: '1px' }}>
                  <Portrait agent={agent} size={24} />
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px' }}>
                    <StatusGlyph status={agent.status} size={10} />
                    <span data-testid="rail-name" style={{ color: 'var(--color-text)', fontWeight: 500 }}>
                      {agent.name}
                    </span>
                    <span
                      data-testid="rail-type"
                      style={{
                        color: 'var(--color-neutral-600)',
                        fontSize: '10.5px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {agent.agentType}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span
                      data-testid="rail-elapsed"
                      style={{ color: 'var(--color-neutral-700)', fontSize: '10.5px' }}
                    >
                      {elapsedLabel(agent.startedAt, now)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                    <ContextMeter agent={agent} fontSize={11} />
                    <span
                      data-testid="rail-pct"
                      style={{ color: 'var(--color-neutral-500)', fontSize: '10.5px' }}
                    >
                      {pctLabel(agent.contextTokens, agent.contextLimit)}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span
                      data-testid="rail-cost"
                      style={{ color: 'var(--color-neutral-600)', fontSize: '10.5px' }}
                    >
                      {costLabel(agent.costUsd)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div
          data-testid="rail-footer"
          style={{
            padding: '9px 16px',
            borderTop: '1px solid var(--color-neutral-900)',
            color: 'var(--color-neutral-700)',
            fontSize: '10.5px',
            display: 'flex',
            gap: '12px',
          }}
        >
          <span>↑↓ select</span>
          <span>⏎ attach</span>
          <span>esc interrupt</span>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <div
          data-testid="rail-detail-header"
          style={{
            padding: '10px 18px',
            borderBottom: '1px solid var(--color-neutral-900)',
            background: 'var(--color-bg)',
            display: 'flex',
            gap: '11px',
            alignItems: 'center',
          }}
        >
          <div style={{ flex: 'none' }}>
            <Portrait agent={attached} size={24} />
          </div>
          <span
            data-testid="rail-detail-name"
            style={{ color: 'var(--color-text)', fontWeight: 500, fontSize: '13px' }}
          >
            {attached.name}
          </span>
          <span
            data-testid="rail-detail-type"
            style={{
              border: '1px solid var(--color-neutral-800)',
              color: 'var(--color-neutral-500)',
              borderRadius: 'var(--radius-sm)',
              padding: '0 5px',
              fontSize: '9.5px',
            }}
          >
            {attached.agentType}
          </span>
          <span style={{ fontSize: '11px', color: attachedStatus.color }}>{attachedStatus.label}</span>
          <span
            data-testid="rail-detail-role"
            style={{
              color: 'var(--color-neutral-600)',
              fontSize: '11px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {attached.role}
          </span>
          <span style={{ flex: 1 }} />
          <ContextMeter agent={attached} fontSize={11.5} />
          <span
            data-testid="rail-detail-ctx"
            style={{ color: 'var(--color-neutral-500)', fontSize: '11px' }}
          >
            {ctxLabel(attached.contextTokens, attached.contextLimit)}
          </span>
          <span
            data-testid="rail-detail-cost"
            style={{ color: 'var(--color-neutral-600)', fontSize: '11px' }}
          >
            {costLabel(attached.costUsd)}
          </span>
        </div>

        <TranscriptFeed lines={attached.transcript} size="rail" />

        <Composer agent={attached} variant="rail" />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/views/Rail.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/views/Rail.tsx src/web/views/Rail.test.tsx && git commit -m "feat: rail view with keyboard-navigable agent listbox"
```

---

### Task 29: Grid view

**Files:**
- Create: `src/web/views/Grid.tsx`
- Test: `src/web/views/Grid.test.tsx`

**Interfaces:**
- Consumes: `Agent`; `Portrait({ agent, size })`; `StatusGlyph({ status, size })`; `ContextMeter({ agent, fontSize })`; `TranscriptFeed({ lines, size })`; `elapsedLabel`, `pctLabel` from `src/web/format.ts`; `fixtureAgents`, `padAgents`, `FIXTURE_NOW`
- Produces: `function Grid(props: { agents: Agent[]; focused: string | null; onFocus: (name: string) => void; now: number }): JSX.Element`

- [ ] **Step 1: Write the failing test**

```tsx
// src/web/views/Grid.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FIXTURE_NOW, fixtureAgents, padAgents } from '../agents.fixture';
import { Grid } from './Grid';

afterEach(cleanup);

const four = fixtureAgents();
const six = padAgents(four, 6);
const seven = padAgents(four, 7);

describe('Grid', () => {
  it('is a 3 × 2 grid', () => {
    render(<Grid agents={six} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const root = screen.getByTestId('grid');
    expect(root.style.display).toBe('grid');
    expect(screen.getAllByTestId('grid-pane')).toHaveLength(6);
    expect(screen.queryByTestId('grid-overflow')).toBeNull();
  });

  it('renders six panes and an overflow count for a seven-agent team', () => {
    render(<Grid agents={seven} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    expect(screen.getAllByTestId('grid-pane')).toHaveLength(6);
    expect(screen.getByTestId('grid-overflow').textContent).toBe('+1 more');
    expect(screen.queryByText('probe-bravo-6')).toBeNull();
  });

  it('renders the two header rows for probe-alpha', () => {
    render(<Grid agents={four} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const alpha = within(screen.getAllByTestId('grid-pane')[1]);
    expect(alpha.getByTestId('grid-name').textContent).toBe('probe-alpha');
    expect(alpha.getByTestId('grid-name').style.fontSize).toBe('12.5px');
    expect(alpha.getByTestId('grid-model').textContent).toBe('claude-opus-5');
    expect(alpha.getByTestId('grid-model').style.fontSize).toBe('10px');
    expect(alpha.getByTestId('grid-pct').textContent).toBe('3%');
    expect(alpha.getByTestId('grid-elapsed').textContent).toBe('0m 42s');
  });

  it('footers each pane with the ellipsised current tool', () => {
    render(<Grid agents={four} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const panes = screen.getAllByTestId('grid-pane');
    const tool = within(panes[1]).getByTestId('grid-tool');
    expect(tool.textContent).toBe('Bash(sleep 20)');
    expect(tool.style.padding).toBe('6px 11px');
    expect(tool.style.fontSize).toBe('10px');
    expect(tool.style.whiteSpace).toBe('nowrap');
    expect(tool.style.textOverflow).toBe('ellipsis');
    expect(within(panes[3]).getByTestId('grid-tool').textContent).toBe('');
  });

  it('renders the transcript at grid size', () => {
    render(<Grid agents={four} focused={null} onFocus={vi.fn()} now={FIXTURE_NOW} />);
    const marker = screen.getAllByTestId('transcript-marker')[0];
    expect(marker.style.width).toBe('8px');
    expect(marker.style.fontSize).toBe('10px');
  });

  it('focuses a pane on click', () => {
    const onFocus = vi.fn();
    render(<Grid agents={four} focused={null} onFocus={onFocus} now={FIXTURE_NOW} />);
    fireEvent.click(screen.getAllByTestId('grid-pane')[2]);
    expect(onFocus).toHaveBeenCalledWith('probe-bravo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/views/Grid.test.tsx`
Expected: FAIL with `Failed to resolve import "./Grid" from "src/web/views/Grid.test.tsx"`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/web/views/Grid.tsx
import type { KeyboardEvent } from 'react';
import type { Agent } from '../../shared/domain';
import { ContextMeter } from '../components/ContextMeter';
import { Portrait } from '../components/Portrait';
import { StatusGlyph } from '../components/StatusGlyph';
import { TranscriptFeed } from '../components/TranscriptFeed';
import { elapsedLabel, pctLabel } from '../format';

const PANES = 6;

export function Grid({
  agents, focused, onFocus, now,
}: {
  agents: Agent[];
  focused: string | null;
  onFocus: (name: string) => void;
  now: number;
}) {
  const shown = agents.slice(0, PANES);
  const overflow = agents.length - shown.length;

  return (
    <div
      data-testid="grid"
      style={{
        flex: 1,
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: 'repeat(3,1fr)',
        gridTemplateRows: 'repeat(2,1fr)',
        gap: '1px',
        background: 'var(--color-neutral-900)',
        minHeight: 0,
      }}
    >
      {shown.map((agent) => {
        function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onFocus(agent.name);
          }
        }

        return (
          <div
            key={agent.name}
            data-testid="grid-pane"
            role="button"
            tabIndex={0}
            aria-current={agent.name === focused}
            onClick={() => onFocus(agent.name)}
            onKeyDown={onKeyDown}
            style={{
              background: '#12141f',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              minWidth: 0,
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: '9px',
                alignItems: 'center',
                padding: '8px 11px',
                background: 'var(--color-bg)',
                borderBottom: '1px solid var(--color-neutral-900)',
              }}
            >
              <div style={{ flex: 'none' }}>
                <Portrait agent={agent} size={24} />
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline' }}>
                  <StatusGlyph status={agent.status} size={10} />
                  <span
                    data-testid="grid-name"
                    style={{ color: 'var(--color-text)', fontWeight: 500, fontSize: '12.5px' }}
                  >
                    {agent.name}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span
                    data-testid="grid-model"
                    style={{ color: 'var(--color-neutral-700)', fontSize: '10px' }}
                  >
                    {agent.model}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '7px', alignItems: 'baseline' }}>
                  <ContextMeter agent={agent} fontSize={10.5} />
                  <span
                    data-testid="grid-pct"
                    style={{ color: 'var(--color-neutral-600)', fontSize: '10px' }}
                  >
                    {pctLabel(agent.contextTokens, agent.contextLimit)}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span
                    data-testid="grid-elapsed"
                    style={{ color: 'var(--color-neutral-700)', fontSize: '10px' }}
                  >
                    {elapsedLabel(agent.startedAt, now)}
                  </span>
                </div>
              </div>
            </div>

            <TranscriptFeed lines={agent.transcript} size="grid" />

            <div
              data-testid="grid-tool"
              style={{
                borderTop: '1px solid var(--color-neutral-900)',
                padding: '6px 11px',
                color: 'var(--color-neutral-700)',
                fontSize: '10px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {agent.currentTool ?? ''}
            </div>
          </div>
        );
      })}

      {overflow > 0 && (
        <span
          data-testid="grid-overflow"
          style={{
            position: 'absolute',
            right: '10px',
            bottom: '8px',
            border: '1px dashed var(--color-neutral-800)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 7px',
            color: 'var(--color-neutral-700)',
            fontSize: '10.5px',
            background: 'var(--color-bg)',
          }}
        >
          {`+${overflow} more`}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/views/Grid.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/views/Grid.tsx src/web/views/Grid.test.tsx && git commit -m "feat: grid view with six panes and an overflow count"
```

---


### Task 30: Lifecycle launcher — the console starts only when a team exists

Implements spec §5.4 and success criterion #0. The console is not a daemon: a `PostToolUse` hook with matcher `Agent` runs a thin shell launcher after every agent spawn, does nothing unless a real team exists, and otherwise starts the server and prints the link into the operator's session.

> **Do not use `SubagentStart` here.** It runs inside the spawning agent's context, where the hook-result generator filters yielded fields to a whitelist that excludes `systemMessage` — the link is silently stripped. Verified empirically: under `SubagentStart` the message appears only in the raw `hook_response` envelope, never to the user. `PostToolUse` runs in the lead's own context and renders as `{"type":"system","subtype":"informational","content":"PostToolUse:Agent says: …"}`.

**Files:**
- Create: `bin/console-launch.sh`
- Create: `src/server/lifecycle.ts`
- Test: `src/server/lifecycle.test.ts`
- Modify: `src/server/setup.ts` (add the `PostToolUse`/`Agent` launcher entry to `hookBlock`)
- Modify: `src/server/http.ts` (add `GET /health`)
- Modify: `src/server/ingest/hooks.ts` (exit on SessionEnd)
- Modify: `src/server/index.ts` (start the idle reaper)

**Interfaces:**
- Consumes: `hookBlock(port: number)` from `src/server/setup.ts`; `createHttpServer`, `listen` from `src/server/http.ts`; `readJsonSafe` from `src/server/watch/jsonfile.ts`
- Produces:
  - `teamNameFromSessionId(sessionId: string): string`
  - `hasLiveTeam(teamsRoot: string, teamName: string): Promise<boolean>`
  - `startIdleReaper(opts: { teamsRoot: string; graceMs: number; onIdle(): void }): { stop(): void }`
  - `LAUNCH_SCRIPT` (absolute path constant used by `hookBlock`)

---

- [ ] **Step 1: Write the failing test for the pure lifecycle helpers**

```ts
// src/server/lifecycle.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { teamNameFromSessionId, hasLiveTeam } from './lifecycle.js';

const run = promisify(execFile);
let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'octo-life-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function writeTeam(name: string, memberNames: string[]) {
  const teamDir = path.join(dir, name);
  await fs.mkdir(teamDir, { recursive: true });
  await fs.writeFile(
    path.join(teamDir, 'config.json'),
    JSON.stringify({
      name,
      createdAt: 1787798107581,
      leadAgentId: `team-lead@${name}`,
      leadSessionId: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283',
      members: memberNames.map((n, i) => ({
        agentId: `${n}@${name}`,
        name: n,
        joinedAt: 1787798107581 + i,
        tmuxPaneId: n === 'team-lead' ? 'leader' : 'in-process',
        subscriptions: [],
        backendType: 'in-process',
      })),
    }),
  );
}

describe('teamNameFromSessionId', () => {
  it('takes the first eight characters, matching the CLI rule', () => {
    expect(teamNameFromSessionId('98b0b4a7-3206-455b-aaf6-a5a81ad1e283')).toBe('session-98b0b4a7');
    expect(teamNameFromSessionId('5cd370e5-2d86-4b64-878e-095f726aea82')).toBe('session-5cd370e5');
  });

  it('returns an empty string for a missing or short id rather than a bogus team', () => {
    expect(teamNameFromSessionId('')).toBe('');
    expect(teamNameFromSessionId('abc')).toBe('');
  });
});

describe('hasLiveTeam', () => {
  it('is false when the team directory does not exist', async () => {
    expect(await hasLiveTeam(dir, 'session-deadbeef')).toBe(false);
  });

  it('is false for a lead-only roster — an ordinary subagent must not wake the console', async () => {
    await writeTeam('session-98b0b4a7', ['team-lead']);
    expect(await hasLiveTeam(dir, 'session-98b0b4a7')).toBe(false);
  });

  it('is true once a real teammate has joined', async () => {
    await writeTeam('session-98b0b4a7', ['team-lead', 'probe-alpha']);
    expect(await hasLiveTeam(dir, 'session-98b0b4a7')).toBe(true);
  });

  it('matches the captured 4-member fixture', async () => {
    const real = JSON.parse(
      await fs.readFile(new URL('../../fixtures/config-4-members.json', import.meta.url), 'utf8'),
    );
    expect(real.members).toHaveLength(4);
    const teamDir = path.join(dir, real.name);
    await fs.mkdir(teamDir, { recursive: true });
    await fs.writeFile(path.join(teamDir, 'config.json'), JSON.stringify(real));
    expect(await hasLiveTeam(dir, real.name)).toBe(true);
  });

  it('is false on a torn or malformed config rather than throwing', async () => {
    const teamDir = path.join(dir, 'session-98b0b4a7');
    await fs.mkdir(teamDir, { recursive: true });
    await fs.writeFile(path.join(teamDir, 'config.json'), '{"members":[{"na');
    expect(await hasLiveTeam(dir, 'session-98b0b4a7')).toBe(false);
  });
});

describe('bin/console-launch.sh', () => {
  const script = path.resolve('bin/console-launch.sh');

  async function launch(payload: unknown, teamsRoot: string) {
    const { stdout } = await run(script, [], {
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: teamsRoot,
        OCTO_PORT: '4899',
        OCTO_NO_SPAWN: '1', // test hook: never actually start a server
      },
      input: JSON.stringify(payload),
    } as never);
    return stdout.trim();
  }

  it('prints {} and exits 0 for a lead-only roster', async () => {
    await fs.mkdir(path.join(dir, 'teams'), { recursive: true });
    await writeTeamUnder(path.join(dir, 'teams'), 'session-98b0b4a7', ['team-lead']);
    const out = await launch(
      { hook_event_name: 'PostToolUse', tool_name: 'Agent', session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283', agent_id: 'a9f20a34', agent_type: 'general-purpose' },
      dir,
    );
    expect(out).toBe('{}');
  });

  it('announces the link once a teammate has joined', async () => {
    await fs.mkdir(path.join(dir, 'teams'), { recursive: true });
    await writeTeamUnder(path.join(dir, 'teams'), 'session-98b0b4a7', ['team-lead', 'probe-alpha']);
    const out = await launch(
      { hook_event_name: 'PostToolUse', tool_name: 'Agent', session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283', agent_id: 'probe-alpha@session-98b0b4a7', agent_type: 'teammate' },
      dir,
    );
    expect(JSON.parse(out).systemMessage).toBe(
      'Agent teams console → http://127.0.0.1:4899/?team=session-98b0b4a7',
    );
  });

  it('announces only once per team', async () => {
    await fs.mkdir(path.join(dir, 'teams'), { recursive: true });
    await writeTeamUnder(path.join(dir, 'teams'), 'session-98b0b4a7', ['team-lead', 'a', 'b']);
    const payload = { hook_event_name: 'PostToolUse', tool_name: 'Agent', session_id: '98b0b4a7-3206-455b-aaf6-a5a81ad1e283', agent_id: 'a@session-98b0b4a7', agent_type: 'teammate' };
    const first = await launch(payload, dir);
    const second = await launch(payload, dir);
    expect(JSON.parse(first).systemMessage).toContain('http://127.0.0.1:4899');
    expect(second).toBe('{}');
  });

  it('exits 0 with {} on garbage input — a broken console must never fail a spawn', async () => {
    const { stdout } = await run(script, [], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: dir, OCTO_PORT: '4899', OCTO_NO_SPAWN: '1' },
      input: 'not json at all',
    } as never);
    expect(stdout.trim()).toBe('{}');
  });
});

async function writeTeamUnder(root: string, name: string, memberNames: string[]) {
  const teamDir = path.join(root, name);
  await fs.mkdir(teamDir, { recursive: true });
  await fs.writeFile(
    path.join(teamDir, 'config.json'),
    JSON.stringify({
      name,
      members: memberNames.map((n) => ({ agentId: `${n}@${name}`, name: n, subscriptions: [] })),
    }),
  );
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/server/lifecycle.test.ts`

Expected: FAIL with `Failed to resolve import "./lifecycle.js"`, and the shell-script tests failing with `ENOENT ... bin/console-launch.sh`.

- [ ] **Step 3: Write the lifecycle helpers**

```ts
// src/server/lifecycle.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the PostToolUse(Agent) launcher, used by hookBlock(). */
export const LAUNCH_SCRIPT = fileURLToPath(new URL('../../bin/console-launch.sh', import.meta.url));

/**
 * The CLI derives the team name from the lead session id. Verified rule:
 * teamName = "session-" + sessionId.slice(0, 8).
 */
export function teamNameFromSessionId(sessionId: string): string {
  if (!sessionId || sessionId.length < 8) return '';
  return `session-${sessionId.slice(0, 8)}`;
}

/**
 * A team "exists" only once a real teammate has joined. Ordinary Agent-tool
 * subagents and workflow fan-outs never appear in members[] — verified during
 * the capture spike, where six workflow subagents were live and members[] still
 * held only the lead. A torn read is treated as "no team", never as an error.
 */
export async function hasLiveTeam(teamsRoot: string, teamName: string): Promise<boolean> {
  if (!teamName) return false;
  const configPath = path.join(teamsRoot, teamName, 'config.json');
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as { members?: unknown[] };
    return Array.isArray(parsed.members) && parsed.members.length >= 2;
  } catch {
    return false;
  }
}

/**
 * Exits the process once no team has been live for `graceMs`. Belt-and-braces
 * against a crashed session leaving the server running: the SessionEnd hook is
 * the primary shutdown path, this is the backstop.
 */
export function startIdleReaper(opts: {
  teamsRoot: string;
  graceMs: number;
  onIdle(): void;
}): { stop(): void } {
  let idleSince: number | null = null;
  const timer = setInterval(async () => {
    let any = false;
    try {
      for (const entry of await fs.readdir(opts.teamsRoot)) {
        if (await hasLiveTeam(opts.teamsRoot, entry)) {
          any = true;
          break;
        }
      }
    } catch {
      any = false;
    }
    if (any) {
      idleSince = null;
      return;
    }
    idleSince ??= Date.now();
    if (Date.now() - idleSince >= opts.graceMs) {
      clearInterval(timer);
      opts.onIdle();
    }
  }, 30_000);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
    },
  };
}
```

- [ ] **Step 4: Write the launcher script**

```sh
#!/bin/sh
# PostToolUse(Agent) launcher for the Agent Teams Console.
#
# CONTRACT: this runs inside a hook that BLOCKS the turn. It must
# always print valid JSON on stdout and always exit 0. A broken console must
# never fail a spawn.
#
# It wakes the console only when a real team exists — that is, when the team's
# config.json carries two or more members. Ordinary Agent-tool subagents and
# workflow fan-outs do not appear in members[], so they cost one shell spawn
# and nothing else.
set -u

PORT="${OCTO_PORT:-4823}"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
ROOT="${OCTO_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
HEALTH="http://127.0.0.1:$PORT/health"

bail() { echo '{}'; exit 0; }

payload=$(cat 2>/dev/null) || bail
[ -n "$payload" ] || bail

session=$(printf '%s' "$payload" \
  | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  | head -1)
[ -n "$session" ] || bail

# teamName = "session-" + first 8 of the lead session id
short=$(printf '%s' "$session" | cut -c1-8)
[ ${#short} -eq 8 ] || bail
team="session-$short"

config="$CLAUDE_DIR/teams/$team/config.json"
[ -f "$config" ] || bail

# Count members without a JSON parser: one "agentId" key per member.
members=$(tr -d ' \n' < "$config" 2>/dev/null | grep -o '"agentId"' | wc -l | tr -d ' ')
[ "${members:-0}" -ge 2 ] 2>/dev/null || bail

# Start the server if it is not already answering.
if ! curl -sf -m 1 "$HEALTH" >/dev/null 2>&1; then
  if [ "${OCTO_NO_SPAWN:-}" != "1" ]; then
    # Prefer the bundle (fast cold start). Fall back to tsx when it has not
    # been built, so a fresh checkout still works without `npm run build`.
    if [ -f "$ROOT/dist/server/index.js" ]; then
      nohup node "$ROOT/dist/server/index.js" --port "$PORT" \
        >>"$CLAUDE_DIR/agent-teams-console.log" 2>&1 &
    else
      nohup npx --prefix "$ROOT" tsx "$ROOT/src/server/index.ts" --port "$PORT" \
        >>"$CLAUDE_DIR/agent-teams-console.log" 2>&1 &
    fi
    i=0
    while [ "$i" -lt 15 ]; do
      curl -sf -m 1 "$HEALTH" >/dev/null 2>&1 && break
      sleep 0.1
      i=$((i + 1))
    done
  fi
fi

# Announce once per team, not once per teammate.
marker="$CLAUDE_DIR/teams/$team/.console-announced"
[ -f "$marker" ] && bail
: > "$marker" 2>/dev/null || bail

printf '{"systemMessage":"Agent teams console → http://127.0.0.1:%s/?team=%s"}\n' "$PORT" "$team"
exit 0
```

Make it executable:

```bash
chmod +x bin/console-launch.sh
```

- [ ] **Step 5: Add `GET /health` to the HTTP surface**

The launcher polls this to decide whether it needs to start a server. It must
answer before any team exists, so it reads `deps.state()` defensively.

```ts
// src/server/http.ts — inside createHttpServer's router, before the /api/* routes
if (method === 'GET' && route === '/health') {
  const s = deps.state();
  return json(res, 200, { ok: true, team: s.teamName, agents: s.agents.length });
}
```

- [ ] **Step 6: Shut down on SessionEnd inside the existing hook handler**

Task 17's `hookBlock` already subscribes `SessionEnd` over http to `/hook`, so no
new hook entry is needed — the handler just has to act on it. Shutdown is deferred
past the response so the hook does not see a dropped connection.

```ts
// src/server/ingest/hooks.ts — in the /hook handler, after the event is stored
if (event.hook_event_name === 'SessionEnd') {
  // Respond first; a hook that never gets its 200 stalls the session's exit.
  setTimeout(() => {
    console.error('[octo] session ended — exiting');
    process.exit(0);
  }, 250);
}
```

- [ ] **Step 7: Add the PostToolUse launcher to `hookBlock`**

This is the one entry that must be a **command** hook rather than http: its whole
job is to start the server when nothing is listening, which an http hook by
definition cannot do. That means widening `HookEntry.hooks` to a union.

```ts
// src/server/setup.ts
import { LAUNCH_SCRIPT } from './lifecycle.js';

export const LAUNCH_HOOK_TIMEOUT_MS = 5000;

export interface CommandHook {
  type: 'command';
  command: string;
  timeout: number;
}
export interface HookEntry {
  matcher?: string;
  hooks: Array<HttpHook | CommandHook>;   // widened from HttpHook[]
}

export function hookBlock(port: number): HookBlock {
  const hooks: Record<string, HookEntry[]> = {};
  for (const event of HOOK_EVENTS) {
    const entry: HookEntry = {
      hooks: [
        {
          type: 'http',
          url: `http://127.0.0.1:${port}/hook`,
          timeout: event === 'PermissionRequest' ? PERMISSION_HOOK_TIMEOUT_MS : HOOK_TIMEOUT_MS,
        },
      ],
    };
    if (MATCHER_EVENTS.has(event)) entry.matcher = '*';
    hooks[event] = [entry];
  }

  // The launcher runs on EVERY Agent spawn and exits immediately unless a real
  // team exists, so its cost on the common path is one shell process.
  // It must be PostToolUse, not SubagentStart: SubagentStart runs in the
  // spawned agent's context, where systemMessage is filtered out of the hook
  // result and the link never reaches the operator. PostToolUse also fires
  // AFTER the spawn returns, so config.json already lists the new member.
  hooks.PostToolUse = [
    ...(hooks.PostToolUse ?? []),
    {
      matcher: 'Agent',
      hooks: [{ type: 'command', command: LAUNCH_SCRIPT, timeout: LAUNCH_HOOK_TIMEOUT_MS }],
    },
  ];

  return {
    hooks,
    statusLine: { type: 'command', command: post(port, 'statusline'), refreshInterval: 5 },
    subagentStatusLine: { type: 'command', command: post(port, 'substatus') },
  };
}
```

Extend `isConsoleEntry` so `uninstall` removes the launcher too:

```ts
function isConsoleEntry(entry: unknown): boolean {
  const hooks = (entry as HookEntry | undefined)?.hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some(
    (h) =>
      (h?.type === 'http' && typeof h.url === 'string' && CONSOLE_HOOK_URL.test(h.url)) ||
      (h?.type === 'command' && typeof h.command === 'string' && h.command.endsWith('console-launch.sh')),
  );
}
```

Add to `src/server/setup.test.ts`:

```ts
it('registers the launcher as a PostToolUse:Agent command hook with an explicit timeout', () => {
  const block = hookBlock(4823);
  const entry = block.hooks.PostToolUse.find((e) => e.matcher === 'Agent');
  expect(entry).toBeDefined();
  expect(entry!.hooks[0]).toMatchObject({ type: 'command', timeout: 5000 });
  expect((entry!.hooks[0] as CommandHook).command).toMatch(/console-launch\.sh$/);
});

it('does not register a SubagentStart hook — systemMessage is stripped there', () => {
  expect(hookBlock(4823).hooks.SubagentStart).toBeUndefined();
});

it('uninstall removes the launcher as well as the http hooks', () => {
  const installed = mergeHookBlock({}, 4823);
  const cleaned = removeHookBlock(installed) as { hooks?: Record<string, unknown[]> };
  expect(cleaned.hooks?.PostToolUse ?? []).toHaveLength(0);
});
```

- [ ] **Step 7: Wire the idle reaper into the server entry**

```ts
// src/server/index.ts — after listen()
import { startIdleReaper } from './lifecycle.js';

const IDLE_GRACE_MS = 10 * 60 * 1000;

startIdleReaper({
  teamsRoot: path.join(claudeDir, 'teams'),
  graceMs: IDLE_GRACE_MS,
  onIdle: () => {
    console.error('[octo] no live team for 10 minutes — exiting');
    process.exit(0);
  },
});
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/server/lifecycle.test.ts src/server/setup.test.ts`

Expected: PASS. In particular `hasLiveTeam` must be `false` for the lead-only roster and `true` for the captured 4-member fixture, and the launcher must print `{}` twice for the same team after its first announcement.

- [ ] **Step 9: Verify the launcher by hand against the real hook payload shape**

```bash
# Should print {} — no team on this session id
echo '{"hook_event_name":"PostToolUse","tool_name":"Agent","session_id":"deadbeef-0000-0000-0000-000000000000","agent_type":"general-purpose"}' \
  | OCTO_NO_SPAWN=1 ./bin/console-launch.sh

# Should print the systemMessage if a real team is live right now
echo "{\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Agent\",\"session_id\":\"$(ls -1t ~/.claude/teams | head -1 | sed 's/^session-//')0000-0000-0000-000000000000\"}" \
  | OCTO_NO_SPAWN=1 ./bin/console-launch.sh
```

Expected: the first prints `{}`. The second prints `{}` too unless a team with ≥2 members exists, in which case it prints the `systemMessage` JSON.

- [ ] **Step 10: Commit**

```bash
git add bin/console-launch.sh src/server/lifecycle.ts src/server/lifecycle.test.ts \
        src/server/setup.ts src/server/http.ts src/server/index.ts
git commit -m "feat: start the console from a PostToolUse(Agent) hook only when a team exists"
```

---


### Task 31: Keyboard interaction and the acceptance run

**Files:**
- Create: `src/web/state/useKeyboard.ts`
- Create: `docs/ACCEPTANCE.md`
- Test: `src/web/state/useKeyboard.test.tsx`

**Interfaces:**
- Consumes: `ViewId` from `src/shared/domain.ts`; the control endpoints `POST /api/agents/:name/interrupt` and `POST /api/agents/:name/stop` (Task 1-23 server), invoked by the `interrupt` / `stop` callbacks the caller supplies
- Produces: `interface KeyboardActions { agents: string[]; view: ViewId; focused: string | null; setFocused(name: string): void; setView(view: ViewId): void; interrupt(name: string): void; stop(name: string): void }` and `function useKeyboard(actions: KeyboardActions): void`

- [ ] **Step 1: Write the failing test**

```tsx
// src/web/state/useKeyboard.test.tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ViewId } from '../../shared/domain';
import { useKeyboard, type KeyboardActions } from './useKeyboard';

afterEach(cleanup);

// The wall column order for the captured spike team.
const AGENTS = ['team-lead', 'probe-alpha', 'probe-bravo', 'probe-charlie'];

let actions: KeyboardActions;

function Harness({ actions: a }: { actions: KeyboardActions }) {
  useKeyboard(a);
  return <textarea data-testid="composer" />;
}

function mount(overrides: Partial<KeyboardActions> = {}) {
  actions = {
    agents: AGENTS,
    view: 'wall' as ViewId,
    focused: 'probe-alpha',
    setFocused: vi.fn(),
    setView: vi.fn(),
    interrupt: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  };
  render(<Harness actions={actions} />);
  return actions;
}

beforeEach(() => vi.clearAllMocks());

describe('useKeyboard — wall navigation', () => {
  it('l jumps to the next column', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'l' });
    expect(actions.setFocused).toHaveBeenCalledWith('probe-bravo');
  });

  it('h jumps to the previous column', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'h' });
    expect(actions.setFocused).toHaveBeenCalledWith('team-lead');
  });

  it('clamps at both ends of the wall', () => {
    mount({ focused: 'team-lead' });
    fireEvent.keyDown(document.body, { key: 'h' });
    expect(actions.setFocused).toHaveBeenCalledWith('team-lead');
    vi.clearAllMocks();
    cleanup();

    mount({ focused: 'probe-charlie' });
    fireEvent.keyDown(document.body, { key: 'l' });
    expect(actions.setFocused).toHaveBeenCalledWith('probe-charlie');
  });
});

describe('useKeyboard — view switching', () => {
  it('⌘1-5 select the five views in switcher order', () => {
    mount();
    for (const [key, view] of [
      ['1', 'wall'], ['2', 'overview'], ['3', 'tasks'], ['4', 'rail'], ['5', 'grid'],
    ] as Array<[string, ViewId]>) {
      fireEvent.keyDown(document.body, { key, metaKey: true });
      expect(actions.setView).toHaveBeenCalledWith(view);
    }
    expect(actions.setView).toHaveBeenCalledTimes(5);
  });

  it('⌘6 is not a view', () => {
    mount();
    fireEvent.keyDown(document.body, { key: '6', metaKey: true });
    expect(actions.setView).not.toHaveBeenCalled();
  });

  it('⌃T opens the tasks view and toggles back to the wall', () => {
    mount({ view: 'wall' });
    fireEvent.keyDown(document.body, { key: 't', ctrlKey: true });
    expect(actions.setView).toHaveBeenCalledWith('tasks');
    cleanup();

    mount({ view: 'tasks' });
    fireEvent.keyDown(document.body, { key: 't', ctrlKey: true });
    expect(actions.setView).toHaveBeenCalledWith('wall');
  });
});

describe('useKeyboard — per-agent control', () => {
  it('Esc interrupts the focused teammate', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(actions.interrupt).toHaveBeenCalledWith('probe-alpha');
  });

  it('x stops the focused teammate', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'x' });
    expect(actions.stop).toHaveBeenCalledWith('probe-alpha');
  });

  it('does nothing when no agent is focused', () => {
    mount({ focused: null });
    fireEvent.keyDown(document.body, { key: 'x' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(actions.stop).not.toHaveBeenCalled();
    expect(actions.interrupt).not.toHaveBeenCalled();
  });
});

describe('useKeyboard — composer scoping', () => {
  it('does not stop the agent when x is typed into the composer', () => {
    mount();
    const composer = screen.getByTestId('composer');
    composer.focus();
    fireEvent.keyDown(composer, { key: 'x' });
    expect(actions.stop).not.toHaveBeenCalled();
  });

  it('leaves h, l and Esc alone inside the composer', () => {
    mount();
    const composer = screen.getByTestId('composer');
    composer.focus();
    fireEvent.keyDown(composer, { key: 'h' });
    fireEvent.keyDown(composer, { key: 'l' });
    fireEvent.keyDown(composer, { key: 'Escape' });
    expect(actions.setFocused).not.toHaveBeenCalled();
    expect(actions.interrupt).not.toHaveBeenCalled();
  });

  it('leaves ⌘1-5 and ⌃T alone inside the composer', () => {
    mount();
    const composer = screen.getByTestId('composer');
    composer.focus();
    fireEvent.keyDown(composer, { key: '3', metaKey: true });
    fireEvent.keyDown(composer, { key: 't', ctrlKey: true });
    expect(actions.setView).not.toHaveBeenCalled();
  });

  it('still fires when focus is outside any editable element', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'x' });
    expect(actions.stop).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/state/useKeyboard.test.tsx`
Expected: FAIL with `Failed to resolve import "./useKeyboard" from "src/web/state/useKeyboard.test.tsx"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/web/state/useKeyboard.ts
import { useEffect } from 'react';
import type { ViewId } from '../../shared/domain';

const VIEW_ORDER: ViewId[] = ['wall', 'overview', 'tasks', 'rail', 'grid'];

export interface KeyboardActions {
  agents: string[];
  view: ViewId;
  focused: string | null;
  setFocused(name: string): void;
  setView(view: ViewId): void;
  interrupt(name: string): void;
  stop(name: string): void;
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.isContentEditable === true;
}

export function useKeyboard(actions: KeyboardActions): void {
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (isEditable(e.target)) return;

      if (e.metaKey) {
        if (e.ctrlKey || e.altKey) return;
        const view = VIEW_ORDER[Number(e.key) - 1];
        if (view) {
          e.preventDefault();
          actions.setView(view);
        }
        return;
      }

      if (e.ctrlKey) {
        if (e.altKey) return;
        if (e.key === 't' || e.key === 'T') {
          e.preventDefault();
          actions.setView(actions.view === 'tasks' ? 'wall' : 'tasks');
        }
        return;
      }

      if (e.altKey) return;

      if (e.key === 'h' || e.key === 'l') {
        if (actions.agents.length === 0) return;
        e.preventDefault();
        const at = actions.focused ? actions.agents.indexOf(actions.focused) : 0;
        const from = at < 0 ? 0 : at;
        const next = Math.min(actions.agents.length - 1, Math.max(0, from + (e.key === 'l' ? 1 : -1)));
        actions.setFocused(actions.agents[next]);
        return;
      }

      if (!actions.focused) return;

      if (e.key === 'Escape') {
        actions.interrupt(actions.focused);
      } else if (e.key === 'x') {
        actions.stop(actions.focused);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/web/state/useKeyboard.test.tsx && npx vitest run`
Expected: PASS — the scoped keyboard suite, then the whole suite green.

- [ ] **Step 5: Write the acceptance checklist**

```bash
cat > docs/ACCEPTANCE.md <<'EOF'
# Agent Teams Console — manual acceptance

Covers the five success criteria in `docs/superpowers/specs/2026-08-27-agent-teams-console-design.md` §1.
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is already set in `~/.claude/settings.json`.

## 0. Bring the console up

```bash
cd /Users/alanoliv/code/agents-team-ui
npm install
npm run setup            # prints the hook + statusLine block, writes ~/.claude/settings.json on confirm
npm run dev              # vite on 5173, server on 127.0.0.1:4823
open http://127.0.0.1:5173/
```

`npm run setup` must be run once before the first acceptance pass and never as a
side effect of `npm run dev`. `npm run uninstall` removes the block afterwards.

## 1. Spawn a real team

In a second terminal:

```bash
cd /Users/alanoliv/code/agents-team-ui
claude
```

Give the lead this prompt verbatim — it reproduces the corpus in `fixtures/`:

> Spawn three in-process teammates on this team, then wait for all three to report.
> Create two tasks first: id 1 "SPIKE probe A — report your identity" and id 2
> "SPIKE probe B — report your identity".
>
> probe-alpha (general-purpose, opus): You are a throwaway probe for a 2-minute
> data-capture spike. Do EXACTLY these steps and nothing else. Do not read or write
> any project files. 1. Run: `sleep 10` 2. Call TaskList, then TaskUpdate on task id
> "1" setting owner to your own agent name and status to "in_progress". 3. Run:
> `sleep 15` 4. Call SendMessage with to="team-lead", summary="probe-alpha claimed
> task 1", message="probe-alpha reporting: I claimed task 1. This is spike traffic."
> 5. Run: `sleep 20` 6. Call TaskUpdate on task id "1" setting status to
> "completed". 7. Return the single line: `probe-alpha done`
>
> probe-bravo (Explore, opus): same shape, but task id "2", and at step 4 send
> to="probe-alpha" with summary="bravo greets alpha", then a second SendMessage
> to="team-lead" with summary="probe-bravo claimed task 2".
>
> probe-charlie (general-purpose, model haiku): 1. Run: `sleep 14` 2. Call
> SendMessage with to="team-lead", summary="probe-charlie alive",
> message="probe-charlie reporting: running on a different model so the console can
> prove per-agent model resolution." 3. Run: `sleep 30` 4. Return the single line:
> `probe-charlie done`

Confirm the team exists on disk:

```bash
TEAM=$(ls -t ~/.claude/teams | head -1); echo "$TEAM"
jq -r '.members[].name' ~/.claude/teams/"$TEAM"/config.json
```

Expected: `team-lead`, `probe-alpha`, `probe-bravo`, `probe-charlie`.

## 2. Criterion 1 — the wall is live

- [ ] The wall shows four columns; `team-lead` is leftmost.
- [ ] Scroll the wall right: the `team-lead` column stays pinned at x = 0 with its
      right-edge shadow over the scrolling columns.
- [ ] Each teammate column shows a moving transcript with no manual refresh, and
      the transcript is bottom-anchored (newest line at the bottom edge).
- [ ] `probe-charlie`'s context line reads `… / 200k`; the opus teammates read
      `… / 1M`. This proves per-agent model resolution from the transcript.
- [ ] Each column's cost reads `≈$…` and grows while the teammate works.
- [ ] Each column's current-tool row shows the live tool, e.g. `Bash(sleep 20)`,
      and goes blank when the teammate is idle.
- [ ] The status bar's `tasks n/m`, total tokens, ASCII meter, elapsed and
      `5h …% · 7d …%` all update without a refresh.

## 3. Criterion 2 — ⌘⏎ delivers a message

- [ ] Click into the `probe-alpha` column composer, type
      `acknowledge this console message in your final line`, press `⌘⏎`.
- [ ] The composer clears immediately.
- [ ] Within one second the message is on disk (teammates poll every 500 ms, so
      catching it requires a tight loop):

```bash
TEAM=$(ls -t ~/.claude/teams | head -1)
for i in $(seq 1 40); do
  jq -c '.[] | {from, text}' ~/.claude/teams/"$TEAM"/inboxes/probe-alpha.json 2>/dev/null
  sleep 0.05
done
```

- [ ] Expected at least one line with `"from":"team-lead"` and the text typed.
- [ ] The tasks view's MAILBOX TRAFFIC pane shows `team-lead → probe-alpha` with
      that body and the SENT clock time.
- [ ] `probe-alpha`'s transcript picks the message up and its reply mentions it.
      This is the end-to-end proof the teammate actually received it.

## 4. Criterion 3 — a plan approval releases

Spawn a fourth teammate with plan mode required:

> Spawn one more in-process teammate named `probe-plan` with planModeRequired
> true, and give it: "Write a plan (do not execute) for deleting
> `migrations/legacy/`. Present the plan for approval and stop."

- [ ] A card appears in the NEEDS YOU strip: `probe-plan · plan approval`, amber
      `#d99e5c` text inside a `#6b4f2c` border, with the plan summary ellipsised.
- [ ] `probe-plan`'s status glyph is `▲` and its status label reads
      `plan approval`.
- [ ] Click `approve`. The card disappears and `probe-plan` resumes within one
      turn boundary.
- [ ] Repeat with `reject with feedback`, entering `not this sprint` — the
      teammate's transcript shows the feedback.

## 5. Criterion 4 — five views, immovable chrome

Press `⌘1` … `⌘5` in turn, with focus outside the composer.

- [ ] `⌘1` wall · `⌘2` overview · `⌘3` tasks · `⌘4` rail · `⌘5` grid.
- [ ] The status bar, NEEDS YOU strip and PANEL footer do not move, resize or
      re-order between any two views. Screenshot the top 40 px and bottom 60 px in
      each view and compare.
- [ ] `⌃T` from the wall opens tasks; `⌃T` again returns to the wall.
- [ ] `h` and `l` move the focused wall column; the focused column is tinted.
- [ ] With focus in a composer, `x`, `h`, `l`, `⌘3` and `⌃T` all type or do
      nothing — none of them switch views or stop an agent.
- [ ] Overview: six tiles share the width with no horizontal scrollbar; each has a
      4 px progress bar matching its percent.
- [ ] Tasks: the table shows task 1 and 2 with their real owners; the left footer
      names `~/.claude/tasks/<team>/`; the right footer is two lines ending in
      "teammates message each other directly — the lead doesn't relay".
- [ ] Rail: `↑`/`↓` move the cursor, `⏎` attaches, and the right pane swaps to
      the attached teammate's transcript and composer.
- [ ] Grid: with seven agents, six panes render and a `+1 more` badge appears.
- [ ] The URL tracks the state: `?view=grid&agent=probe-bravo`. Reload — the same
      view and focused agent come back.

## 6. Criterion 5 — pure logic against fixtures, no Claude Code running

```bash
pkill -f 'claude' || true
cd /Users/alanoliv/code/agents-team-ui
npx vitest run
```

- [ ] Whole suite green with nothing running.
- [ ] `src/shared/**` tests read only `fixtures/` — confirm with
      `grep -rn "\.claude" src/shared || echo "no home-directory reads"`.

## 7. Session-ended behaviour

- [ ] Exit the lead (`/exit`). `~/.claude/teams/<team>/` disappears.
- [ ] The console does NOT blank: it shows the last projected state from the
      store and marks the session ended.
- [ ] Restart `npm run dev` — the store replays and the same final state renders.
EOF
git diff --stat docs/ACCEPTANCE.md 2>/dev/null; wc -l docs/ACCEPTANCE.md</parameter>
```

- [ ] **Step 6: Run the acceptance checklist against a real spawned team**

Run: `npm run dev` in one terminal, then follow `docs/ACCEPTANCE.md` §0 through §7 in order.
Expected: every box in §1–§7 ticked, where §1 is success criterion #0 — quit the console, spawn one teammate, and confirm the link is announced in the session and the server is now answering on 127.0.0.1:4823. Any unticked box is a defect filed against the task that owns that surface — lifecycle §1 → Task 30, Any unticked box is a defect filed against the task that owns that surface — wall §2 → Task 25, composer §3 → Task 24, needs-you §4 → Task 1-23 chrome, views §5 → Tasks 25-29, keyboard §5 → Task 31, fixtures §6 → Task 1-23 shared, session-ended §7 → Task 1-23 store.

- [ ] **Step 7: Commit**

```bash
git add src/web/state/useKeyboard.ts src/web/state/useKeyboard.test.tsx docs/ACCEPTANCE.md && git commit -m "feat: composer-scoped keyboard shortcuts and the acceptance checklist"
```
