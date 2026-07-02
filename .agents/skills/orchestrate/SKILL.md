---
name: orchestrate
description: Token-efficient orchestration for the Outreach AI repo. Use when working in this project and you want the agent to take over execution from CURRENT_TASK.md, keep context lean, resume safely across Claude/Codex sessions, use parallel subagents only when they help, and always finish with build/test plus Playwright E2E for UI-facing changes.
---

# Outreach AI Orchestration Skill

This skill is the **Claude entrypoint** for project execution.
It is designed to work with the shared repo contract in:

- `/Users/pratham/Documents/Repositories/outreach-ai/AGENTS.md`
- `/Users/pratham/Documents/Repositories/outreach-ai/AGENTS_QUICKSTART.md`

Prefer lean execution by default. Use deep orchestration only when the task genuinely needs it.

---

## Read Policy

### Lean mode (default)

Read only:

1. `webapp/CURRENT_TASK.md`
2. `/Users/pratham/Documents/Repositories/outreach-ai/AGENTS_QUICKSTART.md`

Then read only the **Context Files** from `CURRENT_TASK.md`.

Read extra docs only if blocked:

- `/Users/pratham/Documents/Repositories/outreach-ai/AGENTS.md`
- `/Users/pratham/Documents/Repositories/outreach-ai/docs/DEV_RULES.md`
- `webapp/PROGRESS.md`
- relevant sections of `/Users/pratham/Documents/Repositories/outlierai/backend/server.py`

### Deep mode (opt-in)

Use only when:

- schema or migration work spans multiple subsystems
- task touches many files with unclear dependencies
- user explicitly asks for broad research / subagent team orchestration
- architecture or rollout decisions are unclear

In deep mode, also read:

- `webapp/PROGRESS.md`
- `/Users/pratham/Documents/Repositories/outreach-ai/docs/DEV_RULES.md`

---

## Execution Workflow

### Step 1: Anchor on handoff

Treat `webapp/CURRENT_TASK.md` as the primary execution anchor.

Extract:

- current task
- what is already done
- next concrete action
- max 3 context files
- blocker
- test expectation

If `CURRENT_TASK.md` is stale or clearly inconsistent with code, repair the handoff during wrap-up.

### Step 2: Choose operating style

Use **direct execution** when:

- task is small or medium
- files are tightly coupled
- the next step is obvious

Use **subagents** when:

- work splits into independent units
- write scopes are disjoint
- parallelism will reduce time without increasing coordination risk

Do not spawn subagents just because they are available.

### Step 3: Parallelization rules

- Max 3-4 subagents in a batch
- Give each subagent exact file ownership
- Keep prompts surgical
- Avoid duplicate exploration
- If UI depends on API contract that is still moving, do API first, then UI/tests

Good parallel examples:

- separate independent pages
- seed data vs unrelated API route
- docs update vs code change

Bad parallel examples:

- same file touched by two agents
- API route and test before contract is stable
- schema and downstream callers at the same time

---

## Shared repo rules

- Root repo and `webapp` repo are separate Git repos
- Commits/pushes for `webapp` and root must be handled separately
- Auth first in API routes
- `orgId` from session only
- All org-scoped queries must filter by `orgId`
- Never revert unrelated user changes
- If code and docs conflict, trust code behavior, then update docs

---

## Testing policy

Always validate before finishing.

### Minimum validation

- relevant Jest tests for touched server/lib code
- `npm run build` for changed app(s)

### Required for UI-facing work

- Playwright E2E for the affected user flow

Preferred command:

```bash
npx playwright test --config=playwright.config.ts
```

If full E2E is too expensive for a narrow change, run the most relevant spec first, but do not skip browser validation for UI work.

### If tests fail

- diagnose root cause
- fix
- re-run targeted validation
- re-run final build/E2E check

Do not claim completion while known test failures remain.

---

## Wrap-up

Before ending the session:

1. Update `webapp/CURRENT_TASK.md`
2. Update `webapp/PROGRESS.md` if milestone status changed
3. Summarize what changed and what remains
4. Commit only if the user asked
5. If push is requested, confirm which repo has a remote

---

## Resume guarantee

Your goal is that Claude, Codex, or a later session can continue with zero re-discovery.

To achieve that:

- keep `CURRENT_TASK.md` precise
- keep context files capped at 3
- record blockers explicitly
- mention exact tests run
- avoid vague status like "continued work" or "misc fixes"

---

## Prompt stub

Use this internally when invoked:

```text
Use lean mode unless deep mode is clearly required.
Read CURRENT_TASK.md and AGENTS_QUICKSTART.md first.
Do one atomic task.
Use subagents only when parallel work is truly independent.
Validate with Jest/build and Playwright for UI flows.
Leave CURRENT_TASK.md ready for the next agent.
```
