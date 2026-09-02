# The domain model

What the app is made of, above the level of individual features. Read
[overview.md](overview.md) for how the system is wired — remote functions, auth, the
event bus, cron; this document is about what the tables _mean_ and which shapes recur.

## Three verticals over two horizontals

**Verticals** — a thing the collective does, with its own screens and its own lifecycle:

| Vertical               | What it is                                         | Modules                                                                                                                                                                                               |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Asset management**   | Physical resources: reserve, loan, service, retire | `reservation`, `recurring_series`, `closure`, lock codes, `instructor`, `inventory_*`, `stock_movement`, `acquisition`, `purchase_order`, `contractor_job` (repair), `media`                          |
| **Project management** | Work that has to get done, by someone, by a time   | `project`, `volunteer_shift` (the work order), `volunteer_signup`, `work_task`, `duty_list*`, `volunteer_hour_log`, certifications, `contractor_job` (commissioned), `event` (CMC-produced), `ticket` |
| **Social**             | People and the connections between them            | `user`, `directory_entry`, `group`, `group_member`, `band_site`, `suggestion`, `content_flag`, `member_standing`, `user_block`, `event` (band and community listings)                                 |

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

- **`asset_flag.workOrderId`** — a work request raises the work that answers it.
- **`contractor_job.assetId`** — the work is done to a unit. Null means building work.

## Six models that recur

Naming these is the point of the document: each is implemented more than once, and
knowing which is which stops the next implementation being a seventh.

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
industry-standard **work request → work order** pattern; `asset_flag` is the request and
`volunteer_shift` is the order.

`content_flag` is the same lifecycle in social, where the "work" is a moderation decision
rather than a repair — which is why `asset_flag` shares `flagStatuses` verbatim and
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

## Duplications to leave alone

A list like the above invites merging everything. These three are deliberate:

- **`content_flag` vs `asset_flag` as tables.** Argued in the schema, and the argument
  holds: gear must not queue beside a harassment report, `reason` there is
  moderation-shaped, and neither `blocksUse` nor `workOrderId` means anything to
  moderation.
- **`volunteer_shift` vs `contractor_job`.** Same shape, opposite economics: volunteer
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
- [committees-and-roles-spec.md](../specs/committees-and-roles-spec.md) — committees as
  the owners of projects
