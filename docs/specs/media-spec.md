# Media & Attachments — Spec

## Purpose

Every uploaded file in this app is one R2 key in one column on one row. `event.posterKey`,
`group.avatarKey`, `user.image`, plus `band_media` for band-site galleries. There is no layer between
the entity and the object, and four things follow from that.

**A recurring series duplicates its poster.** `generation-job.ts` calls `copyObject` per occurrence
(`src/lib/server/reservation/generation-job.ts`), so a 52-week series is 52 copies of one JPEG in R2.

**Deletion has no reference check.** `event-service.update()` and `cancel()` delete `posterKey`
outright. That is _why_ occurrences must copy rather than share — a shared key would be deleted out
from under its siblings.

**There is nowhere to put alt text, a caption, or a second image.** A column holds a key and nothing
else.

**And `band_media` leaks objects permanently.** Its `bandId` carries `onDelete: 'cascade'`
(`src/lib/server/db/schema/band-page.ts:47`), and `bandMedia` is read-only across the whole
codebase — its only non-schema reference is a `SELECT` at `src/lib/remote/band-site.remote.ts:114`.
`deleteObject` is called from exactly three places, all for `avatarKey` or a profile image. So
deleting a band drops the rows and orphans every gallery object **unreclaimably**: the cascade
destroys the only record of the key that object was stored under.

That last one is the finding this spec is built around, because it inverts the usual argument. A
foreign key is supposed to be the thing that keeps deletion honest. Here it deletes the pointer and
leaves the asset — the cascade is not merely insufficient, it is the mechanism by which the object
becomes unreachable.

## The rule

> **An R2 object is never deleted as a side effect of deleting a row.**
> Rows are detached; objects are reaped by a sweep that can see the whole reference graph.

Everything below follows from taking that seriously.

## Why the parent link carries no foreign key

This is the decision the rest of the design turns on, and it is worth stating plainly rather than
leaving to be inferred from the schema.

**The parent set is open by design.** A media layer earns its keep by being the answer for anything
that ever needs a file — an event poster today, a production's advance packet, a venue photo, an
incident report attachment, things not yet designed. Any shape that names its parents in columns
turns "this new feature wants to attach a file" into a schema change: an `ALTER TABLE ADD COLUMN`,
an amendment to the exactly-one rule, and an edit to every query that enumerates parents. A shared
layer that must be modified by each consumer before it can serve them is not shared infrastructure.
Broad applicability is the requirement, and an unenforced parent link is what it costs.

**This is not the case `directory_entry` settled.** That table uses two nullable typed foreign keys
for what looks like the same question, and it is right to: its parent set is _closed_ — a user, a
group, or nothing — and enumerated by the domain itself, so a third would be a real domain event
rather than a routine one. Paying a column for it is proportionate there and is not here. The two
tables answer different questions, and the axis that separates them is whether the set of parents is
known in advance.

**The sweep then makes the cost small rather than being the reason for it.** An R2 object needs a
sweep whatever shape this table takes, since a cascade deletes rows and never objects. Once one
exists, reconciling rows with it is nearly free — so the integrity a parent-side foreign key would
have bought is the smaller half of what it would have cost.

## Prior art

No package supplies this. The R2 npm packages (`node-cloudflare-r2`, `cloudflare-r2`,
`@oprdev/cloudflare-r2-storage`) are S3 client wrappers, and this repo already has both the native
binding and `@aws-sdk/client-s3`, plus `uploadFile` / `deleteObject` / `getPublicUrl` / `mediaKey` in
`src/lib/server/storage.ts`. The upload pipelines (uploadthing, Pushduck, Uppy) solve the
client → storage leg, which `svelte-easy-crop` and the existing REST endpoints already solve;
uploadthing is rejected by name in the feature catalog. No Drizzle plugin exists. **The table is
hand-rolled in every stack**, so what is worth copying is a design, not a dependency.

Two mature ones, and they agree with each other on the two points that matter here:

