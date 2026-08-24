# Directory & Profiles

A member and band directory with rich profiles — bio, tagline, instruments, genres, links with embeds, and "looking for band/members" flags. Three visibility tiers: hidden (not listed), members-only (default for users), and public (default for bands, no login required). Extends the existing `/directory` route with profile data, filtering, and individual member profiles. Adds profile editing for both members and bands.

---

## Why this feature

The existing directory at `/directory` is a flat list of names and avatars. There's no way for members to discover who plays what, which bands are looking for members, or who's looking for a band. Members who want to showcase their work or connect with other musicians have no profile page beyond their name and pronouns.

A music co-op's directory should function like a musician-specific Linktree: each member gets a profile with their bio, instruments, genres, links to their work (with rich embeds for SoundCloud, YouTube, Spotify, Bandcamp), and a way to signal availability. Bands get the same treatment, minus instruments (implied by their members).

---

## Key concepts

**Three-tier visibility.** Each member and band has a `directoryVisibility` field with three states: `hidden` (not shown anywhere), `members` (visible to logged-in members only), or `public` (visible to everyone, including the public directory). Members default to `members`; bands default to `public`. The public directory at `/directory` shows only `public` profiles; the member directory at `/member/directory` shows `members` and `public` profiles.

**Profile vs. account.** Profile data (bio, tagline, instruments, genres, links, contact info, visibility toggles) is about how you present yourself to others. Account data (email, password, notification preferences, membership) is about your relationship with the platform. They live on separate pages: `/member/profile` and `/member/account`.

**Freeform tags with suggestions.** Instruments and genres are stored as postgres `text[]` arrays. The UI autocompletes from existing tags across all users (`SELECT DISTINCT unnest(instruments) FROM "user"`). No curated tag table — this keeps things simple and lets the vocabulary grow organically.

**Links with URL-recognized icons and embeds.** Links are stored as a JSONB array of `{label, url}` objects. The frontend pattern-matches URLs to known platforms (SoundCloud, YouTube, Spotify, Bandcamp, Instagram, etc.) and renders the appropriate icon. On profile detail pages, embeddable URLs render as inline players/embeds via platform-specific iframe URLs.

---

## Domain model

No new tables. All profile data is added as columns on the existing `user` and `band` tables.

### User (new columns)

```
bio              text          -- longer-form description
tagline          text          -- short one-liner, ~150 chars
instruments      text[]        -- e.g. ['guitar', 'vocals']
genres           text[]        -- e.g. ['jazz', 'funk']
lookingForBand        boolean       -- default false
directoryVisibility   text          -- 'hidden' | 'members' | 'public', default 'members'
directoryContact jsonb         -- { email?, phone?, social? } — separate from account email
links            jsonb         -- [{label, url}, ...]
```

### Band (new columns)

```
tagline            text
genres             text[]
lookingForMembers     boolean     -- default false
directoryVisibility   text        -- 'hidden' | 'members' | 'public', default 'public'
directoryContact   jsonb
links              jsonb
```

Instruments are not on the band table — a band's instruments are implied by its members.

---

## Workflows

### Member edits their profile

1. Member navigates to `/member/profile` (new sidebar nav item)
2. Sees a form with sections: identity (tagline), about (bio), music (instruments, genres, looking-for-band toggle), links (ordered list of label+url pairs, add/remove/reorder), contact (optional email, phone, social handle for directory display), visibility (directory opt-out toggle, public listing toggle)
3. Edits fields and saves
4. Profile is immediately reflected in the directory

### Band owner/admin edits band profile

1. Owner or admin navigates to `/band/[slug]/profile` (new tab in band nav)
2. Sees a form with sections: identity (tagline), music (genres, looking-for-members toggle), links, contact, visibility
3. Edits and saves
4. Band profile is immediately reflected in the directory

### Member browses the member directory

