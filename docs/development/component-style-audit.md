# Component visual style audit

Scope: shared UI primitives in `src/lib/components/shared/`, rendered in isolation
via Storybook and screenshotted in both themes (`corvmc` light, `corvmc-dark`).
Decorative cards (`VinylCard`, `IdCard` + CTA) were treated as intentional brand
art. 16 components storied, 146 screenshots captured (`/tmp/story-shots/`).

## Highlights (read this first)

1. **🔴 Broken `*-content` color tokens — solid buttons/badges render bright
   magenta text.** A theme bug, not a component bug, but it disfigures every
   primitive that sits on a solid color. **This is the one thing worth fixing now.**
2. Everything else is minor: a couple of low-contrast `opacity` text spots and
   some consistency nits. No layout breakage, no dark-mode breakage in the
   components themselves.
3. Several static-pass worries were **refuted** by rendering (the `#fff` avatar
   initials, the QR `bg-white`) — see below so they don't get "fixed" wrongly.

---

## ✅ Resolved — magenta text on solid surfaces (theme bug)

> **Fixed.** The four light-theme and two dark-theme tokens now read `oklch(100% 0 0)`
> ([layout.css:20](../../src/routes/layout.css#L20) and following). The description below is kept
> because the failure mode — relative-colour syntax silently clamping to an out-of-gamut hue — is
> easy to reintroduce.

`src/routes/layout.css` defines several `--color-*-content` tokens as:

```css
--color-primary-content: oklch(from white 1 100% none);
```

The intent was relative-color syntax copying white (`oklch(from white l c h)`).
But the literal `1 100% none` sets **chroma 100%** (≈0.4 absolute, far out of
gamut) with no hue, which the browser clamps to a saturated **magenta**. Computed:
`oklch(1 0.4 none)`. So the _foreground_ text/icon color on those solid surfaces
is magenta in every component that uses them.

Affected tokens:

| Token                       | Light (`corvmc`)                                   | Dark (`corvmc-dark`)                                 |
| --------------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| `--color-primary-content`   | 🔴 broken ([:20](../../src/routes/layout.css#L20)) | 🔴 broken ([:89](../../src/routes/layout.css#L89))   |
| `--color-error-content`     | 🔴 broken ([:42](../../src/routes/layout.css#L42)) | 🔴 broken ([:109](../../src/routes/layout.css#L109)) |
| `--color-secondary-content` | 🔴 broken ([:24](../../src/routes/layout.css#L24)) | ok                                                   |
| `--color-success-content`   | 🔴 broken ([:38](../../src/routes/layout.css#L38)) | ok                                                   |

Visually confirmed across components (not just one):

- `Button` `Primary` — magenta "Primary" on orange, **both** themes. `shared-button--primary__corvmc.png`
- `Badge` `Primary` — magenta text on orange. `shared-badge--primary__corvmc.png`
- `PageHeader` `With actions` — the "New band" primary CTA. `shared-pageheader--with-actions__corvmc.png`
- `Modal` `Default` — the destructive `btn-error` "Cancel reservation" reads magenta-on-red. `shared-modal--default__corvmc.png`

Every `btn-primary` / `btn-error` / `badge-primary` (plus `btn-secondary`,
`btn-success` in light) is affected app-wide.

**Fix:** replace the four (light) + two (dark) broken values with a real white,
e.g. `white` or `oklch(100% 0 0)`. One-line each; no component changes needed.

> Note: `accent`, `info`, `warning`, `neutral` content tokens are correctly
> defined (dark-on-light) and render fine — leave them.

---

## 🟡 Minor — contrast / hierarchy

- **EmptyState** wraps the _entire_ block in `opacity-60`
  ([EmptyState.svelte:25](../../src/lib/components/shared/EmptyState.svelte#L25)).
  Confirmed on the dark screenshot (`shared-emptystate--with-action__corvmc-dark.png`):
  the title and body collapse to the same dim weight, so there's no visual
  hierarchy and the text is a touch low-contrast on near-black. Consider
  `text-base-content/60` on the body only, leaving the title at full strength.
- **CopyableId** label at `opacity-50` is quite faint; the id at `opacity-70` is
  fine ([CopyableId.svelte:22](../../src/lib/components/shared/CopyableId.svelte#L22)).
  Low priority. Its copy button also has no `aria-label` (only `title`).
- **StatusBadge** uses two different color systems by mode: label mode →
  `badge-{color}`, icon-only mode → `text-{color}`
  ([StatusBadge.svelte:39-110](../../src/lib/components/shared/StatusBadge.svelte)).
  Both render legibly in both themes (verified `scheduled`, dark). Not a bug —
  noted only because it's an easy source of future drift.

## 🟢 Refuted by rendering — do NOT "fix" these

- **`#fff` avatar/ID initials** (`Avatar`, `EntityAvatar`, `IdCard`, `VinylCard`).
  The static pass flagged these as dark-mode breakage. Rendering shows they sit on
  a _colored generated pattern_ (theme-independent), and the white + brown
  text-stroke stays legible in **both** themes
  (`shared-avatar--initials__corvmc-dark.png`, `shared-directory-idcard--default__corvmc-dark.png`).
  Leave as hardcoded white.
- **`TicketQRModal` `bg-white`** (not storied; static finding). White backing
  behind a QR code is **required** for scanner contrast — must NOT become
  `bg-base-100` (that would make it unscannable in dark mode). Leave as-is.
- **Decorative gradients** (`VinylCard`, `IdCard`): intentional brand art; render
  correctly light and dark. Out of scope per the no-gradients rule (which targets
  UI surfaces, not illustration).

## Consistency nits (from the static pass, not blocking)

Carried over, lower priority: repeated dropdown-panel markup across
`AccountDropdown` / `NotificationBell` / `AppTopbar` (a candidate shared
component); `rounded-lg` vs `rounded-box` drift; arbitrary `h-[48px]` / `text-[10px]`;
no shared `IconButton` for the many `btn-ghost btn-xs btn-square` icon buttons.
None affect correctness.

---

## How this was produced

- Storybook harness made theme-correct: `.storybook/preview.ts` now imports the
  app stylesheet and adds a light/dark theme toolbar.
- Stories live next to their components (`*.stories.svelte`), following
  `docs/development/component-testing.md`.
- Screenshots: `scripts/shoot-stories.mjs` drives Playwright over every story in
  both themes. Re-run with Storybook up (`pnpm storybook`) + `node scripts/shoot-stories.mjs`.
