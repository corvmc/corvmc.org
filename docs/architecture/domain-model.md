# The domain model

What the app is made of, above the level of individual features. Read
[overview.md](overview.md) for how the system is wired — remote functions, auth, the
event bus, cron; this document is about what the tables _mean_ and which shapes recur.

## Three verticals over two horizontals

**Verticals** — a thing the collective does, with its own screens and its own lifecycle:

| Vertical               | What it is                                         | Modules                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Asset management**   | Physical resources: reserve, loan, service, retire | `reservation`, `recurring_series`, `closure`, lock codes, `instructor`, `inventory_*`, `stock_movement`, `acquisition`, `purchase_order`, `contractor_job` (repair), `media`    |
| **Project management** | Work that has to get done, by someone, by a time   | `project`, `work_order`, `volunteer_signup`, `work_task`, `duty_list*`, `volunteer_hour_log`, certifications, `contractor_job` (commissioned), `event` (CMC-produced), `ticket` |
| **Social**             | People and the connections between them            | `user`, `directory_entry`, `group`, `group_member`, `band_site`, `suggestion`, `content_flag`, `member_standing`, `user_block`, `event` (band and community listings)           |

**Horizontals** — services every vertical emits into:

- **Comms** — `inbox`, `notification`, `marketing`, direct messages, `announcement`
- **Money** — `finance`, Stripe, `credit_transaction`, `payment_cache`

Money is horizontal for the same reason comms is: credits settle both room bookings and
gear loans (assets), ticket revenue comes off shows (projects), and dues come off
membership (social). No vertical owns it.

### Two things the taxonomy makes obvious

**A reservation is a loan.** `reservationStatuses`, `loanStatuses` and
`contractorJobStatuses` are three spellings of one custody machine — see Model 1. The
room, the amp, and the amp at the repair shop are the same flow over different
resources, which is why they are one vertical rather than "space" and "gear."

**A show is a project.** `duty_list` stamps work orders onto an event anchored at
`doors|start|end`; `work_task` is the checklist; `volunteer_signup` is who claimed it.
`eventKinds` includes `work_party`, which is a project outright. Volunteering is not a
separate vertical — it is how a work order gets answered.

## Where `event` sits

`event` appears in two verticals, and this is deliberate rather than an inconsistency.
The app already splits the _surfaces_: `/staff/productions` is `source='cmc'` at every
status including draft, where a show is built; `/staff/events` is the public gig guide
staff moderate.

**But the split does not partition the rows.** From `eventKinds`' own comment: _"Work
parties and monthly deep cleans need advertising as much as a show does, so they get
listings too."_ Every CMC event is both a listing and a project. Only
`source='band'|'community'` rows are listing-only.

Three layers, not two:

| Layer        | What it is                                                                        | Cardinality               |
| ------------ | --------------------------------------------------------------------------------- | ------------------------- |
| `project`    | A body of work with a budget and an owner                                         | 0, 1 or many events       |
| `event`      | The occasion and its public listing                                               | The common case           |
| `production` | A show's back-of-house — the room hold, doors, ticketing, run of show, settlement | Only `source='cmc'` shows |

See [project-spec.md](../specs/project-spec.md).

## The seam

Asset management and project management join at exactly two columns, and they are the
two worth knowing:

- **`work_request.workOrderId`** — a work request raises the work that answers it.
- **`contractor_job.assetId`** — the work is done to a unit. Null means building work.

## Inside the social vertical

The other two verticals are organized by what they act on — resources, work. Social is
organized by **role**: what a piece of it is _for_. Six of them, and the comparables for
each are in
[social-prior-art.md](../reports/social-prior-art.md).

| Role                         | Where it lives                                                     |
| ---------------------------- | ------------------------------------------------------------------ |
| Member directory and profile | `directory_entry`, `directory_tag`, the four intent signals        |
| The organization             | `group`, `group_member`, `group_invite`, ownership as a roster row |
| Governance                   | Committees, chairs, `by_application` — designed, largely unbuilt   |
| Self-published presence      | `band_site`, `band_page_config`, custom domains                    |
| Identity and claiming        | External acts: `directory_entry` with both FKs null                |
| Member-to-member contact     | DMs as request/accept/decline, `user_block`                        |

### The scope ladder

`directory_entry`, `group` and `band_site` look like three peers and are not. They sit at
three different widths, and the nullability of each link is what says so.

| Table             | Link                                     | Can exist unowned?                              | Enforced where            |
| ----------------- | ---------------------------------------- | ----------------------------------------------- | ------------------------- |
| `directory_entry` | `userId` **or** `groupId`, both nullable | **Yes** — both null is an external act          | Service layer, on purpose |
| `group`           | it _is_ the owner                        | n/a                                             | —                         |
| `band_site`       | `groupId` **NOT NULL**                   | **No** — a site cannot exist for a bare listing | The schema                |

