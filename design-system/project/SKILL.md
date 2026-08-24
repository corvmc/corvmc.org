---
name: corvallis-music-collective-design
description: Use this skill to generate well-branded interfaces and assets for the Corvallis Music Collective (CMC) — a nonprofit music collective in Corvallis, OR — either for production or throwaway prototypes / mocks / posters / decks. Contains essential design guidelines, colors, type, fonts, assets, and a UI-kit recreation of corvmc.org for prototyping. Modern but retro-inspired (60s/70s nostalgia without baggage).
user-invocable: true
---

Read the `README.md` file within this skill, and explore the other available files (`colors_and_type.css`, `assets/`, `preview/`, `ui_kits/website/`).

If creating visual artifacts (slides, mocks, throwaway prototypes, posters, social posts, etc), copy assets out of `assets/` and create static HTML files for the user to view. Use `colors_and_type.css` as the foundation — it ships brand colors as CSS variables, the Lexend font import, sensible element defaults, and the `.tri-stripe`, `.retro-rainbow-shadow`, and `.eyebrow` utility classes. Use the components in `ui_kits/website/` as a starting point for any web-style UI work; they're factored as small React components on top of the same CSS vars.

If working on production code (this repo — the SvelteKit + daisyUI site at corvmc.org), you can copy assets and read the rules in `README.md` to become an expert in designing with this brand. The CSS variable names in `colors_and_type.css` deliberately mirror the daisyUI `corvmc` theme so tokens transfer 1:1. For component composition inside the app, `docs/development/ui-patterns.md` governs; this skill governs brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design — a poster, a social post, a slide deck, an in-app screen, a marketing page — and what occasion / program it's for (Practice Space, Open House, Real Book Club, Monthly Meetup, Open Jam, gear lending, fundraising). Ask a few focused questions about audience, format/size, and how much you should lean into the retro poster aesthetic vs. the cleaner product-UI aesthetic. Then act as an expert designer who outputs HTML artifacts *or* production code, depending on the need.

Key things to remember:

- **Voice:** warm, plain, "we / our", short sentences, no emoji. *"Come chat about music"* is the brand in five words.
- **Color:** flat fills only — the only gradient on the brand is the tri-stripe (teal / goldenrod / red-orange, hard stops). Backgrounds are always warm cream, never pure white.
- **Type:** Lexend handles everything 300–700. Posters can lean on UPPERCASE with widened tracking + the `.retro-rainbow-shadow` utility for the chunky stacked wordmark look.
- **Iconography:** Tabler Icons, stroke style. No emoji. Three custom speaker icons live in `assets/icons/`.
- **The speaker mark** in `assets/logos/cmc-speaker.png` is the mascot — include it somewhere on almost every poster and most marketing surfaces. **Never** add the letters "C / M / C" down the side of the cabinet, and **never** use a curly-cursive display face for the wordmark — both are deprecated.