|              | Rails ActiveStorage                                                       | Spatie laravel-medialibrary                       |
| ------------ | ------------------------------------------------------------------------- | ------------------------------------------------- |
| Shape        | Two tables: `blobs` + `attachments`                                       | One table: `media`                                |
| Parent link  | `record_type` / `record_id`, polymorphic, **no FK**                       | `model_type` / `model_id`, polymorphic, **no FK** |
| Slot naming  | `attachments.name`                                                        | `collection_name`                                 |
| Cleanup      | Application-level `purge` / `detach`, plus a **`purge_unattached` sweep** | Model events                                      |
| Blob sharing | Yes — many attachment rows, one blob                                      | No — one media row belongs to one model           |

**Adopt the ActiveStorage split**, and fold in Spatie's `collection_name` as `slot`. The
single-table form cannot share a blob across parents, which is the entirety of the recurring-poster
problem. And note that ActiveStorage's `attachments` table _is_ a link table — it simply happens to
be polymorphic on one side.

Both designs having landed on an unenforced parent link, with a sweep behind it, is the strongest
available evidence that the pattern is sound at far larger scale than CMC will ever reach.

## Decisions

- **Two tables, split by whether the row describes the file or the usage.**

  `media` is one row per R2 object: `id`, `key` (unique — minted by `mediaKey()`, which already
  carries a random token), `contentType`, `byteSize`, `filename` (the original, for
  `Content-Disposition`), `altText`, `caption`, `uploadedByUserId` (FK → `user`,
  `onDelete: 'set null'`), `createdAt`. Immutable in spirit: replacing an image mints a new row and
  never mutates `key`.

  `media_attachment` is one row per usage: `id`, `mediaId`, `attachableType`, `attachableId`, `slot`,
  `sortOrder`, `createdAt`. Indexed on `(attachableType, attachableId, slot)` and on `mediaId`.

- **The two foreign keys are deliberately asymmetric.** `mediaId` is a real FK with
  `onDelete: 'cascade'`, so an attachment can never point at a blob that is gone. `attachableId` has
  no FK at all and is swept. The half that can be enforced for nothing is enforced; the half that
  needs application handling anyway is handled there rather than twice.

- **`attachableType` and `slot` are TypeScript enums, not SQL.** Extending either emits **zero SQL**
  in Drizzle's SQLite dialect. This is not a convenience — it is the mechanism by which the parent
  set stays open, so a new consumer adds a string and writes rows rather than migrating this table. `attachableType` starts as `event | group | user`; `slot` as
  `poster | avatar | gallery | hero | rider | stage_plot`, carrying over the `band_media.type`
  vocabulary.

- **Deletion is detach, then sweep — never inline.** Detaching deletes the `media_attachment` row
  and leaves both the object and the `media` row alone, because a sibling occurrence may still be
  using them. `/api/cron/sweep-media` runs daily and does two passes: first, delete attachment rows
  whose parent no longer exists (one `NOT EXISTS` per `attachableType` — three queries); second,
  delete `media` rows with zero attachments, calling `deleteObject(key)` before the row goes.

- **Inline reference counting is rejected, on a hard constraint rather than taste.** Two concurrent
  detaches both read `COUNT(*) = 0` and both delete. D1 has no transaction to make the
  read-then-delete atomic: `db.transaction()` is broken and banned by the `custom/no-db-transaction`
  lint rule, and `db.batch()` provides no isolation. The sweep is a single writer and is therefore
  correct without one.

- **The sweep honours a grace window.** A `media` row younger than the window is never reaped even
  with zero attachments, because an upload that has been written but not yet attached would otherwise
  be destroyed mid-flight. Rails' `purge_unattached` carries the same hazard and the same guard.

- **Nothing changes above `getPublicUrl()`.** This is the layer _under_ Cloudflare Image
  Transformations. `getPublicUrl()` and `imageSrc()` keep working exactly as they do today.

## What the sweep gets wrong, stated rather than buried

Between a parent's deletion and the next sweep, orphaned attachment rows exist. Two properties make
that survivable, and both were verified rather than assumed:

