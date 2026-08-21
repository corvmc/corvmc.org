# Ideas

## Not Yet Built

### Sponsor Management

Track venue sponsors and their agreements. Manage sponsor logos, tiers, and placement preferences. Sponsors could be linked to events, rooms, or the venue as a whole.

### Local Resources Directory

A public-facing directory of local music-related businesses and spaces — record shops, prominent venues, instrument/gear shops, rehearsal studios, etc. Staff-curated with categories, descriptions, and links. Helps position the venue as a community hub and cross-promotes the local music ecosystem.

### Volunteer Coordination

Manage volunteer sign-ups, shift scheduling, and hour tracking for events and venue operations. Members could browse open volunteer slots, sign up, and log hours. Staff get a dashboard to define needs per event, confirm sign-ups, and track contributions.

**Progress:** Split into two phases in `docs/specs/volunteering-spec.md`. Phase 1 — staff-defined volunteer roles with job descriptions, member hour logging, a staff approval queue, and a date-ranged report by member/role/month — is built behind the `volunteering` flag. Phase 2 — opportunities and shifts, member sign-up, per-event and per-production staffing, and the daily shift-reminder cron — is designed there but deferred, as are certifications (who is cleared for which role, and when that lapses). Approved hours are tracking only; they grant no practice-room credits.

### Member Voting / Proposals

Formal voting system for a member-driven non-profit. Staff or board create proposals (board elections, budget priorities, policy changes, event programming) with a defined voting window. Members cast ballots, results publish automatically. Could also power a lightweight feature-request board where members upvote ideas to help prioritize development.

**Progress:** The lightweight half is built. `/member/suggestions` is a categorized board where members post ideas about anything — gear, programming, the space, policy, the website — upvote what they agree with, and read a public staff response with a status. Staff get the board sorted by votes, plus duplicate merging (votes transfer, deduped) and moderation: a member's report pulls a suggestion off the board pending review, and an upheld report puts the author's future suggestions through review first, reusing the standing rule community listings established. Not flag-gated, deliberately — a board with no audience collects single-vote posts. Specced in `docs/specs/member-suggestions-spec.md`. Formal balloting is still unbuilt and is a different feature: ballot secrecy, eligibility rules, and a close date have no counterpart in an upvote counter.

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

**Progress:** Designed in `docs/specs/moderation-appeals-spec.md`, unbuilt. It rests on one rule
that is a change to the system rather than an addition: **every moderation action is an upheld
report.** Reports come from members or from staff — a staffer who notices something files a report
and upholds it in the same action, which is not a fiction but the written record of why they acted.
Dismissing never costs anyone anything; upholding is the only thing that moderates. Two things fall
out: every moderation action is appealable through one mechanism, and every moderation action has a
stated reason.

That closes a real hole. `setStanding` takes `flagId` as optional today and `setMemberStanding` is a
staff form that restricts a member with no report behind it — the category least reviewed, since no
reporter and no triage was involved and one staffer decided alone. The spec makes `flagId` required
and routes the staff form through a filed-and-upheld report, with a `content_flag.origin` of
`report` or `staff_action` so the queue does not treat a staff action as pending work.

A `moderation_appeal` row hangs off the upheld flag — the inbox was weighed and rejected because a
thread has no outcome state, so the restore would still be a button somebody has to remember. Two
independent outcomes (the content and the standing), so "it broke the rules but a first offense
isn't probation" is expressible, and granting the standing half _is_ the restore. One appeal per
decision, reopenable by staff. Nothing pauses while pending. The second-staffer rule is by identity,
not role, with an asymmetry that keeps a one-staffer collective from deadlocking: you may overturn
yourself, you may not ratify yourself — which matters most in the staff-filed case, where one person
would otherwise file, uphold, and rule on the objection.

Standing is no longer part of this: the three tables merged into a scoped `member_standing` in its
own change (`docs/specs/member-standing-spec.md`), so appeals just calls
`restoreStanding({ userId, scope, staffId })`.

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

### Community Forum / Q&A

