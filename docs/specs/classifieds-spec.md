# Classifieds: wanted and offered posts

Tracking: #589. Built in one PR (#1486).

## What it is

A members-only board of short posts, each saying either **wanted** or **offered**:

- "Looking for a drummer for a surf-rock trio." (wanted, musician)
- "The Dead Pixels need a bassist." (wanted, musician, posted as the band)
- "Keys player, available for sessions and fill-ins." (offered, musician)
- "Open blues jam Thursday, bring an instrument." (offered, jam)
- "Can mix and master your EP." (offered, service)

A post lasts 30 days unless its author renews it, and the author can close it once it is
filled. People answer a post by messaging its author. There is no reply thread on the post
itself.

The directory tells you who is looking. A post says what someone wants right now, in their
own words, and it expires. Those are two different things.

## The handoffs

1. **A member posts.** They pick wanted or offered and a category, write a title and a body,
   and optionally tag instruments, genres and skills, and attach one of their bands.
   - If their `classified` standing is good, the post goes straight onto the board.
   - If it is `restricted`, the post waits in `pending_review` until a staffer approves it.
2. **Other members browse** `/member/classifieds`, filtering by wanted or offered, category and
   tag. A tag on a post links to the directory filtered on the same tag.
3. **A member answers** with **Message** on the post, which starts a direct conversation with
   the author through the existing request/accept flow.
   - When `directMessages` is off, the post links to the author's directory profile (or the
     band's) instead, and whatever contact that profile offers applies.
4. **The author keeps it current.** They can edit, **Renew** it (the expiry resets to 30 days
   from now), or **Close** it once it is filled. A closed or expired post leaves the board but
   stays in their own list.
5. **A member reports it.** The report is a `content_flag` with `entityType: 'classified_post'`.
   Filing it moves the post from `visible` to `under_review` straight away, as a suggestion
   report does.
6. **Staff decide** in `/staff/flags` as they do today.
   - **Dismissed:** the post goes back on the board and the author is untouched.
   - **Upheld:** the post becomes `hidden` with the staff note, and the author's `classified`
     standing becomes `restricted`.
7. **The return.** The author sees the note on their hidden post, edits it, and the edit sends
   it to `pending_review`. Nothing is deleted at any step. Enforcement only changes visibility.

## Data

`src/lib/server/db/schema/classified.ts`, one migration from `pnpm db:generate`.

**`classified_post`**

| Column                                                                      | Notes                                                                 |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `id`                                                                        | uuid                                                                  |
| `author_user_id`                                                            | → `user`, cascade. The post belongs to the account.                   |
| `group_id`                                                                  | → `group`, set null. Only a group the author is owner or admin of.    |
| `kind`                                                                      | `wanted` \| `offered` \| `trade` (gear only)                          |
| `category`                                                                  | `musician` \| `jam` \| `service` \| `gear` \| `other`                 |
| `title`, `body`                                                             | ≤ 120 and ≤ 2000 characters                                           |
| `status`                                                                    | `open` \| `closed`. Closing is what the author does when it is filled |
| `visibility`                                                                | `visible` \| `pending_review` \| `under_review` \| `hidden`           |
| `visibility_note`, `visibility_changed_at`, `visibility_changed_by_user_id` | as on `suggestion`                                                    |
| `expires_at`                                                                | not null. Set to created + 30 days, and reset by a renew              |
| `closed_at`, `created_at`, `updated_at`                                     |                                                                       |

**`classified_post_tag`** holds `(post_id → cascade, kind, value)`, unique on all three.
`kind` is `instrument` \| `genre` \| `skill`, and values are normalised the way `directory_tag`
normalises them, so a post tag and a profile tag compare equal. `skill` costs nothing before
#1440 lands, because a drizzle text enum emits no SQL.

**On the board** means `status = 'open' AND visibility = 'visible' AND expires_at > now`.
Expiry is derived at read time and never stored as a status. No cron job runs.

Vocabularies (`classifiedKinds`, `classifiedCategories`, `classifiedVisibilities`) and their
labels live in `src/lib/config.ts`. `standingScopes` gains `classified` (`none` or
`restricted`), and `flagEntityTypes` gains `classified_post`. Neither change needs a migration.

## Rules

- **At most 5 open, unexpired posts per member.** A sixth is refused until one is closed or
  expires.
- **Only the author edits, renews or closes.** A band post can be edited only by the member who
  posted it, not by the whole band.
- **Staff see every visibility. The author sees their own in every visibility.** Everyone else
  sees only posts that are on the board. A post a member may not see is a 404, not a 403.
- **An edit to a `hidden` post returns it to `pending_review`.** An edit made while the author's
  standing is `restricted` does the same. Any other edit keeps the post's visibility.
- **Renewing** needs the post to be `open` and not `hidden`.
- **Reporting** goes through its own remote rather than `memberReportableEntityTypes`, because a
  report withholds the post. It keeps the same unresolved-report cap as DM reports.

## Surfaces

| Route                      | Who    | What                                                                                                                      |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| `/member/classifieds`      | member | FilterBar (search, kind, category, tag, "mine") over a paginated table. A **New post** modal.                             |
| `/member/classifieds/[id]` | member | The body, a fact grid, and the actions: Message or profile link, Report, and for the author Edit (modal), Renew and Close |
| `/staff/classifieds`       | staff  | Every post, filtered by visibility. It opens on `pending_review`                                                          |
| `/staff/classifieds/[id]`  | staff  | The same detail, plus Approve, Hide (with a required note) and Restore                                                    |

It is a table, not a card list. The body is capped, the row has no artwork, it has one action,
and it is used at a desk. `flag-service`'s `entityHref` points `classified_post` at
`/staff/classifieds/[id]`.

Nav gets "Classifieds" in the member sidebar after Directory, and one row in the staff sidebar.

## Seed

`scripts/seed/classifieds.ts` covers every kind, category and visibility, plus a band post, an
expired post, a closed post, a hidden post carrying a staff note, and a post under review with
its pending flag.

## Not in this build

- Expiry reminders, a dashboard "posts for you" match, and notifications when staff hide or
  approve a post. The note on the post is what the author reads.
