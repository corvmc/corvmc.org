# CorvMC User Manual — Manifest & Checklist

This is the canonical tracker for the end-user manual. It covers four audiences: **public
visitors**, **members**, **band managers**, and **staff**. Check items off as articles land.

## How it works

- Member / band / staff articles are markdown files in [`src/content/help/<category>/<slug>.md`](../../src/content/help).
  Each has YAML frontmatter (`title`, `slug`, `category`, `summary`, `minRole`, `sortOrder`) + a
  CommonMark body. Running `pnpm help:sync` upserts them into the Help DB as `source='static'`,
  auto-creates categories, and marks them `published`. They then appear at `/member/help`.
- **Public-site** articles live under [`public/`](public) here — the in-app KB (`/member/help`) is
  behind member auth, so public how-tos have no in-app home yet (see _Follow-ups_).
- `[P]` = **page-level** article (one per route: where things live + key actions).
  `[H]` = **task/how-to** article (a single workflow, step by step).
- Editing a `static` article in the staff UI is overwritten on the next sync — edit the markdown
  file, not the web copy.

## Categories

Each row is one `help_categories` entry (defined in `scripts/seed-dev.ts`; `sync-help-articles.ts`
auto-creates any missing).

| slug                | Name                 | icon            | minRole | Covers                                               |
| ------------------- | -------------------- | --------------- | ------- | ---------------------------------------------------- |
| `getting-started`   | Getting Started      | book            | member  | account, navigation, basics                          |
| `reservations`      | Practice Space       | calendar        | member  | booking, recurring, payment, credits                 |
| `profile-directory` | Profile & Directory  | user            | member  | profile editing, visibility, being found             |
| `bands`             | Bands                | music           | member  | create/join, invites, membership                     |
| `band-pages`        | Band Pages (Premium) | layout          | member  | subscription, page editor, EPK                       |
| `events-tickets`    | Events & Tickets     | ticket          | member  | browsing, tickets, QR check-in                       |
| `equipment`         | Equipment Lending    | package         | member  | catalog, requesting loans                            |
| `membership`        | Membership & Billing | heart           | member  | sustaining membership, Stripe portal                 |
| `volunteering`      | Volunteering         | heart-handshake | member  | roles, interest, shifts, clearances, hours, feedback |
| `messaging`         | Messages             | message         | member  | staff threads, member DMs, requests, blocks          |
| `suggestions`       | Suggestions          | bulb            | member  | the idea board, voting, statuses                     |
| `staff-guide`       | Staff Guide          | settings        | staff   | all staff operations                                 |

**Coverage:** ~8 public + ~35 member + ~19 band + ~20 staff ≈ **82 articles**.

---

## A. Public site → `public/` (markdown only)

- [x] `[P]` Home & site tour — what CMC offers, how to navigate
- [x] `[H]` Create an account / sign in (`/login`, register, password rules)
- [x] `[H]` Contact us & apply to perform (`/contact` form fields, subjects)
- [x] `[P]` Programs overview (`/programs` — practice space, shows, meetups/clubs)
- [x] `[H]` Ways to contribute (`/contribute` tiers, donate gear, volunteer)
- [x] `[P]` Browse the directory as a visitor (`/directory`, musicians vs bands)
- [x] `[P]` Browse events & buy tickets without an account (`/events`, guest checkout)
- [x] `[H]` Subscribe / unsubscribe from the newsletter (`/subscribe`, `/unsubscribe`)

## B. Member panel → `src/content/help/`

### getting-started

- [x] `[H]` Welcome to CorvMC — an overview of membership and what the panel offers
- [x] `[P]` Member dashboard tour (`/member` — quick links, this week, credits, invites)
- [x] `[H]` Set up your account & contact info (`/member/account`)
- [x] `[H]` Change your password
- [x] `[H]` Manage notification preferences
- [x] `[H]` Manage email subscriptions
- [x] `[H]` Delete your account
- [x] `[H]` Reporting something, and what happens next — filing a report, and what an upheld
      one costs, scoped per area

### profile-directory

- [x] `[P]` Your profile page overview (`/member/profile`)
- [x] `[H]` Write your bio, tagline & upload an avatar
- [x] `[H]` Add instruments & genres
- [x] `[H]` Set "looking for band / for hire / teaches / open to collab" flags
- [x] `[H]` Add links and directory contact info
- [x] `[H]` Control your directory visibility (public / members-only / hidden)
- [x] `[H]` Find other musicians & bands (`/member/directory`)

### reservations

- [x] `[P]` Practice space overview & booking policy (`/member/reservations`)
- [x] `[H]` Book a practice session _(expands seed `booking-a-session`)_
- [x] `[H]` Set up a recurring booking _(expands seed `recurring-reservations`)_
- [x] `[H]` Confirm a waitlisted reservation
- [x] `[H]` Pay for a reservation (`/member/reservations/[id]/pay`)
- [x] `[H]` Understand practice credits & free hours (sustaining benefit)
- [x] `[H]` Cancel or change a reservation

### equipment

- [x] `[P]` Equipment lending library overview (`/member/equipment`)
- [x] `[H]` Request an equipment loan
- [x] `[H]` Track your loans & returns (`/member/equipment/loans`)

