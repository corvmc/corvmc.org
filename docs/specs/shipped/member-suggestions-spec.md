# Member Suggestions — an upvoted board with staff responses

## Purpose

CorvMC is a member-driven non-profit with no structured way for members to say what the collective should do next. Ideas arrive through hallway conversations, Instagram DMs, and the contact form, where they can't be compared, counted, or tracked, and where the member who raised one never learns what happened to it.

This is the "lightweight feature-request board where members upvote ideas to help prioritize development" that `IDEAS.md` has carried under **Member Voting / Proposals** since the file was written — widened, deliberately, from software to anything about the collective. Formal balloting (proposals, voting windows, published results) remains unbuilt; see Out of scope.

## Scope

**In:** a categorized board of member-authored suggestions; one upvote per member per suggestion, toggled; sort by votes or recency; a staff status (`open` → `planned` → `in_progress` → `done`, or `declined`) with a public written response; member reporting that pulls a suggestion off the board pending staff review; posting-under-review for members who have had a report upheld; duplicate merging with vote transfer; author editing, free until the first outside vote and reviewed after.

**Out (deliberately):**

- **Comments or threads.** The one staff response is the whole conversation surface. Discussion belongs in `/member/messages`, and a comment system is a moderation surface of its own.
- **Appealing a takedown.** A member who thinks staff got it wrong messages staff. Workable now and clearly not workable at three times the size — the person who most needs a channel is the one just told they aren't trusted, which is exactly when "just ask us" breaks down. Written up under **Moderation Appeals** in `IDEAS.md`, and since designed in `docs/specs/moderation-appeals-spec.md`, which supersedes this exclusion: an appeal hangs off the upheld flag and carries two independent outcomes, so it can restore the suggestion, the author's standing, or both. The rule this spec wired in `resolveFlag` gains a route back in both directions. Note that an appeal is the _review_ path, not the everyday one — `hidden` is still terminal for editing, so a suggestion staff would rather see reworked than reversed still wants a returnable state this spec does not have.
- **Editing after staff have hidden or merged a suggestion.** Editing a hidden post would be a way to launder it back past the reason it went down.
- **Formal balloting.** Board elections and policy votes need ballot secrecy, eligibility rules, and a close date. None of that is here, and grafting it onto an upvote counter would produce a bad version of both.
- **Public visibility.** The board is members-only. Nothing here renders for signed-out visitors.

## Decisions

**No feature flag.** Every recent feature shipped behind one; this one doesn't. A suggestion board only works if there is an audience to upvote, so a dark-launched board collects single-vote posts and reads as dead on the day it's switched on. Member Messages made the same call for the same reason and `docs/reports/parity-report.md` records it as "Not flag-gated". The consequence is that `requireUser()` and `requireStaff()` in `src/lib/remote/suggestions.remote.ts` are the entire access-control story, which is why the remote spec asserts every one of them.

**Publish immediately.** Trust by default, matching community listings. Staff moderate after the fact rather than gating a queue that nobody has time to clear.

**A report takes the suggestion off the board straight away, and one report is enough.** This is the load-bearing tradeoff in the feature, and it cuts against the community-events rule it otherwise mirrors: an _event_ report deliberately moves nothing, because those can be filed anonymously by any visitor and a bare accusation must not be a lever. A suggestion report is authenticated, attributable, and member-only, and the board is small enough that leaving abuse up until someone gets to it is the worse failure.

It is still a griefing lever: any member can hide any post until staff look. The mitigations are built in rather than retrofitted — reports are never anonymous, a suggestion accepts one pending report at a time (the existing `createFlag` dedupe), `flagSuggestion` is rate-limited to 5/hour/member, dismissal restores automatically, and the staff nav badge leads with withheld posts so nothing sits invisible unnoticed. The threshold is `SUGGESTION_FLAGS_TO_WITHHOLD` in `src/lib/config.ts`, counted as distinct pending reporters, so raising it to 2 or 3 is a one-line change rather than a redesign. What it buys the collective is a response-time expectation on staff; that is the real cost.

