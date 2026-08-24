# Bands Module

A band is a group of CMC members who rehearse and perform together. Members create bands, invite other members to join, and book practice spaces as a group. Bands appear in the public directory alongside individual members.

---

## Domain model

### Band

The core entity. A band has a name, a URL-friendly slug, an optional bio, an owner (the member who created it), and an optional avatar stored in R2.

```
band
  id            text (cuid), PK
  name          text, not null, unique
  slug          text, not null, unique
  bio           text, nullable
  ownerId       text, not null, FK → user (set null on delete)
  avatarKey     text, nullable  (R2 storage key)
  createdAt     timestamp, not null
  updatedAt     timestamp, not null
```

The slug is derived from the name at creation time (lowercased, hyphenated). It's the route key — band pages live at `/band/{slug}/`.

### BandMember

Tracks membership and pending invitations in one table. Every row is either a pending invitation or an active membership.

```
band_member
  id            text (cuid), PK
  bandId        text, not null, FK → band (cascade)
  userId        text, not null, FK → user (cascade)
  role          text, not null  ('owner' | 'admin' | 'member')
  position      text, nullable  (e.g. "Lead Guitar", "Vocals")
  status        text, not null  ('pending' | 'active')
  invitedById   text, nullable, FK → user (set null on delete)
  createdAt     timestamp, not null
  unique(bandId, userId)
```

- Owner row: `role = 'owner'`, `status = 'active'`, `invitedById = null`.
- Invited member: `role = 'member' | 'admin'`, `status = 'pending'`, `invitedById` set.
- Accepting flips `status` to `'active'`.
- Declining or revoking deletes the row.
- The unique constraint prevents duplicate invitations or memberships.

---

## Roles and permissions

Three roles within a band, checked at the service level (no global permission table entries):

| Role   | Can invite | Can remove members | Can edit profile | Can book | Can delete band | Can transfer ownership |
| ------ | ---------- | ------------------ | ---------------- | -------- | --------------- | ---------------------- |
| owner  | ✅         | ✅                 | ✅               | ✅       | ✅              | ✅                     |
| admin  | ✅         | ✅ (not owner)     | ✅               | ✅       | ❌              | ❌                     |
| member | ❌         | ❌                 | ❌               | ✅       | ❌              | ❌                     |

Staff with the `admin` or `staff` role can manage any band (edit, delete, remove members) from the staff panel.

---

## Workflows

### Creating a band

1. Member navigates to `/member/bands/new` (linked from member nav).
2. Fills in band name (required) and bio (optional).
3. On submit, the service creates the band, generates a slug, creates a `band_member` row with `role = 'owner'`, `status = 'active'`.
4. Redirects to `/band/{slug}/`.

### Inviting a member

1. Band owner or admin goes to the Members page in the band panel.
2. Clicks "Invite Member", searches for a CMC member by name or email.
3. Selects a role (`member` or `admin`) and optionally a position.
4. On submit, a `band_member` row is created with `status = 'pending'`.
5. The invitee sees the pending invitation on their member dashboard and in their "My Bands" list.

### Accepting / declining an invitation

1. Invitee sees pending invitation in their My Bands list or on the member dashboard.
2. Accept: `status` flips to `'active'`. They can now access `/band/{slug}/`.
3. Decline: the `band_member` row is deleted.

### Revoking an invitation

1. Band owner or admin goes to Members page, sees pending invitations.
2. Clicks revoke — the `band_member` row is deleted.

### Removing a member

1. Owner or admin goes to Members page, clicks remove on an active member.
2. The `band_member` row is deleted.
3. An owner cannot be removed. The owner must transfer ownership first.

### Transferring ownership

1. Owner goes to Members page, clicks "Transfer Ownership" on another active member.
2. Confirms the action.
3. The target member's role becomes `'owner'`, the previous owner's role becomes `'admin'`.
4. `band.ownerId` is updated.