**Orphans are unreachable.** Nothing queries `media_attachment` globally. Every read asks "the media
for event X", and X is gone, so no query returns them.

**Orphans can never be re-adopted.** Every id in the schema is `crypto.randomUUID()` — checked across
all schema files, zero exceptions — so a new parent can never take a dead parent's id and silently
inherit its attachments. This is the failure mode that makes unenforced links genuinely dangerous in
schemas with sequential ids, and it is structurally impossible here.

**The exception is counting across parents.** A **per-parent** read needs no guard at all: it filters
to an id the caller already holds, and an orphan belongs to a deleted parent, so it can never match.
That covers `groups-spec.md`'s 250 MB / 50-file quota, which is scoped to one live group and is safe
as written — the first draft of this spec claimed otherwise, and building the service showed the
caveat had been drawn too wide.

What is genuinely unsafe is a **global** aggregate — a reporting total, a staff-wide media listing —
which sees rows belonging to every parent deleted since the last sweep. Those go through
`liveAttachmentCondition()` in `media-service.ts`, which returns one `EXISTS` arm per
`attachableType`. A bare `SUM` across `media_attachment` is a bug, and the helper exists so that rule
has one place to live rather than being restated at each call site.

## Reads

Drizzle `1.0.0-rc.3` — which this repo already runs, with `defineRelations` in
`src/lib/server/db/schema/relations.ts` — supports `where` on a relation definition
(`ManyConfig.where`). The discriminator therefore lives in the relation once, rather than at every
call site:

```ts
event: {
	media: t.many.mediaAttachment({
		from: t.event.id,
		to: t.mediaAttachment.attachableId,
		where: { attachableType: 'event' }
	});
}
```

This is new in v1; the v0 relations API could not express it. It is worth noting that this solves
_reading_ only — it emits no SQL and enforces nothing, which is precisely why the sweep above is the
integrity story.

## Not in scope

- **Private documents.** `groups-spec.md` designs a separate `R2_PRIVATE` bucket with its own
  authorized download route, because the public bucket's custom domain makes the entire keyspace
  readable. That store is deliberately not merged into this one; the two compose later.
- **Image conversions and variants.** Cloudflare Image Transformations already generate every size
  at request time, so ActiveStorage's `variant_records` and Spatie's `generated_conversions` have no
  counterpart here and would be pure overhead.
- **Checksum dedup.** `media.checksum` is the natural extension point for "this exact file is already
  uploaded", and nothing has asked for it. Left out of v1 rather than designed and unused.
- **Direct-to-R2 presigned uploads.** Uploads pass through the Worker today. Changing that is a
  separate decision and would only sharpen the need for the grace window, not remove it.

## Why `file` and `media` are two tables

`groups-spec.md` gives group documents their own `file` table, and asserts the separation without
arguing for it. The two overlap in **seven of ten columns** — `id`, `key`, `filename`,
`contentType`, size, `uploadedBy`, `createdAt` — and since the section below they share a deletion
discipline too, so the question is a fair one and will be asked again.

What does **not** justify a second table:

- **The bucket.** `media` is public, `file` is `R2_PRIVATE` — that is a column, not a table. The
  guardrail `groups-spec.md` actually relies on is a _module_ one: `private-storage.ts` exports no
  URL-minting function, so there is no `getPublicUrl` in scope to reach for by accident. That holds
  however the rows are stored.
- **Different accepted types and size caps.** Service constants, not schema.

What does:

**`file.groupId` is `not null`, and ownership has to be intrinsic.** `/api/files/[id]` authorizes
against the file's own group, and a private object must be authorizable from the moment it exists —
including after upload and before anything is attached to it. Derive ownership from an attachment
and an unattached private file has no owner at all. It fails closed rather than leaking, but it is
broken.

The apparent fix — an owner column on `media` — is the thing this design exists to avoid. `media`
names no parents in columns precisely so a new consumer never has to migrate it, and adding
`ownerGroupId` to serve one consumer spends that property.

So: **public media has an open parent set and derived ownership; private files have a closed one and
intrinsic ownership.** That is the same open-vs-closed axis that separates `media_attachment` from
`directory_entry`, one level up. Two tables is right, and the overlap is the price.

