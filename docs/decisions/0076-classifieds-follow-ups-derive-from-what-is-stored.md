# 0076 Classifieds follow-ups derive from what is stored

- **Date:** 2026-11-13
- **Status:** Accepted
- **Issue:** [#2549](https://github.com/corvmc/corvmc.org/issues/2549)

## Context

Classifieds shipped with three follow-ups left open: a reminder before a post expires, a list of
matching posts on the dashboard, and a notice to the author when staff hide or approve a post.
The surface is switched off (`surfaces.classifieds`, #2116), so all three were built behind it.

## Decision

1. **The expiry reminder is a registry entry.** `classified_expiring` in
   `src/lib/server/reminders/registry.ts` asks for posts on the board that expire within
   `CLASSIFIED_EXPIRY_REMINDER_DAYS` (3). The subject is the post id plus its `expires_at`, so a
   renewed post is owed the reminder again. No expiry time is stored beyond `expires_at`.
2. **The author gets the reminder,** including for a post made as a band, because only the
   author can renew it.
3. **Staff decisions notify from `setVisibility`.** A move to `visible` (approve or restore) or
   `hidden` (take down, with the note) emits `classified.moderated`. That covers the staff page,
   the review feed and report resolution. A report's `under_review` and an author's own
   `pending_review` send nothing.
4. **A post matches a profile by tag.** Genre and skill match the same kind. A post's instrument
   matches an instrument the member plays, and, on an offered post, one their project is seeking.
   The match is a join on `directory_tag`, so a long profile cannot pass D1's bound-parameter
   cap. The dashboard shows up to six, newest first, and nothing when none match.
5. **Nothing reaches a member while the surface is off.** The reminder returns no subjects and
   the dashboard asks for no matches. Moderation paths already 404.

## Alternatives rejected

- **A stored reminder time per post.** Every renewal would owe it a reschedule; the sweep derives
  it from `expires_at`.
- **Notifying on a report's withhold.** #2549 asks for hide and approve. A withheld post shows its
  state to its author on the post page.
- **Matching by free text or category.** Tags are normalised like `directory_tag` values for this
  purpose; text matching would need ranking.

## Consequences

- `classified-service.spec.ts` pins the expiry window at every clock edge, the match rules and the
  moderation events against real SQLite.
- Two notification types, `classified_expiring` and `classified_moderated`, appear in members'
  preferences once the surface is on.
