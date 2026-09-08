# Working with Claude Code on this repo

How the agent-instruction surface is organized, why it's split the way it is, and where a new rule
belongs. If you've ever pasted the same correction into chat twice, the second half of this doc is
the fix.

## What loads, and when

Everything an agent knows about this project comes from one of five places, and they cost wildly
different amounts. `CLAUDE.md` is charged on **every request** for the whole session; a
path-scoped rule costs nothing until someone opens a matching file.

| Surface              | Loads                                     | Cost                      |
| -------------------- | ----------------------------------------- | ------------------------- |
| `CLAUDE.md`          | session start, in full                    | every request             |
| `.claude/rules/*.md` | when a file matching its `paths:` is read | only in matching work     |
| `.claude/skills/*/`  | description at start, body when invoked   | near-zero until invoked   |
| Subagents            | on spawn, in their own context            | isolated from the session |
| Hooks                | on a lifecycle event, outside the model   | zero, bar `SessionStart`  |

That gradient is the whole design. `CLAUDE.md` stays short because a bloated one doesn't just
cost tokens — it dilutes the rules that matter until the agent starts ignoring them. The test for
every line in it is: **would removing this cause a mistake?** If not, cut it.

This is also why the Bits UI documentation index is a single link in
`.claude/rules/svelte-ui.md` rather than the 82 lines of URLs it used to be in `CLAUDE.md`.

## Where does a new instruction go?

| You have…                                                  | Put it in                                      |
| ---------------------------------------------------------- | ---------------------------------------------- |
| A convention Claude got wrong twice, anywhere in the repo  | `CLAUDE.md`                                    |
| A rule that only applies under one directory               | a `.claude/rules/*.md` with `paths:`           |
| A multi-step procedure you keep re-explaining              | a `.claude/skills/<name>/SKILL.md`             |
| Something that must happen every time, no exceptions       | a hook in `.claude/settings.json`              |
| Reference material (an API surface, a component catalogue) | a link, or a doc under `docs/` — never a paste |
| Deep background on how a feature behaves                   | a spec in `docs/specs/`                        |

Two failure modes to watch for:

- **A rule that keeps getting violated is usually a length problem, not a volume problem.** Adding
  emphasis to a rule buried in a long file rarely helps; shortening the file does.
- **"Always do X" in prose is a request; a hook is a guarantee.** If it genuinely must hold every
  time, it belongs in `.claude/settings.json`, not in a bullet.

## Prompting Opus 5 here

Opus 5 behaves differently from the models these conventions were originally written for. What
changed, and what it means for how you ask:

