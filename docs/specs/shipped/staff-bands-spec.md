# Staff Band Management

Staff currently have no visibility into bands. Members create and manage bands through the member panel and `/band/[slug]` routes, but staff can't browse, moderate, or create bands on anyone's behalf. This feature adds a `/staff/bands` section with list, detail, and moderation capabilities.

---

## Why this feature

Bands are a core booking entity — they hold reservations and have multiple members. When a band causes problems (double-booking, inactive members squatting slots, inappropriate names), staff have no way to intervene without direct database access. Staff also can't create bands for members who ask at the front desk.

---

## Key concepts

**Soft delete.** Deactivating a band sets `deletedAt` on the band row. Deactivated bands are hidden from members (their `listForUser` query filters them out) but visible to staff with a status filter. Staff can reactivate by clearing `deletedAt`. This is different from the owner's "delete band" action, which is a hard delete that cascades.

**Full management.** Staff can do everything a band owner can — edit name/bio, remove members, transfer ownership — plus moderation actions owners can't do (deactivate/reactivate). This avoids needing impersonation for band management tasks.

---

## Workflows

### Staff browses bands

1. Staff navigates to `/staff/bands`
2. Sees a table of all bands: name, owner name, member count, created date, status (active/deactivated)
3. Can search by band name
4. Can filter by status (all, active, deactivated)
5. Clicks a row → navigates to `/staff/bands/[id]`

### Staff views band detail

1. Staff navigates to `/staff/bands/[id]`
2. Sees band header: name, slug, bio, owner, created date, status badge
3. Sees members table: name, email, role, position, status (active/pending), joined date
4. Sees recent band reservations (last 10)
5. Can take actions from this page (edit, remove member, transfer ownership, deactivate)

### Staff edits band

1. On the detail page, staff edits name and/or bio fields
2. Submits the form
3. Band updates, slug regenerates if name changed

### Staff removes a member

1. On the detail page, staff clicks "Remove" on a non-owner member row
2. Confirmation prompt
3. Member is removed from the band
4. Cannot remove the owner — must transfer ownership first

### Staff transfers ownership

1. On the detail page, staff clicks "Transfer ownership" on an active member
2. Confirmation prompt
3. Current owner is demoted to admin, selected member becomes owner
4. `band.ownerId` updates

### Staff deactivates a band

1. On the detail page, staff clicks "Deactivate"
2. Confirmation prompt
3. `deletedAt` is set to now
4. All future band reservations are cancelled (same logic as hard delete)
5. Band disappears from member views but remains visible to staff

### Staff reactivates a band

1. On the detail page of a deactivated band, staff clicks "Reactivate"
2. `deletedAt` is cleared
3. Band reappears in member views
4. No reservations are restored — members book new ones

### Staff creates a band

1. On the list page, staff clicks "New Band" button
2. Modal opens with fields: name, bio, owner (user search)
3. Staff searches for a member by name/email, selects one as owner
4. Submits
5. Band is created with the selected user as owner (reuses `band-service.create`)

---

## Schema change

### band (existing table — add column)

| Column     | Type                       | Change                                               |
| ---------- | -------------------------- | ---------------------------------------------------- |
| deleted_at | `timestamp with time zone` | **NEW.** Nullable. Null = active, set = deactivated. |

No new tables. No new indexes needed — the column is only filtered in queries, and the table is small enough that a seq scan on `deleted_at IS NULL` is fine.

---

## Service changes

### band-service.ts

**New functions:**

- `listAll(opts?: { search?: string; status?: 'active' | 'deactivated' })` — Returns all bands with owner name and member count. Filters by `deletedAt` based on status param. Used by staff list page.
- `getByIdWithDetails(bandId: string)` — Returns band with owner user info, member count, used by staff detail page. Includes `deletedAt`.
- `deactivate(bandId: string)` — Sets `deletedAt = now()`, cancels all future band reservations.
- `reactivate(bandId: string)` — Sets `deletedAt = null`.

**Modified functions:**