They also make opposite calls on _where_ to enforce, each with a stated reason.
`directory_entry`'s "both set is illegal" stays in the service layer because "violating it
is odd rather than corrupting, since there is still exactly one name." `band_site`'s
constraint is in the schema precisely so no service rule is needed.

And `band_site` mostly holds what a band **buys**, not what it **is** — which is why `tier`
lives there rather than on `group`: every band has the row, so reading a tier needs no
fallback. The row is never deleted while the band lives, because `band_page_config` and
`band_media` cascade from it and a lapsed card must not take a band's content with it.

**`epk` is the exception, and it is deliberate.** Every band has a press kit, free, so that
column is not something bought. It sits in this table because the row already has the
property a free-for-everyone column needs — one per band, created with the band, never
deleted — and moving it would buy a migration and nothing else. The table's name is a
naming debt from before that split; it is not a gate. Which half of `epk` a given reader
may see is decided in `src/lib/server/band/press-kit.ts`, the one module that projects it.

### Two opposite id decisions, one migration

Worth knowing because the reasoning generalizes:

- **`group` deliberately reuses `band.id`.** It is the `band` table renamed, so every
  foreign key still points at the same row and no band→group id map has to thread through
  the later phases.
- **`directory_entry` deliberately refuses to reuse `group.id`.** Seeding from it would
  make `entry.id == entry.groupId` true for every migrated band and false for every new
  one, so code passing a group id where an entry id belongs would work against old rows
  and fail only on records created later — "the worst failure shape available here."

Reuse an id to keep references cheap; refuse to reuse one when the coincidence would make
a bug invisible on exactly the rows you test with.

### Ownership is a roster row

`group.ownerId` was removed in phase 3c. The `group_member` row with `role = 'owner'` _is_
the ownership, capped by a partial unique index that permits zero — an ownerless group is
legal, being a program whose leader stepped down, which is why every query for an owner
LEFT joins. The second copy drifted once: five of sixteen production bands had no usable
owner row behind it.

## Seven models that recur

Naming these is the point of the document: each is implemented more than once, and
knowing which is which stops the next implementation being one more.

### 1. Resource custody `[assets]`

The largest duplication in the app. One shape: a resource, a holder, a window, a custody
state machine, credit settlement, a cancel.

|                         | agreed      | committed   | in custody    | returned    | abandoned               |
| ----------------------- | ----------- | ----------- | ------------- | ----------- | ----------------------- |
| `reservationStatuses`   | `scheduled` | `confirmed` | —             | `completed` | `no_show` / `cancelled` |
| `loanStatuses`          | `requested` | `scheduled` | `checked_out` | `returned`  | `cancelled`             |
| `contractorJobStatuses` | `draft`     | `scheduled` | —             | `completed` | `cancelled`             |

Satellites line up too: `closure` ≡ `assetStatus='maintenance'` (the resource is
unavailable and it is not a booking), `recurring_series` ≡ a standing loan, the lock code
≡ checkout, `reservation.bookerType` ≡ the loan's borrower. "Late" is derived identically
in all three and stored in none.

What does _not_ unify: the room has capacity 1 and a calendar, gear has units and a tag.
Availability genuinely differs. The state machine and the settlement do not.

### 2. A request raises work `[assets → projects]`

Someone notices, staff triage, work is raised, the work closes the request. This is the
industry-standard **work request → work order** pattern; `work_request` is the request and
`work_order` is the order.

`content_flag` is the same lifecycle in social, where the "work" is a moderation decision
rather than a repair — which is why `work_request` shares `flagStatuses` verbatim and
copies six columns. **They stay separate tables** (see below); the triage queue, detail
page, resolve/dismiss action and don't-re-notify-on-repeat rule are what could be shared.

### 3. Template → instance `[projects, assets]`

Three mechanics, and choosing between them has a rule:

| Shape                 | When                                                       | Example                                     |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| Real table            | Instances are edited after the fact                        | `duty_list` — a roster changes constantly   |
| Prototype row         | Instances are not edited after the fact                    | Recurring events — nobody edits a past show |
| **Generate-on-close** | The next occurrence should not exist until this one closes | Monthly deep clean, quarterly PA check      |

The first two exist. The third does not yet — `recurring_series` materializes 2.5 weeks
ahead, which can drift and can pile up unclosed duplicates.

### 4. The review return `[social, projects]`

Four implementations of "sent back is not a rejection", each with the same
`status='rejected'` + `reviewNotes` pair, and each hand-rolling a queue, an approve, a
send-back with a required reason, and an edit-and-resubmit that deletes nothing:

`instructor` (the application _is_ the draft listing) · `event.reviewNotes` (community
listings) · `volunteer_hour_log` · `suggestion_edit` (approve against a before/after).

The duplication that hurts is the service and the UI, not the columns.

### 5. The append-only ledger `[one per vertical, plus money]`

