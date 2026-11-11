# 0024 Groups split the band table by purpose

- **Date:** 2026-08-08
- **Status:** Accepted
- **PRs:** #247, #267, #279, #283, #292, #307, #323, #324, #326–#329, #332, #336–#338

## Context

A `band` row held a roster, a public listing, a paid microsite and an address. Clubs and committees
needed the roster without the band columns. `user` and `band` carried seven identical listing
columns, three tag tables served two concepts, and `directory-service.ts` held parallel member and
band implementations. The driving case was the Real Book Club jazz jam: a roster, a recurring
drop-in session, a way to announce changes, and somewhere to keep charts.

## Decision

Split by purpose, not by entity type:

- **`group`** is the managed organization: roster, slug, `kind` (`band`, `club`, `committee`).
- **`directory_entry`** is the public listing for a member, a group, or nobody (an external act).
  `directory_tag` replaces `band_genre`, `user_genre` and `user_instrument`.
- **`band_site`** is the premium microsite. Its `groupId` is NOT NULL, so a site cannot exist
  without a band.

Rules that follow:

1. **`kind` carries governance, not behaviour.** Any member creates a band; only staff create a
   club or committee. A band is always `invite_only`, because a band member books room time against
   the band's credits and card. Free room time for a session travels with `kind`, and
   `requireProgramGroup` rejects a band.
2. **`group` owns one slug namespace**, `unique(slug)` across all kinds, so a guard resolves a group
   from a slug alone.
3. **`group.id` is `band.id`.** The table was renamed, so every foreign key kept its value and no id
   map crossed phases. `directory_entry` takes fresh ids so that a group id passed as an entry id
   fails on every row.
4. **Membership is a real foreign key**, not `(entityType, entityId)`. Deletes cascade without a
   purge helper or reconcile job.
5. **`reservation.bookerType` names a table.** `'band'` became `'group'`; `kind` stays off the
   discriminator.
6. **The guard takes an explicit ref.** `requireGroupRole({ slug } | { id }, minRole, opts)`
   replaced guards that read `params.slug`, which a remote function receives from the client.

## Alternatives rejected

- **A polymorphic roster** over bands and programs. It needed a purge helper on every delete path
  and a discriminator branch in every query.
- **A `band_profile` table split by entity type.** Promoting an external act to a band would have
  moved name, bio and avatar between tables.
- **Fresh group ids.** Every phase would have threaded a band→group map, where one missed lookup
  reattaches a row to the wrong band.
- **`unique(kind, slug)`.** A slug alone would no longer resolve a group.
- **Kind values as booker types.** A denormalized copy of `kind` that misses the next kind added.

## Consequences

- A club gets a directory entry like a band; a committee's entry carries nullable band-shaped
  columns it does not use.
- `directory_entry.name` and `bio` are copies of `user.name` and `group.name`/`bio`, maintained on
  write.
- Adding a kind is one value in `groupKinds` plus its governance row.
- Group documents use a second bucket, `R2_PRIVATE`, behind `private-storage.ts`, which exports no
  URL-minting function.