Worth tidying when documents are built: `file.description` is `media.altText`/`caption` under a
different name, and `media` has no `deletedAt`/`updatedAt` where `file` has both.

## Settled: group documents follow the same discipline

`groups-spec.md` originally stated that soft-deleting a document **hard-deletes the R2 object
immediately**, reasoning that "a soft-delete flag with no reaper is how storage bills grow silently."
That reasoning was correct and held only while no reaper existed. This spec builds one, so group
documents now detach and let the sweep reclaim — `groups-spec.md` has been updated to say so.

This is a shared _discipline_, not a shared table. Documents keep their own `R2_PRIVATE` bucket and
their own row, because the public bucket's custom domain makes its whole keyspace readable. What
they adopt is the rule: no write path calls `deleteObject`, because no write can see whether
something else still references the object, and a failed R2 call after the row is gone strands the
file with no record of its key.

**One thing this owes the documents work.** `/api/cron/sweep-media` reaps `media` today and knows
nothing about a `file` table, which does not exist yet. Whoever builds group documents adds a third
pass to it — objects in `R2_PRIVATE` that no live `file` row points at — rather than reintroducing
an inline delete. The sweep is written as two independent passes precisely so a third costs nothing
structural.

## Phasing

Each is its own PR, sequenced so nothing is dropped before its replacement is proven.

1. **Schema and service.** `media` / `media_attachment` via `pnpm db:generate`, plus
   `src/lib/server/media/media-service.ts` — `attach`, `detach`, `listFor`, `liveAttachments`. Both
   tables are pure `CREATE TABLE`, so `d1-safe-rebuild.mjs` is not involved.
2. **The sweep.** `/api/cron/sweep-media`, its entry in `src/lib/server/cron/schedule.ts`, its
   `wrangler.toml` trigger and its Sentry Crons check-in. Ships _before_ any backfill, so nothing
   ever accumulates unreaped.
3. **Backfill.** A script reading `event.posterKey`, `group.avatarKey`, `user.image` and `band_media`
   into the new tables. The old columns keep their values and stay readable throughout.
4. **Cut over, one surface at a time.** Band gallery (`band-site.remote.ts`), then avatars
   (`band-service.ts`, `profile-service.ts`), then event posters.

   **Only the gallery moved its reads.** It was a list, and had one reader. The others are single
   keys selected inline by roughly 127 existing queries — 50 for `group.avatarKey`, 62 for
   `event.posterKey`, 15 for `user.image` — and turning each into a join costs a join on queries
   that today read a plain column, for entities that do not need sharing on the read side at all.

   So for those, **the write path moved and the column stayed**, maintained by the single writer
   that now also records the object. That keeps every benefit the layer exists for — no request
   deletes an R2 object, lifetime is the sweep's, several parents may share one object — while the
   column goes on being what it already was: a denormalization with one writer, the same bargain
   `directory_entry.name` strikes and for the same reason.

   It also still fixes the copy: occurrences point at one key with one `media` row and an attachment
   each, which is exactly what phase 5 needs.

5. **Delete the poster copy.** Done. `generation-job.ts` no longer calls `copyObject`; an occurrence
   attaches the prototype's `media` row and shares its key, so a 52-week series holds one object
   rather than 52. `copyObject` itself stays for its one remaining caller, the moderation takedown,
   which _moves_ a withheld poster to a fresh key rather than duplicating one.
6. **Retire `band_media`** — the one table the cut-over genuinely replaced. The key _columns_ stay:
   see below.

## Related

- `CHORES.md` — the media-management entry this spec closes.
- `docs/reports/feature-catalog.md#image-delivery` — Cloudflare Image Transformations, the layer
  above this one.
- `docs/specs/groups-spec.md` — private group documents, the `R2_PRIVATE` bucket, and the quota this
  spec must not inflate.
- `docs/specs/shipped/recurring-reservations-spec.md` — prototype cloning, which is why occurrences
  copy a poster today.