### Leaving a band

1. A non-owner member clicks "Leave Band" from the band panel.
2. Their `band_member` row is deleted.
3. Owners cannot leave — they must transfer ownership first.

### Booking a practice space

1. From the band panel, an owner/admin/member clicks "Book Practice Space".
2. The booking flow is the same as the member reservation flow (date, time, conflict check).
3. The reservation is created with `bookerType = 'band'`, `bookerId = band.id`, `createdByUserId = currentUser.id`.
4. The reservation appears on the band's reservations page and in each band member's dashboard (under "This Week").

### Editing band profile

1. Owner or admin goes to the band profile edit page.
2. Can change name (slug is regenerated), bio, and avatar.
3. Avatar upload follows the same pattern as event posters: `PUT` to an API endpoint, stored in R2 at `bands/avatars/{id}.{ext}`.

### Deleting a band

1. Owner clicks "Delete Band" from band settings, confirms.
2. All `band_member` rows cascade-delete.
3. Future reservations with `bookerType = 'band'` and `bookerId = band.id` are cancelled.
4. Avatar is deleted from R2 if present.
5. The band row is deleted (hard delete).

---

## Routes

### Band panel (`/band/{slug}/`)

All routes under `/band/{slug}/` require the user to be an active member of that band. A layout load function resolves the band by slug and verifies membership.

| Route                       | Page                                                       | Access                              |
| --------------------------- | ---------------------------------------------------------- | ----------------------------------- |
| `/band/{slug}/`             | Dashboard — band name, member count, upcoming reservations | all members                         |
| `/band/{slug}/members`      | Your own membership, then the roster and invitations       | all members (actions gated by role) |
| `/band/{slug}/reservations` | Band's reservations list, with the booking modal           | all members                         |
| `/band/{slug}/edit`         | Edit band profile (name, bio, avatar)                      | owner, admin                        |
| `/band/{slug}/settings`     | Band address; delete band                                  | owner, admin (read-only)            |

### Member panel additions

| Route               | Page                                                               |
| ------------------- | ------------------------------------------------------------------ |
| `/member/bands`     | My Bands — list of bands the user belongs to + pending invitations |
| `/member/bands/new` | Create Band form                                                   |

Add a "Bands" section to the member nav with links to My Bands and Create Band.

### Public directory

| Route                     | Page                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `/directory`              | Tabbed page: Members tab (grid of member cards) and Bands tab (grid of band cards) |
| `/directory/bands/{slug}` | Public band profile — name, bio, avatar, member list                               |

### Staff panel additions

Bands don't need a full staff resource initially. Staff can manage bands through the existing band panel routes (their `admin`/`staff` role grants access to all bands). Defer a dedicated staff bands page.

### API

| Route                    | Method   | Purpose                                                      |
| ------------------------ | -------- | ------------------------------------------------------------ |
| `/api/bands/[id]/avatar` | `POST`   | Upload band avatar (multipart, same pattern as event poster) |
| `/api/bands/[id]/avatar` | `DELETE` | Remove band avatar                                           |

---

## Schema

### `band` table

| Column    | Type      | Constraints                                |
| --------- | --------- | ------------------------------------------ |
| id        | text      | PK, cuid                                   |
| name      | text      | not null, unique                           |
| slug      | text      | not null, unique                           |
| bio       | text      | nullable                                   |
| ownerId   | text      | not null, FK → user(id) on delete set null |
| avatarKey | text      | nullable                                   |
| createdAt | timestamp | not null, default now()                    |
| updatedAt | timestamp | not null, default now()                    |

Indexes: `unique(name)`, `unique(slug)`.

### `band_member` table

