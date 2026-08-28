# Ideas

## Not Yet Built

### Sponsor Management

Track venue sponsors and their agreements. Manage sponsor logos, tiers, and placement preferences. Sponsors could be linked to events, rooms, or the venue as a whole.

**Progress:** Not built. `docs/specs/committees-and-roles-spec.md` assigns this to the Development committee, alongside `Grant & Fundraising Tracker` and a renewal calendar for permits, licenses and insurance — three unbuilt things that are all the same shape: an agreement with a counterparty, a deadline, and an obligation afterwards.

### Local Resources Directory

A public-facing directory of local music-related businesses and spaces — record shops, prominent venues, instrument/gear shops, rehearsal studios, etc. Staff-curated with categories, descriptions, and links. Helps position the venue as a community hub and cross-promotes the local music ecosystem.

### Volunteer Coordination

Manage volunteer sign-ups, shift scheduling, and hour tracking for events and venue operations. Members could browse open volunteer slots, sign up, and log hours. Staff get a dashboard to define needs per event, confirm sign-ups, and track contributions.

**Progress:** Built, both phases, specced in `docs/specs/shipped/volunteering-spec.md` and gated by the `volunteering` flag. Phase 1: staff-defined roles with job descriptions, member hour logging, a staff approval queue, and a date-ranged report by member/role/month. Phase 2 (#235): volunteer shifts with member sign-up, a shift attachable to the show it staffs, certifications and clearances (who is cleared for which role, and when that lapses), post-shift feedback, and three crons. Approved hours are tracking only; they grant no practice-room credits. Still open: per-**production** staffing, which waits on productions existing at all; CSV export; bulk approve.

### Member Voting / Proposals

Formal voting system for a member-driven non-profit. Staff or board create proposals (board elections, budget priorities, policy changes, event programming) with a defined voting window. Members cast ballots, results publish automatically. Could also power a lightweight feature-request board where members upvote ideas to help prioritize development.

**Progress:** The lightweight half is built. `/member/suggestions` is a categorized board where members post ideas about anything — gear, programming, the space, policy, the website — upvote what they agree with, and read a public staff response with a status. Staff get the board sorted by votes, plus duplicate merging (votes transfer, deduped) and moderation: a member's report pulls a suggestion off the board pending review, and an upheld report puts the author's future suggestions through review first, reusing the standing rule community listings established. Not flag-gated, deliberately — a board with no audience collects single-vote posts. Specced in `docs/specs/shipped/member-suggestions-spec.md`. Formal balloting is still unbuilt and is a different feature: ballot secrecy, eligibility rules, and a close date have no counterpart in an upvote counter.

### Moderation Appeals

There is no way for a member to contest a moderation decision. When staff uphold a report — on
a community listing or a suggestion — the post comes down and the member's future posts go
through review, and their only recourse is to message staff and hope. That is workable at the
current size and clearly not workable at three times it: the person who most needs a channel is
the one who has just been told they are not trusted, which is exactly when an informal "just ask
us" breaks down.

Wants a lightweight appeal attached to the upheld flag rather than a new inbox thread, so staff
see the decision and the objection together, and a second staffer can be the one to answer it.
Would also want an outcome that restores standing automatically when an appeal succeeds, since
the manual "Restore posting trust" button is easy to forget after the conversation has moved on.

**Progress:** Designed in `docs/specs/moderation-appeals-spec.md`, unbuilt — no `moderation_appeal`
table exists and `setStanding` still takes `flagId` as optional. The spec rests on one rule that is a
change to the system rather than an addition — **every moderation action is an upheld report**, filed
by a member or by the staffer who acted — from which appealability and a stated reason both fall out.
Read it there rather than here.

Still open, and not an appeals problem: **suggestions have no return state.** Community listings do
— `rejected` and `draft` are both editable and republishable, so a turned-down listing is a
conversation with a turn in it. A hidden suggestion is terminal, since editing is blocked for
anything but `visible`/`pending_review`, so `hidden` does double duty as "this is bad, gone" and
"not like this." An appeal can now restore it, but the cheaper everyday fix is still a returnable
state where staff hand it back with a note and the author edits. Not yet specced.

Account deactivation is deliberately out until there is a real ban to appeal against — see the
CHORES entry on there being no platform ban, only deactivation.

### Merch Consignment

Let bands list merch for sale at the venue. Track inventory, sales splits, and payouts. Ties into the existing band and payments systems.

### Event Recaps / Photo Gallery

Staff or bands upload photos after events. Builds a public archive and gives bands shareable content. Could tie into automatic poster compositing for a cohesive visual identity.

### Member Skill Tags

Let members tag themselves with skills (sound engineer, photographer, promoter). Makes it easy for bands or staff to find help — and feeds naturally into volunteer coordination.

### Sponsored Event Placement

Let sponsors buy visibility on specific events — logo on the poster, mention in email blasts, branding on the event page. More granular than venue-wide sponsorship and priced per event. Ties into sponsor management for tracking agreements and automatic poster compositing for logo placement.

### Affiliate Commissions

Partner with gear shops and music businesses in the local resources directory for referral revenue on member purchases. Track click-throughs and commissions. Turns the directory from a community resource into a revenue channel.

### Booking Request Pipeline

External bands and promoters submit booking inquiries through a public form. Staff review, negotiate, and track from inquiry to confirmed event. Replaces scattered emails with a structured pipeline.

**Progress:** The staff-side half is designed in `docs/specs/production-workflow-spec.md` — a production moves `draft → offered → confirmed`, with per-slot offer terms (guarantee, door split) and invited/confirmed/declined status. The public inquiry form is explicitly deferred there; it would land as a `draft` production.

### Tech Rider Management

Bands submit stage plots and backline requirements ahead of events. Staff match against available gear and flag gaps before load-in. Cuts down day-of surprises.

**Progress:** Designed as the advance stage of `docs/specs/production-workflow-spec.md` — per-slot `techNotes`/`backlineNeeds`, an advance checklist, and reuse of the rider/stage-plot/backline fields already on `BandEpk` and `band_media` for premium member bands. Matching against the equipment catalog is not in that spec.

### Annual Report Generator

Pull stats across the platform — events held, members active, volunteer hours, revenue, grants received — into a formatted report for the board and funders. Non-profits need this every year.

**Progress:** Not built. `docs/specs/reporting-spec.md` sequences it as the last phase and settles the shape: the rollup calls each module's existing report service rather than writing its own queries, so `getVolunteerTotals()` and `getCommunityStats()` are already the queries it will use. The open piece is revenue — nothing in the app sums `payment_cache`, so that line is a design decision (Stripe as the authoritative total, local rows for the per-member breakdown) rather than a query to write.

### Community Forum / Q&A

Member forum for gear advice, technique questions, and general music knowledge sharing. Threaded discussions, searchable archive, and topic categories. Complements the classifieds for gear talk and help articles for staff-curated knowledge with peer-to-peer support.

### Musician Classifieds / Jam Board

Community bulletin board for members. Post musician-wanted ads, band openings, gear for sale/trade, and jam session invites. Lighter and more immediate than mentorship matching — a quick way to find each other.

### Member Onboarding

Guided checklist for new members: orientation scheduling, safety walkthrough sign-off, gear policy acknowledgment, key fob activation, etc. Ensures everyone starts on the same page and gives staff visibility into onboarding progress.

### Venue Maintenance Requests

Members report broken gear, room issues, or facility problems. Staff track, prioritize, and resolve them. Keeps the space in shape without relying on hallway conversations.

**Progress:** Not built. `docs/specs/committees-and-roles-spec.md` puts it under the Facility committee with two adjacent gaps it does not cover — a cleaning schedule somebody is assigned to, and a register of key, lock and alarm-code holders (distinct from the reservation door-code integration, and the higher-consequence half). The labor is already served: work parties are a volunteer role and schedule as ordinary shifts.

### Incident & Safety Log

Staff log noise complaints, safety incidents, or property damage for liability, insurance, and neighbor relations. Track resolution and spot recurring patterns. Important for a venue's long-term survival.

### Event Settlement

After an event, calculate door splits, bar revenue, and band payouts. Automates end-of-night accounting and ties into the existing payments system.

**Progress:** Designed as the settlement stage of `docs/specs/production-workflow-spec.md` — ticket revenue read from `ticket` + `payment_cache`, a `production_expense` table, suggested payouts from `max(guarantee, door split %)`, and a frozen snapshot on settle. Deliberately a worksheet, not a disbursement system: no Stripe payouts.

### Mentorship Matching

Pair experienced musicians with newer members by instrument, genre, or interest. Builds on member skill tags to facilitate connections and track mentorship relationships.

### Grant & Fundraising Tracker

Track grant applications, deadlines, award status, and reporting obligations. Could surface on the staff dashboard alongside donation wishlist fulfillment.

### Community Calendar

A regional music calendar with three event layers: venue events auto-populated from internal systems, community-submitted events moderated by staff, and partner feeds batch-imported from sponsors and affiliated venues. On the export side, syndicate events out to other local aggregators via standardized feeds, API, or formatted blasts — positioning the venue as a two-way hub for the local music scene.

**Progress:** Phases 1 and 2 shipped. Phase 1 made `/events` a unified gig guide: next-3 CMC hero posters plus a poster-forward list of CMC and member-band events, a compact mini-calendar date-jumper, and band events rendering on `/events/[id]` with band attribution (`docs/specs/shipped/community-calendar-spec.md`). Phase 2 added the third layer the extension point was left for — members author `source='community'` listings for off-site shows, publishing directly until staff uphold a report against them, after which their listings queue for review; anyone with no account can send an "Event Tip" through the contact form into the staff inbox. Cancelled events now stay on the guide marked cancelled instead of vanishing (`docs/specs/shipped/community-events-spec.md`). Still to come: partner feed imports and `.ics`/RSS syndication (no calendar UI package was needed — built on the already-installed `@internationalized/date`).

### Staff Events: Productions and Calendar

`/staff/events` is two jobs on one page. **Moderating** is reactive: a member or band posts a show,
almost all go straight to the public guide untouched, but a member whose standing is flagged has
theirs held at `pending_review` and staff get pinged. The questions are fixed — what is this, who's
behind it, is anything wrong, is it already on the calendar — and the work is done when the queue is
empty. **Running a production** is the opposite shape: nobody pings you, one show is touched
repeatedly over weeks, and the characteristic failure is something quietly missing — no room held,
no poster, no volunteers — until it's too late to fix.

One page can't be shaped for both. Today it toggles between them with a `TabBar` and a source
`Select`, and the detail page carries every card for every source: a community listing at another
venue still renders "Space Reservation: no space held" and a "Volunteer Shifts: + schedule one" form
for a show CMC neither produces nor staffs.

The axis is **work versus publicity**. `/staff/events` becomes **Productions** — `source='cmc'` at
every status, the surface where a show is built: drafts, the room, the ticket ledger, the check-in
door. A new `/staff/calendar` is the staff's view of the public gig guide — **every** source,
public statuses plus `pending_review`, forward-chronological, with the moderation actions on each
row and a **Posted by** column naming whoever is accountable. A CMC show appears on both, in two
roles; neither page is a superset of the other, since Productions holds drafts the Calendar must
never show.

Splitting the moderation half by _source_ was the first design and it was wrong, because it answers
a question moderators don't ask. The clincher is duplicates: `checkForDuplicate`'s own comment calls
two people posting the same gig "the characteristic failure of a community calendar" and names
moderation as the only backstop — yet `findDuplicateListing` returns null unless the caller is the
listing's own author, so **staff have no duplicate detection at all**. The duplicate is frequently
one of our own shows, re-posted by a member who didn't know we had it listed. A source-scoped page
structurally cannot show that; a calendar shows it by construction.

The detail page stays at **one route**. `entity-href.ts` sends every event ref to
`/staff/events/{id}` and `EventRef` carries no `source`, so two detail routes would mean adding
`source` to every event-ref producer. Gating the production cards on `source === 'cmc'` removes the
dead UI for a fraction of that cost.

**Progress:** Built. `/staff/events` is Productions and `/staff/calendar` is the staff gig guide;
the shared detail page gates its production cards on source. No schema change, and no change to
`listAll` or `getStaffEvents` either — Productions calls the existing query with `source: 'cmc'`,
and the Calendar got its own read modelled on the gig guide's. Design rationale, including the
axis that was rejected, is archived in `docs/specs/shipped/staff-events-split-spec.md`; behaviour
lives in `docs/development/business-workflows.md` §5. Groups phase 9 will add a **fourth**
`eventSources` value, `'group'`, for club sessions rather than renaming an existing one — those
reach the Calendar for free when they publish, while their work-side home stays open for the
Groups panel design to settle.

### Club Management

Tools for member-run clubs (jazz night, open mic, songwriter circle, etc.). Each club gets a dedicated space for managing a recurring event series, a member roster, and a simplified email/announcement system for communicating with club members. Club organizers can also share resources (files, links, lesson materials) with their members, similar to the teacher panel. Builds on top of the existing event and email marketing infrastructure without requiring club organizers to use the full staff tools.

**Progress:** Being built as the **Groups** module (`docs/specs/groups-spec.md`) — the Real Book
Club jazz jam is that spec's driving case. It splits today's `band` table by **purpose** into four:
`group` (kind, roster, announcements, documents, events), `directory_entry` (the public listing,
shared with members), `band_site` (the premium microsite), and `contact` (private details of people
who are not members). Clubs and committees reuse the roster machinery without inheriting band-shaped
columns. Three kinds: `band | club | committee`. Bands stay member self-service; clubs and
committees are staff-created, which is what makes free room time safe to grant by kind — a program
gets the room through its event rather than a credit balance, so the abuse case is closed
structurally instead of by a check someone has to remember. Phases 0–2 and 3a have landed (the
`group` table, `band_member` → `group_member`, `directory_entry`); club-facing behaviour arrives at
phase 5 and phase 9 (group events). Phase 5 deliberately does **not** give a club a panel: a club
member's whole surface is four things, three of which already arrive by notification and on the
calendar, so clubs live on one tabbed page at `/member/groups/{slug}`, indexed at `/member/groups`,
which does discovery as well as membership. Bands are excluded from that index and keep
`/member/bands` — two indexes, because "what can I be part of" is not a question a band answers. Join policies are `open`,
`invite_only` and `by_application`.

### Poster Art Repository

Artists upload poster art and templates to a shared library. Musicians browse and license artwork for their events — either for a fee paid to the artist or covered by a portion of their membership dues. Ties into automatic poster compositing so licensed art can flow directly into event poster generation.

### Member Music Store / Web Radio

Members and bands upload tracks for sale or streaming. A public-facing storefront for digital music sales and a web radio station that rotates member music. Gives bands exposure, generates revenue for artists and the venue, and feeds into ASCAP/BMI compliance tracking with a built-in play log.

### ASCAP/BMI Compliance Tracking

Track setlists and song performances for music licensing compliance. Log what gets played at events to simplify reporting to ASCAP, BMI, and SESAC. Could auto-generate required reports and track license renewal dates. Useful both for the venue itself and as a service offered to other local businesses through the local resources directory.

### Lessons / Teacher Panel

Tools for members who teach music lessons at the venue. A teacher panel for sharing resources with students, keeping lesson notes, and coordinating schedules. Could integrate with the reservation system for booking lesson rooms and with member profiles to link teachers to their specialties.

### Gear Library

Track gear donations with donor attribution, condition notes, and provenance. Members can submit acquisition requests for gear the venue doesn't have yet — like a library purchase request. Staff review, prioritize (possibly informed by member voting), and fulfill. Ties into the donation wishlist for sourcing and the equipment system for cataloging once acquired.

**Progress:** The tracking half is built and specced in `docs/specs/inventory-spec.md`. Every
physical unit of a serialized item is now its own `inventory_asset` row with its own condition,
serial, repair history and the `acquisition` it arrived on — so donor attribution and provenance
have somewhere to live, which they did not under the old single-table schema. Donations,
purchases and grants are one `acquisition` table, carrying the fair-value basis and intended use
that FASB ASU 2020-07 requires a nonprofit to disclose.

The request half turned out to be **already shipped under a different name**: `gear_equipment` is
a live category on `/member/suggestions`, with upvotes, a staff response and the
`open → planned → in_progress → done / declined` lifecycle. A gear suggestion marked `planned`
_is_ the purchase request this entry describes. Phase 2 links the two rather than building a
second queue.

### Donation Wishlist

Public-facing list of items the venue needs — gear, furniture, supplies, services. Members and community can claim items they want to donate. Staff manage the list, mark items as fulfilled, and optionally acknowledge donors. Could tie into consumables inventory for recurring supply needs.

**Progress:** Not built, and deliberately **not a new list**. `docs/specs/inventory-spec.md`
settles that demand for the unknown already lives on the suggestions board (`gear_equipment`,
upvoted) and replenishment of the known lives on reorder points, so the wishlist is the public
projection of rows that already exist rather than a fourth thing to maintain. Donor
acknowledgment is a field on `acquisition` (`acknowledgedAt`, `appraisalRef`) for the IRS Form
8283 threshold, and is Phase 3 of that spec.

### Consumables Inventory

Track stock levels for space consumables — drumsticks, strings, cables, cleaning supplies, etc. Staff log restocks and usage, set low-stock alerts, and see spending over time. Complements the existing equipment system which covers loanable gear.

**Progress:** Built, and **not** a complement to the equipment system — the same one. Specced in
`docs/specs/inventory-spec.md`: gear and consumables are one catalog on one append-only ledger,
differing by `kind` (serialized vs bulk) and `isLoanable` (comes back vs does not). A consumable
is derived from that pair, never stored. Restocks are `acquisition` rows, usage is a `consume`
movement, low stock is a reorder point the staff dashboard surfaces on its own, and spend over
time is a query rather than a report anyone has to build. What is still open is the spend report
UI itself and the `supplier` table that normalises the free-text source (Phase 2).

### Automatic Poster Compositing

Auto-generate event posters by compositing uploaded artwork with a branded footer containing event details (date, time, venue, ticket info) and sponsor logos. Reduces manual design work for recurring events and ensures consistent branding.

### Committee Operations

Give the six committees a working surface: a roster where each member's named position means
something, a path from "I'm interested in Programming" to actually being on it, a report to the
board on a cadence, and the spending limit a chair works inside. The groups module already
carries committees as `kind = 'committee'` with a roster, announcements and documents; what is
missing is everything that makes a committee a committee rather than a group chat with a
filing cabinet.

**Progress:** Requirements enumerated in `docs/specs/committees-and-roles-spec.md`, which maps
the whole committee structure against what the app serves today and has settled its five open
questions. Two decisions shape the work: a committee is a `by_application` group — so joining
one rides phase 5 of `groups-spec.md` and the committee `volunteer_role` bucket retires with it
— and committee members act within their own domain, which makes `admin-vs-staff-spec.md`'s
Option B a hard prerequisite rather than an adjacent cleanup. `group_member.position` stays free
text that nothing reads, deliberately: committee titles are the chair's to invent and rename,
and code that read them would constrain them.

The larger framing that came out of it: the committees are meant to become the app's organizing
principle rather than a permission overlay on the entity-filed staff panel, which stays on as the
administrative tool underneath. Most of what the committees lack is not tables — it is dedicated
workflow affordances over tables that already exist, which is a different and cheaper problem
than the raw gap count suggests. Programming and Production get the first surface, and
`production-workflow-spec.md` is already most of it.

### Poster Art Commissioning

Commission the poster for an event from a local artist: a roster of artists and what each has
made, an info packet sent per event, image rights agreed in writing before work starts, the
file back before the publication deadline, and a record of what the artist is owed and how they
are credited. Distinct from `Poster Art Repository` (a library artists upload to and musicians
license from) and from `Automatic Poster Compositing` (generating the finished image) — this is
the relationship and the deadline, not the file.

**Progress:** Not built, and the largest uncovered workflow in
`docs/specs/committees-and-roles-spec.md`. `event.posterKey` is the finished file; nothing
models how it got there, and the flyer cutoff that Communications is supposed to enforce has
nothing to enforce against.

### Market Vendor Management

Run a market day: recruit vendors, take applications against a deadline, set and collect table
fees, lay out the table map, check vendors in on the day, handle no-shows and reassignments,
and record who sold well enough to invite back. Pairs the Development committee's recruiting
duties with the vendor host's day-of role as one feature rather than two.

**Progress:** Not built; nothing in the app models a vendor, a table, or a market day. Fee
collection would ride the existing Stripe integration, and check-in is close in shape to
`/staff/events/[id]/check-in`.

### Recording Session Management

Track a recording session end to end: booking the session, multitrack capture at sessions and
at shows, file custody and backups, a signed release before anything is used, and the handoff
to whoever mixes and masters it. The Production committee already trains and clears the
engineers through the certification module; the sessions themselves have nowhere to live.

**Progress:** Not built. `media` stores finished files and is not session management. The
release-form half is shared with two other committees — photo and video subject releases for
Communications, image-rights agreements for Art and Merch — and is called out in
`docs/specs/committees-and-roles-spec.md` as one problem that will otherwise be solved three
times.

## Laravel-era, not yet reviewed

Features the legacy Laravel app had that this one never rebuilt. They were tracked in the parity
report until it became the feature catalog (2026-08-26); they are parked here so the call can be
made deliberately rather than lost. Nobody has decided these are wanted — several may simply be
artifacts of how the old app was organised.

### Site Pages / CMS

A staff-editable page builder for the public site — the Laravel app had one with a block builder.
Nothing equivalent exists here; public pages are Svelte routes, edited in the repo.

### Kiosk Devices

A registered-device concept for a terminal in the space — check-in, door access, or a
walk-up booking screen. The Laravel app had a `KioskDevices` resource; what it was actually for is
not recorded anywhere.

### Bylaws

A place to publish and version the collective's bylaws. Currently they live outside the app.

### Revisions

Generic revision history for edited records. Partly overtaken by
[`docs/specs/audit-log-spec.md`](docs/specs/audit-log-spec.md), which covers staff actions on member
accounts; a general content-revision layer is a bigger and much less obviously needed thing.

### Member Order History

A "my payments" view for members. Would pull from Stripe and the `payment_cache` table rather than
a local order ledger, since Stripe is the source of truth. Staff already have this at
`/staff/payments`; members do not.

### Public About Page

The public site has no About page. The most clearly wanted item in this group.

---

---

## Library Reference

Existing npm packages that could accelerate building these features. Grouped by area.

### Image Processing & Poster Compositing

| Package           | Downloads/wk | Use                                                                                     |
| ----------------- | ------------ | --------------------------------------------------------------------------------------- |
| `sharp`           | 66M          | Server-side image compositing, watermarking, thumbnails, format conversion              |
| `@napi-rs/canvas` | 12M          | Full Canvas 2D API in Node — rich text rendering, complex layouts for poster generation |
| `satori`          | 1.3M         | HTML+CSS to SVG — template-driven poster design, pipe through sharp for raster output   |
| `photoswipe`      | 510K         | Client-side lightbox for photo galleries — lightweight, touch/gesture support           |

### Calendar & Scheduling

| Package                | Downloads/wk | Use                                                                  |
| ---------------------- | ------------ | -------------------------------------------------------------------- |
| `ical-generator`       | 468K         | Generate .ics feeds for event syndication                            |
| `node-ical`            | 163K         | Parse partner .ics feeds for import                                  |
| `feed`                 | 1.2M         | Generate RSS/Atom feeds for event syndication                        |
| `@event-calendar/core` | 23K          | Svelte-native calendar display — day/week/month views, drag-and-drop |
| `@schedule-x/svelte`   | 121K         | Calendar with official Svelte adapter — modern alternative           |

### Audio & Streaming

| Package          | Downloads/wk | Use                                                                         |
| ---------------- | ------------ | --------------------------------------------------------------------------- |
| `wavesurfer.js`  | 881K         | Waveform visualization + playback for music store                           |
| `howler.js`      | 777K         | Cross-browser audio playback, playlists — simpler alternative to wavesurfer |
| `music-metadata` | 1.9M         | Server-side ID3/metadata extraction — feeds ASCAP/BMI compliance logs       |
| `hls.js`         | 5.3M         | HLS playback in browsers for web radio streaming                            |

### Forum & Content

| Package           | Downloads/wk | Use                                                  |
| ----------------- | ------------ | ---------------------------------------------------- |
| `marked`          | 42M          | Markdown to HTML for forum posts — fast, lightweight |
| `rehype-sanitize` | 4.9M         | Sanitize user-generated HTML — pair with marked      |
| `minisearch`      | 1.2M         | Client-side full-text search for forum/help articles |

### PDF & Reporting

| Package         | Downloads/wk | Use                                                               |
| --------------- | ------------ | ----------------------------------------------------------------- |
| `csv-stringify` | 9.7M         | CSV export. No runtime deps; use `csv-stringify/browser/esm/sync` |
| `chart.js`      | 12.8M        | Charts — but see the note on SSR below before picking a library   |

**`puppeteer` and `pdfkit` were listed here and are wrong for this stack.** Puppeteer cannot run
inside a Cloudflare Worker at all; the platform answer for HTML → PDF is **Cloudflare Browser
Rendering** (a `/pdf` REST endpoint or the binding), which needs no npm dependency. A print
stylesheet over the report page comes first either way — see `docs/specs/reporting-spec.md`.

Two things to know before adding either of the above:

- **`csv-stringify` must be configured with `escape_formulas`.** It does not escape a leading `=`,
  `+`, `-` or `@` by default, and neither does PapaParse — CSV formula injection is the reason to
  take the dependency rather than hand-rolling the quoting. The `src/lib/server/report/csv.ts`
  wrapper forces the flag on so no call site can forget it.
- **A charting library is not yet chosen, and the constraint is SSR.** The board packet is a print
  artifact, so a library that emits SVG without a browser DOM wins. `chart.js` and Observable Plot
  both assume a DOM; LayerChart is Svelte-native and worth testing first.

### Stage Plot & Drawing

| Package  | Downloads/wk | Use                                                                       |
| -------- | ------------ | ------------------------------------------------------------------------- |
| `konva`  | 1.7M         | 2D canvas with drag-and-drop shapes — stage plot builder                  |
| `fabric` | 796K         | Canvas with object model + SVG export — heavier but more drawing features |

### Inventory & Scanning

| Package            | Downloads/wk | Use                                                                        |
| ------------------ | ------------ | -------------------------------------------------------------------------- |
| `barcode-detector` | 1.5M         | Camera-based barcode/QR scanning — ZXing-C++ via wasm, actively maintained |
| `bwip-js`          | 572K         | Generate barcode/QR labels for printing                                    |

### Drag & Drop / Pipeline UI

| Package             | Downloads/wk | Use                                                                   |
| ------------------- | ------------ | --------------------------------------------------------------------- |
| `svelte-dnd-action` | 134K         | Svelte-native DnD — kanban boards for booking pipeline, grant tracker |

### No Good Library Found (yet)

Areas where the npm ecosystem is thin — worth revisiting periodically.

- **Voting / Ranked Choice** — no well-maintained package exists; `nanoid` can generate ballot IDs
- **Affiliate Tracking** — no turnkey solution; `nanoid` or `hashids` for referral codes, rest is custom
- **Shift Scheduling UI** — no standalone package; build on top of a calendar component

---

## Feature-Flagged (Built, Not Yet Enabled)

Features behind feature flags in `src/lib/server/feature-flags.ts` — all seven of `ALL_FLAGS`, in declaration order. Toggled via Staff Settings.

Inventory used to be here as `equipment`; its flag was cut in #286 and the module is now always on.

## Staff Inbox

**Flag:** `staffInbox`

Multi-channel unified inbox for email, SMS, and web messages. Adds an Inbox nav item to the staff sidebar with conversation list and detail views. Inbound webhooks for Postmark (email) and Twilio (SMS) are gated behind the flag.

**Routes:** `/staff/inbox`, `/staff/inbox/[id]`
**API:** `/api/inbox/postmark`, `/api/inbox/twilio`

## Band Premium

**Flag:** `bandPremium`

Premium tier system for bands with page editor, EPK, and public band sites. When enabled, band owners see a Subscription nav item. Premium-tier bands also get access to a Page Editor for their public site.

**Routes:** `/band/[slug]/subscription`, `/band/[slug]/page-editor`

## Email Marketing

**Flag:** `emailMarketing`

Audience management, campaigns, and broadcast emails. Adds a Marketing section to the staff sidebar with Campaigns and Audiences views. Includes campaign creation, editing, and a cron-based send pipeline.

**Routes:** `/staff/marketing/campaigns`, `/staff/marketing/campaigns/new`, `/staff/marketing/campaigns/[id]`, `/staff/marketing/campaigns/[id]/edit`, `/staff/marketing/audiences`, `/staff/marketing/audiences/[id]`
**API:** `/api/cron/send-campaigns`

## Help Articles

**Flag:** `helpArticles`

Knowledge base with staff-managed articles for members. Staff can create and edit articles; members can browse and search them. Adds a Content section to the staff sidebar and a Help section to the member sidebar.

**Routes (staff):** `/staff/help`, `/staff/help/create`, `/staff/help/[id]`
**Routes (member):** `/member/help`, `/member/help/[slug]`
**API:** `/api/help`, `/api/help/search`, `/api/help/[slug]`

## Content Flags

**Flag:** `contentFlags`

Member reporting and the staff triage queue. Members report a profile, band, event or suggestion; staff uphold or dismiss, and an upheld report writes `member_standing`. The flag gates the member-facing report button only — the staff queue is always on.

**Routes (staff):** `/staff/flags`, `/staff/flags/[id]`

## Direct Messages

**Flag:** `directMessages`

Member↔member messaging with request/accept consent, blocks, silent drops and reporting. Shares the inbox transport with member↔staff portal chat, which is not flagged.

**Routes:** `/member/messages`, `/member/messages/[id]`

## Volunteering

**Flag:** `volunteering`

Volunteer roles, hour logging and approval, shifts and sign-up, certifications and clearances, post-shift feedback. Gates the member surface only; the staff panel always shows it.

**Routes (staff):** `/staff/volunteer`, `/staff/volunteer/{roles,roles/[id],shifts,shifts/[id],certifications,clearances,report}`
**Routes (member):** `/member/volunteer`, `/member/volunteer/{start,interests,blocked,feedback/[signupId]}`
**API:** `/api/cron/{shift-reminders,complete-shifts,shift-feedback}`
