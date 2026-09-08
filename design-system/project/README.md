# Corvallis Music Collective — Design System

> **Building and connecting music communities in Corvallis, OR.**

The Corvallis Music Collective (CMC) is a 501(c)(3) nonprofit music collective
in Corvallis, Oregon. Members book practice space, form bands, attend events,
borrow equipment, and meet up around shared musical interests (Real Book Club,
Songwriter Circle, monthly open jam). This design system captures the brand for
use in posters, slides, in-app UI, social posts, and prototypes.

The visual direction is **modern, but retro-inspired** — it evokes nostalgia
about the 60s and 70s without carrying it as baggage. Warm cream backgrounds,
chunky speaker logo, tri-color "highway stripes", and a single workhorse type
family (Lexend) carry the brand. Posters lean further into the retro side —
cassette tapes, sunburst rays, halftone collage, diamond signage — while the
product UI stays clean and contemporary.

---

## Sources

This system was built from:

- **Website / app codebase:** [`DevonCash/corvmc.org`](https://github.com/DevonCash/corvmc.org)
  (Laravel 12 + Filament v5, daisyUI on Tailwind v4). The primary source of
  truth for color, type, components, and iconography. We mirrored the
  `corvmc` daisyUI theme from `resources/css/app.css`.
- **Brand assets** the user provided: logos (color + monocolor), social
  avatars, and ~9 event posters (Open House, Real Book Club, Need Somewhere
  to Practice, Monthly Meetup, Cassette concert poster, etc).
- **Iconography:** Tabler Icons (the site uses `blade-ui-kit/blade-tabler-icons`)
  plus three custom speaker glyphs (`speaker-check`, `-exclamation`, `-share`).

---

## Brand essentials

- **Name:** Corvallis Music Collective · **Short:** CMC · **Web:** corvmc.org · **Social:** `@corvmc`
- **Mission line:** *Building and Connecting Music Communities in Corvallis*
- **Tagline (event posters):** *Come chat about music*
- **Status:** 501(c)(3) nonprofit · Location: 6775 SW Philomath Blvd, Corvallis, OR
- **Logo motif:** Stylized 2×10" speaker cabinet emitting sound lines, in CMC
  Orange / Light Blue / Yellow / Navy. The current mark is the **plain
  speaker** (`assets/logos/cmc-speaker.png`) — no enclosing circle, no
  lettering on the cabinet side.
- **Contact:** contact@corvmc.org

---

## Index — what's in this system

```
README.md                  ← you are here
SKILL.md                   ← cross-compatible Agent Skill manifest
SKEUOMORPHISM.md           ← principles for the poster / vinyl / ID card patterns
colors_and_type.css        ← CSS vars, semantic vars, element defaults, utility classes
retro_flourishes.css       ← opt-in utilities: sunburst, halftone, paper-tape, sticker, marker
skeuomorphic.css           ← opt-in skeuo components: .poster-card, .vinyl-card, .id-card

assets/
├── logos/                 ← current marks only:
│                            • cmc-speaker.png — speaker mascot (canonical)
│                            • cmc-compact-logo.svg — speaker + Lexend wordmark
│                            • cmc-logo-horizontal.png — wide lockup
│                            • favicon.svg
├── icons/                 ← custom speaker SVG icons (check, exclamation, share)
├── posters/               ← 9 real event posters (PNG/PDF) for tone reference
└── social/                ← Facebook / Instagram avatar PNGs (clean speaker on cream)

preview/                   ← Design System tab cards (auto-shown by the asset pane)

ui_kits/
└── website/               ← Recreation of corvmc.org public site
    ├── index.html         ← interactive click-through demo
    ├── Layout.jsx         ← header, footer, tri-stripe
    ├── Hero.jsx, EventCard.jsx, WhatWeDo.jsx, …  (small, factored components)
    └── README.md

email_templates/           ← Production HTML emails (600px tables, inline styles)
├── event-announcement.html       ← single-event marketing send
├── reservation-confirmation.html ← transactional booking receipt
├── newsletter.html               ← monthly community roundup
├── index.html                    ← Gmail-style 3-template inbox preview
└── README.md                     ← client-compat rules + merge-tag list
```

---

## Content fundamentals

CMC writes like a friendly neighbor running a community space — warm, plain,
inclusive, never corporate. Sentences are short. Calls to action are direct
and present-tense ("Join Our Community!", "Become a Member", "Apply to
Perform"). Headings often skip end-punctuation; CTAs skip exclamation points
unless the message is genuinely celebratory (open houses, meet-ups).

**Voice traits**

- **We / our**, not "the organization" or "CMC offers…". Always speaks as a
  collective: *"Our practice rooms are equipped…"*, *"We provide shared music
  resources…"*. Second person ("you / your") is used for direct invitations.
- **Plain and concrete.** *"Bring your instrument and a Real Book (or we'll
  share!)"* over *"Attendees should arrive with appropriate materials."*
- **Encouraging, not gatekept.** *"all skill levels welcome"*, *"Whether you're
  a seasoned performer or just starting out"*, *"Everyone is welcome!"*
- **Specific over generic.** Posters always include the exact address
  (*6775 SW Philomath Blvd*), the day-of-month pattern (*"Last Thursday of every
  month"*), and the price (*"$15/hour — $30/hour without membership"*).

**Casing**

- **Title Case** for page titles, section headings, card titles, button labels:
  *"Upcoming Events"*, *"Get Involved"*, *"Become a Member"*. Every example is a
  short noun phrase, and that is the limit of the rule — it does not reach a
  string that is a sentence.
- **Sentence case** in long-form prose, captions, and admonitions — and
  throughout transactional email, headings and button labels included. Mail
  addresses one person about one thing that just happened, so its headings are
  sentences and questions (*"How did it go?"*, *"A slot has opened up"*), which
  Title Case turns into *"How Did It Go?"*. Its subjects and its in-app
  counterparts were already sentence case; the headings and CTAs drifted, so one
  notification read two ways at once. `src/lib/server/notification/copy-casing.spec.ts`
  keeps them agreeing.
- **UPPERCASE** on posters and "eyebrow" labels — always with widened tracking.
  *"CORVALLIS MUSIC COLLECTIVE"* over a hero illustration; *"HOURLY PRACTICE
  SPACE AVAILABLE"* across the bottom of a flyer.

**Punctuation / tone tells**

- En-dash (–) for time ranges: *"Jan 30th – 7 PM"*, *"5:30–7:30pm"*.
- Pipe (|) for date / price slugs on posters: *"October 2 | 5 PM"*.
- "NOTAFLOF" appears on price lines — short for *No One Turned Away For Lack
  Of Funds*. Suggested-donation pricing is a CMC value.
- Occasional `!` for celebratory moments only: *"Open House!"*, *"Real Book
  Club!"*, *"Join Our Community!"*.

**Emoji & icons in copy**

- **No emoji.** Copy is text-only. When a visual cue is needed inline, Tabler
  icons are placed *next to* the text (e.g. an admonition card with a
  `tabler-flame` next to a "Tip" label) — never inside the sentence.

**Example copy**

> Affordable hourly rehearsal space with professional equipment for bands and
> musicians.

> Whether you're a seasoned performer or just starting out, our performance
> programs provide supportive environments to share your music with
> appreciative audiences.

> Come chat with — or just listen to — other local musicians about gear, gigs,
> and everything music-related. Everyone is welcome!

---

## Visual foundations

**The single-family system.** Lexend handles everything — 300 / 400 / 500 / 600
/ 700. There is no separate display face; the "retro" feel comes from the
illustration and color systems, not the type. Lexend at 700 with tight
tracking is the closest the brand gets to a display face.

**Color is the whole brand.** Six recurring hues, used in flat fills with no
gradients on UI surfaces:

| Token | Hex | Where it lives |
| --- | --- | --- |
| CMC Orange | `#e5771e` | Primary buttons, speaker cabinet, top-of-hierarchy callouts, posters' "OPEN HOUSE!" type |
| CMC Navy | `#003b5c` | Secondary buttons, dark stripe band, enclosed-logo ring |
| CMC Teal | `#00859b` | Wordmark color, public-header tri-stripe top band, sound lines |
| CMC Light Blue | `#b8dde1` | Accent — speaker face, soft backgrounds |
| CMC Yellow | `#ffe28a` | Warning surfaces, soft callouts, speaker cone fill |
| CMC Goldenrod | `#ffb500` | Tri-stripe middle band, full-bleed poster backgrounds |
| CMC Red-Orange | `#f84d13` | Tri-stripe bottom band, sunburst rays, sale/urgency accents |
| CMC Cream | `#fffbf6` | Page / slide background — everything sits on warm cream, never pure white |
| CMC Parchment | `#ffe2cd` | Peach-cream sidebar, business-card footer, enclosed-logo center |
| CMC Brown | `#5a3d2b` | Speaker cabinet outline, body copy on cream when navy is too cool |

**Background system.** Three warm paper tones — cream (`base-100`), parchment
(`base-200`), aged paper (`base-300`) — paired with **tinted sections**:
`bg-primary/20`, `bg-success/10`, `bg-warning/20`, `bg-info/20`. Long-form
pages alternate these tints to create rhythm between sections. There are
**no gradients** in the product UI. Gradients only appear in two places:

1. The **tri-stripe band** (teal → goldenrod → red-orange, hard stops) under
   the public header.
2. **Sunburst rays** on some posters — flat triangular bands radiating from
   the lower-left, never soft conic gradients.

**Imagery.**

- **Flat vector illustration** (speaker, microphone) with thick brown outlines
  (`#4a2e1f`), 2–4px, no gradients, no inner shadows — Adobe Illustrator
  retro-poster look. The speaker icon is the brand mascot and appears on
  nearly every poster.
- **Halftone collage** on some posters: scanned cassette tape, vinyl, a
  black-and-white open mouth in halftone, paper-textured banners. Warm,
  slightly aged, never pristine.
- **Photography is rare** on event materials; when used (Real Book Club: line
  drawing of a sax player), it's a vintage line-art reference, not stock photo.
- **Color vibe:** *warm*. Cream / orange / goldenrod dominate. The teal-blue is
  the "cool" balancing note. Posters are never black-and-white only; even the
  halftone collage pieces sit on cream with red and orange accents.

**Layout.**

- Generous, centered hero with a single H1, supporting paragraph, and one or
  two pill-shaped CTAs (`btn-wide` in daisyUI terms).
- Sections are alternating tinted bands; content stays in a `max-w-2xl` or
  `container mx-auto` rail.
- Three- and four-column "What We Do" grids of equal-height shadowed cards.
- Strong centered headings with a `text-lg opacity-70` lede directly beneath.
- A **fixed 10–12px tri-stripe** sits at the bottom of the site header on every
  page — the strongest brand recall device in the UI.

**Borders & corners.**

- **Cards:** `border-radius: 8px` (16px on hero/large cards), `shadow-xl` from
  daisyUI, no border by default. Colored variants (`bg-primary text-primary-content`)
  are used to call out "Get Involved" tiles.
- **Buttons:** daisyUI `btn` default radius (≈ 8px). Heart CTAs (`btn-wide`)
  feel pill-adjacent at small sizes.
- **Badges:** fully pill (`9999px`). Outline variants use a 2px border in the
  badge color; solid badges use bold weight at .8rem.

**Shadows.** Soft, daisyUI defaults: `shadow-sm`, `shadow`, `shadow-lg`,
`shadow-xl`. No neumorphic inner shadows. No long colored shadows. The poster
"retro rainbow" stack-shadow (goldenrod / red-orange / teal / navy offsets)
appears on the wordmark and is reserved for that.

**Borders.** Hairline `border-base-200` separators between header and body.
Tag badges may use a `2px` outline. Most surfaces rely on background tint
contrast, not borders.

**Animation & interaction.**

- **Hover:** simple `opacity: 0.7` on inline links and avatars; `hover:scale-105`
  on sponsor logo tiles; cards bump `z-index` on hover so any tooltips win
  stacking. No color shifts.
- **Transitions:** `transition: opacity 150ms ease` is the default. No spring
  or bounce easings.
- **Press:** daisyUI default — slight darkening of the button background.
- **Page-level animation:** none. The site is intentionally calm; the only
  motion is theme-toggle and Livewire fades.

**Transparency & blur.** A subtle `backdrop-filter: blur(10px)` on the navbar
in dark mode. Otherwise opacity is used only for text tiers
(`opacity-70` ≈ secondary text) and for tinting section backgrounds
(`bg-primary/20`).

**Themes.** Light (`corvmc`) and dark (`corvmc-dark`) ship side by side via
daisyUI in the codebase, and as plain `[data-theme]` overrides on `html` in
this system. Light is the canonical brand experience; dark is supported and
ergonomically equal, with a cool blue-gray base (deep charcoal `#161b22` →
section `#1d232c` → card `#262d38`), warm off-white text `#e6dcd0`, and the
brand accents lifted in lightness/chroma so orange / teal / goldenrod still
pop against the dark surfaces. The tri-stripe stays identical in both
themes — it's the strongest brand recall and shouldn't shift.

**How to switch.** Three activation paths, all in `colors_and_type.css`:
1. `<html data-theme="dark">` — explicit dark
2. `<html data-theme="corvmc-dark">` — daisyUI-compatible alias (matches the
   live site's localStorage value)
3. `prefers-color-scheme: dark` — automatic when no explicit theme is set
   (suppressed by `<html data-theme="light">`)

To avoid a light-mode flash on dark-mode-preferring users, set the
`data-theme` attribute in an inline `<script>` in the document head **before**
any framework mounts. See `ui_kits/website/index.html` for a reference
implementation that reads `localStorage["cmc-ui-kit-theme"]` first, falls back
to the `prefers-color-scheme` media query, and persists user choice.

---

## Iconography

- **Icon system:** **Tabler Icons** (stroke style, 1.5–2px), exposed through
  `blade-ui-kit/blade-tabler-icons` on the site. We mirror Tabler via the
  CDN in our UI kit (`@tabler/icons-react@3.x`), so any name like
  `IconCalendar`, `IconUsers`, `IconHeartHandshake`, `IconMusic`,
  `IconMicrophone-2`, `IconBook`, `IconList`, `IconApps`,
  `IconLayoutDashboardFilled`, `IconLogin`, `IconAlertCircle`,
  `IconAlertTriangle`, `IconFlame`, `IconNumber-1/2/3` resolves
  identically.
- **Sizing:** `size-5` (20px) for inline / button icons, `size-6` (24px) for
  nav and card headers, `size-8/10` (32/40px) for hero feature icons.
- **Color:** icons inherit text color (`currentColor`). On sidebar items
  the inactive icon is `var(--color-secondary)`.
- **Custom speaker icons:** three SVGs in `assets/icons/` —
  `speaker-check.svg`, `speaker-exclamation.svg`, `speaker-share.svg` —
  for use in success/error/share patterns. They borrow the cabinet outline of
  the main mark.
- **Logos:** the current marks are bundled. `cmc-speaker.png` is the
  canonical speaker mascot (no enclosing circle, no "CMC" lettering on the
  cabinet — those are deprecated; see Caveats). `cmc-compact-logo.svg` is
  the inline speaker + Lexend wordmark. `cmc-logo-horizontal.png` is the
  wide lockup. A vector monocolor variant is **not** currently bundled —
  see Caveats.
- **Emoji:** **never** used in product UI or marketing copy.
- **Unicode characters as glyphs:** sparingly — en-dash (–), pipe (|), `@`
  for social handles. No decorative glyphs like ✦ or ★.

---

## Caveats & substitutions

- **Fonts:** the site loads **Lexend** from Google Fonts directly; we mirror
  that via `@import url(...)` in `colors_and_type.css` rather than bundling
  woff2 files. No substitution needed.
- **Deprecated branding (do not reintroduce):** earlier CMC materials used
  (a) a curly-cursive display face on the wordmark and (b) the letters
  **C / M / C** stacked vertically down the orange side of the speaker
  cabinet. **Both have been phased out.** Set the wordmark in **Lexend 700
  in CMC teal**; use the plain `cmc-speaker.png` for the mark. The earlier
  "sticker" art (with the side lettering, sometimes inside a peach circle),
  the matching social avatars, and the old monocolor variants have been
  *removed* from this system on purpose — if you find them in older repos
  or print, treat them as historical reference only.
- **Monocolor logo:** the single-ink vector parts from the Figma master are
  bundled in `assets/logos/cmc-mono-speaker-*.svg`. The
  `preview/brand-logo-monocolor.html` card composes them via CSS positions.
  Sound lines are *omitted* in the bundled mono variant — if you need them
  rendered, fall back to the full-color `cmc-speaker.png`.
- The **retro stack-shadow** effect (`.retro-rainbow-shadow`) is a Lexend-
  based text-shadow utility, not a separate display font. Reach for it on
  hero / poster moments only — never on UI chrome or body copy.
- The **Real Book Club** sax-player illustration and the **cassette tape /
  vinyl / halftone mouth** collage pieces from the posters are not separable
  vectors we could extract — they exist only as rasters in
  `assets/posters/`. Use the posters as-is for moodboards; we did not try
  to recreate them.
