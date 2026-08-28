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

Everything below follows from taking that seriously. The corollary is the part that resolves the
long-running argument about polymorphic tables: **a sweep is required for the object regardless of
what shape the schema takes.** Once one exists, running it over rows as well is free — so the
referential integrity a foreign key would have bought on the parent side is no longer worth
contorting the schema for.

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
  in Drizzle's SQLite dialect, which is what makes adding a parent type — `production`, `venue` —
  free later. `attachableType` starts as `event | group | user`; `slot` as
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

## Open question: reconciling with `groups-spec.md`

`groups-spec.md` states that soft-deleting a document **hard-deletes the R2 object immediately**,
reasoning that "a soft-delete flag with no reaper is how storage bills grow silently." That reasoning
is correct and holds only while no reaper exists. This spec builds one, so group documents should
move to detach-and-sweep for consistency.

That is a change to a spec whose implementation is in flight — groups phase 3a landed in #283 and
#285 — so it is recorded here as a question for whoever owns that module rather than made
unilaterally.

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
5. **Delete the poster copy.** Remove `copyObject` from `generation-job.ts`; occurrences attach the
   prototype's `media` row instead. This is the payoff — a 52-week series holds one object.
6. **Drop the old columns.** Last and separately. Dropping `event.posterKey` rebuilds `event`, which
   `groups-spec.md` calls the riskiest rebuild in the schema, so it goes through
   `d1-safe-rebuild.mjs` in a PR of its own.

## Related

- `CHORES.md` — the media-management entry this spec closes.
- `docs/reports/feature-catalog.md#image-delivery` — Cloudflare Image Transformations, the layer
  above this one.
- `docs/specs/groups-spec.md` — private group documents, the `R2_PRIVATE` bucket, and the quota this
  spec must not inflate.
- `docs/specs/shipped/recurring-reservations-spec.md` — prototype cloning, which is why occurrences
  copy a poster today.