- `listForUser` — Add `isNull(band.deletedAt)` to the where clause so deactivated bands are hidden from members.
- `getBySlug` — Add `isNull(band.deletedAt)` so members can't navigate to deactivated bands. The `/band/[slug]` layout already checks `isStaff`, so staff can still access via the staff detail page (which uses `getByIdWithDetails` by ID, not slug).

**Unchanged functions:**

- `create`, `update`, `deleteBand`, `getById`, `getMembers`, `searchMembers`, `invite`, `acceptInvitation`, `declineInvitation`, `revokeInvitation`, `removeMember`, `updateMember`, `transferOwnership`, `leaveBand`, `getUserRole` — All reused as-is from staff actions. Staff calls these same functions; authorization is checked at the route level (staff layout guard), not inside the service.

---

## Routes

### /staff/bands/+page.server.ts

Load function calls `listAll()` with search/status params from URL.

### /staff/bands/+page.svelte

DataTable with Column components:

- Status (StatusBadge — "active" or "deactivated")
- Name (sortable)
- Owner (MemberColumn)
- Members (count)
- Created (type="date", sortable)

`rowHref={(b) => `/staff/bands/${b.id}`}`

PageHeader with "New Band" button that opens `CreateBandModal`.

Filter bar: search input + status select (All / Active / Deactivated).

### /staff/bands/CreateBandModal.svelte

Modal with:

- Name field (required)
- Bio field (textarea, optional)
- Owner search (user search input, required) — reuses the same search pattern as band member invite

### /staff/bands/[id]/+page.svelte

Detail page using `data.remote.ts` pattern (not +page.server.ts load).

### /staff/bands/[id]/data.remote.ts

Queries:

- `getBand(id)` — Calls `getByIdWithDetails`, returns band + members + recent reservations
- `getMembers(id)` — Calls `getMembers` from band-service

Forms:

- `updateBand` — Validates name/bio, calls `band-service.update`
- `removeMember` — Calls `band-service.removeMember`
- `transferOwnership` — Calls `band-service.transferOwnership`
- `deactivateBand` — Calls new `band-service.deactivate`
- `reactivateBand` — Calls new `band-service.reactivate`
- `createBand` — Validates name/bio/ownerId, calls `band-service.create`

---

## Staff nav

Add to `navItems` in `/staff/+layout.svelte`:

```typescript
{ href: '/staff/bands', label: 'Bands', icon: IconMusic }
```

Position: after Events, before Payments.

---

## What changes

| Area                    | Change                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `band` schema           | Add `deletedAt` column                                                                                                        |
| `band-service.ts`       | Add `listAll`, `getByIdWithDetails`, `deactivate`, `reactivate`. Filter `listForUser` and `getBySlug` by `deletedAt IS NULL`. |
| `/staff/+layout.svelte` | Add Bands nav item                                                                                                            |
| `/staff/bands/`         | New list page + create modal                                                                                                  |
| `/staff/bands/[id]/`    | New detail page with remote functions                                                                                         |
| Migration               | Add `deleted_at` to `band` table                                                                                              |
| Seed script             | Optionally: add a deactivated band for dev                                                                                    |

## What doesn't change

| Area                        | Notes                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `/band/[slug]/*` routes     | Untouched. Staff accesses band detail via `/staff/bands/[id]`, not the shared slug routes. |
| Member band creation/invite | Unchanged. `create`, `invite`, `acceptInvitation` all work as before.                      |
| Band reservations           | Booking logic unchanged. Deactivated bands just can't book because members can't see them. |
| Notifications               | No new notification types for band moderation.                                             |
| `bandMember` schema         | No changes.                                                                                |

## Deferred

- **Admin impersonation.** Full user impersonation system where staff assumes a member's session. Discussed and explicitly deferred — it's cross-cutting and warrants its own design.
- **Band activity log.** Tracking who deactivated/reactivated/edited a band and when. Would be part of a general activity log system.
- **Bulk moderation.** Selecting multiple bands to deactivate at once. Not needed until the band count is much larger.

## Open questions

None.
