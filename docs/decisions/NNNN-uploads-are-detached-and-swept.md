# NNNN Uploads are detached and swept, never deleted inline

- **Date:** 2026-08-28
- **Status:** Accepted
- **PRs:** #289

## Context

Each upload was one R2 key in one column: `event.posterKey`, `group.avatarKey`, `user.image`, and
`band_media` for galleries. A recurring series copied its poster once per occurrence, because
deleting a key on update or cancel would have pulled a shared object from under its siblings. There
was nowhere for alt text or a second image. `band_media` cascaded on band delete and nothing deleted
its objects, so the cascade destroyed the only record of each key.

## Decision

**An R2 object is never deleted as a side effect of deleting a row.** Rows detach; a sweep that sees
the whole reference graph reaps objects.

1. **Two tables.** `media` is one row per object; `media_attachment` is one row per usage, with an
   `attachableType`, `attachableId` and `slot`. Several parents may share one object.
2. **`mediaId` is a real foreign key; `attachableId` has none.** The parent set is open by design,
   so a new consumer adds an `attachableTypes` value, which emits no SQL.
3. **`/api/cron/sweep-media` runs daily.** It drops attachments whose parent is gone, then deletes
   unattached `media` rows and their objects, skipping rows inside a grace window so an upload not
   yet attached survives.
4. **A global count goes through `liveAttachmentCondition()`.** Per-parent reads need no guard.
5. **Single-key columns keep their values.** `event.posterKey`, `group.avatarKey` and `user.image`
   are written by the same path that records the `media` row, so about 127 existing queries did not
   become joins. The gallery reads `media_attachment`; `band_media` was dropped.
6. **Private files are a separate table with intrinsic ownership.** Group documents use `file`,
   whose `groupId` is NOT NULL, in `R2_PRIVATE`. They follow the same discipline: delete sets
   `deletedAt`, and the sweep reclaims the object.

## Alternatives rejected

- **A typed foreign key per parent**, as `directory_entry` uses. Its parent set is closed; this one
  is open, and each new consumer would migrate the table.
- **Inline reference counting.** Two concurrent detaches both read zero and both delete. D1 has no
  transaction to make the read and delete atomic, and the sweep is a single writer.
- **One `media` row per parent, without sharing.** It cannot fix the copied poster.
- **Private documents in `media`.** An unattached private file would have no owner to authorize
  against, and an owner column would close the open parent set.

## Consequences

- Orphaned attachment rows exist between a parent's deletion and the next sweep. No per-parent read
  can return them, and ids are random UUIDs, so a new parent cannot inherit them.
- A recurring series shares one poster object across its occurrences.
- Each new private store adds a pass to the sweep rather than an inline delete.