- **It self-verifies.** Don't add "double-check your work" or "re-verify before responding" — those
  compound with behavior the model already has and produce over-verification, burning tokens for no
  quality gain. The Svelte MCP block that used to sit in `CLAUDE.md` ("you MUST call the autofixer,
  keep calling it until no issues return") was exactly this, and it's gone.
- **It expands scope on its own judgment.** For a narrow change, say so: name what's out of scope.
  For a large one, front-load the complete specification and let it run — that's where it's
  strongest, and interrupting to add requirements mid-run costs more than writing them down first.
- **It delegates readily.** Subagents pay off on wide, genuinely independent investigation. They
  don't pay off as a way to double-check work, or on anything finishable in a handful of tool calls.
- **Effort controls thinking, not response length.** If you want a short answer, ask for a short
  answer.

For a feature of any size, the highest-leverage thing you can do is get a written spec first —
`docs/specs/` exists for this. Ask the agent to interview you with `AskUserQuestion` until the hard
parts are covered, write the spec, then start a **fresh session** to implement it. Clean context
plus a precise spec beats a long session with accumulated corrections nearly every time.

## Close the loop

An agent stops when the work _looks_ done. Give it something that returns pass or fail and it
iterates on its own instead of handing you the verification job.

| You changed…                       | Prove it with                           |
| ---------------------------------- | --------------------------------------- |
| Anything typed                     | `pnpm check`                            |
| Service or domain logic            | `pnpm test:unit -- --run <path>`        |
| A component                        | `pnpm test:components`                  |
| A user-visible flow                | `pnpm test:e2e --workers=1`             |
| Schema                             | `pnpm db:generate` then `pnpm db:reset` |
| Routes or help articles            | `pnpm docs:routes && pnpm docs:check`   |
| Anything at all, before committing | `pnpm lint`                             |

Each row maps onto a CI job in `.github/workflows/ci.yml`, so a green local gate is a green PR.

That last row matters more than it looks: PR CI runs `lint:changed`, which globs **code only**. A
mis-formatted markdown file passes every check on the PR and then reddens `main` on the full `lint`
job after merge. Run the full `pnpm lint` before committing docs.

Ask for evidence rather than assurance — the test output, the command and what it returned, a
screenshot. Reading evidence is faster than re-running the check yourself, and it works for the
sessions you weren't watching.

## Guardrails already in place

Advisory, in order of how hard they push back:

| Layer                         | What it does                                                            | Blocks?       |
| ----------------------------- | ----------------------------------------------------------------------- | ------------- |
| `.claude/rules/`, `CLAUDE.md` | tells the agent the convention                                          | no            |
| lefthook pre-commit           | prettier `--write` on staged files (no eslint — see git hooks)          | no, by design |
| `PostToolUse` format hook     | formats every file the agent edits                                      | n/a           |
| `PreToolUse` hooks            | reject `npm`/`npx`, reject edits to committed migrations                | **yes**       |
| `require-issue-dedupe`        | rejects `gh issue create` until a search has run in this session        | **yes**       |
| Custom ESLint rules           | `no-db-transaction`, `no-raw-form-elements`, `no-duplicate-field-names` | at lint time  |
| CI                            | seven jobs — lint, check, unit, e2e, schema drift, docs                 | **yes**       |

The two `PreToolUse` hooks live in `scripts/claude/`. Each explains itself on stderr, including the
escape hatch, so a blocked agent can correct course without asking you.

One hook runs at the other end of the session's life: `SessionStart` fires
`scripts/claude/cloud-session-start.sh`, which does nothing locally and boots a fresh clone in a
cloud session. See [cloud-sessions.md](cloud-sessions.md).

## Recording a finding

A session that is changing one thing will find something else wrong. There are three things it can
do with that, and two of them lose it:

- **Fix it here.** The PR now does two things, the review is harder, and a revert takes the
  unrelated fix with it.
- **Say it in the chat.** Gone when the session ends, which for a background `dev` agent is a few
  minutes after it is said.
- **File it.** `gh issue create --template finding.md`, labelled `agent-filed` and `needs-triage`.

The third is the rule, and `CLAUDE.md` states it. The template asks for the location, how it was
found, why it was not fixed there, and — the field worth defending — whether the finding was
**verified by running it or inferred from reading**. A finding is not a hunch: if the honest answer
to "why not fix it here" is "it would have been quick", fix it instead.

**Search first.** `require-issue-dedupe.sh` blocks the create until `gh issue list` or
`gh search issues` has run in the same session, because a session has no memory of what it filed
last week and the duplicate is the default outcome rather than the unlucky one. There is no escape
hatch and none is needed — the hook sees the search command, not its result, so a search that fails
offline still satisfies it.

### Why this is not a markdown file any more

It was, until 2026-09. `CHORES.md` was a genuinely well-written backlog, and by the time it was
retired it held an **open** chore for a bug whose **done** entry sat eighty lines below it, and a
"628 lint warnings" item that had been zero since `eslint --max-warnings 0` landed. Nobody caught
either, for months, in a repo where the file is linked from four places. That is the failure mode
to design against, and it is not solved by moving prose somewhere nicer:

| Layer                | Cost                    | What it buys                                     |
| -------------------- | ----------------------- | ------------------------------------------------ |
| `SessionStart` hook  | ~8 lines, every session | The session knows the tracker exists and is live |
| `.claude/rules/*.md` | nothing until a match   | The query is asked for when a vertical is opened |
| `CLAUDE.md`          | every request           | The one rule: file it, do not fix or say it      |

Deliberately **not** injected: the issue list itself. A hundred titles is a couple of thousand
tokens on every request, buying recall of a list nothing reads top to bottom — the same mistake
`CLAUDE.md` avoids by staying short. Counts plus the query beat the list.

## Keeping it healthy

Re-read this surface every few months — model capabilities move, and instructions written to work
around an older model's limitations become dead weight or active harm once they don't apply.

- A rule the agent follows correctly **without** being told is a rule to delete.
- A rule the agent keeps violating means the file it's in is too long.
- A procedure that has grown past a few bullets belongs in a skill, not in `CLAUDE.md`.
- If two files give conflicting guidance, the agent picks one arbitrarily. `CLAUDE.md` and
  `conventions.md` drifted into exactly this once — CLAUDE.md said "don't generate migrations"
  while conventions.md said "generate them yourself." Keep one source of truth per fact and link
  to it.