**Dismissing a report must restore the suggestion.** The asymmetry with events falls straight out of the above: because the report already hid the post, "dismiss" doing nothing would leave every member holding a permanent takedown button. This is wired in exactly one place — `resolveFlag` in `src/lib/server/flag/flag-service.ts` — and asserted in `flag-service.spec.ts`, which is the executable form of this paragraph.

**Visibility and status are two axes, not one.** `status` is editorial: what staff decided. `visibility` is whether the thing is on the board. A public "Declined, here's why" and a silent takedown must not be the same state, or members cannot tell a decision from a disappearance. `visibility` covers all four ways a suggestion is off the board:

| value            | meaning                                | entered by                         | left by                                      |
| ---------------- | -------------------------------------- | ---------------------------------- | -------------------------------------------- |
| `visible`        | on the board                           | default                            | a report, or staff hiding it                 |
| `pending_review` | never been public; author on probation | `createSuggestion` seeing standing | staff approve → `visible`, reject → `hidden` |
| `under_review`   | was public, pulled by a report         | `createFlag`                       | upheld → `hidden`, dismissed → `visible`     |
| `hidden`         | staff takedown, or an upheld report    | staff, or `resolveFlag`            | staff restoring it                           |

The board filter is then exactly `eq(visibility, 'visible')` — one predicate, hard to get wrong.

**`merged` is derived, never stored.** `mergedIntoId` is the single source of truth; `displayStatus()` computes the badge. This keeps the stored enum exactly the five statuses the staff form offers, so nobody has to remember to filter the dropdown.

**Status and response are one mutation.** Split, the normal staff workflow — mark Planned, then write the reply — would fire two notifications for what the member experiences as one act. One form, one event, one notification. This is why the service exposes `respondToSuggestion` and not `setStatus` + `setResponse`, and it is load-bearing: splitting them later reintroduces the double-notify.

**Editing is free until the first outside vote, then it is a request.**

The attack is a bait-and-switch: post something agreeable, collect the votes, then swap in what you actually wanted, carrying the endorsement across. The trigger is therefore votes rather than time — an author may rewrite freely while the only person who has voted is themselves, because nobody has been misled by a change nobody endorsed, and typo fixes overwhelmingly happen in the first minutes. The moment another member upvotes, the words become something they put their name to, and an edit stops being a write and becomes a `suggestion_edit` row staff approve or reject.

An author's _own_ vote never locks their post; the count is `votes where userId != authorUserId`. Otherwise a member who upvoted their own idea would be locked out of fixing their own typo by their own click.

Two properties this buys that a blanket "all edits need review" would not: zero staff burden in the overwhelmingly common case, and a UI that can tell the truth — the button says **Edit** or **Request an edit** depending on which one it is, rather than promising a save and delivering a queue.

The alternative considered and rejected was letting edits through but resetting the vote count. It needs no staff at all and is self-policing, but it makes fixing a typo cost a popular suggestion everything it earned, so in practice nobody fixes typos and the board fills with visible errors nobody dares touch.

The request stores a **snapshot** of the text it would replace, not a live join, so staff review the change the author was actually looking at even if the suggestion moved underneath them. Approving writes the new text first and marks the request second: with no transactions, a crash between them leaves an approved-in-substance request still showing pending — visible and re-runnable — where the reverse order would show "approved" over text that never changed. Approving never touches the votes; the endorsement was of the idea, and staff have just confirmed the idea is the same one.

`editedAt` is stamped only when the title or body actually differs, so opening the form and saving without typing doesn't mark a suggestion as edited.

**A separate `suggestion_standing` table, duplicating `community_event_standing`.** Generalizing means renaming a shipped table and touching working community-events code for no user-visible gain. Sharing it means an upheld report about an event listing silently puts someone on probation for suggestions, which is surprising and wasn't asked for. Two domains is not a pattern; when a third needs standing, merge all three into a scoped `member_standing`. This was knowing duplication, recorded here so the next person didn't think it was an oversight.