1. Member navigates to `/member/directory`
2. Sees a grid of member profile cards showing: avatar, name, tagline, instruments (as tags), genres (as tags), "looking for band" badge if set
3. Can search by name
4. Can filter by: instruments (multi-select from suggestions), genres (multi-select), "looking for band" only
5. Clicks a card → navigates to `/member/directory/members/[id]` for the full profile

### Member views a member profile

1. Navigates to `/member/directory/members/[id]`
2. Sees: avatar, name, tagline, pronouns, bio, instruments, genres, "looking for band" badge, links (with platform icons), rich embeds for supported platforms (SoundCloud player, YouTube embed, Spotify embed, Bandcamp player), contact info (if the member opted in)
3. Can click "Back to Directory" to return

### Member browses bands in the directory

1. From `/member/directory`, switches to the Bands tab
2. Sees band cards: avatar, name, tagline, genres, member count, "looking for members" badge
3. Can filter by genres and "looking for members"
4. Clicks a card → navigates to `/directory/bands/[slug]` (existing route, enhanced)

### Visitor browses the public directory

1. Navigates to `/directory` (no login required)
2. Same layout as member directory but only shows profiles where `directoryVisibility = 'public'`
3. Member cards link to `/directory/members/[id]`
4. Band cards link to `/directory/bands/[slug]` (existing)
5. Same filtering capabilities

### Visitor views a public member profile

1. Navigates to `/directory/members/[id]`
2. Same layout as the member-only profile view
3. Only accessible if the member has `directoryVisibility = 'public'` — otherwise 404

---

## Embed support

On profile detail pages, links to recognized platforms render as embedded players instead of plain links. Detection is by URL pattern matching on the frontend.

### Supported platforms (v1)

| Platform   | URL pattern                           | Embed format                        |
| ---------- | ------------------------------------- | ----------------------------------- |
| YouTube    | youtube.com/watch, youtu.be           | iframe with youtube.com/embed/{id}  |
| SoundCloud | soundcloud.com/{user}/{track}         | iframe via SoundCloud oEmbed widget |
| Spotify    | open.spotify.com/track\|album\|artist | iframe with open.spotify.com/embed/ |
| Bandcamp   | {artist}.bandcamp.com/track\|album    | iframe via Bandcamp embed           |

Links to unrecognized platforms render as regular links with a platform-detected icon (favicon or known icon) or a generic link icon.

### URL → icon mapping (frontend utility)

Pattern-match the hostname to render the right icon. Covers: YouTube, SoundCloud, Spotify, Bandcamp, Instagram, Facebook, Twitter/X, TikTok, Apple Music, personal website (generic globe icon as fallback).

---

## Routes

### New routes

| Route                            | Auth       | Purpose                                |
| -------------------------------- | ---------- | -------------------------------------- |
| `/member/profile`                | Member     | Edit own profile                       |
| `/member/directory`              | Member     | Members-only directory (browse/filter) |
| `/member/directory/members/[id]` | Member     | Member profile detail (members-only)   |
| `/band/[slug]/profile`           | Band admin | Edit band profile                      |
| `/directory/members/[id]`        | Public     | Public member profile detail           |

### Modified routes

| Route                     | Change                                                               |
| ------------------------- | -------------------------------------------------------------------- |
| `/directory`              | Add profile fields to cards, add filtering, add member profile links |
| `/directory/bands/[slug]` | Add tagline, genres, links, embeds, contact info                     |

---

## Schema

### user table (new columns)

```sql
ALTER TABLE "user" ADD COLUMN "bio" text;
ALTER TABLE "user" ADD COLUMN "tagline" text;
ALTER TABLE "user" ADD COLUMN "instruments" text[];
ALTER TABLE "user" ADD COLUMN "genres" text[];
ALTER TABLE "user" ADD COLUMN "looking_for_band" boolean NOT NULL DEFAULT false;
ALTER TABLE "user" ADD COLUMN "directory_visibility" text NOT NULL DEFAULT 'members';
ALTER TABLE "user" ADD COLUMN "directory_contact" jsonb;
ALTER TABLE "user" ADD COLUMN "links" jsonb;
```

### band table (new columns)

