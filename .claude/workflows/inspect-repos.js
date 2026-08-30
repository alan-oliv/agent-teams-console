export const meta = {
  name: 'inspect-repos',
  description: 'Inspect each repo in ~/code and write a 5-line summary for each',
  whenToUse: 'When you want a quick, current picture of every project sitting in the parent code folder',
  phases: [
    { title: 'Inspect', detail: 'one agent per repo, reading manifests, README, layout and git log' },
  ],
}

const REPOS = Array.isArray(args) && args.length ? args : [
  '/Users/alanoliv/code/agents-team-ui',
  '/Users/alanoliv/code/agents-team-ui-docs',
  '/Users/alanoliv/code/ai-script-builder',
  '/Users/alanoliv/code/grimoire',
  '/Users/alanoliv/code/stable-diffusion-webui',
]

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Directory name of the repo' },
    lines: {
      type: 'array',
      minItems: 5,
      maxItems: 5,
      items: { type: 'string' },
      description: 'Exactly five summary lines, one sentence each, no bullet markers',
    },
  },
  required: ['name', 'lines'],
  additionalProperties: false,
}

log(`Inspecting ${REPOS.length} repos`)
phase('Inspect')

const summaries = await parallel(REPOS.map((path) => () =>
  agent(
    `Inspect the repository at ${path} and summarise it in exactly five lines.

Read enough to be accurate and specific, and do not guess:
- README and any top-level docs
- manifests (package.json, pyproject.toml, mix.exs, Cargo.toml, go.mod, requirements.txt)
- the top two levels of the directory tree
- the last ~20 commits (git log --oneline -20) and the current branch, if it is a git repo
- if it is not a git repo, say so rather than inventing history

Return exactly five lines, each one sentence, covering in this order:
1. What the project is and what problem it solves.
2. Language, framework and key dependencies.
3. How the code is organised — the main directories or modules and how they fit together.
4. Current state: activity level, recent commit themes, branch, and whether it looks maintained or dormant.
5. One concrete, non-obvious detail a new contributor would want to know.

Be specific to this repo — name real files, real directories, real dependencies. No filler, no marketing tone. Do not include bullet markers or numbering in the line text.`,
    { label: `inspect:${path.split('/').pop()}`, phase: 'Inspect', schema: SUMMARY_SCHEMA },
  ),
))

const done = summaries.filter(Boolean)
if (done.length < REPOS.length) {
  log(`${REPOS.length - done.length} repo(s) failed to return a summary`)
}

return {
  inspected: done.length,
  requested: REPOS.length,
  summaries: done,
}