**That trigger has since fired, and the merge is done.** PR #213 (direct messages) was the third domain to need standing, so all three tables are now one `member_standing` keyed `(userId, scope)` — see `docs/specs/shipped/member-standing-spec.md`, which records how the two-state/ladder and `source` questions were resolved. Nothing about the rule above changed: scope did not collapse, and an upheld report about an event listing still costs nothing on the suggestion board. Suggestion standing is now `getStanding(userId, 'suggestion')`.

**No denormalized vote counter.** Counts come from a `leftJoin` + `groupBy`. At this scale that is free, and — more to the point — `custom/no-db-transaction` makes an _incrementing_ counter genuinely unsafe: a read-modify-write has no transaction to protect it, so concurrent votes would lose counts permanently. If a counter is ever needed, the only safe form is an absolute recompute (`SET vote_count = (SELECT count(*) …)`), never `+= 1`.

**Vote counts use a join, not a correlated subquery.** `src/lib/server/correlated-sql.spec.ts` documents the production bug this avoids: a correlated `sql` fragment inside a single-table select renders its outer column reference unqualified and silently matches everything. Every query in `suggestion-service.ts` joins, so columns render qualified. The comment on `voteCountSql` says so, because the tempting "optimisation" reintroduces the bug.

**Merge transfers votes before marking the source.** There are no transactions on D1, so the order _is_ the safety property. Votes move first, deduped by the unique `(suggestion_id, user_id)` index so nobody counts twice; only then does the source point at the target, guarded by `isNull(mergedIntoId)` so a concurrent double-merge is a no-op for the second writer. A crash between the steps leaves both suggestions on the board with nothing lost — obvious, and repaired by clicking Merge again. The reverse order would hide the source with its votes stranded, silently under-counting the target. The source's own vote rows are kept: merge stays purely additive, and the source is off the board so they are never double-counted.

Merging into an already-merged suggestion is **rejected rather than followed**. Simpler, and it closes the only cycle — A→B then B→A is impossible once A is merged. Staff will occasionally hit the error; its copy names the canonical target.

**List page plus detail page, not expandable cards.** The moderation notification needs a stable `href`; a merged or withheld suggestion needs a landing page that explains itself without an HTTP redirect; and suggestion bodies are unbounded prose. `/staff/flags` + `/staff/flags/[id]` was the drop-in shape.

**`flagSuggestion` bypasses the `contentFlags` feature flag.** It writes a `content_flag` row, but reporting is how a suggestion comes off _this_ board — it belongs to the board, which is not gated, rather than to the optional content-flag surface. Two consequences, recorded so neither is a surprise: suggestion reports still arrive when `contentFlags` is off, and they land in `/staff/flags`, which is reachable regardless because staff surfaces are never flag-gated.

## Schema delta

`src/lib/server/db/schema/suggestion.ts` (new):