| Column      | Type      | Constraints                                     |
| ----------- | --------- | ----------------------------------------------- |
| id          | text      | PK, cuid                                        |
| bandId      | text      | not null, FK → band(id) on delete cascade       |
| userId      | text      | not null, FK → user(id) on delete cascade       |
| role        | text      | not null, check in ('owner', 'admin', 'member') |
| position    | text      | nullable                                        |
| status      | text      | not null, check in ('pending', 'active')        |
| invitedById | text      | nullable, FK → user(id) on delete set null      |
| createdAt   | timestamp | not null, default now()                         |

Indexes: `unique(bandId, userId)`, index on `userId` (for "my bands" queries), index on `status` (for filtering pending invitations).

---

## Service: band-service

Functions:

| Function                                              | Description                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| `create(ownerId, data)`                               | Create band + owner band_member row. Generate slug from name.        |
| `update(bandId, data)`                                | Update name/bio. Regenerate slug if name changes.                    |
| `delete(bandId, actorId)`                             | Delete band, cancel future band reservations, delete avatar from R2. |
| `getBySlug(slug)`                                     | Look up band by slug, include member count.                          |
| `listForUser(userId)`                                 | All bands where user has a band_member row (any status).             |
| `getMembers(bandId)`                                  | All band_member rows with user info, ordered by role then name.      |
| `searchMembers(query)`                                | Search CMC members by name or email for the invite flow.             |
| `invite(bandId, userId, role, position, invitedById)` | Create pending band_member row.                                      |
| `acceptInvitation(bandMemberId, userId)`              | Flip status to active. Verify userId matches.                        |
| `declineInvitation(bandMemberId, userId)`             | Delete the pending row. Verify userId matches.                       |
| `revokeInvitation(bandMemberId)`                      | Delete the pending row.                                              |
| `removeMember(bandMemberId)`                          | Delete an active row. Cannot remove owner.                           |
| `updateMember(bandMemberId, data)`                    | Update role/position. Cannot demote owner.                           |
| `transferOwnership(bandId, newOwnerId, actorId)`      | Swap roles, update band.ownerId.                                     |
| `leaveband(bandId, userId)`                           | Remove self. Cannot leave if owner.                                  |

Slug generation: lowercase, replace non-alphanumeric with hyphens, collapse consecutive hyphens, trim. If the slug already exists, append `-2`, `-3`, etc.

---

## Member dashboard integration

The member dashboard's "This Week" section should include reservations where `bookerType = 'band'` and the band has a `band_member` row for the current user with `status = 'active'`. These show alongside the user's personal reservations, with the band name displayed.

The dashboard should also show pending band invitations as a small notification section (or integrate into the existing quick links area).

---

## What changes

| Area                | Change                                                          |
| ------------------- | --------------------------------------------------------------- |
| Database            | New `band` and `band_member` tables                             |
| Member nav          | Add "Bands" section with My Bands and Create Band               |
| Member dashboard    | Show band reservations in "This Week", show pending invitations |
| Reservation service | No changes needed — already supports `bookerType = 'band'`      |
| Storage module      | No changes — reuse existing upload/delete functions             |
| Public routes       | New `/directory` page with member and band tabs                 |

## What doesn't change

| Area               | Notes                                           |
| ------------------ | ----------------------------------------------- |
| Reservation schema | `bookerType` + `bookerId` already handles bands |
| Auth / session     | No changes                                      |
| Finance / payments | Band reservations use the same payment flow     |
| Staff panel        | No new staff pages in initial build             |
| Event module       | No band-event association in initial build      |

---

## Deferred

- **Band visibility** (public/members-only/private) — all bands are public for now.
- **Genre and influence tags** — skip tagging system initially.
- **Links and embeds** — social links, YouTube embeds on band profile.
- **Band-event association** — linking bands to events they're performing at.
- **Staff bands resource** — dedicated staff page for managing all bands.
- **Band avatar conversions** — thumbnail/medium/large conversions. Store one size initially.
- **Notifications** — email notifications for invitations, acceptance. In-app only for now.
- **Band productions** — the Laravel app's BandProductionsResource.

## Open questions

None — all decisions have been made.
