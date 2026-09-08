---
title: Themes & Custom CSS
slug: page-theme-css
category: band-pages
summary: Pick a theme, then take its CSS over when you want to change it.
minRole: member
sortOrder: 4
---

## Choosing a theme

The **Page Editor**'s style panel — the **Style** button opens it — has a theme
dropdown: a default theme plus genre-based ones. Pick the one that fits your
band's look and it applies across all your blocks.

Underneath the dropdown you can read exactly what that theme does. That box is
the theme's own CSS, and it is read-only for as long as the theme is what is
styling your page.

## Custom CSS

Press **Customize** and the theme's rules become yours: the theme stops applying
and the box you are now editing is the whole of what styles your page. So a rule
you delete is gone, and a colour you change is changed — there is nothing left
underneath quietly overriding you.

The theme dropdown then reads **Custom**, and remembers which theme you started
from. Picking a different theme from there replaces your CSS, so the editor asks
first.

A few notes:

- There's a size limit (around 50KB) — plenty for styling tweaks.
- CSS is **sanitized** for safety, so some properties may be stripped. External
  stylesheets and scripts are removed; images from your own media library are
  fine.
- Everything you write is scoped to your page, so a bare selector like `h1` only
  ever affects your site.
- These five variables are what the blocks read, so changing one recolours
  everything at once: `--bs-bg`, `--bs-text`, `--bs-accent`, `--bs-surface` and
  `--bs-muted`.

## Tips

- The page beside the panel is your real page, and it restyles as you type.
- If something looks off after a CSS change, remove the rule and re-add it
  piece by piece to find the culprit.

## Related

- [Build your page](/member/help/build-your-page)
