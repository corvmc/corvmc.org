# The social vertical, and what comparable products do better

> A survey of the social side by **role** — member directory, the organization,
> governance, self-published presence, identity and claiming, member-to-member contact
> — against the products that compete with each. Companion to
> `docs/architecture/domain-model.md`.
>
> **Status: complete.** Surveyed 2026-09-02.

## Why this exists

The taxonomy settled and two moves narrowed this vertical: **moderation is horizontal**
(it polices suggestions, events, DMs and profiles alike) and **suggestions moved to
project intake** (a member proposing work is the front of the `project` pipeline).
Marketing also split out as its own vertical, keyed on `subscriber` rather than `user`.

What is left is genuinely social — **people, the organizations they form, and how they
present themselves** — and it had never been mapped.

Unlike projects, this vertical has a mature commercial category sitting on top of it:
**Association Management Software**. Nobody sells a practice-room-booking CMMS for music
collectives; several vendors sell member directories, chapters and committees. So the
question "is anyone doing this better" has real answers here, and this report gives them.

### This is not a buy-versus-build report

That question is closed, and closed correctly:

- **The site provides services, not a member database.** Room booking, credits, gear
  loans, volunteering and ticketing all key off `user`. Splitting identity out to a
  vendor would put the member record in two places, and membership is the thing
  everything else hangs off.
- **Signing up in eight places is worse than any feature gap** it would close.
- **Cost runs the wrong way.** This hosts for about $5/month on Cloudflare. Wild Apricot
  is ~$720/year under 1,000 members; Hivebrite and Glue Up run $300+/month; MemberClicks
  is $4,500/year and GrowthZone $3,985/year.

So every verdict below answers one question: **what are they doing that we should
steal?**

## Evidence quality

- **Vendor pages describe features, never data models.** A fetch of Artifax's scheduling
  page during the projects survey returned nothing structural. Treat mechanics as
  reported, not verified.
- **Our own claims are verified against the working tree**, with file and line cited.
  Three separate beliefs about this area turned out to be stale before this was written.

## Role 1 — Member directory and profile

**Ours.** `directory_entry` carries `bio`, `tagline`, `hometown`, `foundedYear`, `links`,
`visibility`, `contact`, plus `directory_tag` over `['genre','instrument']` and four
intent signals: `lookingFor` (`'members'` \| `'band'`), `availableForHire`,
`teachesLessons`, `openToCollaboration`. The public directory loads every row in one
payload and facets in the browser
([`directory-browse.ts`](../../src/lib/utils/directory-browse.ts)), deliberately, with the
server-filter switch-back already written and documented.

**Them.** Hivebrite filters by "role, organization, interests, skills, or location" and
**pairs members for 1:1 networking by industry, interests and experience, handling the
scheduling**. Mighty Networks does **automated member matching based on interests**.
Circle surfaces active contributors and facilitates introductions.

**Verdict: they do this better, and the gap is not a feature — it is that we never use
the data we collect.**

`lookingFor` is a two-directional field, designed so "a bassist wants a band" and "a band
wants members" are the same column pointed opposite ways. We have instruments, genres,
and three availability switches. And the only thing any of it does is populate filter
chips the member has to think to apply.

**The matching is latent in the schema and it is a join, not AI.** A member with
`lookingFor = 'band'` and instrument _bass_, against groups with `lookingFor = 'members'`
and an overlapping genre tag, is a query we could already write. That is the single
highest-value thing in this report.

The client-side faceting is fine and should stay — the module already documents when to
switch back.

## Role 2 — The organization

**Ours.** `group` over `['band','club','committee']`, `group_member` with
`['pending','active','requested']`, `group_invite`, and ownership held by the roster row
itself — `group.ownerId` was removed in phase 3c after a second copy drifted, five of
sixteen production bands ending up with no usable owner. A partial unique index caps a
group at one owner and deliberately permits zero, since a program between leaders is a
real state.