- **`suggestion`** — author (`set null`, so a deleted account doesn't take community history), title, body, `category`, `status`, `visibility` + `visibilityNote`/`visibilityChangedAt`/`visibilityChangedByUserId` (null when the _system_ moved it, i.e. an incoming report), `responseBody`/`responseByUserId`/`responseAt`, `mergedIntoId`/`mergedByUserId`/`mergedAt`, timestamps. Indexed on status, category, visibility, author, mergedIntoId, createdAt.
- **`suggestion_vote`** — `uniqueIndex(suggestionId, userId)`. That index is both the double-submit backstop and the merge dedup.
- **`suggestion_edit`** — the proposed title/body/category, a snapshot of the original three, `status` (`pending`/`approved`/`rejected`), reviewer, notes. Plus `suggestion.editedAt`, null until the text actually changes.
- ~~**`suggestion_standing`**~~ — `userId` pk, `requiresReview`, `reason`, `triggeringFlagId` → `content_flag` (so "why am I in review?" always resolves), `updatedByUserId`, `updatedAt`. **Superseded:** merged into `member_standing` at scope `suggestion`; see `docs/specs/shipped/member-standing-spec.md`.

`mergedIntoId` is a **plain indexed column with no FK**. No self-referencing FK exists anywhere in the schema, and `scripts/db/d1-safe-rebuild.mjs` walks a child graph on every `db:generate` that has never had to order a table against itself. This mirrors `contentFlag.entityId`, FK-less for the same reason. Nothing hard-deletes a suggestion, and the service validates the target.

Elsewhere: `'suggestion'` added to `flagEntityTypes` in `schema/flag.ts` — that one word is what lets the entire shipped report pipeline carry suggestions. The vocabularies (`suggestionCategories`, `suggestionStatuses`, `suggestionVisibilities`) live in `src/lib/config.ts` and are imported by the schema, matching `volunteer.ts`; `$lib/config` is client-safe and carries no server imports.

## Permissions

| Who                 | Can                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Signed out          | Nothing. Every remote starts with `requireUser()` or `requireStaff()`.                               |
| Any member          | Read the board, post, vote, report someone else's suggestion, read their own non-visible suggestions |
| Member on probation | All of the above; their posts land `pending_review`                                                  |
| Staff / admin       | Everything above, plus status + response, review, hide/restore, merge, restore posting trust         |

`getSuggestionDetail` 404s — not 403s — when a non-author asks for a non-visible suggestion. A 403 would confirm the suggestion exists, which turns reporting into an enumeration oracle.

`admin` and `staff` are the same authorization here, as everywhere else in the app (`docs/specs/admin-vs-staff-spec.md`). Nothing in this feature depends on the distinction.

## Surfaces

| Route                                | What                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `/member/suggestions`                | The board: filters, sort, create modal, probation banner                       |
| `/member/suggestions/[id]`           | Full suggestion, vote, report, official response, merged/withheld notice       |
| `/staff/suggestions`                 | Board · Needs review · Hidden tabs                                             |
| `/staff/suggestions/[id]`            | Review, respond, hide/restore, merge                                           |
| `/staff/flags` + `/staff/flags/[id]` | Where suggestion reports are resolved — the only place                         |
| `/staff/users/[id]`                  | Suggestion standing, with a link to the triggering report and a restore button |

Notifications: `suggestion_responded`, `suggestion_moderated`, and `suggestion_edit_reviewed`, all defaulting to email + in-app. The second one is not politeness — a suggestion can vanish because someone reported it, and silence there reads as a shadowban.

## Dev testing

`pnpm db:reset` seeds one row per reachable state, including the three that are otherwise tedious to stage by hand:

- a **merged pair with overlapping voters** — the target shows 8 votes where the naive sum would be 10, so a broken merge is visible at a glance rather than plausible
- an **`under_review`** suggestion with its pending `content_flag`, so report → resolve/dismiss is testable end to end
- a **`pending_review`** post from a member with a `member_standing` row at scope `suggestion` and an already-upheld flag behind it
- a **pending edit** on the most-voted suggestion, so the staff before/after card has something at stake

Then: vote and unvote from the board and the detail page; report another member's suggestion and watch it leave the board; dismiss the report in `/staff/flags` and watch it come back; uphold a second one and check `/staff/users/[id]` shows the author on review with a link to the report; post as that member and approve it out of the review tab; merge two suggestions with overlapping voters and confirm the union; click Merge again and confirm nothing changes.

Then, for editing: open your own unvoted suggestion and confirm the button says **Edit** and saves; open one with votes on it and confirm it says **Request an edit**, that submitting leaves the board text untouched, and that the author sees a pending banner; approve it from `/staff/suggestions/[id]` and confirm the text changes while the vote count does not.
