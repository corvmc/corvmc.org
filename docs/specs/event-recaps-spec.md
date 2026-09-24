# Event Recaps — photos on a show after it happens

Tracking issue: #581, under #852 (an event's publicity, end to end), where it is the last stage.

## Purpose

After a show, the photos live in somebody's phone. Nothing on the site holds them, so a past event's
page is its pre-show listing with "This event has ended." under it, and a band that played has
nothing of ours to share. The issue asks for two outcomes: a **public archive** of what happened, and
**shareable content** for the acts on the bill.

## What already exists

Checked against `main` on 2026-09-23.

- **Storage.** `media` + `media_attachment` (`src/lib/server/db/schema/media.ts`) hold any number of
  images per parent, ordered by `sortOrder`, with `altText` and `caption` on the object. The
  `gallery` slot already exists, and `event_listing` is already an `attachableType`, so an event
  can hold a gallery **with no schema change**.
- **Lifecycle.** `media-service.ts` has `record`, `attach`, `detach`, `listFor` and
  `setDescription`. Removal is detach-only; `/api/cron/sweep-media` reclaims the R2 object once
  nothing points at it, and `liveAttachmentCondition()` already covers `event_listing`.
- **Upload validation.** `validateUpload` and `uploadFile` in `src/lib/server/storage.ts`, keys
  from `mediaKey()` in `storage-keys.ts`. Remote `form()`s accept `z.instanceof(File)` already
  (`files.remote.ts`).
- **The pattern to copy.** A band's press photos are the same shape on a `group`: `gallery` slot,
  capped count, detach on delete (`src/routes/api/bands/[id=uuid]/media/+server.ts`,
  `press-kit/PressPhotos.svelte`).
- **Nothing** in `src/` reads the `gallery` slot for an `event_listing`. The public event page
  (`src/routes/(public)/events/[id]/+page.svelte`) has no past-event state beyond the ended line,
  and `/events` lists upcoming shows only — there is no archive of any kind.

## What gets built

### Staff add photos to an event that has happened

On the staff event page (`/staff/events/[id]`), a **Photos** card, shown once the event has started
and is not cancelled.

- Upload several images at once. JPEG, PNG or WebP, 10 MB each — `validateUpload`'s rules, not a
  second set. At most 10 per upload and **60 per event**.
- Each photo is a `media` row attached to the event in slot `gallery`, appended to the end of the
  order. Keys are `mediaKey('events/photos', eventId, contentType)`.
- Each photo can have alt text and a caption, through `setDescription`.
- Removing one detaches it. No R2 delete in the request.
- One event's photos are its own. A recurring series' occurrences share a poster; they never share
  a gallery, because each occurrence is a different night.

The guard is `requireCapability('event.manage')` in a new `src/lib/remote/event-photos.remote.ts`,
with the rules in `src/lib/server/event/event-photo-service.ts`. The poster endpoint and poster
code are not touched.

### The public event page shows them

`getPublicEventDetail` returns the gallery in one extra `listFor` call. When it is non-empty the page
renders a **Photos** section under the event facts: a grid of thumbnails in order, each opening the
full image, alt text on every `<img>` (falling back to "Photo from <event title>"). The section has
an `id="photos"`, so `/events/<id>#photos` is the link a band shares. A cancelled or unpublished
event already 404s or has no photos; no new gate is needed.

### `/events` gets a recent-recaps strip

Below the upcoming shows, **Recent recaps**: the six most recent past public events that have at
least one photo, each a card with the first photo as its image, linking to `#photos`. One query in
`event-photo-service.ts`, joined to `event_listing` (so orphaned attachments cannot surface). When
there are none, nothing renders.

### Seed

`scripts/seed-dev.ts` gets a past CMC show with a handful of recap photos, captions on some, so the
gallery and the strip both render locally.

## Decisions taken without the user

Filed as `agent-filed` Task issues for review, each titled as the decision:

- **Only `event.manage` holders upload recap photos** (#1398). Not bands, not the Documentation role, not
  attendees.
- **Recap photos publish without a review queue** (#1399). Staff-only uploads need no moderation step.
- **A written recap** (#1401): `event_listing.recap_text`, nullable markdown. Staff with
  `event.manage` write it on `/staff/events/[id]` once the event has started, and can clear it at
  any time. The public page renders it above the photos, and each Recent recaps card shows a
  plain-text excerpt. `event.uploadRecap` holders cannot write it yet: that waits on a
  per-event `can(cap, { eventId })` resolver.
- **Consent is handled by takedown, not by a release on file per photo** (#1400). A person who asks is
  removed by staff detaching the photo.

## Not in this spec

- Band or member uploads, and the moderation they would need.
- The per-event shot list and same-week handoff that `committees-and-roles-spec.md` marks 🆕.
- Photos on a band's own page or site. The event link is the shareable unit for now.
- Poster compositing from recap photos (#606).

## Delivery

Two PRs, both into `main`. No feature branch: the public surfaces render only when photos exist,
and photos exist only once the staff card that ships in the same PR can make them, so `main` is
never showing half a feature.

1. This spec.
2. Service, remote, staff card, public section, recaps strip, seed, tests — `Fixes #581`.