**Them.** Wild Apricot, MemberClicks and Glue Up all model chapters. GrowthZone supports
"chapters, sections, divisions, and committees."

**Verdict: par, and ours is better on one specific thing.** Ownership-as-a-roster-row
with a partial unique index is a stronger model than a nullable owner column, and we
learned it the expensive way. Bands as first-class organizations that book rooms and hold
credits has no vendor equivalent — chapters are administrative subdivisions of the
association, not independent parties that transact with it.

## Role 3 — Governance

**Ours.** Committees exist as `group` rows; `by_application` and `requested` both exist.
[`admin-vs-staff-spec.md`](../specs/admin-vs-staff-spec.md) designs capabilities-not-tiers
and states the guard: "a committee guard reads `group_member`, not the role table, and the
two are independent." Announcements and files are phases 5+. **Designed, largely unbuilt.**

**Them.** GrowthZone advertises "centralized governance and distributed control" — which
is precisely the sentence `admin-vs-staff-spec.md` is reaching for. MemberClicks does the
same at $4,500/year.

**Verdict: they are ahead, because theirs ships and ours is a spec.** But the design has
converged on the category-standard answer independently, which is reassuring.

Take their warning seriously, though: MemberClicks' "role and permission boundaries
require configuration discipline, with approvals, permission changes, and committee access
updates needing to be governed and tested." A capability matrix is configuration, and
configuration rots silently. Whatever we build needs the matrix asserted in a spec file,
the way `feature-flags.spec.ts` already asserts flags against `DEFAULTS` both ways.

This is also the row the project work depends on — `project.groupId` is committee
ownership, and committee-scoped views are what make projects usable by the people doing
the work.

## Role 4 — Self-published presence

**Ours.** `band_site`: 14 block types, 7 themes, sanitized custom CSS, custom domains via
Cloudflare for SaaS, printable EPK, per-band `robots.txt`/`sitemap.xml`, a
Turnstile-protected contact form. Free at `{slug}.corvmc.org` for every band; the microsite
itself is the premium tier.

**Them.** **Bandzoogle** — music-specific, hundreds of themes, built-in music player, tour
calendar, ticket sales, merch ecommerce, one-click PDF Onesheet EPK. $9.95/month Lite,
$14.95 Standard, $6.95 for an EPK-only plan.

**Verdict: they build a better website. We hold better data — and that is verified, not
asserted.**

`getBandSiteData` pulls the band's events straight from `event-service`
([`band-site.remote.ts:109`](../../src/lib/remote/band-site.remote.ts)), so the microsite's
gig list is the same rows the band already maintains for the CMC gig guide. A Bandzoogle
site means keeping that list twice. `events` and `members` are data-driven blocks; nothing
comparable exists on a generic builder.

**But be honest about what owning it costs.** Seven themes against hundreds. No merch, no
music player, no one-click PDF. And a block editor with `custom_html` and custom CSS means
owning a sanitizer — ours shipped as a **no-op** DOMPurify+linkedom setup before `js-xss`
replaced it, which is to say the feature was silently unsanitized in production. That is
the real price of building this row, and it is not theme count.

## Role 5 — Identity and claiming

**Ours.** An external act is a `directory_entry` with both `userId` and `groupId` null.
`groups-spec.md` justifies keeping the record on three grounds — marketing material on
hand, a contact record, and a promotion path — and makes promotion **one statement**:
create a `group`, set `directory_entry.groupId`, insert the owner row, one `db.batch`.
"Nothing merges, no identity columns move, and every event they ever played is still
attached because `event_band` pointed at the entry all along, never at the group." An
external act has no page anywhere; public attribution links **out**, never in.

**Them.** Three patterns, and they disagree:

| Pattern                                 | System                    | Mechanic                                                                                          |
| --------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------- |
| One row, claiming transfers control     | Google Business Profile   | Profiles auto-generated before anyone signs in; claiming is verification, and the row never moves |
| Canonical entity, nobody claims it      | MusicBrainz, Discogs      | Stable IDs, because everything else links to them                                                 |
| A separate object, converted on qualify | Salesforce Lead → Contact | Deliberately different objects; a Lead cannot do what a Contact can                               |

**Verdict: ours is sound, and arrived at the right answer twice independently.** It is
Google's claim-in-place _and_ MusicBrainz's stable-id lesson — `event_band` points at the
entry, so the claim rewrites no history. Salesforce's separation is the one we did not
take, correctly: splitting would force a _merge_ on claim, which is exactly what this
design exists to avoid.

**One open question, narrower than it first looked.** "External act" is encoded as _the
absence of two foreign keys_, and the state is inferred rather than declared. A hidden
member entry and an external act both sit at `visibility: 'hidden'` while being different
things. Whether that needs an explicit discriminator is a real question; the design around
it is not in doubt.

## Role 6 — Member-to-member contact

**Ours.** A first message is a request: exactly one message, no unread badge, and an email
naming neither sender nor content. Accept, decline or report. Declining blocks silently —
[`direct-service.ts:131`](../../src/lib/server/inbox/direct-service.ts): _"a decline and an
unopened request look identical from the other side."_ Members can switch off their own
DMs (`user.accepts_direct_messages`), independently of staff switching them off, and a
member's switch never lifts a restriction.

**Them.** LinkedIn gates messaging behind connection requests and paid InMail. Community
platforms generally allow open member-to-member messaging within the community.

**Verdict: ours is better, and deliberately so.** Making a decline indistinguishable from
an unopened request is a safety property most platforms do not have — it removes the
social cost of saying no, and removes the signal a persistent sender could act on. The
two-independent-switches design (a member's own preference never overriding a staff
restriction, and vice versa) is likewise more careful than the category norm.

## What to take

Ranked by value, and only things worth acting on:

1. **Match, do not just filter.** Role 1. The intent data already exists and is unused;
   this is a query, not a feature area.
2. **Assert the capability matrix in a spec file.** Role 3. The category's own warning is
   that permission configuration rots; `feature-flags.spec.ts` is the pattern we already
   use for exactly this failure mode.
3. **Decide whether the external act needs an explicit discriminator.** Role 5. Narrow,
   and the rest of that design is sound.
4. **Be deliberate about band-site scope.** Role 4. We will not out-feature Bandzoogle and
   should not try; the defensible core is data integration, and every block added past
   that is maintenance and sanitizer surface.

## Sources

- [Hivebrite — member directory](https://hivebrite.io/features/member-directory/) · [networking features](https://hivebrite.io/online-community-networking-platform-features/)
- [Mighty Networks — community platforms compared](https://www.mightynetworks.com/resources/community-platforms) · [Wild Apricot alternatives](https://www.mightynetworks.com/resources/wild-apricot-alternatives)
- [Circle — Hivebrite alternatives](https://circle.so/blog/hivebrite-alternatives)
- [GrowthZone — association management software](https://www.growthzone.com/association-management-software/) · [choosing an AMS](https://www.growthzone.com/blog/best-association-management-software)
- [Bloomerang — membership software for nonprofits](https://bloomerang.com/blog/membership-software-for-nonprofits)
- [Outseta — Wild Apricot alternatives](https://www.outseta.com/posts/best-wildapricot-alternatives)
- [Bandzoogle — EPK builder](https://bandzoogle.com/features/epk) · [pricing](https://bandzoogle.com/pricing)
- [Google Business Profile — request ownership](https://support.google.com/business/answer/4566671?hl=en) · [add or claim](https://support.google.com/business/answer/2911778?hl=en)
- [MusicBrainz — database structure](https://musicbrainz.org/doc/MusicBrainz_Database)
- [ShellBlack — Salesforce leads vs accounts and contacts](https://www.shellblack.com/whiteboard/overview-of-leads-account-and-contacts-the-salesforce-data-model/)