```sql
ALTER TABLE "band" ADD COLUMN "tagline" text;
ALTER TABLE "band" ADD COLUMN "genres" text[];
ALTER TABLE "band" ADD COLUMN "looking_for_members" boolean NOT NULL DEFAULT false;
ALTER TABLE "band" ADD COLUMN "directory_visibility" text NOT NULL DEFAULT 'public';
ALTER TABLE "band" ADD COLUMN "directory_contact" jsonb;
ALTER TABLE "band" ADD COLUMN "links" jsonb;
```

### Indexes

```sql
-- GIN indexes for array overlap filtering
CREATE INDEX idx_user_instruments ON "user" USING gin ("instruments");
CREATE INDEX idx_user_genres ON "user" USING gin ("genres");
CREATE INDEX idx_band_genres ON "band" USING gin ("genres");

-- Partial index for directory queries
CREATE INDEX idx_user_directory ON "user" ("name") WHERE "deleted_at" IS NULL AND "directory_visibility" IN ('members', 'public');
CREATE INDEX idx_user_public ON "user" ("name") WHERE "deleted_at" IS NULL AND "directory_visibility" = 'public';
```

### JSONB shape: directoryContact

```typescript
type DirectoryContact = {
	email?: string; // display email (separate from account email)
	phone?: string;
	social?: string; // freeform — could be @handle, URL, etc.
};
```

### JSONB shape: links

```typescript
type ProfileLink = {
	label: string; // user-provided label, e.g. "My SoundCloud"
	url: string; // full URL
};

// stored as ProfileLink[] — ordered array, max ~20 entries enforced in validation
```

---

## Service layer

### directory-service.ts (new)

Queries for the directory pages. Separate from band-service and user account queries.

```typescript
// Member directory (visibility = 'members' or 'public')
listMembers(opts?: { search?: string; instruments?: string[]; genres?: string[]; lookingForBand?: boolean })

// Public directory (visibility = 'public' only)
listPublicMembers(opts?: { search?: string; instruments?: string[]; genres?: string[] })

// Single member profile (for detail pages)
getMemberProfile(userId: string, visibility: 'members' | 'public')

// Band directory
listBands(opts?: { search?: string; genres?: string[]; lookingForMembers?: boolean })
listPublicBands(opts?: { search?: string; genres?: string[] })

// Tag suggestions
suggestInstruments(prefix: string): string[]
suggestGenres(prefix: string): string[]
```

Array filtering uses postgres `&&` (overlap) operator: `WHERE instruments && ARRAY['guitar', 'drums']`.

### profile-service.ts (new)

Mutations for profile editing.

```typescript
// Member profile
updateMemberProfile(userId: string, data: {
  bio?: string;
  tagline?: string;
  instruments?: string[];
  genres?: string[];
  lookingForBand?: boolean;
  directoryVisibility?: DirectoryVisibility;
  directoryContact?: DirectoryContact;
  links?: ProfileLink[];
})

// Band profile
updateBandProfile(bandId: string, userId: string, data: {
  tagline?: string;
  genres?: string[];
  lookingForMembers?: boolean;
  directoryVisibility?: DirectoryVisibility;
  directoryContact?: DirectoryContact;
  links?: ProfileLink[];
})
```

`updateBandProfile` checks that the caller is an owner or admin of the band.

---

## Member profile edit page

`/member/profile` — a form page (using the `Form`/`Field` pattern) with these sections:

**Identity:** tagline (text input, 150 char limit)

**About:** bio (textarea)

**Music:** instruments (tag input with autocomplete), genres (tag input with autocomplete), "I'm looking for a band" toggle

**Links:** ordered list of {label, url} pairs. Add button appends a row. Remove button per row. Drag to reorder (or up/down arrows for accessibility).

**Contact info:** optional fields for email, phone, social handle. Helper text: "This info is shown on your directory profile. Leave blank to keep private."

**Visibility:** radio group with three options — Hidden (not shown anywhere), Members only (visible to logged-in members), Public (visible to everyone). Stored as `directoryVisibility`.

