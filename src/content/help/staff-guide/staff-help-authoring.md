---
title: Author help articles
slug: staff-help-authoring
category: staff-guide
summary: Write and publish member-facing help articles.
minRole: staff
sortOrder: 16
---

## Authoring help

**Staff → Help** lists every help article, published or not. Create a new one or
edit an existing article.

## Creating an article

Fill in:

- **Title** and an optional **slug** (auto-generated from the title if left blank).
- **Category** and an optional **summary** for listings.
- **Content** in the markdown editor.
- **Minimum role** — `member`, `staff`, or `admin` — controls who can see it.
- **Published** — toggle on to make it visible.

## Static vs. dynamic articles

- **Dynamic** articles are created and edited here in the web UI.
- **Static** articles are synced from markdown files in the codebase
  (`src/content/help/`). When you open one, a banner warns that **edits here are
  overwritten on the next sync** — change the source file instead.

## Tips

- Set the right minimum role so staff-only guidance stays out of members' view.
- Keep an article focused on one task; link to related articles rather than
  cramming everything in.
