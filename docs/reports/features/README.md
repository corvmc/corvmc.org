# Features

One file per shipped feature, in a folder per panel: `staff/`, `member/`, `band/`, `public/` and
`api/`. `pnpm docs:catalog` prints them as the feature tables of the
[feature catalog](../feature-catalog.md), sorted by name. The rendered tables are not committed, so
two feature PRs never edit the same lines.

A feature file is a heading, a status line, and at most one paragraph of notes:

```markdown
# Recurring reservations

Status: ✅ /staff/recurring

What it does and where it lives, on one paragraph, because it renders as one table cell.
```

Name the file after the feature, in kebab case. Each panel folder's `README.md` holds the table's
title and any intro above it. `pnpm docs:check` fails on a file that does not parse, a folder that
is not a panel, or two features with the same name in one panel.