---

## Band profile edit page

`/band/[slug]/profile` — same layout as member profile, minus instruments and "looking for band" (replaced with "looking for members" toggle). Accessible to band owners and admins.

---

## Directory UI

### Member directory (`/member/directory`)

Replaces the current `/member/directory` dead link. Uses the existing `/directory` page as a starting point but scoped to members-only visibility.

**Filter bar:** search (text input), instruments (multi-select combobox with suggestions), genres (same), "looking for band" checkbox.

**Member cards:** avatar, name, tagline (truncated), instruments (as small badges, max 3 shown + "+N more"), genres (same), "Looking for a band" badge if set.

**Band tab:** same as current but with genres, tagline, "looking for members" badge added to cards.

### Public directory (`/directory`)

Same layout and filtering as member directory, but queries `directoryVisibility = 'public'` profiles only.

### Member profile detail

`/member/directory/members/[id]` (member-only) and `/directory/members/[id]` (public).

Full-width profile page: large avatar, name, tagline, pronouns, bio, instruments (as badges), genres (as badges), "looking for band" badge, contact info section (if provided), links section with platform icons, embed section (recognized embeddable links rendered as iframes).

### Band profile detail (`/directory/bands/[slug]`)

Extend the existing page to show: tagline, genres, "looking for members" badge, links with embeds, contact info, and the existing member roster.

---

## Permissions

| Action                        | Who                               |
| ----------------------------- | --------------------------------- |
| Edit own member profile       | Any active member                 |
| Edit band profile             | Band owner or admin               |
| Browse member directory       | Any active member                 |
| View member profile (members) | Any active member                 |
| Browse public directory       | Anyone (no auth)                  |
| View member profile (public)  | Anyone (if visibility = 'public') |
| View band profile (public)    | Anyone (band not deactivated)     |

Staff can view any profile through the existing staff user/band detail pages. No special staff directory features needed for v1.

---

## What changes

| Area                      | Change                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `user` schema             | Add 8 columns (bio, tagline, instruments, genres, lookingForBand, directoryVisibility, directoryContact, links) |
| `band` schema             | Add 6 columns (tagline, genres, lookingForMembers, directoryVisibility, directoryContact, links)                |
| `/directory` page         | Enhanced cards with profile data, filtering, member profile links                                               |
| `/directory/bands/[slug]` | Enhanced with tagline, genres, links, embeds, contact info                                                      |
| Member sidebar nav        | Fix `/member/directory` link (currently points to non-existent route), add `/member/profile`                    |
| Band nav                  | Add Profile tab                                                                                                 |
| Seeder                    | Add profile data to seeded users and bands                                                                      |

## What doesn't change

| Area                     | Notes                                                             |
| ------------------------ | ----------------------------------------------------------------- |
| Account page             | No profile fields added here — they live on `/member/profile`     |
| Band edit page           | Existing name/bio editing stays. Profile fields are on a new page |
| Staff user/band detail   | No changes needed — staff already sees all user/band data         |
| Reservation/booking flow | No interaction with profile data                                  |
| Authentication           | No changes                                                        |

---

## Deferred

**Profile analytics.** View counts and link click tracking were discussed and deferred. If added later, a simple `viewCount` integer column on user/band plus a `profile_view_log` table for trends would be the starting point.

**Curated tag management.** Staff could manage a canonical list of instruments and genres to reduce duplicates. For now, freeform with suggestions is sufficient. If tag sprawl becomes a problem, add a `directory_tag` table and a staff management UI.

**Messaging / contact requests.** An in-app "send interest" button that notifies the other member was considered. Deferred in favor of opt-in contact info display. If added later, it would use the existing notification system.

**Member profile detail from band profile.** Clicking a band member's name on the band profile page could link to their individual profile. Deferred to keep the first pass simpler — band member list stays as-is.

**Profile completeness indicator.** A progress bar or prompt encouraging members to fill out their profile. Nice-to-have, not essential for launch.

---

## Open questions

None.