Member forum for gear advice, technique questions, and general music knowledge sharing. Threaded discussions, searchable archive, and topic categories. Complements the classifieds for gear talk and help articles for staff-curated knowledge with peer-to-peer support.

### Musician Classifieds / Jam Board

Community bulletin board for members. Post musician-wanted ads, band openings, gear for sale/trade, and jam session invites. Lighter and more immediate than mentorship matching — a quick way to find each other.

### Member Onboarding

Guided checklist for new members: orientation scheduling, safety walkthrough sign-off, gear policy acknowledgment, key fob activation, etc. Ensures everyone starts on the same page and gives staff visibility into onboarding progress.

### Venue Maintenance Requests

Members report broken gear, room issues, or facility problems. Staff track, prioritize, and resolve them. Keeps the space in shape without relying on hallway conversations.

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

**Progress:** Phases 1 and 2 shipped. Phase 1 made `/events` a unified gig guide: next-3 CMC hero posters plus a poster-forward list of CMC and member-band events, a compact mini-calendar date-jumper, and band events rendering on `/events/[id]` with band attribution (`docs/specs/community-calendar-spec.md`). Phase 2 added the third layer the extension point was left for — members author `source='community'` listings for off-site shows, publishing directly until staff uphold a report against them, after which their listings queue for review; anyone with no account can send an "Event Tip" through the contact form into the staff inbox. Cancelled events now stay on the guide marked cancelled instead of vanishing (`docs/specs/community-events-spec.md`). Still to come: partner feed imports and `.ics`/RSS syndication (no calendar UI package was needed — built on the already-installed `@internationalized/date`).

### Staff Events: Productions vs Listings

`/staff/events` is two jobs on one page. **Moderating listings** is reactive: a member or band posts
a show, almost all go straight to the public guide untouched, but a member whose standing is flagged
has theirs held at `pending_review` and staff get pinged. The questions are fixed — what is this,
who's behind it, is anything wrong — and the work is done when the queue is empty. **Running a
production** is the opposite shape: nobody pings you, one show is touched repeatedly over weeks, and
the characteristic failure is something quietly missing — no room held, no poster, no volunteers —
until it's too late to fix.

One page can't be shaped for both. Today it toggles between them with a `TabBar` and a source
`Select`, and the detail page carries every card for every source: a community listing at another
venue still renders "Space Reservation: no space held" and a "Volunteer Shifts: + schedule one" form
for a show CMC neither produces nor staffs. Meanwhile the review queue never shows who posted the
thing, which is the first fact a moderator needs.

The split is by **source**, not status. `/staff/events` becomes **Productions** (`source='cmc'`) — no
queue, New Event as the primary action, a status filter, and the Space column promoted so an unheld
room is visible while scanning. A new `/staff/listings` becomes **Listings** (`band` + `community`) —
opens on Needs review, badged in the sidebar from the `listingsPending` count `getStaffLayout`
already computes and nothing reads, with a **Posted by** column carrying the accountable party: the
band's chip for a band gig, the member for a community listing.

The detail page stays at **one route**. `entity-href.ts` sends every event ref to
`/staff/events/{id}` and `EventRef` carries no `source`, so two detail routes would mean adding
`source` to every event-ref producer. Gating the production cards on `source === 'cmc'` removes the
dead UI for a fraction of that cost. Both indexes should scope by an explicit allow-list rather than
by exclusion, so a future source lands on neither page until someone chooses — a group event going
missing is a visible bug, whereas one quietly appearing in the moderation queue is a wrong answer
nobody notices.

Losing the combined index costs less than it appears. The cross-source view staff actually want is
day-level — _is anything else on that night?_ — and that already exists as the public gig guide,
which is all-source by design and whose mini-calendar dots exist to answer exactly that. What the
staff index adds is the non-public rows, and those divide cleanly: a CMC draft is Productions, a
listing awaiting or refused review is Listings. The one real gap is scheduling against an
_unannounced_ show, which belongs in `checkConflicts` — today it guards the room, not the night.

