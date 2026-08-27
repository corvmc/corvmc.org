# Groups Module

A group is a set of CMC members who organize together — a band, a club, or a committee. Groups own a roster, post announcements to their members, keep shared documents, and run events. A band additionally has a **directory entry** — the public-facing musical identity of genres, hometown, links and bio — and, if it pays for one, a **band site**: the premium microsite a club or committee has no use for.

The driving case is the Real Book Club jazz jam: a CMC program with a roster, a recurring session anyone may drop into, a way to tell its members when a session moves, and somewhere to keep the charts. Everything in this spec should be checked against whether it serves that.

This spec splits today's `band` table by purpose. `group` is the managed organization; `directory_entry` is the public listing, shared with members; `band_site` is the premium microsite; `contact` holds the private details of people who are not members. The split is what lets clubs and committees reuse the roster machinery without inheriting band-shaped columns, what lets an external act exist as a staff-kept record with no roster at all, and what keeps a promoter's phone number out of every table a public query touches.

> This spec is the source of truth for the band/group boundary, including where it meets
> [production-workflow-spec.md](production-workflow-spec.md) and
> [event-lineup-spec.md](shipped/event-lineup-spec.md). `production_slot` appears below as a design contrast
> rather than an existing table.

---

## Domain model

### The split

Four tables, split by **purpose** rather than by entity type. That axis is what lets a member, a
band, and an external act share one listing shape while keeping premium features and private contact
details out of it.

| Entity            | Is                                                                     | Attaches to                 |
| ----------------- | ---------------------------------------------------------------------- | --------------------------- |
| `group`           | The managed org — roster, announcements, documents, events, slug       | —                           |
| `directory_entry` | The public listing, **and** the reusable act record                    | a user, a group, or nothing |
| `band_site`       | The premium microsite — tier, subscription, custom domain, EPK, blocks | a group                     |
| `contact`         | Private third-party contact details — never public                     | a directory entry           |

Splitting on purpose rather than entity type is what keeps identity in one place: a name lives on the
directory entry and nowhere else, and what varies is only what that entry is attached to.

Three kinds of group:

```
group.kind  'band' | 'club' | 'committee'
```

**Roles and membership behave identically across all three.** Owner, admin, and member mean the same
thing everywhere; announcements, documents, and the roster are one implementation. What kind does
determine is the line below, which is a governance fact rather than a UI one:

|                                   | `band`                                   | `club`, `committee`                      |
| --------------------------------- | ---------------------------------------- | ---------------------------------------- |
| Created by                        | Any member, self-service                 | **Staff only**, from the staff panel     |
| Owner                             | The creator                              | **Appointed by staff**                   |
| Deleted by                        | Its owner                                | Staff only                               |
| May have a band site              | Yes                                      | No                                       |
| Default join policy               | `invite_only`                            | Either; `open` is the point of a program |
| Its events may hold the room free | No                                       | **Yes**                                  |
| Rehearsal bookings                | `bookerType: 'group'`, credits then cash | n/a — see [Room time](#room-time)        |

"Band" is not a table — it is _a group with a directory entry, optionally with a band site_. So
`kind` carries governance alone: who may create, who may delete, and who gets free room time.

**A club or committee is a sanctioned CMC program by construction.** There is no `sanctioned` flag,
because the existence of the row is the sanction — staff created it and staff appointed whoever runs
it. A band is the opposite: a member's own project, self-created, paying for its own rehearsal time.

That distinction is what makes free room time safe to grant. The abuse case — spin up a fake club,
give it a weekly "event," collect free room time — is closed structurally rather than by a check
someone has to remember.

Adding a kind later is a one-line change to this union plus a row in that table.

### Group

```
group
  id                 text (uuid), PK
  kind               text, not null   ('band' | 'club' | 'committee')
  name               text, not null
  slug               text, not null, unique
  description        text, nullable
  avatarKey          text, nullable   (R2 storage key)
  publicVisibility   text, not null, default 'public'   ('public' | 'members' | 'hidden')
  joinPolicy         text, not null, default 'invite_only'   ('invite_only' | 'open')
  joinInstructions   text, nullable
  lookingForMembers  boolean, not null, default false
  contact            json, nullable   (public contact preferences)
  createdAt          timestamp, not null
  updatedAt          timestamp, not null
  deletedAt          timestamp, nullable
```

**`group` owns the address namespace.** `group.slug` is the only _live_ slug in the system — directory entries have none — so a plain unique index is the whole namespace enforcement: no registry table, no dual-write, no second source of truth. It follows that **a thing is publicly addressable if and only if it has a group**, which is a structural fact rather than a filter anyone can forget to apply.

Two things qualify that "only" without weakening it, and both are covered in [Addresses](#addresses): released slugs, which `group_slug_history` keeps so old links still resolve, and premium custom domains, which are an alternate address for a microsite rather than an entry in this namespace.

The index is `unique(slug)`, not `unique(kind, slug)`: one namespace shared by bands, clubs, and committees alike. Per-kind would make `requireGroupRole({ slug })` ambiguous, since the guard resolves a group from a slug alone at ~90 call sites and would need the kind before it could resolve anything.

**There is no `ownerId`.** The owner is the `group_member` row with `role = 'owner'`, enforced by a partial unique index. See [Ownership](#ownership).

**`joinPolicy` is how open enrollment works.** `invite_only` is today's behavior and stays the default: you get in because someone with authority added you. `open` means any signed-in member may join themselves, landing directly on an active `member` row with no approval step — which is the whole point of a drop-in program like the Real Book Club. The policy governs only self-service joining; invitations work identically under both.

`joinInstructions` remains useful under `open` — it is the "bring a horn, charts provided" prose next to the button, not a substitute for it.

### Directory entry

One listing shape for members and groups alike. The duplication that justifies it is already in the
schema: `user` and `band` hold
**seven identical columns** — `name`, `bio`, `tagline`, `hometown`, `links`, `directoryVisibility`,
`directoryContact` — plus `lookingForBand` and `lookingForMembers`, which are the same idea pointed
in opposite directions. There are three tag tables (`user_genre`, `user_instrument`, `band_genre`)
for two concepts, and `directory-service.ts` carries parallel implementations throughout:
`listMembers` / `listPublicMembers` / `getMemberProfile` beside `listBands` / `listPublicBands`.

```
directory_entry
  id           text (uuid), PK
  userId       text, nullable, unique, FK → user  (cascade)
  groupId      text, nullable, unique, FK → group (cascade)

  name         text, not null
  bio          text, nullable
  tagline      text, nullable
  hometown     text, nullable
  foundedYear  text, nullable
  avatarKey    text, nullable   (R2 storage key)
  links        json, nullable
  visibility   text, not null, default 'public'   ('public' | 'members' | 'hidden')
  contact      json, nullable   (published contact preferences — see below)
  lookingFor   text, nullable   ('members' | 'band' | null)
  availableForHire     boolean, not null, default false
  teachesLessons       boolean, not null, default false
  openToCollaboration  boolean, not null, default false
  createdAt    timestamp, not null
  updatedAt    timestamp, not null
  deletedAt    timestamp, nullable
```

**`name` and `avatarKey` are copies, not moves.** `user.name` belongs to better-auth, `group.name`
has readers in every module through `refs.ts`, and — decisively — an entry is _optional_: a club or
committee has a group and no listing, so a name held only on the entry would leave `/staff/groups`
with nothing to render. Both columns stay canonical where they are and are maintained here on write,
the `event_band.name` pattern. The duplication earns itself immediately, because the directory's
`ORDER BY name` and its search `LIKE` then run against this row rather than a joined table. For a
user-attached entry `avatarKey` stays **null** and the member's avatar remains `user.image`, which an
OAuth provider may have filled with a full URL rather than an R2 key. **Phase 3c therefore drops
neither `name` nor the avatar columns.**

**The three availability booleans come along.** `availableForHire`, `teachesLessons` and
`openToCollaboration` travel with `lookingForBand` through every filter, form, DTO and card;
`lookingFor` unifies only the fourth. They are list-query predicates, and a column compare beats an
`EXISTS` subquery, so they keep the shape and default they had on `user` — and they generalize:
"available for hire" is as natural a listing fact for a band, or for an external act, as for a member.

**What it is attached to is the whole of its meaning:**

| State         | Is                                                      |
| ------------- | ------------------------------------------------------- |
| `userId` set  | A member's directory presence                           |
| `groupId` set | A band's or group's public listing                      |
| **Both null** | **An external act** — a staff-kept record, never listed |
| Both set      | Illegal                                                 |

Two nullable typed foreign keys are **not** the polymorphism rejected for `group_member`. That
argument was about `(entityType, entityId)` losing referential integrity; here both cascades are
real, so deleting a user takes their entry and deleting a group takes its listing, with no
`purgeEntity()` helper and no orphan-reconcile cron. The "exactly zero or one" rule is not
enforceable without a CHECK constraint, and deliberately stays in the service layer — but unlike the
old identity rule, violating it is merely odd rather than corrupting: there is still exactly one
name.

**Genres and instruments collapse into one table.**

```
directory_tag
  entryId  text, not null, FK → directory_entry (cascade)
  kind     text, not null   ('genre' | 'instrument')
  value    text, not null
  unique(entryId, kind, value)
```

This replaces `band_genre`, `user_genre`, and `user_instrument`. The directory already filters on
genre with an `EXISTS` subquery and suggests values by prefix; both become one implementation
serving members and bands alike.

**A directory entry has no slug.** It is reached through whatever it is attached to — a group at
`group.slug`, a member at `/directory/members/{id}` as today, an external act at no URL at all.
`group.slug` therefore remains the only slug in the system and the one-namespace reasoning in
[Addresses](#addresses) is untouched. Giving entries their own slug would hand a namespace entry to
external acts, which are the one thing that must never be addressable.

#### Solo acts

The reason to put entries on users, rather than only on groups, is that a solo performer currently
has no honest representation: they either invent a one-person "band" or accept a member profile that
cannot appear on a bill. With an entry on the user, `event_band` credits a `directoryEntryId` and a
lineup can mix bands, solo members, and external acts uniformly — no fake band, and no new slug.

Their public page stays `/directory/members/{id}`. This spec adds no performer route for members;
it only makes them creditable.

### The external act

An external act is a `directory_entry` with **both** `userId` and `groupId` null. Three needs justify
keeping a record at all, and they are worth stating because they are what rule out doing this with
lineup rows:

- **Marketing material on hand** for when they come back — bio, genres, links, photo.
- **A contact record** for later reference: lost gear, payment rectification, "who did we deal with."
- **A promotion path**, because an external act is a plausible future member.

`event_band` cannot serve any of this. Its rows are keyed to an event, so anything stored there is a
fact about one night rather than a reusable record of a party.

**Promotion is one statement.** When someone from the act joins CMC and claims it, the service
creates a `group`, sets `directory_entry.groupId`, and inserts the owner `group_member` row — one
`db.batch`. Nothing merges, no identity columns move, and every event they ever played is still
attached because `event_band` pointed at the entry all along, never at the group.

#### An external act has no page anywhere

**An external act is a staff-facing record and nothing else.** Its entry is forced to
`visibility: 'hidden'` and there is no public profile, no share link, no short id, no `noindex`
page — nothing rendered to the world at any URL. It is a row staff can see, and that is the whole of
it.

This is the point of directory visibility and slugs being a member benefit, taken to its conclusion.
CMC does not host a page for a band that has no relationship with CMC; the band already has a web
presence it chose — a Linktree, a Bandcamp, an Instagram — and that is where anyone who wants to
find them should land.

So **public attribution links out, never in.** Wherever an external act's name appears publicly — a
lineup, a run of show, an event page — it renders as:

- a link to the act's own URL, taken from `directory_entry.links`, when they have given one; or
- **plain text** when they have not.

Never a link to a CMC page, because there is no CMC page to link to.

##### How this meets `event_band`

`event_band` looks at a glance like a competing model of the same thing. It is not, and both stay.

- **`event_band` is a credit on one bill** — a display name, a billing order, a consent status. It
  is per-event and says nothing about the act beyond how it appeared that night.
- **A `directory_entry` is a persistent record of a party** — bio, genres, links — reusable across
  every event that act ever plays.

So `event_band.bandId` re-keys to **`directoryEntryId`**, and `status = 'unlinked'` keeps its current
meaning: a name with no record behind it, which is the common case and the whole of backfilled
history. Staff stubbing an act when they book it is what creates the record and points the row at it.

One amendment falls out. `pending` / `confirmed` / `declined` model a band _agreeing_ to be listed,
which presumes somebody with an account to agree; an entry with no user and no group has nobody. A
row pointing at an external act is therefore **`confirmed` by construction** — staff entered it, and
there is no consent step to wait on. The existing render rule, "only `confirmed` links to the band,"
needs the destination split rather than the condition changed:

| Row                                 | Renders as                                               |
| ----------------------------------- | -------------------------------------------------------- |
| `confirmed`, entry has an owner     | A link to the member's or band's CMC page                |
| `confirmed`, entry has no owner     | A link **out** to `directory_entry.links`, or plain text |
| `unlinked` / `pending` / `declined` | Plain text, exactly as today                             |

### Band site

The premium microsite leaves the profile and becomes its own table, keyed to a group.

```
band_site
  id                        text (uuid), PK
  groupId                   text, not null, unique, FK → group (cascade)
  tier                      text, not null, default 'free'   ('free' | 'premium')
  subscription              json, nullable
  customDomain              text, nullable, unique
  customDomainStatus        text, nullable   ('pending' | 'active' | 'failed')
  customDomainHostnameId    text, nullable
  customDomainVerification  json, nullable
  customDomainAddedAt       timestamp, nullable
  createdAt                 timestamp, not null
  updatedAt                 timestamp, not null
```

`groupId` is **not null** here, which is the point: a microsite is something a CMC member band buys,
so it cannot exist for an external act, and no service-layer rule is needed to say so. `band_page_config`
and `band_media` re-key to `bandSiteId`.

Separating this from the listing also disentangles two columns that currently collide.
`user.subscription` (membership) and `band.subscription` (band premium) are different things sharing
a name; after the split the first stays on `user` and the second lives here, where nothing else means
"subscription."

### Contact

The private half. `directory_entry` is a **public** listing; an external act's booking details are the
opposite of public, and the two must not share a row.

```
contact
  id            text (uuid), PK
  entryId       text, nullable, FK → directory_entry (cascade)
  subscriberId  text, nullable, FK → subscriber (set null)
  bookingName   text, nullable      — often a manager, not a band member
  bookingEmail  text, nullable
  bookingPhone  text, nullable
  notes         text, nullable
  paymentRef    text, nullable      — a Stripe or settlement reference, never card data
  source        text, not null      ('self_entered' | 'staff_entered')
  retainUntil   timestamp, nullable
  createdAt     timestamp, not null
  updatedAt     timestamp, not null
```

**A separate table is the protection that actually works.** This codebase uses `select()` with no
arguments and `getTableColumns(event)` splats; any private column sitting on a row a public query
touches is one refactor away from being serialized. Putting the fields in their own table makes
leaking require an explicit JOIN — something a person has to mean. It is the same reasoning
`private-storage.ts` uses further down: the module boundary is the guardrail.

Three rules ride on top of it:

- **One access path.** Every read goes through a single service that calls `requireStaff()` itself,
  with a custom ESLint rule banning imports of the schema anywhere else. Four such rules already
  exist in this repo, so the machinery and the precedent are both there.
- **Never in a client DTO.** Remote functions return a shaped object; these fields appear in exactly
  one staff-facing query.
- **Prefer self-entered.** `/act/{token}` (below) is the privacy-best acquisition path — the act
  types its own details, so CMC holds what they chose to give. `source` records which rows someone
  actually consented to, and staff-typed is the fallback rather than the default.

**Retention is deliberate.** Marketing material, payment rectification, and lost gear all have a
natural horizon; `retainUntil` carries it, and a staff report lists contacts with no event in N
years. Nothing here expires today, and that is the current gap rather than a decision.

**Promotion retires the contact, it does not carry it.** The booking contact is frequently a manager
rather than a member, so when an external act becomes a CMC band the record is archived rather than
inherited — otherwise a member band ends up with a stale private phone number attached and nobody
owning it. Contact then goes through the account.

#### `contact` versus `subscriber`

`subscriber` already exists and already does more than half of this: `email` unique, a nullable
`userId`, and `suppressedAt` / `suppressionReason` for global suppression, with `audience_member`
carrying per-list opt-out and both levels enforced in the send path. It is, in effect, a party store
that already handles non-members.

They stay separate, because they answer different questions:

- **`subscriber` is the consent ledger for an email address** — may we email this, and about what.
- **`contact` is the party record** — who is this, how do we reach them, what do we owe them.

Booking phone numbers, payment references, and lost-gear notes must not live in a table every
marketing query joins. But `contact.subscriberId` links them, so **"may we email this person" has
exactly one answer**; without it a future "email the booking contact" path would send from `contact`
and silently bypass a suppression the person actually expressed.

The corollary is a rule: **creating a contact may create a `subscriber` row, and must never create an
`audience_member` row.** Registering an address in the ledger is bookkeeping; enrolling it in a list
without opt-in is how a sending domain collects spam complaints. `audience.allowOptIn` already draws
that line and this spec does not cross it.

#### The contact-sheet link

There is exactly one reason an external act needs a URL: **so they can fill in their own details.**
Staff stub an act when booking it, and the act itself is the best source for its bio, genres, links,
photo, and booking contact. Asking staff to retype what an act emails them is how records go stale.

That is a **write** surface, not a read one, so it is gated — by an emailed magic link rather than an
account:

```
directory_entry_link
  id           text (uuid), PK
  entryId      text, not null, FK → directory_entry (cascade)
  token        text, not null, unique
  email        text, not null      — where it was sent; the only address it is valid for
  expiresAt    timestamp, not null
  createdById  text, nullable, FK → user (set null on delete)
  lastUsedAt   timestamp, nullable
  revokedAt    timestamp, nullable
  createdAt    timestamp, not null
```

Staff send it from the act's record. The act clicks `/act/{token}` and gets a form for its own
descriptive fields and contact details. It is **reusable until it expires** — filling in a contact
sheet is not always one sitting — and revocable, and it expires on its own so a forwarded link does
not stay live forever.

Four constraints that matter:

- **It creates no session and no account.** The token authorizes editing exactly one entry and
  nothing else. It must not touch `locals.user`, and it must not be confused with authentication. Do
  not reach for better-auth's magic-link plugin here — the app is email+password only today, and
  adding a passwordless path to the real auth system to solve a data-entry problem would be a much
  larger change with a much larger blast radius.
- **It cannot change the name.** Staff control the canonical name, because it appears on posters and
  in settlement records. The act edits everything descriptive; renaming is a conversation.
- **It is also the subject-rights surface.** The same token lets the act see what CMC holds about
  them and ask for its removal. They have no account, so this is the only door they have, and it
  costs nothing because the door already exists.
- **Claiming is a different door.** This link says "keep your record current and stay external."
  Becoming a CMC band — a group, a slug, a roster — is a `group_invite` with `role: 'owner'`,
  described in [Claiming an external act](#claiming-an-external-act). Conflating them would mean an
  act updating its bio accidentally acquires a membership.

`platform_invite` already establishes this shape: unique token, expiry, resolved at a public route.
This is the same pattern narrowed to one row and one form.

### Addresses

The split has to say where each half of the band-address machinery lands.

**`band_slug_history` becomes `group_slug_history`**, re-keyed to `groupId`. A released slug is a
fact about an address, and addresses belong to the group, so the history follows the namespace it
came from. Its semantics are unchanged: a live `group.slug` always wins, claiming a released slug
deletes its history row, and the `ON DELETE CASCADE` stays load-bearing because hard deletion of a
group must not fail on a foreign key.

**Custom domains go to `band_site`**, because a custom domain is a premium microsite feature and
`tier`/`subscription` live there. That the site table's `groupId` is NOT NULL is what makes the
constraint structural: an external act has no group, therefore no site, therefore no domain, and
nobody has to remember a rule.

That leaves one consequence worth naming before the migration finds it.
`src/lib/server/band/band-host-service.ts` resolves an incoming hostname by selecting `band.slug` and
`band.tier` from a single table. Afterwards those live on `group` and `band_site`, so **both
`resolveBandSubdomain` and `resolveCustomDomain` become joins.** `resolveCustomDomain` runs from
`reroute` — before routing, on every request to a custom host — which is exactly where an extra join
is least welcome. It is already KV-cached, so the cost lands on cache misses only, and
`resolveBandSubdomain` is deliberately uncached and stays a single indexed lookup plus one join.
Neither needs a redesign; both need editing.

`hooks.ts` itself is untouched — groups get no subdomains, and only band microsites claim
`{slug}.corvmc.org`.

#### Where everything re-keys

Every foreign key that points at `band.id` today has to land somewhere, and the purpose split
decides which. This is the complete list. Values survive untouched wherever the target is the group,
because `group.id` is `band.id` — see
[Identity through the migration](#identity-through-the-migration); only the rows landing on
`directory_entry` and `band_site` resolve through a lookup.

| Today                      | Becomes                       | Because                             |
| -------------------------- | ----------------------------- | ----------------------------------- |
| `band_member.bandId`       | `group_member.groupId`        | Roster is the managed org's         |
| `band_slug_history.bandId` | `group_slug_history.groupId`  | Addresses belong to the group       |
| `platform_invite.bandId`   | `group_invite.groupId`        | Invitations are to a roster         |
| `event.bandId`             | `event.groupId`               | Records authority, not identity     |
| `band_genre.bandId`        | `directory_tag.entryId`       | Genres are listing data             |
| `event_band.bandId`        | `event_band.directoryEntryId` | A credit names a party, not an org  |
| `event_band.addedByBandId` | `event_band.addedByGroupId`   | Who added it is an act of authority |
| `band_page_config.bandId`  | `band_page_config.bandSiteId` | Microsite blocks belong to the site |
| `band_media.bandId`        | `band_media.bandSiteId`       | Same                                |

`user_genre` and `user_instrument` also fold into `directory_tag`, which is a merge rather than a
re-key.

### GroupMember

Tracks membership and pending invitations in one table, exactly as `band_member` does today. Every row is either a pending invitation or an active membership.

```
group_member
  id                  text (uuid), PK
  groupId             text, not null, FK → group (cascade)
  userId              text, not null, FK → user (cascade)
  role                text, not null   ('owner' | 'admin' | 'member')
  position            text, nullable   (e.g. "Lead Guitar", "Treasurer", "Instructor")
  alias               text, nullable   (the name this person goes by in this group)
  status              text, not null   ('pending' | 'active')
  notifyAnnouncements boolean, not null, default true
  invitedById         text, nullable, FK → user (set null on delete)
  createdAt           timestamp, not null
  updatedAt           timestamp, not null
  unique(groupId, userId)
  unique(groupId) where role = 'owner'
```

- Owner row: `role = 'owner'`, `status = 'active'`, `invitedById = null`.
- Invited member: `role = 'member' | 'admin'`, `status = 'pending'`, `invitedById` set.
- Accepting flips `status` to `'active'`. Declining or revoking deletes the row.
- `position` is free text and carries whatever the group calls it — instrument for a band, office for a committee, "host" or "chart librarian" for a club.
- `alias` carries over from `band_member` unchanged. It is self-set — an admin can say what you play, but cannot rename you — and null means "use the account name", so the roster falls back rather than storing a copy that goes stale. It generalizes without strain: a stage name for a band, a preferred name anywhere else. Dropping it during the phase-2 port would regress a shipped band feature to save one nullable column.
- `notifyAnnouncements` is the per-group mute. A member of six groups needs to silence one without silencing all; a single global preference cannot express that.

**Membership is not polymorphic.** Because everything managed is a group, `groupId` is a real foreign key with `ON DELETE CASCADE` — as are `group_invite`, `announcement`, and `file`. This is the single largest simplification in the design. A polymorphic `(entityType, entityId)` shape would have required a `purgeEntity()` helper called from every delete path, an orphan-reconcile cron, and a discriminator branch in every query. It would also have invited the bug `content_flag` already has: its rows are never cleaned up when a band is deleted, because there is no FK to enforce it.

### Ownership

A group has **at most one** owner: the `group_member` row with `role = 'owner'`, guaranteed by `unique(groupId) where role = 'owner'`. A partial unique index permits zero, which is deliberate — see [Resigning a leadership](#resigning-a-leadership).

This spec drops `band.ownerId` rather than carrying it across. Authorization never reads it today — `requireBandOwner()` resolves through `getUserRole()`, which reads `band_member` alone — so every remaining use is display or bookkeeping, and all of it is derivable.

**Three of those uses are `innerJoin(user, eq(user.id, band.ownerId))`** in `band-service.ts` —
twice in `listAll`, once in `getByIdWithDetails`. An inner join drops any row whose join target is
missing, so under this spec's own rule that an ownerless group is legal, `listAll` would **silently
omit exactly the groups staff most need to see**, and `getByIdWithDetails` would return nothing for
a group that plainly exists. All three must become left joins as part of the port, with the owner
rendered as absent rather than the group disappearing. This is a behavior change the
column drop forces, not an incidental refactor, and it is the kind of thing that passes review
because nothing about a left-to-inner join looks wrong in a diff. `transferOwnership()` already performs its three writes in a single `db.batch([...])`; dropping the column removes one statement from a batch that already spans the other two, so the atomicity guarantee is unchanged.

Phase 1 inherits a cleaner starting point than this spec originally assumed. Ownership was recorded
twice and had drifted — five of sixteen production bands had no usable owner row — but
`scripts/backfill-band-owners.ts` repaired it and `insertBandWithOwner` replaced the hand-rolled
band+owner pairs in the seed. (The pg migrator that also reconciled them was deleted in #278.) So
"create a group per existing band" starts from a reconciled model rather than one that has to be
repaired mid-migration.

Dropping it also retires a live contradiction. The migration declares `owner_id text NOT NULL` with `FOREIGN KEY ... ON DELETE SET NULL` — two clauses that cannot both be satisfied, so deleting a user who owns a band would fail at the constraint. The Drizzle definition says `onDelete: 'restrict'`, so schema and migration disagree about the intent as well. `purgeUser()` guards it in application code, which is why nobody has hit it.

**A group with no owner is legal**, and it is a normal transient state: a program whose leader stepped down and whose replacement has not been appointed yet. The program keeps running — its sessions, roster, documents, and announcements are untouched — and staff see it flagged in `/staff/groups` until someone is appointed. Making an ownerless group illegal would mean either trapping a leader in the role or dissolving a working program the moment they resign, and neither is right.

Admins keep working while the owner seat is empty; only owner-exclusive actions (transferring ownership, and deleting a band) are unavailable, and for a program those belong to staff anyway.

### Announcement

```
announcement
  id              text (uuid), PK
  groupId         text, not null, FK → group (cascade)
  authorId        text, nullable, FK → user (set null on delete)
  title           text, not null          (max 200)
  body            text, not null          (markdown, max 10000, sanitized)
  pinned          boolean, not null, default false
  publishedAt     timestamp, nullable
  notifiedAt      timestamp, nullable     (fan-out latch — see Notifications)
  recipientCount  integer, nullable
  createdAt       timestamp, not null
  updatedAt       timestamp, not null
  deletedAt       timestamp, nullable
```

`notifiedAt` is written by the fan-out listener and never by the remote function. It is the idempotency guarantee, not a display field.

### File

```
file
  id            text (uuid), PK
  groupId       text, not null, FK → group (cascade)
  key           text, not null, unique     (private R2 object key)
  filename      text, not null             (original name, sanitized)
  contentType   text, not null
  sizeBytes     integer, not null
  description   text, nullable
  uploadedById  text, nullable, FK → user (set null on delete)
  createdAt     timestamp, not null
  updatedAt     timestamp, not null
  deletedAt     timestamp, nullable
```

The row id goes in the R2 key, not the filename — two uploads named `rider.pdf` must not collide, and the key must not be guessable from the display name.

### GroupInvite

Replaces `platform_invite`. Covers only the **email** path: inviting someone who has no account yet.

**`platform_invite` is band-scoped despite its name**, so this is a correction rather than a change
in meaning. Its `bandId` is NOT NULL, its `role` is `bandRoles`, and its service is
`createInvite` / `listForBand` / `revoke(inviteId, bandId?)` — every row is an invitation to one
band. It is also not a gate on joining CMC: signup is open, and `resolvePendingInvites(userId, email)`
runs from `hooks.server.ts` on a session's first request, matching on email alone, so an invitee who
ignores the link and signs up unaided still lands in the band.

A genuine platform-level invitation — one that other invitations hang off — is a coherent thing to
want, and it is additive whenever a second payload type appears (a volunteer role, a class
enrolment, referral attribution). It buys nothing today: `group_invite` would be its only child, and
the parent would authorize nothing while signup stays open.

```
group_invite
  id            text (uuid), PK
  groupId       text, not null, FK → group (cascade)
  email         text, not null              (normalized lowercase)
  token         text, not null, unique
  role          text, not null              ('owner' | 'admin' | 'member')
  position      text, nullable
  invitedById   text, nullable, FK → user (set null on delete)
  status        text, not null, default 'pending'   ('pending' | 'accepted' | 'revoked')
  expiresAt     timestamp, not null
  createdAt     timestamp, not null
  acceptedAt    timestamp, nullable
  unique(groupId, email) where status = 'pending'
```

**Two invite mechanisms, deliberately.** Inviting an existing member stays a `group_member` row with `status = 'pending'` — that row _is_ the invitation, it appears on the invitee's dashboard, and accepting is a status flip. Only the non-user case needs a token and an expiry. Merging them would hang nullable `token`/`email`/`expiresAt` columns off every pending membership and add a branch to the accept path, to unify two flows that genuinely differ.

`invitedById` is **nullable** here. Today's `platform_invite.invitedById` is declared `.notNull()` _and_ `onDelete: 'set null'` — contradictory clauses, so deleting a user who ever sent an invite fails on a NOT NULL violation. The new table is a fresh create, so fixing it is free.

The partial unique index replaces the manual "is there already a pending invite" SELECT in `createInvite`; an `onConflictDoUpdate` refreshes the expiry instead.

### Events

`event.bandId` becomes **`event.groupId`**. The column marks who manages the event and on whose page it appears — it is authority, not billing. A new join table carries billing:

```
event_group
  eventId    text, not null, FK → event (cascade)
  groupId    text, not null, FK → group (cascade)
  sortOrder  integer, not null, default 0
  unique(eventId, groupId)
```

The managing group is inserted as the first row automatically, so no read path needs a "sometimes present, sometimes not" branch. `eventSources` is `['cmc', 'band', 'community']` today and gains a fourth value: `['cmc', 'band', 'community', 'group']`. Community listings arrived after this spec was drafted and are unaffected by it — they are member-submitted listings for events CMC neither manages nor hosts, and they keep their own draft/review path.

#### Reaching the gig guide

**A published group event reaches the public events page for free.** The gig guide is
`listPublicUpcomingEvents`, which filters on `status IN ('published','cancelled')` and a start date
and applies **no source filter at all** — so `/events` already lists CMC shows, band gigs, and
community listings side by side, and a `source: 'group'` session joins them the moment it is
published. Nothing in the read path needs widening.

What _is_ CMC-only is deliberate, and stays that way. `listUpcoming`, `listPast`, and
`getShowTonight` feed the **featured** surfaces — the poster strip at the top of `/events`, the
"More shows" tail on an event page, `/member/events`, the member dashboard, and the `/show-tonight`
redirect. Those mean "programming at the Collective," which a club's jazz night is and a band's
off-site gig is not; a group session appears in the guide below, not in the poster strip above.

So the shape of the public events page is already the shape groups need: **all published events,
with upcoming CMC events featured at the top.** This spec adds a source value to that page, not a
mechanism.

**Three tables describe "who else is on this event," and they do not overlap.** Two exist in some
form; drawing the line now is what stops them collapsing into each other:

| Table             | Models                                       | Carries                                              | Used by                   |
| ----------------- | -------------------------------------------- | ---------------------------------------------------- | ------------------------- |
| `production_slot` | The **run of show** for a CMC-produced event | Set times, set lengths, ordering, per-act settlement | CMC productions           |
| `event_band`      | **Who played** — a credit on the bill        | Display name, billing order, consent status          | Any event with a lineup   |
| `event_group`     | **Shared advertising** on a member event     | Which groups' pages show it, display order only      | Band/club-authored events |

A CMC production uses `production_slot`. A lineup uses `event_band`. A member-authored event that
two groups want on both their pages uses `event_group`. The distinction between the last two is
_credit_ versus _reach_: `event_band` answers "whose name is on the poster," `event_group` answers
"whose page does this appear on." A co-hosted show plausibly writes both, and that is fine — they
are different facts about the same event, not two encodings of one.

Adding `groupId` and the join table are plain `ALTER TABLE ADD COLUMN` / `CREATE TABLE` operations, and extending the `source` enum emits **zero SQL** — it is a TypeScript-only constraint in Drizzle's SQLite dialect. Keep `groupId` a real column rather than an `ownerType`/`ownerId` pair: the polymorphic form forces a rebuild of `event`, which has more children than any other table (`ticket`, `event_rsvp`, `recurring_series`, `reservation`) and is the riskiest rebuild in the schema.

### Room time

A program does not book the room the way a band does. It gets the room **through its event**, free, and the mechanism already exists — it just isn't reachable from outside the staff panel today:

| Path                              | Reserves the room                                                 | Cost               |
| --------------------------------- | ----------------------------------------------------------------- | ------------------ |
| Member or band rehearsal          | `bookerType: 'user' \| 'group'`                                   | Credits, then cash |
| Staff CMC event — `create()`      | `bookerType: 'event'`, via `staffCreate`, straight to `confirmed` | **Free**           |
| Band event — `createBandEvent()`  | **Nothing.** It is an off-site gig listing with a `location`      | n/a                |
| **Club or committee event — new** | `bookerType: 'event'`, same path as a CMC event                   | **Free**           |

So a group event needs a `createGroupEvent()` that takes optional reservation params and routes them through `staffCreate` with `bookerType: 'event'`, exactly as `create()` does in `event-service.ts` — including the `hasConflict` pre-check and the compensating delete if the event insert fails. Recurring group sessions need the same on each generated occurrence.

**A group event does not book as the group, and no credit ledger is touched.** The reservation belongs to the event, so `bookerType` stays `'event'` and `bookerId` points at the event row. Booking as the group would imply the group has a balance to spend, which is precisely what a sanctioned program does not need.

#### `bookerType` is a table discriminator, not a category

`reservation.bookerId` carries **no foreign key** — it cannot, since it points into different tables — so `bookerType` exists to say which table that is, and which ref builder resolves it (`refs.ts` branches on exactly this). Two rules follow.

**The existing `'band'` value is renamed to `'group'`.** After the port its rows point at `group.id`, so leaving it called `'band'` would leave the enum naming one table and addressing another. It is a value migration rather than a column change, so no table is rebuilt:

```sql
UPDATE reservation SET booker_type = 'group' WHERE booker_type = 'band';
```

The rename grants nothing. Whether a group may hold private rehearsal time stays a service-level policy — only `kind = 'band'` may create one — and group rehearsal bookings are out of scope regardless. Keeping what the discriminator is _called_ separate from what the policy _allows_ is the point.

**`kind` stays off the polymorphism.** `'band' | 'club' | 'committee'` as booker types would be three discriminator values resolving through one `toGroupRef`, and it would cost real things: `kind` becomes a denormalized copy that has to be rewritten whenever a group's kind changes, "any group booking" degrades to `inArray(bookerType, [...])` that silently misses the next kind added, and every branch on booker type gains two identical arms. A discriminator answers _which table_; `kind` answers _what sort of thing the row is_. Different axes.

This is why free room time is safe: only staff create clubs and committees, so only staff decide who may hold the room this way. The privilege travels with the kind, not with a per-event approval.

Bands are excluded deliberately. A band event is an off-site gig listing and does not reserve anything; a band rehearsal is private paid time under `bookerType: 'group'`. Neither becomes free, and a band cannot reach the free path by creating an "event" for its own rehearsal.

---

## Roles and permissions

Three roles within a group, checked at the service level. Identical across all three kinds.

| Role   | Post announcements | Upload documents | Invite | Remove members | Edit group | Manage events | Transfer ownership | Delete group |
| ------ | ------------------ | ---------------- | ------ | -------------- | ---------- | ------------- | ------------------ | ------------ |
| owner  | ✅                 | ✅               | ✅     | ✅             | ✅         | ✅            | ✅                 | Bands only   |
| admin  | ✅                 | ✅               | ✅     | ✅ (not owner) | ✅         | ✅            | ❌                 | ❌           |
| member | ❌                 | ❌               | ❌     | ❌             | ❌         | ❌            | ❌                 | ❌           |

Members read announcements and download documents; they do not create them. Staff (`admin` or `staff`) can manage any group from the staff panel.

**Deleting a club or committee is staff-only**, unlike a band. An appointed program leader runs the program; they do not own it, and they should not be able to dissolve a CMC program on their own — the same reason they could not create it. A leader who wants out transfers ownership or leaves; ending the program is a staff decision. This is the one place the role table differs by kind.

### The guard

`requireGroupRole()` replaces `band-context.ts`:

```ts
requireGroupRole(
  ref: { slug: string } | { id: string },
  minRole: 'owner' | 'admin' | 'member',
  opts?: { allowStaff?: boolean }
): Promise<GroupContext>
```

**The ref is an explicit argument, never read from `params`.** Today's `requireBandBySlug()` reads `getRequestEvent().params.slug`, and the band guards that wrap it are called from roughly 90 sites across more than twenty files. SvelteKit's own documentation is explicit that `params` in a remote function describe the _calling page_, are client-manipulable, and must never determine authorization. It is safe today only incidentally — the slug is a lookup key and the role check still runs against the resolved band — but it cannot serve two route roots without sniffing `route.id`, which is the same untrusted value.

The drift is already visible. `getBandEventDetail` takes `z.object({ slug, eventId })`, destructures only `{ eventId }`, and calls `requireBandMemberOrStaff()` — which reads `params.slug`. Its neighbour `getBandLineupInvites` is declared `query(z.string(), async () => …)`: an argument accepted and never bound at all. In both, the declared parameter is decorative and there are two sources of truth for one value.

Passing the ref explicitly is not a security regression. The slug is a lookup key, not a capability: the guard resolves the group from the untrusted slug and then checks the caller's own membership on the resolved group, so spoofing a slug lands you somewhere you have no role and yields 403.

**The invariant that matters: child-row ids from the client are always re-scoped to the resolved group.** `band-service.ts` already gets this right, and its comment already explains why:

> When `bandId` is provided (band-context callers), the row must belong to that band — a band admin's authority stops at their own band…

`memberScope(memberId, bandId)` generalizes to `memberScope(memberId, groupId?)`, keeping the staff-omits-scope escape hatch. Every service function taking a client-supplied child id follows the same shape.

**`allowStaff` settles a live inconsistency.** `requireBandMember()` throws 403 for staff who are not members, while `getBandLayout` lets them in and reports `userRole: 'staff'` — so a staff member can currently render a band panel in which every single action fails. The layout and the guard must use the same rule; `allowStaff: true` is that rule, applied to reads and withheld from destructive writes.

`getUserRole` continues to filter on `status = 'active'`, so a pending invitee gets 403. That is correct, and it means `acceptInvitation` cannot be guarded by `requireGroupRole` — it stays guarded by `requireUser()` plus row ownership in the WHERE clause, as it is today.

---

## Workflows

### The Real Book Club, end to end

The driving case, traced through the design, as a check that the pieces actually compose:

1. **Staff** create the group from `/staff/groups`, kind `club`, named "Real Book Club", and appoint a member as its leader — an owner `group_member` row. It gets the slug `real-book-club`, a public page at `/groups/real-book-club`, and a directory entry so it can be found. No band site.
2. Staff set `joinPolicy: 'open'`. The leader writes `joinInstructions` — "third Thursday, bring a horn, charts provided" — which the public page shows next to a Join button.
3. Anyone browsing `/groups/real-book-club` who is signed in can join themselves, landing straight on an active `member` row. The leader can still invite people directly, and non-members get a `group_invite` email.
4. The leader creates a recurring event series for the jam, `source: 'group'`, and asks it to hold the room. Each occurrence is published to the gig guide with the club as host and carries a free `bookerType: 'event'` reservation — see [Room time](#room-time). No credits are spent and nobody books anything personally.
5. They upload the charts to Documents as PDFs. Members download them through the authorized route; nobody outside the club can, which matters for material the club doesn't own outright.
6. A session moves. They post an announcement; it fans out in-app and by email to every member who hasn't muted the club, in one batched send.

Two pieces of this do not exist yet and are the real work: a `createGroupEvent()` that can reserve the room, and a fix to the recurring generator, which hard-codes `source: 'cmc'` and `status: 'draft'` and would otherwise emit unpublished CMC-attributed drafts with no reservation. See [Prerequisites](#prerequisites-and-known-defects).

### Creating a group

**Bands** are member self-service, unchanged from today: a member enters a name, and the service creates the `group` (slug generated and checked against `RESERVED_SLUGS`), the owner `group_member` row, and a `directory_entry` carrying the name — one `db.batch`. No `band_site` row is written; one is created if and when the band buys premium. Redirect to `/band/{slug}`.

**Clubs and committees** are created by staff from `/staff/groups`:

1. Staff enter a name, kind, and description, and pick the member who will lead it.
2. The service creates the `group` and an owner `group_member` row for that member with `status = 'active'` — appointed, not invited, so there is nothing for them to accept.
3. Staff set `joinPolicy` and `publicVisibility`.
4. The appointee gets a notification and the group appears in their panel switcher.

The appointee never had to opt in, which is deliberate: staff are recording an arrangement that already exists offline. They can leave or hand off afterwards like any owner.

### Joining an open group

1. A signed-in member opens the public page of a group with `joinPolicy: 'open'` and clicks Join.
2. The service inserts a `group_member` row with `role = 'member'`, `status = 'active'`, `invitedById = null`.
3. They land in the panel immediately — no approval, no pending state.

The guard is the group's own policy, not the caller's identity: the remote re-reads `joinPolicy` from the resolved group rather than trusting anything from the request. Re-joining is idempotent against `unique(groupId, userId)`. Leaving and rejoining is unremarkable and expected for a drop-in program.

Owners and admins cannot self-assign — self-join always produces `role = 'member'`.

### Inviting a member

1. Owner or admin opens Members, searches CMC members by name or email.
2. Picks a role and optionally a position.
3. Existing user → `group_member` row with `status = 'pending'`; the invitee sees it on their dashboard.
4. No account → `group_invite` row with a token and a 7-day expiry, and an emailed link.

At signup, `resolvePendingInvites(userId, email)` converts pending invites into active memberships. The real FK means an invite to a deleted group has already cascaded away, so there is no dangling-reference case to handle.

### Posting an announcement

1. Owner or admin writes a title and a markdown body, then publishes.
2. The row is written with `publishedAt` set and `notifiedAt` NULL, and `announcement.published` is emitted.
3. A listener fans out to members — see [Notifications](#notifications).
4. Members see it on the group dashboard and, unless muted, in-app and by email.

Announcements are one-way. Replies, threads, and read receipts are [not in scope](#not-in-scope).

### Uploading a document

1. Owner or admin uploads a file from the group's Documents page.
2. The service validates type and size, checks the group's quota, writes to the **private** bucket, and records a `file` row.
3. Any active member can download it through the authorized route. Nobody outside the group can, at any URL.

### Claiming an external act

The path from staff-kept record to member band:

1. Staff have a `directory_entry` with **both** `userId` and `groupId` null, holding the act's name,
   bio, avatar, genres, and links — plus, privately, a `contact` row.
2. Someone from the act joins CMC and claims it.
3. The service creates a `group` (kind `band`), sets `directory_entry.groupId`, and creates the owner
   `group_member` row — one `db.batch`.
4. The band now has a slug and is publicly addressable, and its entry flips from hidden to whatever
   visibility they choose. Its entire prior history — every event it played — is already attached,
   because `event_band` pointed at the entry all along.
5. The `contact` row is **archived, not inherited.** See [Contact](#contact): the booking contact is
   often a manager rather than one of the members who just joined, and carrying it forward would
   leave a member band holding a stale private phone number that nobody owns.

Nothing merges and no rows are reconciled. The only column that changes on the entry is `groupId`,
which is the whole benefit of splitting by purpose rather than by entity type — under the earlier
`band_profile` design this step had to move name, description, and avatar between tables and null the
originals.

### Transferring ownership, leaving, removing

Unchanged from bands, minus the `ownerId` write: the target's row becomes `owner`, the previous owner's becomes `admin`, in one batch. An owner cannot be removed or leave without transferring first.

For a club or committee, staff may also reassign the leader directly from the staff panel without the outgoing leader's participation — the appointment is theirs to make and unmake.

### Resigning a leadership

**A program leader may leave without naming a successor.** They step down, their `group_member` row is deleted, the owner seat goes empty, and staff are notified and see the group flagged in `/staff/groups`.

This is the one place programs and bands diverge on leaving. A band owner must transfer first, because there is nobody whose job it is to pick up an orphaned band. A program leader was **appointed**, and the body that appointed them is still there — so "must find your own replacement" would be trapping someone in a volunteer role they have already said they are done with. The group keeps running in the meantime; nothing about it depends on the owner row existing.

Ordinary members leaving is unremarkable under either policy, and under `open` they may rejoin whenever they like.

### Ending a group

**Deactivation is how a program ends. Hard deletion is for mistakes.** These are two different operations and the UI should not present them as a pair of equally weighted buttons.

A dissolved committee is a historical fact, and its minutes, roster, and announcements _are_ the record of it. Cascading them away because the committee wound up is the wrong default — the group ending is exactly when its documents become archival rather than operational. `deactivate()` / `reactivate()` already exist in `band-service.ts` and generalize unchanged.

**Deactivating** sets `deletedAt`. The group leaves the public directory and the panel switcher, its events stop generating, and the panel goes read-only — but every row survives, staff can still reach it and its documents from `/staff/groups`, and reactivating restores a working group. No R2 object is touched. Retention is indefinite; a wound-up committee's minutes are a few megabytes and the storage argument does not outweigh losing them.

**Hard deletion** is a staff-only action reserved for rows that should never have existed — a typo'd name, a duplicate, a test. It confirms with an explicit count ("this will permanently delete 14 documents and 62 announcements"), then:

1. Private R2 objects for the group's files are deleted first — a failed object delete leaves the rows as a recovery record rather than orphaning storage silently.
2. The `group` row is deleted. `group_member`, `group_invite`, `announcement`, and `file` **cascade**.
3. The `directory_entry` survives with `groupId` set back to null and visibility forced to hidden — a deleted band reverts to a staff-kept record rather than vanishing, so its event history keeps a name and its lineup credits keep resolving. Nothing is copied to make that work; only `groupId` changes. A `band_site` row, if one exists, cascades away with the group.

A band owner deleting their own band from Settings keeps today's behavior: it is their project and their call, and the confirmation carries the same document count.

---

## Routes

### Band panel (`/band/{slug}`)

Unchanged root, now resolving a **group** slug. Nav splits into two sections so the presentational and managerial halves stop competing for one flat list:

| Section         | Route                          | Page                                          | Access       |
| --------------- | ------------------------------ | --------------------------------------------- | ------------ |
| —               | `/band/{slug}`                 | Dashboard                                     | all members  |
| **Public face** | `/band/{slug}/edit`            | Directory entry — tagline, genres, links, bio | owner, admin |
| **Public face** | `/band/{slug}/page-editor`     | Premium microsite blocks & theme              | owner, admin |
| **Public face** | `/band/{slug}/page-editor/epk` | EPK                                           | owner, admin |
| **Public face** | `/band/{slug}/subscription`    | Premium tier                                  | owner        |
| **Manage**      | `/band/{slug}/members`         | Roster, invitations, roles                    | all members  |
| **Manage**      | `/band/{slug}/announcements`   | Announcement list & composer                  | all members  |
| **Manage**      | `/band/{slug}/documents`       | Shared files                                  | all members  |
| **Manage**      | `/band/{slug}/events`          | Band events                                   | all members  |
| **Manage**      | `/band/{slug}/reservations`    | Practice bookings                             | all members  |
| **Manage**      | `/band/{slug}/settings`        | Delete band, danger zone                      | owner        |

### Group panel (`/group/{slug}`)

The same two-section shape for clubs and committees. Its _Public face_ is one page — the simple public page — and it has no reservations:

| Section         | Route                         | Page                                                    |
| --------------- | ----------------------------- | ------------------------------------------------------- |
| —               | `/group/{slug}`               | Dashboard                                               |
| **Public face** | `/group/{slug}/edit`          | Name, description, photo, visibility, join instructions |
| **Manage**      | `/group/{slug}/members`       | Roster, invitations, roles                              |
| **Manage**      | `/group/{slug}/announcements` | Announcement list & composer                            |
| **Manage**      | `/group/{slug}/documents`     | Shared files                                            |
| **Manage**      | `/group/{slug}/events`        | Group sessions, including the recurring series          |
| **Manage**      | `/group/{slug}/settings`      | Leave, hand off — **no delete**                         |

There is no danger zone here. Ending a club or committee is a staff action, so `/group/{slug}/settings` carries leaving and handing off but not deletion.

### Public

| Route                     | Page                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/groups`                 | Directory of public groups, filterable by kind                                                                                  |
| `/groups/{slug}`          | Simple public page — name, description, photo, upcoming sessions, and a Join button when `joinPolicy` is `open`                 |
| `/directory/bands/{slug}` | Band listing — unchanged, now resolving group → directory entry                                                                 |
| `/act/{token}`            | Token-gated contact sheet for an external act to fill in its own details. A **write** surface — no readable profile page exists |

The Join button is the only write on a public page. It requires a session, so a signed-out visitor gets a sign-in prompt that returns them to the group.

Groups get **no subdomains**. Only band microsites claim `{slug}.corvmc.org`, so `hooks.ts` is untouched. Group slugs still need reserved-checking, because they share one namespace with bands.

`RESERVED_SLUGS` lives in `src/lib/reserved-slugs.ts` and already covers system subdomains, the Cloudflare for SaaS plumbing (`saas`, `domains`, `fallback`), and the app areas bands shouldn't squat — including `band`, `bands`, `member`, `members`, `events`, and `directory`. What it does not yet hold is every word this spec introduces: `group`, `groups`, `club`, `clubs`, `class`, `classes`, `committee`, `committees`, `file`, `files`. These must be added **before the first group is created**; retrofitting means renaming live slugs.

Reserve `class` and `classes` now even though classes are deferred. Reserving a word costs nothing today and cannot be done later without taking a slug away from a group that already has it.

### Staff

| Route                | Page                                                                           |
| -------------------- | ------------------------------------------------------------------------------ |
| `/staff/groups`      | All clubs and committees; **create** a group and appoint its leader            |
| `/staff/groups/{id}` | Edit, set `joinPolicy` and visibility, reassign the leader, deactivate, delete |
| `/staff/bands`       | Existing page — gains a filter for external acts                               |

`/staff/groups` is the **only** place a club or committee comes into existence. External acts have no panel, no slug, and no page of their own; they are reached from the staff bands area, which gains an inline create used when booking an act into a production and a "send contact sheet link" action.

Add `act` and `acts` to `RESERVED_SLUGS` alongside the group words, so no group can claim the contact-sheet root as a subdomain.

### API

| Route             | Method   | Purpose                                 |
| ----------------- | -------- | --------------------------------------- |
| `/api/files/[id]` | `GET`    | Authorized private download — see below |
| `/api/files/[id]` | `DELETE` | Remove a document (owner, admin)        |

### Panel switcher

`AppTopbar.svelte` currently partitions panels with `p.type !== 'band'`, which would push every group into the top-level button row and blow out the topbar. `PanelTab['type']` widens to include `'group'`, the predicate becomes an explicit `'member' | 'staff'` test, and bands and groups share **one** "My groups" dropdown with sections.

`getMemberLayout`, `getStaffLayout`, and `getBandLayout` all three build this list from `listForUser`. Extract one `getPanels(userId)` rather than letting a fourth copy diverge.

---

## Notifications

One notification type covers every kind:

```
key         'announcement'
label       'Group announcements'
description 'Posts from bands, clubs, and committees you belong to'
defaults    { email: true, inApp: true, sms: false }
```

One key rather than one per kind: four near-identical rows in the preferences UI would be one user decision, and adding a kind would become a registry change plus a UI change. The kind goes in the notification `data` payload and the copy.

Per-group muting is `group_member.notifyAnnouncements`, which the global preference cannot express.

### Announcements ride the transactional stream, deliberately

An announcement is sent with `sendTemplateBatch()` on the **transactional** stream, gated by
`notification_preference` and `group_member.notifyAnnouncements`. It is therefore **not** filtered by
`subscriber.suppressedAt` — someone who has hit "unsubscribe from all" for marketing still receives
announcements from a group they belong to.

That is the intended behaviour, and the justification is that group announcements are not marketing:
you are receiving them because you joined a roster, and you can leave the group or mute it on the
membership row. The marketing suppression ledger governs campaigns, which are sent to people who did
not necessarily ask for them.

It is stated here because it is exactly the arrangement that produces a spam complaint, and **a
complaint on the transactional stream is far more damaging than one on broadcast** — that stream also
carries password resets and receipts, so its reputation is load-bearing for the whole app. Two
consequences follow:

- Every announcement email must carry a visible, one-click way to mute the group, landing on the
  membership row rather than on a marketing preference page. "There is a setting somewhere" is what
  makes people press the spam button instead.
- If complaint rates on the transactional stream ever rise, the fix is to move announcements to their
  own Postmark stream — not to start consulting `suppressedAt`, which would let a marketing opt-out
  silence a roster someone deliberately joined.

### Fan-out

The send runs in a listener registered inside `registerNotificationListeners()`, not inline in the remote function. The remote writes the row, emits, and returns.

**`dispatch()` in a loop does not work at group scale.** Per recipient it performs a preference SELECT, a notification INSERT, an in-memory SSE push, and one outbound HTTPS call to Postmark — all awaited serially. At 200 members that is roughly 600 sequential subrequests against a 1000-subrequest ceiling, tens of seconds of wall clock, and a mid-loop failure that leaves half the group notified with no record of where it stopped.

The listener instead:

1. **Latches.** `UPDATE announcement SET notified_at = ? WHERE id = ? AND notified_at IS NULL RETURNING id`. No row back means another invocation already sent; return. This is the idempotency the house rule requires of every event-bus side effect.
2. **Resolves recipients in one query.** `group_member ⋈ user LEFT JOIN notification_preference`, excluding the author, muted memberships, and soft-deleted users. Null preferences coalesce to the type's defaults in JS, mirroring `getPreference`.
3. **Inserts in-app rows in chunks.** D1 caps a statement at **100 bound parameters**, so a naive 200-row multi-column insert is rejected outright. Chunk, then group the statements into `db.batch([...])` — never `db.transaction()`, which the `custom/no-db-transaction` lint rule bans because it is broken on D1.
4. **Sends one batched email per 500 recipients** through a new `sendTemplateBatch()` alongside the existing `sendBroadcastBatch()`, on the transactional stream.
5. **Records `recipientCount`.**

That turns 200 emails into one subrequest and 200 inserts into roughly 20 statements across 2 batches.

Above ~500 recipients the listener persists a cursor and lets the existing cron drain it, so the failure mode at unexpected scale is a slow send rather than a truncated one. Real CMC groups are far below this; the rule exists so the ceiling is defined rather than discovered.

No new Postmark template is needed — the generic `notification` template is model-driven.

---

## Documents and private storage

**Documents is a file store, not a document tool.** Members upload files produced elsewhere — charts as PDFs, committee minutes from whatever word processor the committee already uses — and download them again. There is no in-app authoring, no rich-text editor, no versioning, and no structured minutes or agenda format. That boundary is what keeps this a small feature, and it is a decision rather than an omission.

### This requires a second bucket

`media.corvmc.org` is an **R2 bucket custom domain**. There is no prefix scoping and no per-object ACL: attaching a custom domain makes the entire keyspace publicly readable, and existing keys are guessable (`bands/avatars/{bandId}.jpg`). A private document placed in the `corvmc` bucket would be one guessed URL away from public, and nothing in the app would report it.

`resolveImageUrl()` and `getPublicUrl()` compound this — they will mint a `media.corvmc.org` URL for _any_ key handed to them. (The transform half of this is fixed: `getPublicUrl` now only wraps keys whose extension is an image format, so a PDF resolves to a plain R2 URL rather than a meaningless transformation. Keys also carry a random token now, so they are no longer guessable from an entity id. Neither changes the core problem below — the object is still public.)

So:

- A new bucket `corvmc-private`, binding `R2_PRIVATE`, **no custom domain and no public access**. `wrangler.toml` gains a second `[[r2_buckets]]`; `hooks.server.ts` gains `initPrivateStorage(...)`; the env validation gains the binding.
- A new `src/lib/server/private-storage.ts` that **exports no URL-minting function at all**. The module boundary is the guardrail: there is no `getPublicUrl` in scope to call by accident.
- `file.key` must never reach `resolveImageUrl`.

### The download route

`src/routes/api/files/[id=uuid]/+server.ts`, reusing the existing `uuid` param matcher. It resolves the row, then authorizes against **the file's own group** — never against anything supplied by the request — with `requireGroupRole({ id: row.groupId }, 'member', { allowStaff: true })`.

Three response requirements, all load-bearing. Unlike avatars and posters, which sit on a separate media origin, private files are served **from the app origin with session cookies attached**:

- **Stream `obj.body` straight into `Response`.** Never `await obj.arrayBuffer()` — that buffers the whole file into a 128 MB isolate and burns CPU proportional to size.
- **`Cache-Control: private, no-store` plus `Vary: Cookie`.** Without it Cloudflare's edge can cache one member's authorized response and serve it to the next requester.
- **`Content-Disposition: attachment` plus `X-Content-Type-Options: nosniff`**, with CR/LF and quotes stripped from the filename. Serving a user-uploaded `text/html` inline would be stored XSS against `corvmc.org`.

### Limits

Allowed types are a constant in `private-storage.ts`, **not** a change to `storage.ts`'s `ALLOWED_TYPES`, which also governs avatars:

```
application/pdf
image/jpeg, image/png, image/webp
text/plain, text/csv
application/vnd.openxmlformats-officedocument.wordprocessingml.document   (.docx)
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet         (.xlsx)
```

Legacy macro formats (`application/msword`, `application/vnd.ms-excel`), `application/zip`, and `application/octet-stream` are excluded.

`uploadFile()` enforces its 10 MB cap regardless of the `allowedTypes` argument it is given, and 10 MB is small for a real document. The private module carries its own `MAX_DOCUMENT_BYTES` of 25 MB rather than raising the shared constant. That is a hard ceiling: the file passes through `request.formData()` into an `ArrayBuffer` in the Worker, so memory is the real limit. Anything larger needs presigned multipart upload, which is [not in scope](#not-in-scope).

Quota is `sum(sizeBytes)` for the group where `deletedAt IS NULL`, checked before upload — 250 MB and 50 files per group, as service constants rather than per-group columns until someone asks for tiering.

Soft-deleting a document **hard-deletes the R2 object immediately**; the row is the audit record. A soft-delete flag with no reaper is how storage bills grow silently.

`File.type` is browser-supplied and spoofable, and there is no virus scanning. The exposure is bounded — authenticated members only, forced attachment, `nosniff` — but it is a real trade-off and is stated rather than left implicit.

---

## Service surface

New: `src/lib/server/group/`.

| Function                                                                 | Description                                                                                                                        |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `create(ownerId, { kind, name, description })`                           | Group + owner row + directory entry, one batch. Callers gate on kind: `band` is member self-service, `club`/`committee` staff-only |
| `update(groupId, data)`                                                  | Name/description/visibility/`joinPolicy`; re-slug on rename, excluding self                                                        |
| `joinGroup(groupId, userId)`                                             | Self-join. Re-reads `joinPolicy` from the resolved group; always `role: 'member'`, `status: 'active'`                              |
| `assignLeader(groupId, userId, actorId)`                                 | Staff appointment: owner row created or moved without the outgoing owner's participation                                           |
| `deactivate(groupId)` / `reactivate(groupId)`                            | The normal end-of-life. Sets/clears `deletedAt`; no rows removed, no R2 objects touched                                            |
| `deleteGroup(groupId, actorId)`                                          | Hard delete for mistakes only. Delete private objects, null the entry's `groupId` and hide it, delete group (cascades)             |
| `getBySlug(slug)` / `getById(id)`                                        | Excludes soft-deleted; includes member count                                                                                       |
| `listForUser(userId)`                                                    | Groups where the user has a row, any status                                                                                        |
| `getMembers(groupId)`                                                    | Rows joined to user, ordered owner → admin → member                                                                                |
| `invite` / `acceptInvitation` / `declineInvitation` / `revokeInvitation` | Unchanged semantics, group-scoped                                                                                                  |
| `removeMember` / `updateMember`                                          | Client ids re-scoped via `memberScope`                                                                                             |
| `transferOwnership` / `leaveGroup`                                       | Owner constraints as today, minus the `ownerId` write                                                                              |
| `claimExternalAct(entryId, ownerId)`                                     | Creates the group, sets `directory_entry.groupId`, inserts the owner row, archives the `contact`                                   |
| `createExternalAct(data, actorId)`                                       | Staff-only. An unowned entry forced to `visibility: 'hidden'`, plus its `contact` row                                              |
| `sendContactSheetLink(entryId, email, actorId)`                          | Staff-only. Issues a `directory_entry_link` token and emails it                                                                    |

`announcement-service.ts`, `file-service.ts`, and `group-context.ts` sit alongside it.

Two further modules, each drawn so that its boundary carries a rule:

- **`src/lib/server/directory/entry-service.ts`** absorbs what `band-service.ts` and
  `profile-service.ts` currently duplicate — listing, visibility, tags, and the public shaping for
  members and groups alike. `band-service.ts` shrinks to the microsite: tier, subscription, custom
  domain, blocks.
- **`src/lib/server/directory/contact-service.ts`** is the **only** module permitted to import the
  `contact` schema, guards with `requireStaff()` internally, and exports no shape that reaches a
  client. A custom ESLint rule enforces the import ban, in the manner of the four rules the repo
  already ships.

`requireBandMember` / `requireBandAdmin` / `requireBandOwner` remain for one release as thin deprecated wrappers delegating to `requireGroupRole`, so the schema work and the 55-call-site port land in separate reviewable PRs.

---

## Feature flags and rollout

Four flags: `groups`, `groupEvents`, `groupFiles`, `announcements`. The last two cover bands as well as groups, since both capabilities key off group membership and bands are groups.

A flag must be registered in **three** places: the `FeatureFlag` union and `ALL_FLAGS`, both in `src/lib/server/feature-flags.ts`, and a `feature.`-prefixed entry in `DEFAULTS` in `src/lib/server/site-config/site-config-service.ts`. Missing the third makes `config()` _throw_ `Unknown site config key`, not return false — but `feature-flags.spec.ts` now asserts the set both ways, so a half-registered flag fails CI rather than reaching production. Register all three and the test is silent.

Phase order. Each phase ships green, with bands working at every step.

| #   | Phase                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Reserved slugs. First, and near-irreversible once groups exist                                                                                                                                                                                                                                                                                                                                                                                 |
| 1   | `band` → `group`: the row keeps its identity and the table is renamed (see below), gaining `kind`, `joinPolicy` and `joinInstructions`. `band_member` is untouched — its foreign key simply points at the renamed table. Rename the `'band'` booker type to `'group'`; no `bookerId` repoint is needed                                                                                                                                         |
| 2   | `band_member` → `group_member`, with every read and write ported and the CI grep gate — **its own PR**                                                                                                                                                                                                                                                                                                                                         |
| 3a  | `directory_entry` + `directory_tag`: create, backfill one entry per band **and** per member, fold in `band_genre`/`user_genre`/`user_instrument`, migrate readers. Columns stay on `user`/`group` until 3c. **Four PRs**: schema + backfill, then the band half, then the member half, then the merges and the gate — split by surface, because reads and writes for one surface cannot move apart without a window where an edit is invisible |
| 3b  | `band_site`: move tier, subscription and the five `customDomain*` columns; re-key `band_page_config` and `band_media`. Carries the `band-host-service.ts` join                                                                                                                                                                                                                                                                                 |
| 3c  | Drop the moved listing columns from `group` and `user`, plus `ownerId`. Carries the owner left-join conversion. **Not** `slug`, `name` or the avatar columns — see [Directory entry](#directory-entry)                                                                                                                                                                                                                                         |
| 4   | `requireGroupRole` + explicit refs; deprecated wrappers retained                                                                                                                                                                                                                                                                                                                                                                               |
| 5   | `/staff/groups` + `/group/{slug}` panel + public group page; `joinPolicy` and self-join                                                                                                                                                                                                                                                                                                                                                        |
| 6   | `group_invite` replaces `platform_invite`                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7   | Announcements — bands and groups simultaneously, since it is the same code                                                                                                                                                                                                                                                                                                                                                                     |
| 8   | Documents — bucket and binding deployed and verified **first**, then the table and route                                                                                                                                                                                                                                                                                                                                                       |
| 9   | Group events + `event_group` + `createGroupEvent()`; fix the recurring generator                                                                                                                                                                                                                                                                                                                                                               |
| 10  | External acts: unowned entries, `contact`, `directory_entry_link` + `/act/{token}`, and `event_band` re-keyed to `directoryEntryId`                                                                                                                                                                                                                                                                                                            |

Do not interleave phases 1–3. A half-ported roster plus a new `group` table means group bugs and band regressions land in one diff and cannot be told apart.

Phase 3 is split into three because it is now the largest step in the plan — it touches `user` as
well as `band`, and it merges three tag tables. The order matters: **3a backfills without dropping
anything**, so a mistake in the entry backfill is recoverable from columns that still exist. Only 3c
is irreversible, and by then the readers have been running against the new tables for two releases.

Phase 10 sits last deliberately. External acts are the only part of this spec that stores third-party
personal data, and putting it after everything else means the access-path rule, the lint rule, and
the retention job land in a diff where they are the subject rather than a detail.

### Identity through the migration

**`group.id` is `band.id`.** A band is not copied into a new group; the row keeps its identity and
becomes the group, and the columns belonging elsewhere move out from under it. Most of the
migration's difficulty disappears with that one decision:

- Six foreign keys — `band_member`, `band_slug_history`, `platform_invite`, `event.bandId`,
  `event_band.addedByBandId`, and `reservation.bookerId` — change **name only**. Every stored value
  stays correct.
- `reservation.bookerId` needs no repoint at all. Only the enum value changes, per
  [`bookerType` is a table discriminator, not a category](#bookertype-is-a-table-discriminator-not-a-category).
- **No id map is carried between phases.** That was the alternative's real cost: minting fresh group
  ids would mean threading a band→group mapping through phases 1, 2 and 3, where one missed lookup
  silently reattaches a row to the wrong band.

**One hazard, and it is the destructive kind.** `pnpm db:generate` must be told that `band` → `group`
is a **rename**, not a dropped table plus a new one. Answer that prompt wrong and the generated
migration drops every band. Read the emitted SQL before committing it — this is the one step in the
plan where a bad migration is unrecoverable rather than merely wrong.

**`directory_entry` does not reuse ids.** Its rows get fresh uuids, deliberately. Seeding them from
`band.id` would make `entry.id == entry.groupId` true for every migrated band and false for every new
one, so code passing a group id where an entry id belongs would work in production against old data
and fail only on records created later. That is the worst failure shape available here.

It costs nothing in practice, because the mapping never has to be carried anywhere. Phase 3a inserts
the entries and folds `band_genre` in the same step, and phase 10 re-keys `event_band` seven phases
later off the same resolution — `group_id` does not expire, which is the real content of the
no-id-map argument:

```sql
UPDATE event_band
   SET directory_entry_id = (
     SELECT id FROM directory_entry WHERE directory_entry.group_id = event_band.band_id
   );
```

The same holds for `band_page_config` and `band_media` re-keying to `band_site` in 3b.

Phase 2 carries a specific hazard: raw SQL that `pnpm check` cannot see inside compiles fine through the port and throws at runtime the moment the table is renamed. `band-service.ts` holds three such `band_member` subqueries — inside `listForUser`, `listAll`, and `getByIdWithDetails` — and there is at least a fourth elsewhere in `src/`: `LEADS_A_BAND` in `marketing/system-audience-defs.ts`. Scripts carry more (`backfill-band-owners.ts`, `seed-dev.ts`, `d1-table-order.mjs`). Write the CI grep gate against the literal string across the whole tree rather than against `band-service.ts`, because the count is what keeps being wrong.

The split between phases 1 and 2 is drawn at the table, not at the layer, and that is deliberate: renaming a table in the database forces every code reference to it into the same commit, so `band` and `band_member` cannot be renamed together and reviewed apart. `band` reaches 39 files; `band_member` reaches roughly 180 references across 18. Separately each is a mechanical diff a reviewer can scan; together they are one diff in which a band regression and a roster regression are indistinguishable.

---

## What changes

| Area           | Change                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Database       | `group`, `group_member`, `group_invite`, `announcement`, `file`, `event_group`, `contact`; `band` → `directory_entry` + `band_site` |
| Slugs          | Move to `group`, which owns the address namespace; `band_slug_history` → `group_slug_history`                                       |
| Custom domains | The five `customDomain*` columns follow the microsite to `band_site`; `band-host-service.ts` joins                                  |
| Ownership      | `band.ownerId` dropped; the owner is a `group_member` row; three owner joins become left joins                                      |
| Permissions    | `band-context.ts` → `requireGroupRole` with explicit refs                                                                           |
| Events         | `event.bandId` → `event.groupId`; `source` gains `'group'`; `event_group` for co-billing                                            |
| Lineups        | `event_band` re-keys to `directoryEntryId`; an unowned entry is `confirmed` by construction, and solo members become creditable     |
| Group events   | New `createGroupEvent()` that can reserve the room free via `bookerType: 'event'`                                                   |
| Reservations   | `bookerType: 'band'` is renamed `'group'` and its `bookerId` repoints to `group.id`; `kind` stays off the polymorphism              |
| Enrollment     | `joinPolicy` on `group`; self-join for `open` groups                                                                                |
| Staff panel    | New `/staff/groups` — the only place a club or committee is created                                                                 |
| Contact sheets | `directory_entry_link` + `/act/{token}` — a magic-linked write surface and the subject-rights door                                  |
| Attribution    | Public mentions of an external act link **out** to the act's own URL, or render as plain text                                       |
| Storage        | Second R2 bucket for private documents                                                                                              |
| Email          | `sendTemplateBatch()` added to the Postmark client                                                                                  |
| Notifications  | One `announcement` type; per-group mute on the membership row                                                                       |
| Nav            | Band panel splits into Public face / Manage; topbar gains a merged groups dropdown                                                  |

## What doesn't change

| Area                   | Notes                                                                             |
| ---------------------- | --------------------------------------------------------------------------------- |
| Auth / session         | No changes                                                                        |
| Platform roles         | `admin` / `staff` / `sustaining` / `member` untouched; group roles are orthogonal |
| Reservation flow       | Booking, conflicts, credits, payment all unchanged                                |
| Band microsite         | Blocks, themes, EPK, custom CSS all unchanged; they re-key to `band_site`         |
| Staff inbox            | Untouched — it models external contacts, not member sets                          |
| `production_slot`      | Run-of-show modeling stays entirely with productions                              |
| Recurring reservations | The generator's reservation branch is not extended to groups                      |

---

## Prerequisites and known defects

Verified against the code, and load-bearing for this design whether or not they are fixed in the same
pass. Findings are anchored to symbols rather than line numbers, which move.

| Finding                                                                                                                                                                | Location                                                                  | Effect                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `processEventSeries()` hard-codes `source: 'cmc'` and `status: 'draft'`, copying neither owner nor `location`, and creates no reservation unless the prototype had one | `generation-job.ts` — `processEventSeries`                                | A club's recurring jazz night would never reach the gig guide **and** would not hold the room. Latent today only because band events cannot be recurring at all.                                                                                                                                                                                         |
| `createBandEvent()` creates no reservation at all — it is an off-site gig listing                                                                                      | `event-service.ts` — `createBandEvent`                                    | There is no non-staff path that reserves the room, so `createGroupEvent()` must add one, modelled on `create()` in the same file, including the `hasConflict` pre-check and the compensating delete if the event insert fails.                                                                                                                           |
| `invitedById` declared `.notNull()` **and** `onDelete: 'set null'`                                                                                                     | `platform-invite.ts` — `platformInvite`                                   | Deleting a user who ever sent an invite fails on a NOT NULL violation. Fixed by the new table.                                                                                                                                                                                                                                                           |
| A declared parameter that the handler never binds, then authorization off `params.slug`                                                                                | `band-events.remote.ts` — `getBandEventDetail`, `getBandLineupInvites`    | Two sources of truth for one value. The original instance in `createBandEventForm` was fixed and the shape recurred; resolved for good by the explicit-ref refactor.                                                                                                                                                                                     |
| Three raw-SQL `band_member` subqueries                                                                                                                                 | `band-service.ts` — inside `listForUser`, `listAll`, `getByIdWithDetails` | Invisible to `pnpm check`; throw at runtime after the table is dropped. Needs a CI grep gate on the literal string as part of phase 2.                                                                                                                                                                                                                   |
| Three `innerJoin(user, eq(user.id, band.ownerId))` — twice in `listAll`, once in `getByIdWithDetails`                                                                  | `band-service.ts`                                                         | An ownerless group is legal under this spec, and an inner join drops any row whose owner is missing. In `listAll` that hides precisely the groups staff need to act on; in `getByIdWithDetails` it empties the detail page of a group that still exists. All three must become left joins during the port. See [Ownership](#ownership).                  |
| `flagEntityTypes` contains `'member_profile'` and `'band_profile'`                                                                                                     | `flag.ts`                                                                 | Both entity types resolve to a `directory_entry` id, since that is where the flagged content (bio, photo, links) lives for a member and a band alike. The enum values keep their names and meanings; only what `content_flag.entityId` points at changes. Add a comment on the enum rather than renaming, which would need a data migration for no gain. |

**A decision this spec must make, not defer:** whether `processEventSeries()` copies `status` from the prototype. Doing so is required for a club series to publish automatically, but it changes behavior for existing staff CMC series, which today always generate drafts for review. Publish automatically only when `source !== 'cmc'`, preserving the staff review step where it already exists.

---

## Not in scope

Flat list, so nobody has to guess whether an omission was deliberate.

- **A group as a messaging recipient** — addressing a group in the inbox so a message reaches every
  member. Wanted, and a follow-up rather than part of this spec. `inbox_participant` already carries
  multi-party threads with a per-participant read cursor, so the table is not the problem; the design
  question is whether addressing a group **expands to participant rows at send time** (a snapshot —
  later joiners never see the thread, leavers stay in it) or **references the group and resolves
  membership at read time** (live — but the read cursor lives on the participant row, so unread would
  need rethinking). Note also that a group thread and threaded announcements are nearly the same
  feature approached from opposite ends: one is two-way to all members, the other is one-way with
  replies. Decide them together, or the second one built will duplicate the first.
- Threaded discussion — replies to announcements, read receipts, unread counts. See above.
- Group email aliases — an inbound address per group fanning out to members. Distinct from the item
  above: that is internal addressing, this is an external inbound address.
- Document folders, versioning, and previews. Flat list, one version, download only.
- Presigned multipart upload, needed above the 25 MB in-Worker ceiling.
- Group rehearsal bookings — a group holding the room privately, outside an event. Programs do not
  need it: their sessions are events, and events reserve the room free.
- Request-to-join. `joinPolicy` has two values, not three. Approval-gated joining needs a
  `status: 'requested'` rather than reusing `'pending'`, which today means "we invited you, awaiting
  your answer" — a join request is its exact mirror, and overloading one value would make every
  roster query ambiguous about which direction it faces.
- Contact sheets for member bands. A member band edits its entry in its own panel.
- Group subdomains. Only band microsites claim one.
- Public directory filtering beyond kind and genre.
- Per-group document quota tiers. Service constants for now.
