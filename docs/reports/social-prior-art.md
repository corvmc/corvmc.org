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

**One genuine cost, and it is not theme count.** A block editor with `custom_html` and
custom CSS means owning a sanitizer, and ours shipped as a **no-op** DOMPurify+linkedom
setup before `js-xss` replaced it — the feature was silently unsanitized in production.
That is the price of building this row. One-click PDF export is a small real gap
alongside it.

**What is not a cost, and was miscounted as one:**

- **Merch** is out of scope by decision — it goes through an outside vendor.
- **Seven curated themes** against Bandzoogle's hundreds is a choice, not a deficiency.
  A collective with a design system does not want an unbounded theme gallery. **What it
  does want is for a theme to be a starting point rather than a skin** — that is a
  different claim from theme count, and it is the one that shipped: "Start from this
  theme" copies a theme's rules into the band's own CSS, the sanitizer stops eating the
  comments that explain them, a band may use its own uploaded photo as a background, and
  the editor previews the result as you type.
- **A music player is an opportunity, and a bigger one for us than for them.** See below.

#### The player is a discovery surface, which Bandzoogle structurally cannot build

Bandzoogle's player serves one band on one isolated site. They have no cross-band surface
to put a station on, because their customers are unrelated to each other.

**Ours are not.** A site-wide player — a constant-run station across member bands — is a
thing only a collective can build, and it answers role 1's real gap with a better mechanic
than filter chips: **hearing the bands beats faceting them.** What it plays cannot be the
streaming embeds `ListenStrip` carries, for licensing reasons set out under
[the ladder](#the-radio-needs-a-source-and-embeds-cannot-be-it) — it needs files bands
upload, which is the same thing selling downloads needs.

It also supplies the missing incentive in the completeness ladder below. "Add your music
links" stops being a nag when the payoff is that other members hear you.

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

## The free tier is a ladder, and nothing says so

A priority that reframes roles 1 and 4 together: **the directory should be a free
link-in-bio page for members, and filling it in should teach a band its way to a finished
EPK.** Neither is framed that way today, and most of the first one is already built.

### Against Linktree, the free tier wins on the thing Linktree paywalls

Linktree's free plan keeps you on `linktr.ee/yourname`, puts Linktree branding on your
page, and takes **12% of digital product sales** through it. A custom domain is paid only;
Pro went from $9 to $15/month in November 2025.

**Every CMC band already gets `{slug}.corvmc.org` for free** — premium bands serve a
microsite there and everyone else 302s to `/directory/bands/{slug}`, which renders an
avatar, bio, switchable streaming embeds, a links ribbon, shows and contact. A real
subdomain, no branding tax, no revenue cut.

So the free tier is a Linktree-plus that loses only on framing. Linktree's actual product
is being the obvious answer to "where do I put my one link"; ours is filed under
"directory profile." That is a naming and affordance problem, not a capability one — and
the missing affordances are small: a share action, a QR code, and telling members the URL
exists at all.

### The EPK is the destination, and shows are the part that maintains itself

Standard EPK guidance converges on the same checklist. Mapped against what a free
directory profile already carries:

| EPK requirement                    | Free directory today    | Gap                                     |
| ---------------------------------- | ----------------------- | --------------------------------------- |
| Short bio, 3–4 sentences           | `tagline`               | Close enough, unlabelled                |
| Long bio, 2–3 paragraphs           | `bio`                   | —                                       |
| Music — best tracks or lead single | `links` + `ListenStrip` | —                                       |
| **Upcoming shows**                 | `ShowsBox`              | **— and it is automatic**               |
| Contact                            | `contact`               | One field, not three roles              |
| Press quotes, achievements         | ✅ free                 | Closed                                  |
| Booking / management / PR contacts | ✅ free, package only   | Closed — and deliberately not published |
| Hi-res photos, logo, video         | ✅ one photo free       | Closed; a gallery and video are premium |

**The standout is shows.** Every EPK guide stresses keeping the schedule current, and it
is the item bands most reliably let rot. Ours reads from `event-service`, so a band that
lists gigs for the gig guide — which they already do, for the community calendar and
lineup credits — has a permanently current EPK section it never has to touch. That is the
hardest item on the checklist, generated for free, and nothing tells the band it happened.

### The radio needs a source, and embeds cannot be it

An earlier draft of this section proposed building the station on the streaming embeds
`ListenStrip` already carries. **That is wrong on licensing.** A Spotify or YouTube embed
is a click-to-play player under terms that do not permit sequencing it into a broadcast;
they are a link to someone else's licensed service, not an audio source we hold.

The source should be **files bands upload to us**, which is also the basis for selling
digital downloads through the site. One upload, one rights grant, three payoffs: a track
the band can sell, a track the station can play, and the music section of their EPK.

#### Two rights, always, and covers are the trap

Every recording carries two separate copyrights, and licensing one is not licensing the
other:

| Right           | Who administers it         | Covered by a direct grant from the band?            |
| --------------- | -------------------------- | --------------------------------------------------- |
| Sound recording | SoundExchange, statutorily | **Yes** — direct negotiation is expressly permitted |
| Composition     | ASCAP, BMI, SESAC          | **Only if the band wrote it**                       |

So an **original** recording of an **original** composition, uploaded with an explicit
licence to stream and sell, is clean — and because it is directly licensed, whether the
station is interactive is a term of that grant rather than a statutory question. (The
statutory route only covers _non_-interactive streaming, and never downloads.)

A **cover** is not clean. The band can grant us the recording and cannot grant the
composition.

**Decision: covers are excluded — from the station and the store both.** That is one line
rather than two carve-outs, because the two halves fail differently and would each need
their own clearance: streaming a cover implicates the performance right (PRO licences),
while _selling_ one implicates the mechanical right, which is a separate compulsory
licence. Excluding covers outright means neither has to be priced, and the rule is
explainable to a band in a sentence.

Two things that still follow from it:

- **The upload flow has to ask** — an attestation that the track is the band's own
  composition and that they control the master. A band with a label deal, or one member
  short, may not control what it believes it controls, and the attestation is what makes
  that their statement rather than our assumption.
- **A venue's live-performance blanket licences do not extend to webcasting.** They are a
  different licence category. Nobody should reason from "we already pay ASCAP for shows."

None of this is legal advice, and the attestation wording is worth a lawyer's eye before
it ships — but originals-only is the configuration that keeps the question small.

#### It is blocked on a bucket, and it is not the only thing

Paid downloads need storage the public cannot address by key. There is **one** R2 bucket
today (`R2_BUCKET` → `corvmc`), served publicly at `media.corvmc.org`.

`R2_PRIVATE` / `corvmc-private` — "no custom domain and no public access" — is designed in
[groups-spec.md](../specs/groups-spec.md) and unbuilt. **Three unrelated features wait on
it:** group documents (that spec), contractor invoices (whose schema comment says outright
that an invoice with hourly rates "has no business being addressable by key… revisit when a
private bucket exists"), and now digital sales. That shared dependency raises its priority
above what any one of them justifies on its own.

Bandcamp is the obvious incumbent for the sales half and its terms should be read before
designing against it, rather than assumed. The opening is not price — it is that a
collective can put a member's tracks on a station its other members hear, which a
storefront has no reason to build.

### What the ladder needs

- **A completeness model that is a progression, not a boolean.** `isProfileComplete`
  ([directory-service.ts:281](../../src/lib/server/directory/directory-service.ts)) is
  deliberately the wrong shape for this: the bar is one instrument, because it backs an
  ambient nudge and "a nudge that survives a genuine effort to answer it is worse than no
  nudge." That reasoning is right for what it does. The ladder needs a second, richer
  measure alongside it — not a change to that one.
- **A named destination.** LinkedIn's profile strength works because the target has a name
  and the missing pieces are enumerated. "You have 5 of 11 EPK sections" is that, and the
  last few honestly requiring a band site is a legitimate upsell rather than a dark
  pattern — especially against Bandzoogle's $6.95/month EPK-only plan.
- **A reward per rung, not just a bar.** This is where the site-wide player earns its
  place: filling in music links produces something audible to other members, rather than a
  progress percentage.

## What to take

Ranked by value, and only things worth acting on:

1. ~~**Name the free tier and give it share affordances.**~~ **Done.** `AddressCard` puts
   the address and a QR on the dashboard, and the press kit's one-pager carries the same
   QR into every package a band sends — so a venue that saved the zip can still reach the
   current shows list.
1. ~~**Make completeness a progression toward a named destination.**~~ **Done.**
   `epk-completeness.ts` scores twelve named rungs with the missing ones enumerated and
   `isProfileComplete` left alone, exactly as this report asked. The whole press kit is
   free now; premium buys presentation and volume, so the last rungs are a legitimate
   upsell rather than a paywall on the information a venue needs.
1. **Make completeness a progression toward a named destination.** "5 of 11 EPK sections"
   with the missing ones enumerated. Leave `isProfileComplete` alone — its low bar is
   correct for the nudge it backs — and add a second measure beside it.
1. **Match, do not just filter.** Role 1. The intent data exists and is unused; this is a
   query, not a feature area.
1. **Build the private bucket.** `R2_PRIVATE` is designed and unbuilt, and three
   unrelated features queue behind it — group documents, contractor invoices and digital
   sales. Cheap on its own terms, and it unblocks more than its own scope.
1. **Track uploads, then the store, then the player.** Role 4. One upload and one rights
   grant serve all three, originals only. Inter-band discovery Bandzoogle structurally
   cannot copy, and the reward that makes rung 2 something other than a nag.
1. **Assert the capability matrix in a spec file.** Role 3. The category's own warning is
   that permission configuration rots; `feature-flags.spec.ts` is the pattern we already
   use for exactly this failure mode.
1. **Decide whether the external act needs an explicit discriminator.** Role 5. Narrow,
   and the rest of that design is sound.

Note what is _not_ here: out-featuring Bandzoogle on themes, merch or block count. The
defensible core of role 4 is data integration and cross-band surfaces, and every block
added past that is maintenance and sanitizer surface.

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
- Linktree free-tier limits — [Links.fans, is Linktree free](https://blog.links.fans/is-linktree-free/) · [Bitly, Linktree alternatives](https://bitly.com/blog/linktree-alternatives/) · [Soniare, alternatives for musicians](https://www.soniare.net/blog/best-linktree-alternatives-for-musicians)
- Music licensing — [SoundExchange, licensing 101](https://www.soundexchange.com/service-provider/licensing-101/) · [SoundExchange FAQ](https://www.soundexchange.com/frequently-asked-questions/) · [Pillsbury, licensing and royalty requirements for webcasters (PDF)](https://www.pillsburylaw.com/a/web/2371/689FBDFD3B40B5495649A2DD84A50374.pdf)
- EPK checklists — [Bandzoogle, the 8 things every EPK needs](https://bandzoogle.com/blog/the-8-things-that-should-be-in-every-band-s-digital-press-kit) · [DIY Musician EPK checklist](https://diymusician.cdbaby.com/music-marketing/epk-checklist/) · [Cascade Blues EPK checklist (PDF)](https://cascadeblues.org/wp-content/uploads/2025/12/EPK-Electronic-Press-Kit-Checklist.pdf)
- [ShellBlack — Salesforce leads vs accounts and contacts](https://www.shellblack.com/whiteboard/overview-of-leads-account-and-contacts-the-salesforce-data-model/)