`stock_movement` (assets) · `volunteer_hour_log` (projects) · `credit_transaction` and
`payment_cache` (money). Four ledgers, four sum-to-a-balance reads, four
backdating-and-correction stories. That each vertical grew its own is a point _for_ the
taxonomy.

**Derived balances, never stored counters.** Project burn is a `sum()` across these.

### 6. Container membership `[social, projects, comms]`

`group_member` · `volunteer_signup` · `audience_member` · `inbox_participant` ·
`event_rsvp` · `member_certification`. All are (container, person, status, joined_at).

The repeated hard part is the per-membership notification preference:
`group_member.notifyAnnouncements` exists precisely because the global
`notification_preference` cannot express it, and the next container hits the same wall.

### 7. A staff tool is a group tool with the group hardcoded `[all three verticals]`

**The staff panel is the CMC group's panel.** Most of what lives under `/staff` is not
privileged by nature — it is a tool scoped to an organization, where the organization
happens to be the collective and is therefore implicit. Once a tool is genuinely
group-scoped, a band, a club and a committee can all have one.

This is not speculative; it has already happened twice, and the schema says why:

- **`announcement`** — "One table for bands, clubs and committees alike, because a band
  posting to its roster and a committee posting to its members are the same act."
- **`event_group`** — which groups' pages an event appears on, distinct from
  `event_band`'s credit on the bill.
- **`project.groupId`** is the next one, and ships in that table's first migration.

**The inbox is the clearest remaining case.** `inbox_thread` has **no owner column at
all** — `channel` records how a message arrived (contact form, portal, email, SMS,
Instagram, Messenger), never whose queue it belongs in, so every thread is implicitly
CMC's. Meanwhile `submitBandContactForm`
([band-site.remote.ts](../../src/lib/remote/band-site.remote.ts)) already delivers booking
enquiries "to the band's booking contact, falling back to the band owner" — as email.
Bands receive this traffic today, into a personal mailbox, unthreaded, with no status, no
awaiting-reply marker and no record that anyone answered.

One nullable owner column on `inbox_thread` — null meaning CMC, the same shape
`directory_entry` uses for its two nullable owners — turns one inbox into many.

Three things this pattern has to respect, all of which already have working precedent:

- **Internal notes must not leak.** `/member/messages` is member↔staff on these same
  tables and internal notes are never exposed there, so the isolation is proven in
  production rather than hypothetical.
- **Participants are people.** `inbox_participant.userId` is a user FK, which is how DMs
  scope. A group cannot be a participant, so ownership and participation are two different
  questions and need two different columns.
- **Not every tool generalizes.** Marketing is the counter-example: consent, suppression
  and unsubscribe are per-`subscriber` and a band's list is not the collective's list, so
  the compliance question changes rather than scaling. Inventory and volunteering are weak
  fits for the same reason — they describe things the collective owns.

## Duplications to leave alone

A list like the above invites merging everything. These three are deliberate:

- **`content_flag` vs `work_request` as tables.** Argued in the schema, and the argument
  holds: gear must not queue beside a harassment report, `reason` there is
  moderation-shaped, and neither `blocksUse` nor `workOrderId` means anything to
  moderation.
- **`work_order` vs `contractor_job`.** Same shape, opposite economics: volunteer
  labour is claimed and credited in hours, contractor labour is commissioned and paid in
  cents.
- **The four ledgers.** A shared table would put credits, gear and hours in one row type
  to save a `sum()`.

## Already-unified references

The bar for what "worked out" looks like, and the thing to imitate rather than reinvent:

- **Entity references.** `entityTypes` + `entityLabels` in
  [config.ts](../../src/lib/config.ts), [`refs.ts`](../../src/lib/server/entity/refs.ts)
  for the href, [`registry.ts`](../../src/lib/components/ui/entity/registry.ts) for
  icons, avatars and chips. One polymorphic reference over 17 kinds, split server/client
  so Svelte icon components never reach server code, kept honest by `registry.spec.ts`.
- **Scoped restriction.** `member_standing` over `standingScopes` — one table serving
  three surfaces, merged from three per-domain tables.
- **Polymorphic booking.** `reservation.bookerType` over
  `['user','group','event','instructor']`.
- **Polymorphic attachment.** `media` / `media_attachment` over `attachableTypes`.
- **One vocabulary file.** [config.ts](../../src/lib/config.ts), imported by schema _by
  relative path_ — a `$lib` alias breaks `db:generate`.

## Further reading

- [project-spec.md](../specs/project-spec.md) — the `project` design
- [project-management-prior-art.md](../reports/project-management-prior-art.md) — the
  comparable products and why these decisions were made
- [social-prior-art.md](../reports/social-prior-art.md) — the same, per social role, and
  what those products do better
- [committees-and-roles-spec.md](../specs/committees-and-roles-spec.md) — committees as
  the owners of projects
