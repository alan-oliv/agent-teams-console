# Graph Report - agents-team-ui  (2026-08-31)

## Corpus Check
- 181 files · ~224,990 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1339 nodes · 3215 edges · 76 communities (57 shown, 16 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 30 edges (avg confidence: 0.84)
- Token cost: 120,120 input · 8,900 output

## Community Hubs (Navigation)
- Agent Status Domain
- Cost & Team State
- Shared Domain Types
- Server Log & Store
- Code Tokenizer
- HTTP Server
- Model Catalog & Pricing
- Transcript File Ingest
- Design Decision Log
- Permission Permits Control
- Setup & Hooks Install
- Workflow Grid View
- Agent Portraits
- Workflow Usage View
- Server CLI & Team Discovery
- TypeScript Config
- Server Index Tests
- Status Bar & Keyboard
- Workflow Server Parsing
- Workflow Agents View
- Team State Hook
- Movie Themes
- Lifecycle & Idle Reaper
- Run Selector
- Server Wiring Tests
- Mailbox Protocol
- Web App Shell
- Transcript Parsing
- Metrics Bar
- Team Selector
- Team Select Tests
- Themes & Density
- App Shell Tests
- Workflow Resume & Script
- Config Menu
- Dev Dependencies
- Project Payload Builder
- Cast Builder
- Settings Hook
- Roster Builder
- Diff Modal
- Needs-You Attention
- Agent Fixtures
- Console Wall Screenshot
- Project Tests
- Grid & Overview Tests
- Team State Store
- Runtime Dependencies
- Package Scripts
- Mailbox Control Writes
- No Sessions View
- Mock EventSource
- Rail View
- Status Bar Tests
- Wall View Tests
- Config Menu Tests
- Tasks View Tests
- Workflow View Tests
- Console Launch Script
- Package Metadata
- Inspect Repos Workflow
- Launcher Tests
- Workflow Run Tests
- Hidden Sessions Hook
- UI Sizing Rulings
- JSDOM Dependency
- Playwright Dependency
- TSX Dependency
- Node Types Dependency
- TypeScript Dependency
- Vite Dependency
- Vitest Dependency
- Console Restart Script

## God Nodes (most connected - your core abstractions)
1. `Agent` - 32 edges
2. `useCast()` - 32 edges
3. `startFileIngest()` - 25 edges
4. `main()` - 24 edges
5. `project()` - 21 edges
6. `buildCast()` - 21 edges
7. `openStore()` - 20 edges
8. `TeamState` - 20 edges
9. `WorkflowAgent` - 20 edges
10. `WorkflowRun` - 20 edges

## Surprising Connections (you probably didn't know these)
- `Agent Teams Console` --references--> `Design Bundle (agents-team-ui-docs)`  [EXTRACTED]
  README.md → CONSOLE-DECISIONS.md
- `Standing Rule 1: No Control Without a Runtime Call` --rationale_for--> `Workflow Mode`  [INFERRED]
  CONSOLE-DECISIONS.md → README.md
- `/console Command` --shares_data_with--> `Launcher Wake Gate`  [INFERRED]
  plugin/commands/console.md → README.md
- `Shared-Checkout Isolation` --shares_data_with--> `Launcher Wake Gate`  [INFERRED]
  plugin/skills/implement-task-list/SKILL.md → README.md
- `/console-setup Command` --references--> `Ten Observation Hooks`  [EXTRACTED]
  plugin/commands/console-setup.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Console Machine Setup Flow** — plugin_commands_console_setup_command, readme_env_vars, readme_subagent_status_line, readme_status_line_policy [EXTRACTED 1.00]
- **Task Delegation Pipeline** — plugin_skills_to_agents_task_list_skill, plugin_skills_to_agents_task_list_four_fields, plugin_skills_implement_task_list_skill, plugin_skills_implement_task_list_dispatch_contract, plugin_skills_implement_task_list_terminal_deliverable [EXTRACTED 1.00]
- **Design Conflict Adjudication** — console_decisions_decision_log, console_decisions_design_bundle, console_decisions_standing_rule_1, console_decisions_standing_rule_3, console_decisions_standing_rule_4 [EXTRACTED 1.00]
- **Agent Team session-7c01fcd1** — docs_console_wall_team_lead, docs_console_wall_impl_task_1, docs_console_wall_impl_task_2, docs_console_wall_sendmessage_coordination [EXTRACTED 1.00]
- **Operator Monitoring Surface** — docs_console_wall_wall_view, docs_console_wall_transcript_stream, docs_console_wall_token_cost_tracking, docs_console_wall_needs_you_bar, docs_console_wall_panel_bar [INFERRED 0.85]

## Communities (76 total, 16 thin omitted)

### Community 0 - "Agent Status Domain"
Cohesion: 0.06
Nodes (69): Agent, AgentStatus, TaskState, wallOrder(), AGENT_STATUS, DORMANT_OPACITY, isDormant(), StatusStyle (+61 more)

### Community 1 - "Cost & Team State"
Cohesion: 0.06
Nodes (53): ModelRate, rateOf(), usdCost(), TeamState, renderBar(), formatCost(), withRuns(), FIXTURE_NOW (+45 more)

### Community 2 - "Shared Domain Types"
Cohesion: 0.07
Nodes (49): Cast, CONSOLE_SENDER, DIFF_LINE_TEXT_CAP, DIFF_LINES_CAP, DiffSign, MailMessage, Marker, RateLimits (+41 more)

### Community 3 - "Server Log & Store"
Cohesion: 0.08
Nodes (46): debug(), describe(), logError(), logInfo(), carriesTotals(), clearOwner(), decode(), encode() (+38 more)

### Community 4 - "Code Tokenizer"
Cohesion: 0.07
Nodes (40): CodeToken, CodeTokenKind, codeTokens(), dedent(), EXT_LANG, isBlank(), KEYWORDS, Segment (+32 more)

### Community 5 - "HTTP Server"
Cohesion: 0.09
Nodes (31): BAD_SEGMENT_BODY, contentTypeFor(), createHttpServer(), decodeSegment(), DEFAULT_WEB_DIST, FORBIDDEN_BODY, HttpDeps, isJsonBody() (+23 more)

### Community 6 - "Model Catalog & Pricing"
Cohesion: 0.11
Nodes (27): project(), usageFrom(), catalog, CatalogFile, compactAtFor(), normalise(), PricingTier, ResolvedModel (+19 more)

### Community 7 - "Transcript File Ingest"
Cohesion: 0.10
Nodes (29): agentOfTranscript(), chainHas(), chainKnown(), claimOfTranscript(), DEFAULT_SWEEP_MS, FileIngest, INGEST_BATCH_RECORDS, IngestConfig (+21 more)

### Community 8 - "Design Decision Log"
Cohesion: 0.08
Nodes (32): Unified Chat Bubble Grounds, Context Warning Threshold Formula, Console Decisions Log, Design Bundle (agents-team-ui-docs), PR Field Refused, Diffstat Shipped, Quiet Metadata Register, Read-Only Column Marking, Respawn Card Kept (+24 more)

### Community 9 - "Permission Permits Control"
Cohesion: 0.09
Nodes (19): autoDenyReason(), createPermits(), Entry, HeldPermit, holdMsFor(), Permits, agentNameFrom(), Bag (+11 more)

### Community 10 - "Setup & Hooks Install"
Cohesion: 0.12
Nodes (29): AGENT_ENV_VARS, BACKUP_FILE, backupPathFor(), CommandHook, envBackup(), EnvVar, HOOK_EVENTS, HOOK_TIMEOUT_SECONDS (+21 more)

### Community 11 - "Workflow Grid View"
Cohesion: 0.13
Nodes (24): WorkflowPhase, formatTokens(), clustersOf(), gridCooperates(), itemKeyOf(), liveCounts(), PhaseGroup, phaseList (+16 more)

### Community 12 - "Agent Portraits"
Cohesion: 0.13
Nodes (21): PortraitId, gridSvg(), hashName(), NON_LEAD_PORTRAIT_IDS, PAINT_ORDER, PORTRAIT_IDS, portraitFor(), portraitSvg() (+13 more)

### Community 13 - "Workflow Usage View"
Cohesion: 0.14
Nodes (20): phaseTally(), PhaseHead(), activeAt(), AGENT_WARN_THRESHOLD, bannerFires(), CELL, concurrency(), concurrencySeries() (+12 more)

### Community 14 - "Server CLI & Team Discovery"
Cohesion: 0.16
Nodes (22): adoptByCwd(), branchOf(), Cli, diffstatOf(), DiscoveredTeam, discoverTeam(), execFileAsync, FOLLOW_INTERVAL_MS (+14 more)

### Community 15 - "TypeScript Config"
Cohesion: 0.09
Nodes (21): DOM, DOM.Iterable, ES2022, node, src, vite/client, vite.config.ts, vitest.config.ts (+13 more)

### Community 16 - "Server Index Tests"
Cohesion: 0.12
Nodes (13): DEFAULT_PORT, fencedSink(), IDLE_GRACE_MS, execFileAsync, FIXTURES, initRepo(), leadOnlyAt(), membersOf() (+5 more)

### Community 17 - "Status Bar & Keyboard"
Cohesion: 0.16
Nodes (10): ViewId, StatusBarProps, isEditable(), KeyboardActions, STEP, AGENTS, Harness(), useKeyboard() (+2 more)

### Community 18 - "Workflow Server Parsing"
Cohesion: 0.21
Nodes (16): agentOf(), agentStateOf(), arr(), Bag, bagOf(), foldWorkflows(), modeOf(), num() (+8 more)

### Community 19 - "Workflow Agents View"
Cohesion: 0.15
Nodes (15): WorkflowAgentState, formatElapsed(), Workflow(), WorkflowViewId, dash(), FOOTER, HEAD, STATE_COLOR (+7 more)

### Community 20 - "Team State Hook"
Cohesion: 0.19
Nodes (16): clampWidth(), COLUMN_MAX, COLUMN_MIN, COLUMN_WIDTH, isAnnouncedTeam(), parseWidths(), readUrlState(), readWidths() (+8 more)

### Community 21 - "Movie Themes"
Cohesion: 0.11
Nodes (18): config panel (gear) as 'movie theme'., It never renames a state, a verb, a metric, a task id or a file path — those are readouts., Movie themes for the agent-teams console. A theme renames agents and nothing else., There is no UI for this file; it is the data the console reads. The picker lives in the, about, legal, roleSlots, rules (+10 more)

### Community 22 - "Lifecycle & Idle Reaper"
Cohesion: 0.16
Nodes (14): execFileAsync, hasLiveTeam(), LAUNCH_SCRIPT, PLUGIN_DIR, recycledSpares(), RESTART_SCRIPT, sparePidsFrom(), startIdleReaper() (+6 more)

### Community 23 - "Run Selector"
Cohesion: 0.14
Nodes (11): WorkflowRun, ROW, RUN_STATUS_COLOR, runLabel(), runOrder(), RunSelect(), pick(), RunSelectProps (+3 more)

### Community 24 - "Server Wiring Tests"
Cohesion: 0.14
Nodes (12): addRun(), assistantLine(), ENTRY, FIXTURES, homeWithRun(), layout(), snapshot(), transcriptOf() (+4 more)

### Community 25 - "Mailbox Protocol"
Cohesion: 0.18
Nodes (16): ProtocolFrameType, contentKey(), DeliveryPart, detectProtocol(), fnv1a32(), InboxEntry, mergeMail(), parseInboxEntry() (+8 more)

### Community 26 - "Web App Shell"
Cohesion: 0.22
Nodes (11): TeamSummary, App(), StopContext, Web Entry HTML, host, HIDDEN_KEY, isEmptySession(), isNotShown() (+3 more)

### Community 27 - "Transcript Parsing"
Cohesion: 0.24
Nodes (16): splitTeammateDelivery(), capText(), currentToolOf(), deliveryDrafts(), describeTool(), diffOfToolUse(), DiffOp, draftsOf() (+8 more)

### Community 28 - "Metrics Bar"
Cohesion: 0.19
Nodes (8): Bar(), BarProps, keptMetrics(), METRIC, useFittedCount(), METRIC_RANK, SettingsStore, WORKFLOW_METRIC_RANK

### Community 29 - "Team Selector"
Cohesion: 0.19
Nodes (15): agentCount(), Mark, MARK_COLOR, MARK_TEXT, matchesQuery(), STATE_COLOR, STATE_GLYPH, stateText() (+7 more)

### Community 30 - "Team Select Tests"
Cohesion: 0.13
Nodes (7): LIST, renderSelect(), SWITCH_TO_B5, WATCH, useWatch(), WatchContext, WatchState

### Community 31 - "Themes & Density"
Cohesion: 0.17
Nodes (14): Settings, Accent, ACCENT_KEYS, ACCENT_STEPS, AccentKey, AccentSteps, Density, DENSITY_IDS (+6 more)

### Community 32 - "App Shell Tests"
Cohesion: 0.15
Nodes (8): chip, RUNS, stubMixedFetch(), stubTeamsFetch(), soloList(), installMockEventSource(), Listener, sampleTeams()

### Community 33 - "Workflow Resume & Script"
Cohesion: 0.19
Nodes (11): WorkflowAgent, DispatchCluster, GridRow, resumeSplit, SIDE_BODY, SIDE_LABEL, SIDE_PANEL, agent() (+3 more)

### Community 34 - "Config Menu"
Cohesion: 0.17
Nodes (11): ConfigMenu(), onKeyDown(), onPointerDown(), ConfigMenuProps, LABEL, MENU, optionColor(), optionStyle() (+3 more)

### Community 35 - "Dev Dependencies"
Cohesion: 0.13
Nodes (15): esbuild, devDependencies, esbuild, @testing-library/jest-dom, @testing-library/react, @types/proper-lockfile, @types/react, @types/react-dom (+7 more)

### Community 36 - "Project Payload Builder"
Cohesion: 0.18
Nodes (14): AgentUsageTotals, lastAssistantModel(), lineMemo, linesOf(), memoisable(), NeedsYouResolvedPayload, NO_TOOL, TaskPayload (+6 more)

### Community 37 - "Cast Builder"
Cohesion: 0.19
Nodes (11): buildCast(), CastAgent, CastName, MOVIE_THEMES, MovieTheme, RoleSlot, SLOT_PATTERNS, slotFor() (+3 more)

### Community 38 - "Settings Hook"
Cohesion: 0.22
Nodes (11): ALPHA, LEAD, CAST_KEYS, DEFAULT_SETTINGS, inList(), parseSettings(), read(), SETTINGS_KEY (+3 more)

### Community 39 - "Roster Builder"
Cohesion: 0.21
Nodes (11): RosterPayload, AgentIdentity, buildRoster(), roleOf(), Sidecar, TeamConfig, TeamConfigMember, config (+3 more)

### Community 40 - "Diff Modal"
Cohesion: 0.22
Nodes (11): DiffHunk, DiffLine, changeRuns(), DiffModal(), GUTTER, hunkLabel(), metaLabel(), OUTLINE_ACTION (+3 more)

### Community 41 - "Needs-You Attention"
Cohesion: 0.20
Nodes (10): NeedsYouItem, postJson(), Card(), CARD_BASE, DETAIL, NeedsYou(), NeedsYouProps, FAILURE (+2 more)

### Community 42 - "Agent Fixtures"
Cohesion: 0.16
Nodes (11): CONFIG_PATH, CONTEXT_TOKENS, COST_USD, fixtureAgents(), HERE, linesFor(), MODEL, RUN_STATE (+3 more)

### Community 43 - "Console Wall Screenshot"
Cohesion: 0.26
Nodes (13): Console Wall Screenshot, Agent Lifecycle States (working / departed), impl-task-1 Agent, impl-task-2 Agent, Per-Agent Message Input, NEEDS YOU Attention Bar, Panel Bar Keyboard Controls, SendMessage Team Coordination (+5 more)

### Community 44 - "Project Tests"
Cohesion: 0.22
Nodes (12): PROJECTED_TRANSCRIPT_LINES, buildLog(), derivations, FIXTURES, fx(), readJson(), recordsOf(), TRANSCRIPTS (+4 more)

### Community 45 - "Grid & Overview Tests"
Cohesion: 0.17
Nodes (9): FIXTURE_NOW, padAgents(), feed, four, seven, six, feed, four (+1 more)

### Community 46 - "Team State Store"
Cohesion: 0.18
Nodes (5): Diff, Draft, LINES, DiffContext, TeamStateStore

### Community 47 - "Runtime Dependencies"
Cohesion: 0.18
Nodes (11): @fontsource/inter, @fontsource/jetbrains-mono, dependencies, @fontsource/inter, @fontsource/jetbrains-mono, proper-lockfile, react, react-dom (+3 more)

### Community 48 - "Package Scripts"
Cohesion: 0.20
Nodes (10): scripts, build, build:server, dev, prepare, setup, start, test (+2 more)

### Community 49 - "Mailbox Control Writes"
Cohesion: 0.29
Nodes (6): atomicWrite(), colorOf(), sendToInbox(), setTeamsRoot(), teamsRoot, FIXTURES

### Community 50 - "No Sessions View"
Cohesion: 0.24
Nodes (5): DOT, DOT_COLOR, ELLIPSIS, NoSessions(), NoSessionsProps

### Community 52 - "Rail View"
Cohesion: 0.22
Nodes (4): Rail(), agents, feed, row

### Community 53 - "Status Bar Tests"
Cohesion: 0.25
Nodes (4): APPEARANCE, DIFF, TRUNCATED, CastContext

### Community 57 - "Workflow View Tests"
Cohesion: 0.29
Nodes (5): APPEARANCE, FINISHED, LIVE, OLDER, WORKFLOW_VIEW_IDS

### Community 58 - "Console Launch Script"
Cohesion: 0.60
Nodes (5): bail(), find_team_by_cwd(), find_team_for_session(), find_team_via_sidecar(), console-launch.sh script

### Community 59 - "Package Metadata"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 60 - "Inspect Repos Workflow"
Cohesion: 0.50
Nodes (3): done, meta, SUMMARY_SCHEMA

## Knowledge Gaps
- **330 isolated node(s):** `meta`, `SUMMARY_SCHEMA`, `done`, `name`, `private` (+325 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 506 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `TeamState` connect `Cost & Team State` to `Shared Domain Types`, `Project Payload Builder`, `HTTP Server`, `Server CLI & Team Discovery`, `Team State Store`, `Status Bar & Keyboard`, `Team State Hook`, `Server Wiring Tests`, `Metrics Bar`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `Agent` connect `Agent Status Domain` to `Cost & Team State`, `Shared Domain Types`, `Project Payload Builder`, `Roster Builder`, `Transcript File Ingest`, `Agent Fixtures`, `Team State Hook`, `Web App Shell`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **What connects `meta`, `SUMMARY_SCHEMA`, `done` to the rest of the system?**
  _330 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Agent Status Domain` be split into smaller, more focused modules?**
  _Cohesion score 0.056363636363636366 - nodes in this community are weakly interconnected._
- **Should `Cost & Team State` be split into smaller, more focused modules?**
  _Cohesion score 0.05926251097453907 - nodes in this community are weakly interconnected._
- **Should `Shared Domain Types` be split into smaller, more focused modules?**
  _Cohesion score 0.07139079851930195 - nodes in this community are weakly interconnected._
- **Should `Server Log & Store` be split into smaller, more focused modules?**
  _Cohesion score 0.07570621468926554 - nodes in this community are weakly interconnected._