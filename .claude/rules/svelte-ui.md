---
paths:
  - 'src/**/*.svelte'
---

# Svelte components

`docs/development/ui-patterns.md` is the component reference — read it before building a page.
Compose the existing shared primitives rather than inventing new ones.

- **Forms**: pages use `Form` / `FormField` / `SubmitButton` from
  `$lib/components/shared/Form/`. The only raw `<select>` elements in the codebase live inside
  those shared components; a page that needs one is a page that should be using `FormField`.
- **`FormField` with `type="textarea"` drops the rest props** — `rows`, `placeholder`, and
  `maxlength` are ignored. Use the custom-input mode instead.
- **daisyUI 5**: the `.select` class belongs on a wrapping element, not on the bare `<select>`.
- **Bits UI** is the headless base layer. Docs: <https://bits-ui.com/docs/llms.txt> (per-component
  pages follow the same `.../llms.txt` pattern).
- **No gradients**, anywhere.

## SSR traps

- A `pending` snippet on `<svelte:boundary>` makes the boundary skip its contents server-side. To
  keep SSR, pass `pending` as a nullable attribute rather than defining the snippet.
- A JS-only form with no `method` submits its fields into the URL as a GET before hydration
  finishes. `/login` stays client-mounted for exactly this reason.
- Declarations after a top-level `await` are async-gated. On Svelte < 5.56.4 their async blocks
  could stay uncommitted after an SPA navigation, producing dead modals.

## Filter state in the URL

`replaceState()` from `$app/navigation` updates neither `page.url` nor the router's own state. Back
a filter with local `$state` and `goto(url, { replaceState: true })`.

## Tooling

`mcp__svelte__svelte-autofixer` is available when a component won't compile or the rune semantics
are unclear. Reach for it when it helps — it is not a required step on every edit.
