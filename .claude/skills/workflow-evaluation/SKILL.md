---
name: workflow-evaluation
description: Walk one of the app's workflows end to end in a named usage style — the half-finisher, the power user, the keyboard-only member, the screen-reader user, the impatient one — and report where the workflow fails that style. Use when asked to evaluate, audit, walk through or usability-test a workflow or screen, before a redesign, or after a feature lands and nobody has used it as anything but the admin.
---

# Evaluating a workflow in a usage style

A workflow that works is not the same as a workflow that works **for the way somebody
actually uses software**. This skill runs one workflow as one person, and reports what
broke for them.

The styles live in `styles/`, one file each. Each is a prompt written in the second
person: read it, adopt it for the whole walk, and do not step out of it to be helpful.
Stepping out is the failure mode — an agent that quietly reaches for the URL bar when the
navigation defeats it has destroyed the finding it was about to make.

## Pick two things before you start

**A workflow.** `docs/development/business-workflows.md` has fifteen, numbered, each with
its story, code path and known break points. Name the one you are walking. If the ask
names a screen rather than a workflow, find the workflow that screen belongs to and walk
the whole thing — a screen in isolation cannot show you a handoff that drops something.

**A style.** `styles/` holds ten. They split two ways, and the split decides how you run:

| kind            | how it runs                                               | styles                                                                                |
| --------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Data-backed** | sign in as the seeded persona; the account _is_ the style | `half-finished` `high-volume` `long-absent` `locked-down`                             |
| **Enacted**     | any account; you adopt the behaviour                      | `keyboard-only` `small-screen` `screen-reader` `impatient` `interrupted` `first-time` |

If the ask does not name a style, pick the two most likely to find something: whichever
data-backed style the workflow touches most, plus `impatient`. Say which you picked.

Running several styles over one workflow is the high-value shape — the same screen fails
differently for each, and the overlap is where the real defect is. Run them as separate
walks, not as one blended reviewer.

## Run it in the app, not in the source

Reading the code tells you what it intends. The point of this skill is what it does.

1. `pnpm db:reset` if the database is stale, then start the dev server — `/worktree-dev`
   if you are in a worktree, which has its own port.
2. Sign in. Every seeded account's password is `password`;
   `docs/development/local-dev-quickstart.md#demo-logins` lists all 31 and what each is
   for. The data-backed styles name their own login at the top of their file.
3. Walk the workflow in order, doing what the style says and nothing else.
4. Record as you go, not afterwards. A walk you reconstruct from memory turns into a
   description of the code.

**The browser pane is not the user's browser.** It has its own profile and its own session,
clicks can miss at some scales, and a `vite preview` started by hand has no D1 bindings at
all. If you cannot make the pane behave, write a Playwright spec instead and read the
trace — that is a better artifact anyway.

## What counts as a finding

A finding is a **place the workflow stopped serving this person**, stated so that somebody
else can reproduce it without asking you what you meant:

- where you were, and what you were trying to do
- what the style made you do differently
- what happened, and what should have
- the file, if you found it — but a finding with a route and no file is still a finding

Each style file ends with **what this style predicts**: the specific failures it exists to
catch. Answer every prediction explicitly, including the ones that held. "Pagination
appeared at 25 and the sort survived it" is a result, and a walk that reports only failures
cannot be told apart from a walk that stopped early.

Do not report: a preference with no user behind it, a thing you inferred from reading the
code without hitting it, or a defect that has nothing to do with the style you were in.
That last one still gets filed — see below — it just is not this walk's finding.

## What to do with the findings

Findings that are real problems get **filed, not fixed** (`CLAUDE.md`), and a walk that
produced several is a parent issue plus one sub-issue each — never one long body:

```
gh issue list --state open --search '<terms>'     # required first, a hook enforces it
gh issue create --template finding.md --type Bug  # one per finding, labelled agent-filed
gh api --method POST repos/corvmc/corvmc.org/issues/<parent>/sub_issues \
  -F sub_issue_id=$(gh api repos/corvmc/corvmc.org/issues/<n> --jq .id)
```

The parent carries only what the findings share: which workflow, which style, what you
could not reach and why. Say in it which of the style's predictions **held** — that is what
stops the next session from walking the same ground.

If the walk found nothing, say so plainly and say what you covered. A clean walk is a
result, and it is only worth anything if it is specific about what it exercised.

## When the style needs data that is not there

Several styles need a state the seed does not carry — a workflow the persona has never
touched, a queue with nothing in it. Two honest moves, in this order:

1. **Extend the seed** so the state exists for everybody afterwards. That is the
   `seed-data` skill, and it is usually one row.
2. If the state cannot be seeded, say the walk stopped there and why. Do not hand-edit the
   database to get past it — the next person will not have your edit, and a finding that
   rests on it cannot be reproduced.
