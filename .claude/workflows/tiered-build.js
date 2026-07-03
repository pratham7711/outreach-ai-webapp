export const meta = {
  name: 'tiered-build',
  description: 'Opus builds each spec, Sonnet verifies with evidence; Fable stays orchestrator',
  whenToUse: 'Batch of well-specified implementation tasks with disjoint file boundaries',
  phases: [
    { title: 'Build', detail: 'one Opus agent per spec', model: 'opus' },
    { title: 'Verify', detail: 'Sonnet runs tsc + affected suites, reports evidence', model: 'sonnet' },
  ],
}

const specs = Array.isArray(args) ? args : (args && Array.isArray(args.specs) ? args.specs : [])
if (specs.length === 0) return { error: 'pass args as [{name, prompt, model?}] or {specs: [...]}' }

const VERDICT = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    tsc: { type: 'string' },
    tests: { type: 'string' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['pass', 'tsc', 'tests', 'problems'],
}

const results = await pipeline(
  specs,
  (s) => agent(s.prompt, { label: `build:${s.name}`, phase: 'Build', model: s.model || 'opus' }),
  (built, s) =>
    agent(
      `Verify freshly built work in /Users/pratham/Documents/Repositories/outreach-ai/webapp. Task "${s.name}". Builder report: ${built}\n\nRun from the webapp dir: 1) node node_modules/.bin/tsc -p tsconfig.json --noEmit (must be 0 errors); 2) npx jest --config jest.integration.config.js --maxWorkers=2 (existing suites must pass); 3) spot-read the touched files for: code comments (forbidden), orgId taken from request input (forbidden), hardcoded colors instead of var(--cc-*) tokens. Report pass=false with specific problems if anything fails. Do not edit files.`,
      { label: `verify:${s.name}`, phase: 'Verify', model: 'sonnet', schema: VERDICT },
    ).then((v) => ({ name: s.name, report: built, verdict: v })),
)

const done = results.filter(Boolean)
log(`${done.filter((r) => r.verdict && r.verdict.pass).length}/${done.length} specs verified clean`)
return done