### events-tickets

- [x] `[P]` Events for members (`/member/events`, filters)
- [x] `[H]` Buy a ticket
- [x] `[H]` Show your ticket / QR at the door (ticket stubs, check-in modal)

### membership

- [x] `[P]` Membership page overview (`/member/membership`)
- [x] `[H]` Become a sustaining member (subscription flow)
- [x] `[H]` Manage billing via the Stripe portal (update card, cancel, resume)
- [x] `[H]` Understand benefits, sliding scale & credit allocation

### volunteering

- [x] `[P]` Volunteering overview (`/member/volunteer`) — browsing roles, saying what interests you, claiming shifts, logging hours, the day-after survey
- [x] `[H]` Reviewing volunteer hours (minRole=staff) — scheduling shifts, the approval queue, the interest list, roles and clearances, the feedback rollup, the report

### messaging

- [x] `[P]` Messages (`/member/messages`) — staff threads and member threads in one list, requests, the phone layout
- [x] `[H]` Messaging another member — the request/accept consent model, blocking, reporting, turning DMs off

### suggestions

- [x] `[P]` The suggestion board (`/member/suggestions`) — posting, voting, statuses and staff responses, editing, duplicates, reporting

## C. Band panel → `src/content/help/`

### bands

- [x] `[P]` My bands & invitations (`/member/bands`)
- [x] `[H]` Create a band _(expands seed `creating-a-band`)_
- [x] `[H]` Accept or decline a band invitation
- [x] `[P]` Band dashboard tour (`/band/[slug]`)
- [x] `[H]` Invite members (existing member or by email)
- [x] `[H]` Manage roles, remove members, revoke invites (`/band/[slug]/members`)
- [x] `[H]` Transfer band ownership / leave a band
- [x] `[H]` Edit the band profile (bio, genres, links, visibility) (`/band/[slug]/edit`)
- [x] `[H]` Book a session as a band (`/band/[slug]/reservations/new`)
- [x] `[H]` Manage band reservations (`/band/[slug]/reservations`)
- [x] `[H]` Create & manage band events (`/band/[slug]/events`)
- [x] `[H]` Delete a band (danger zone) (`/band/[slug]/settings`)

### band-pages (Premium)

- [x] `[P]` What Premium band pages include (`/band/[slug]/subscription`)
- [x] `[H]` Upgrade to Premium (monthly/yearly, Stripe checkout)
- [x] `[P]` Page editor overview & the 14 block types (`/band/[slug]/page-editor`)
- [x] `[H]` Build your page: add, reorder & configure blocks
- [x] `[H]` Choose a theme & add custom CSS
- [x] `[H]` Upload media (gallery, hero, stage plot, tech rider)
- [x] `[H]` Fill in your press kit (`/band/[slug]/press-kit` — free for every act)

## D. Staff panel → `src/content/help/staff-guide/` (minRole=staff)

- [x] `[P]` Staff dashboard & navigation (`/staff`)
- [x] `[P]` Members & users overview (`/staff/users`, tiers, search)
- [x] `[H]` Edit a user, manage roles & adjust credits (`/staff/users/[id]`)
- [ ] `[H]` Impersonate a user for support — _blocked: the feature does not exist.
      Impersonation is explicitly deferred (`docs/specs/shipped/staff-bands-spec.md`), and the
      article that described it as working was removed._
- [x] `[H]` Manage reservations & resolve issues _(expands seed `staff-managing-reservations`)_
- [x] `[H]` Take payment / comp / refund a reservation (`/staff/reservations/[id]`)
- [x] `[H]` Manage recurring reservation series (`/staff/recurring`)
- [x] `[H]` Set facility closures / blackout dates (`/staff/closures`)
- [x] `[H]` Create & manage events; ticketing & check-in (`/staff/events`, `.../check-in`)
- [x] `[H]` Run an off-site or multi-day event (venue, two day-events, one project, duty lists)
- [x] `[H]` Manage bands (deactivate/reactivate, members) (`/staff/bands`)
- [x] `[H]` Manage the inventory catalog, units & categories (`/staff/inventory`)
- [x] `[H]` Approve loans & record returns (`/staff/inventory/loans`)
- [x] `[H]` Send an email campaign (`/staff/marketing/campaigns`)
- [x] `[H]` Build & manage audiences (`/staff/marketing/audiences`)
- [x] `[H]` Handle the contact inbox (`/staff/inbox`)
- [x] `[H]` Reconcile payments & credits (`/staff/payments`, `/staff/credits`)
- [x] `[H]` Author help articles (`/staff/help`, static-vs-dynamic, sync caveat)
- [x] `[H]` Work the moderation queues (`/staff/flags`, `/staff/suggestions`) — upholding vs
      dismissing, scoping a restriction, running the idea board
- [x] `[P]` System settings reference (`/staff/settings` — products, reservations, org, integrations, inbox channels)

---

## Follow-ups (not in the first pass)

- **Public help route** — so `public/` content surfaces in-app. Flagged, not built.
- **Screenshots/diagrams** — text-first now; images later.
