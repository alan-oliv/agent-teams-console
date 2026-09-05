export const meta = {
  name: 'roast-repos',
  description: 'Explore five old repos, roast each one, and compile the roasts into REPO-ROAST.md',
  whenToUse: 'When you want an evidence-backed comedic teardown of the projects sitting in ~/code/old',
  phases: [
    { title: 'Roast', detail: 'one agent per repo, reading real files before landing a jab', model: 'sonnet / haiku' },
    { title: 'Compile', detail: 'one agent stitches the roasts into REPO-ROAST.md', model: 'opus' },
  ],
}

const OUT = '/Users/alanoliv/code/agents-team-ui-docs/REPO-ROAST.md'

const REPOS = (Array.isArray(args) && args.length ? args : [
  { path: '/Users/alanoliv/code/old/battle', model: 'sonnet', effort: 'medium' },
  { path: '/Users/alanoliv/code/old/ai-script-builder', model: 'sonnet', effort: 'medium' },
  { path: '/Users/alanoliv/code/old/github-contrib-chart', model: 'haiku', effort: 'low' },
  { path: '/Users/alanoliv/code/old/hometask-be-template-master copy', model: 'haiku', effort: 'low' },
  { path: '/Users/alanoliv/code/old/archie-poc', model: 'sonnet', effort: 'medium' },
]).map((r) => (typeof r === 'string' ? { path: r, model: 'sonnet', effort: 'medium' } : r))

const ROAST_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Directory name of the repo' },
    oneLiner: { type: 'string', description: 'A single sentence that captures the whole repo' },
    stack: { type: 'string', description: 'One phrase: language, framework, and the year it feels like' },
    burns: {
      type: 'array',
      minItems: 3,
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          jab: { type: 'string', description: 'The joke, one or two sentences' },
          evidence: { type: 'string', description: 'The real file, dependency version, or commit message that earns it' },
        },
        required: ['jab', 'evidence'],
        additionalProperties: false,
      },
    },
    redeeming: { type: 'string', description: 'One thing that is genuinely good, said without sarcasm' },
  },
  required: ['name', 'oneLiner', 'stack', 'burns', 'redeeming'],
  additionalProperties: false,
}

const roastPrompt = (path) => `Explore the repository at "${path}" and roast it.

The path may contain spaces — quote it in every shell command.

Explore before you write a single joke. Read, at minimum:
- README and any top-level docs
- manifests (package.json, pyproject.toml, mix.exs, Cargo.toml, go.mod, requirements.txt), including dependency versions and how stale they are
- the top two levels of the directory tree
- the two or three largest source files, plus any file whose name suggests things went sideways (utils, helpers, misc, temp, old, final, test2)
- git log --oneline -30, the current branch, and whether uncommitted junk is lying around

Then roast it. The rules that make a roast land:
- Every jab must be earned by something you actually read. Name the file, dependency, or commit message. An unsourced jab is worthless.
- Roast the code and the choices, never the person who wrote them.
- Specific beats mean. "Three date libraries and none of them formats the date" beats "this code is bad".
- Cut any jab that would fit equally well on any other repo.
- If the repo is genuinely small or genuinely fine, say so and roast what is actually there. Do not invent flaws.

Return the structured roast.`

log(`Roasting ${REPOS.length} repos, then compiling to ${OUT}`)
phase('Roast')

const roasts = (await parallel(REPOS.map((repo) => () =>
  agent(roastPrompt(repo.path), {
    label: `roast:${repo.path.split('/').pop()}`,
    phase: 'Roast',
    schema: ROAST_SCHEMA,
    model: repo.model,
    effort: repo.effort,
  }),
))).filter(Boolean)

if (roasts.length < REPOS.length) {
  log(`${REPOS.length - roasts.length} repo(s) came back empty — compiling without them`)
}

phase('Compile')

const out = await agent(
  `Here are ${roasts.length} repo roasts as JSON:

${JSON.stringify(roasts, null, 2)}

Write them up as one markdown document and save it to "${OUT}" with the Write tool.

Shape:
- An H1 title, then two or three sentences naming the habit these ${roasts.length} repos share. This is the part only you can write — the individual roasts could not see each other.
- One H2 per repo, in the order given: the one-liner in italics, the stack line, then the burns as bullets with the evidence woven into the sentence rather than bolted on in parentheses.
- Close each section with a short "In its defence" line drawn from the redeeming field.
- End with an H2 "Verdict" ranking the repos most to least roastable, one line of reasoning each.

Keep the voice dry and consistent throughout — the source roasts came from different agents and will not match in tone. Add no jabs that are absent from the source material. Do not pad.

Return only the absolute path you wrote.`,
  { label: 'compile:REPO-ROAST.md', phase: 'Compile', model: 'opus', effort: 'high' },
)

return { roasted: roasts.length, requested: REPOS.length, out, roasts }