**Progress:** Designed, unbuilt, and deliberately sequenced after Groups (see
[Club Management](#club-management)). That module renames `band` to `band_profile` and
`event.bandId` to `event.groupId`, which is precisely the join the Posted by column reads, and
extends `eventSources` with `'group'` — a club's jazz night is production-shaped, since it's a
staff-sanctioned program that holds the room free. Building this first means rebuilding it after.
Groups also independently prescribes the same `sources: EventSource[]` allow-list refactor for its
own source filters, so the two converge.

### Club Management

Tools for member-run clubs (jazz night, open mic, songwriter circle, etc.). Each club gets a dedicated space for managing a recurring event series, a member roster, and a simplified email/announcement system for communicating with club members. Club organizers can also share resources (files, links, lesson materials) with their members, similar to the teacher panel. Builds on top of the existing event and email marketing infrastructure without requiring club organizers to use the full staff tools.

**Progress:** Designed as the **Groups** module in `docs/specs/groups-spec.md`, unbuilt — the Real
Book Club jazz jam is that spec's driving case. It generalizes today's `band` table into `group`
(kind, roster, announcements, documents, events) plus `band_profile` (the musical identity a club
has no use for), so clubs and committees reuse the roster machinery without inheriting band-shaped
columns. Three kinds: `band | club | committee`. Bands stay member self-service; clubs and
committees are staff-created, which is what makes free room time safe to grant by kind — a program
gets the room through its event rather than a credit balance, and the abuse case is closed
structurally instead of by a check someone has to remember.

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

### Donation Wishlist

Public-facing list of items the venue needs — gear, furniture, supplies, services. Members and community can claim items they want to donate. Staff manage the list, mark items as fulfilled, and optionally acknowledge donors. Could tie into consumables inventory for recurring supply needs.

### Consumables Inventory

Track stock levels for space consumables — drumsticks, strings, cables, cleaning supplies, etc. Staff log restocks and usage, set low-stock alerts, and see spending over time. Complements the existing equipment system which covers loanable gear.

### Automatic Poster Compositing

Auto-generate event posters by compositing uploaded artwork with a branded footer containing event details (date, time, venue, ticket info) and sponsor logos. Reduces manual design work for recurring events and ensures consistent branding.

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

| Package     | Downloads/wk | Use                                                           |
| ----------- | ------------ | ------------------------------------------------------------- |
| `pdfkit`    | 3.6M         | Server-side PDF generation for annual reports                 |
| `puppeteer` | 10M          | Render styled HTML to PDF — most flexible for complex reports |
| `chart.js`  | 11.6M        | Chart generation for report data visualization                |

### Stage Plot & Drawing

| Package  | Downloads/wk | Use                                                                       |
| -------- | ------------ | ------------------------------------------------------------------------- |
| `konva`  | 1.7M         | 2D canvas with drag-and-drop shapes — stage plot builder                  |
| `fabric` | 796K         | Canvas with object model + SVG export — heavier but more drawing features |

### Inventory & Scanning

| Package        | Downloads/wk | Use                                                       |
| -------------- | ------------ | --------------------------------------------------------- |
| `html5-qrcode` | 1.1M         | Camera-based barcode/QR scanning for inventory management |
| `bwip-js`      | 572K         | Generate barcode/QR labels for printing                   |

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

Features behind feature flags in `src/lib/server/feature-flags.ts`. Toggled via Staff Settings.

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

## Equipment

**Flag:** `equipment`

Equipment catalog, loan management, and equipment credits. Adds an Equipment section to the staff sidebar with loan tracking and inventory management.

**Routes:** `/staff/equipment`, `/staff/equipment/loans`, `/staff/equipment/[id]`

## Help Articles

**Flag:** `helpArticles`

Knowledge base with staff-managed articles for members. Staff can create and edit articles; members can browse and search them. Adds a Content section to the staff sidebar and a Help section to the member sidebar.

**Routes (staff):** `/staff/help`, `/staff/help/create`, `/staff/help/[id]`
**Routes (member):** `/member/help`, `/member/help/[slug]`
**API:** `/api/help`, `/api/help/search`, `/api/help/[slug]`
