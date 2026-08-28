# Inventory & Assets — gear and consumables on one ledger

> **Status: Phases 1–2 shipped (#286 and follow-up). Phases 3–4 unbuilt.**
>
> How the shipped half _behaves_ is documented in
> [business-workflows §6](../development/business-workflows.md#6-inventory-gear-and-consumables),
> which is where behaviour belongs. What survives here is the design rationale — the
> options weighed and rejected — plus the two phases that are still only intent.
> Read [Phases](#phases) for the split.

## Purpose

The collective owns two kinds of physical stuff and can currently only track one
of them badly.

**Gear** — amps, guitars, PAs, mics — is lent to members and comes back. The
`equipment` module models this today: a catalog row with a quantity, categories
carrying a pricing tier, and a five-state loan machine that settles against
equipment credits. It works, it is tested, and it has never been used. The member
nav deliberately hides it "while gear lending stays manual", and production holds
zero equipment rows.

**Consumables** — strings, sticks, cables, batteries, cleaning supplies — leave
and do not come back. Nothing models this at all. Today the space finds out it is
out of something when somebody needs it.

Putting the second into the first is not possible as the schema stands, and the
reason is worth stating precisely because it is the whole design:

> `equipment.totalQuantity` is a number somebody types. There is no way to
> decrement stock except to edit it.

A pack of strings opened is a hand-edit that overwrites the only record that it
ever existed. So "how many packs did we go through last quarter", "what do we
spend on sticks in a year", and "who took the last one" are not hard questions to
answer — they are unanswerable, permanently, because the data was never written
down.

Two more things the current shape cannot hold, both of which matter more than
they look:

- **`serialNumber` and `condition` sit on a quantity row.** One serial number for
  twelve XLR cables. One condition for the good Strat and the beat-up one. A row
  that means "a kind of thing" is being asked to also mean "this particular
  thing".
- **Nothing records where anything came from.** No donor, no cost, no date. For a
  nonprofit this is not a nice-to-have: contributed gear has to be reported, and
  the reporting is not reconstructable after the fact.

This spec replaces the three `equipment*` tables with a model that holds all of
it. It is being written now because production is empty, and a breaking schema
change against an empty table is free exactly once.

## The rule this rests on

**Stock is a ledger, not a number.**

Every change to what the collective physically holds is an append-only
`stock_movement` row: a signed quantity, a reason, a time, an actor. On-hand is
the sum of those rows and is never stored as an authoritative figure. Nothing
writes a quantity directly — not receiving, not lending, not consuming, not a
stocktake correction. A correction is itself a movement, with reason `adjust`.

This is not a new idea in this codebase. `creditTransaction` in
`src/lib/server/finance/credit-service.ts` is already a ledger with balances
derived from it, and it is the reason a member's credit balance can be explained
line by line while their gear cannot. Stock reuses the idiom rather than
inventing one.

Two things fall out, and both are the point:

**History is a consequence, not a feature.** "What did we spend on sticks" and
"who has taken the last cable three times this month" are queries against rows
that already exist, rather than reports somebody has to remember to build.

**Consumables and gear stop being different systems.** A loan is a movement out
that expects a movement back. A consumption is a movement out that does not.
That is the entire difference, and it is one enum value — not a second module.

## Key concepts

The model splits one table into three, along the seam that the current schema
keeps tripping over: the difference between _a kind of thing_, _a particular
thing_, and _something that happened_.

**Item** — the catalog entry. "QSC K12.2", "XLR cable, 25ft", "D'Addario EXL110".
An item is a type, never a physical object. It carries what is true of every unit:
name, category, whether it is loanable, its unit of measure, and its
manufacturer barcode if it has one.

An item's `kind` says how it is **tracked**, and only that:

|                                    | `serialized`      | `bulk`     |
| ---------------------------------- | ----------------- | ---------- |
| Tracked as                         | individual units  | a count    |
| Has `inventory_asset` rows         | yes, one per unit | no         |
| Carries a serial, condition, donor | per unit          | not at all |

Whether a thing **comes back** is a second, separate axis: `isLoanable`.

Folding the two into one enum was the first draft of this spec, and it could not
express the cable drawer. Twelve XLR cables are lent out and come back, but
nobody tracks which cable — they are counted _and_ returnable. A pack of strings
is also counted, and does not come back. Both are `bulk`; only `isLoanable`
separates them.

| Example          | `kind`       | `isLoanable` |                          |
| ---------------- | ------------ | ------------ | ------------------------ |
| Blues Deluxe     | `serialized` | yes          | one row per amp          |
| XLR cable, 25ft  | `bulk`       | yes          | counted, returnable      |
| D'Addario EXL110 | `bulk`       | no           | **this is a consumable** |

So **a consumable is a bulk item that is not loanable** — derived, never stored,
because a stored flag could contradict the loan rules it is supposed to describe.

**Asset** — one physical unit of a `serialized` item. This K12.2, with this
serial number, in this condition, bought on this date, currently in the main
room. Four K12.2s are one item and four assets.

**Movement** — the ledger row. Signed quantity, reason, location, actor, time,
and a link to whatever caused it (a loan, an acquisition).

**Acquisition** — how stock arrived. A purchase, a donation, or a grant. Every
`receive` movement hangs off one, which is what makes spend and provenance
answerable.

**Location** — where something is. Hierarchical, because "main room → stage left
rack" is how people actually describe it.

### Why this shape

It is not invented. Every system surveyed converges on catalog → physical →
ledger: InvenTree (Part / StockItem / stock tracking entries), Snipe-IT (Model /
Asset / checkout log), Grocy (Product / stock entry / consume log), and the
commercial rental platforms (Cheqroom, Rentman). InvenTree's _trackable_ flag is
precisely the `kind` flag above, arrived at independently.

That convergence is the argument for the shape. It is not the argument for
adopting any of those systems — see [Why not buy one](#why-not-buy-one).

## How it works

### Lending an amp

Nothing changes for the member. They browse the catalog, request a Blues Deluxe
for the weekend, and staff schedule a pickup — the same five states, the same
charge calculation, the same equipment credits settling it first and cash after.

What changes is that staff now hand over a _particular_ amp. At checkout they
scan the tag on it, which binds that asset to the loan. Two movements are written
over the loan's life: `loan_out` when it leaves, `loan_return` when it comes
back. The amp's status goes `in_service → on_loan → in_service`.

When it comes back with a torn grille, the staffer changes its condition and
writes a note. That is a `repair_out` movement and a status of `maintenance`, and
the amp stops being offered until somebody puts it back. Its history — every
loan, every repair, every condition change — is the list of movements carrying
its id.

### Running out of cables

A bulk item has no assets. Receiving twenty XLR cables writes
one `receive` movement of `+20` against an acquisition; taking three for a show
writes a `consume` of `-3`. On-hand is 17 because that is what the rows sum to,
not because anyone maintained a counter.

The item has a reorder point. When on-hand crosses it, the item surfaces on the
staff dashboard as low. Nobody has to notice.

### Buying more

All receiving goes through an acquisition, including the first one, including a
$4 pack of strings somebody picked up on the way in. The acquisition carries
what was paid and where it came from; its lines carry which items and how many,
and each line emits its `receive` movement.

This is deliberately not optional and not deferred. A `receive` with no cost
attached is a row that can never be improved later — the receipt is gone, and
the spend history has a hole in it that no migration can fill.

### Being given a guitar

Someone donates a Les Paul. The same acquisition table, `kind: 'donation'`, with
the donor, a fair value and the basis for it, and what the collective intends to
do with it. Because its value clears the capitalization threshold it becomes a
tracked asset with the donor recorded on it; a donated box of picks would not,
and lands as consumable stock.

Those fields are not bureaucratic decoration. They are what
[FASB ASU 2020-07](#standards-borrowed) requires a nonprofit to disclose, and
they are unreconstructable a year later when the report is due.

### Scanning a tag

Every serialized asset carries a QR sticker encoding `corvmc.org/a/{tag}`. A
phone camera resolves it with no app. Where it lands depends on who is holding
the phone: a staffer gets the operational record, a member gets the asset page —
what this is, how to use it, and a way to say it is broken. That routing is not
written here; it is the existing `entityHref` policy the identity chips already
use.

## Domain model

```
inventory_location ──┐
                     │
inventory_item ──┬───┼──> inventory_asset ──┐
   (a type)      │   │      (a unit)        │
                 │   │                      │
                 └───┴──> stock_movement <──┘
                            (the ledger)
                                 ▲
                                 │
       acquisition ──> acquisition_line
        (how it arrived)

inventory_loan ──> inventory_item + inventory_asset
```

Reading rules:

- A movement always names an item. It names an asset only when the item is
  `serialized`.
- An asset always belongs to exactly one item, and that item is
  `kind: 'serialized'`.
- A loan names an item from the moment it is requested; it names an asset from
  the moment a specific unit is handed over. Bulk loans (three cables) never
  name one.
- On-hand for an item is `SUM(stock_movement.quantity)`. For a serialized item
  that sum equals the count of its live assets, which is a useful invariant to
  assert in tests.

## Schema

New file `src/lib/server/db/schema/inventory.ts`, replacing `equipment.ts`.
Vocabularies live in `src/lib/config.ts` and are imported by **relative path**
(`../../../config`) — `$lib/config` breaks `pnpm db:generate`, which has no alias
map.

### Vocabularies

```ts
export const itemKinds = ['serialized', 'bulk'] as const;

export const stockReasons = [
	'receive', // arrived, against an acquisition
	'loan_out', // left on a loan
	'loan_return', // came back from a loan
	'consume', // used up, does not return
	'adjust', // stocktake correction
	'transfer', // moved between locations
	'repair_out', // out of service
	'repair_in', // back in service
	'loss', // gone, unexplained
	'retire' // end of life
] as const;

export const assetStatuses = ['in_service', 'on_loan', 'maintenance', 'retired', 'lost'] as const;

export const acquisitionKinds = ['purchase', 'donation', 'grant'] as const;
```

There is deliberately **no capitalization threshold** here. An earlier draft
carried `CAPITALIZATION_THRESHOLD_CENTS`, and it was wrong twice over — see
[Why there is no capitalization threshold](#why-there-is-no-capitalization-threshold).

`stockReasons` is seeded from the GS1 EPCIS `bizStep` vocabulary — receiving,
storing, inspecting, repairing, decommissioning — trimmed to what this domain
actually does. `equipmentConditions` and `pricingTiers` carry over unchanged.

### Tables

**`inventory_location`** — id, name, `parentId` (self-referencing, nullable),
displayOrder, notes.

**`inventory_item`** — the catalog. Note what is **absent**: no quantity column,
because that number was the bug. id, name, description, `categoryId`,
`kind`, `unitOfMeasure`, `gtin` (nullable — the manufacturer's UPC), `isLoanable`,
`reorderPoint` / `reorderQuantity` (nullable), `resourceId` (carried forward),
imageUrl, timestamps, `deletedAt`.

**`inventory_asset`** — one physical unit. id, `itemId`, `assetTag` (nullable,
unique — see Labelling), `serialNumber`, `condition`, `status`, `locationId`,
`acquisitionId` (nullable), `retiredAt` / `retiredReason`, notes, timestamps.

**`stock_movement`** — append-only. id, `itemId` (not null), `assetId`
(nullable), `quantity` (signed integer), `reason`, `locationId`, `toLocationId`
(transfers only), `actorId`, `occurredAt`, `loanId` (nullable), `acquisitionId`
(nullable), notes. Indexed on itemId, assetId and occurredAt; `check quantity != 0`.

**`inventory_loan`** — the rebuild of `equipment_loan`. Identical five-state
machine and identical money columns (`dailyRateCents`, `estimatedCostCents`,
`totalChargeCents`, `creditsCents`, `cashCents`), plus `itemId` and a nullable
`assetId`.

**`acquisition`** — id, `kind`, `occurredAt`, `reference`, `totalCents`, notes;
`supplierId` (nullable, Phase 2) or `donorUserId` / `donorName`; and the
disclosure fields `fairValueCents`, `fairValueBasis`, `intendedUse`, `monetized`,
`acknowledgedAt`, `appraisalRef`.

**`acquisition_line`** — id, `acquisitionId`, `itemId`, quantity,
`unitValueCents`.

**`supplier`** (Phase 2) — id, name, url, notes. Normalises what Phase 1 records
as free text on the acquisition.

### Migration

The three `equipment*` tables are dropped rather than migrated. Production holds
no rows, which is the only reason this is safe, and it must be **verified against
production before the migration lands**, not assumed.

Two hazards specific to this repo:

- `pnpm db:generate` may offer `equipment` → `inventory_item` as a rename. It is
  not one — the columns differ in meaning. Answer the prompts deliberately; the
  default is DROP, which is correct here but must not be reached by pressing
  return.
- The emitted SQL gets read before it is committed. `PRAGMA foreign_keys=OFF` is
  a no-op on D1, so any table rebuild takes its `ON DELETE CASCADE` children with
  it. See `docs/development/conventions.md#table-rebuilds-on-d1`.

## Status lifecycles

**Loan** — unchanged from the shipped module:

```
requested ──> scheduled ──> checked_out ──> returned
     └──────────┴─────────> cancelled
```

`checkoutLoan` additionally binds an asset (for serialized items) and writes
`loan_out`; `returnLoan` writes `loan_return`. Invalid transitions keep throwing
`InvalidLoanTransitionError`.

**Asset**:

```
in_service ──> on_loan ──> in_service
     │                          ▲
     ├──> maintenance ──────────┘
     ├──> retired
     └──> lost
```

`retired` and `lost` are terminal. Both write a movement (`retire`, `loss`) so
the count falls out of the ledger rather than by deleting a row — an asset's
history has to survive the asset.

## Labelling

Three physical problems with three different answers, only one of which the app
prints.

**Serialized gear: buy pre-printed tags.** Sequentially numbered polyester with a
QR runs roughly $0.15–0.30 a tag at quantity, with the numbering and variable
data usually free. Two hundred pieces of gear is a one-time ~$60. Adhesive
polyester survives handling and gigging; a laser-printed paper label on an amp
corner does not. Anodized aluminium at $2–8 a tag is specced for steam cleaning
and submersion — not this.

**Consumables: do not tag the unit.** A pack of strings already carries a UPC.
Scan that into `inventory_item.gtin` and label the **bin** instead. Bin labels
are low-volume, indoor and disposable, so an ordinary printer is fine.

**Reprints:** when a tag comes off an amp, reprint _that number_ rather than
renumbering the amp.

So the app **binds** a tag rather than generating one. `assetTag` is nullable
until a staffer scans one off the roll and binds it. This supports either
purchasing model without the schema caring, and it makes a lost tag a rebind
rather than a renumber: **an asset's identity is the row, never the sticker.**

The QR encodes a plain `corvmc.org/a/{tag}` URL, which is the useful half of GS1
Digital Link — a phone camera resolves it with no app. The standard itself is not
adopted: its syntax is keyed to GS1 identifiers behind a paid company prefix,
which buys the collective nothing.

## Scan resolution

`/a/[tag]` renders nothing. Its `+page.server.ts` resolves the tag to an asset,
builds an `EntityRef`, and hands off to `entityHref` in
`src/lib/utils/entity-href.ts` —
the same policy the identity chips and cards already apply: _stay in the panel
you are already in, otherwise take the richest page you are entitled to_
(staff → band → member → public).

`equipment` and `loan` are already entity types there, both staff-only. The work
is adding arms, not building a mechanism:

- The catalog **item** and a new **asset** type each gain a member arm beside the
  staff one. `loan` gains one too — `/member/equipment/loans` exists and nothing
  links to it.
- **There is no public arm.** The gear catalog is not public, so `entityHref`
  correctly returns `null` for a signed-out viewer, and `/a/[tag]` turns that
  into `/login?redirectTo=/a/{tag}` rather than a 404. The tag is a physical
  object in a room full of people who may not be signed in on their phone, so
  this is the common path, not an edge case.

**A `load`, not a remote function** — deliberately, and against the usual rule
that data access is `query()`/`form()`. This is navigation rather than data: a QR
code scanned by a phone camera should get a 302 straight off the server, not a
blank page that redirects once JavaScript has booted. The viewer is built with
`panel: 'public'`, because the route sits outside all three panels; nothing has a
public arm for gear, so the panel match always misses and the "richest entitled"
fallback decides — which is the wanted behaviour here.

Two constraints come with the reuse. `registry.spec.ts` asserts that every entity
type is drawn and that **no two share an icon**, so the new `asset` type needed a
glyph that collides with none of the twenty already registered (`IconBarcode` —
a unit is the thing that wears a scannable tag). And `entityHref` is display
logic, not authorization: the `load` re-checks `isStaff` itself, and every asset
query guards in the remote layer.

## Acquiring things

Three distinct questions hide behind "how do we get more", and only one of them
needed anything built.

**Restocking what we already carry** is an acquisition with lines against
existing items. Phase 1.

**Carrying something new** is creating the item, then receiving against it. No
special path.

**Deciding what to acquire is already built, and it is not in inventory.**
`suggestionCategories` includes `gear_equipment`, on a board that already has
upvotes, a staff response and the `open → planned → in_progress → done /
declined` lifecycle. A gear suggestion marked `planned` **is** an acquisition
request with member votes attached — which is exactly what the Gear Library entry
in `IDEAS.md` describes ("like a library purchase request … prioritised, possibly
informed by member voting"), shipped already under a different name.

So no purchase-request queue gets built.

**And no stored link either.** The first draft of this spec had a `planned`
suggestion resolve into a catalog item, with the acquisition that fulfils it
closing the suggestion automatically. That needs a foreign key plus a hook in
`recordAcquisition`, and it was the largest item in Phase 2. Dropped, for three
reasons:

- `respondToSuggestion` already sets the status **and** writes a public response
  in one action. A staffer marking the request `done` types "Bought — Yamaha
  Stage Custom, it's in the main room", and the member learns everything the
  automation would have told them. That is zero new code, not less code.
- A foreign key asserts that one suggestion becomes one item, which is often
  false. "Better vocal mics" may be three purchases; one purchase may satisfy two
  requests. Prose carries that natively; a column does not, and a join table
  would only be machinery to work around a claim we need not make.
- The volume is a handful of gear requests a year. The automation costs more than
  the labour it saves.

What is genuinely lost: nothing can query which suggestions produced gear, and
the author is not pinged — they see the response next time they open the board.
Notifying on a staff response is worth doing, but it applies to every category
and belongs to the suggestion board rather than to inventory.

The **Donation Wishlist** idea remains the public projection of those same rows,
not a fourth list to maintain.

Reorder points cover replenishing the known; the suggestions board covers demand
for the unknown. Between them there is nothing left for a wishlist table to do.

## Standards borrowed

Borrowed, not conformed to — in every case the useful half is a vocabulary or a
required field, and conformance would cost money or effort that buys the
collective nothing.

- **GS1 EPCIS 2.0** — the event shape (what / when / where / why / who) for
  `stock_movement`, and the `bizStep` vocabulary as the seed for `stockReasons`.
- **GS1 GTIN/UPC** — consumables mostly arrive with a barcode already on them.
  Scan it rather than inventing an internal SKU.
- **FASB ASU 2020-07** — contributed nonfinancial assets appear as a separate
  line item, disaggregated by category, with the fair-value basis and whether the
  asset was monetized or utilized. This dictates the `acquisition` disclosure
  fields, and it is why they are captured from Phase 1: they are not
  reconstructable a year later.
  **It binds the financial statements, not the organisation**, and CMC has never
  been asked for a GAAP statement — so the fields are insurance against a funder
  asking, not a live obligation. See [Phases](#phases).
- **IRS Form 8283** — non-cash gifts over $500 need an acknowledgment and over
  $5,000 an appraisal the organisation signs. Carried as `acknowledgedAt` and
  `appraisalRef`.

**ISO 55000** was considered and dropped: it is an asset-management governance
framework aimed at organisations with asset portfolios, and there is nothing in
it a collective with two hundred pieces of gear can act on.

## Why not buy one

Cheqroom (roughly $184–367/year per admin seat), myTurn, Rentman and Snipe-IT are
all good, all cheaper than building this, and all wrong here for one reason:

**Loans settle against the membership.** `calculateLoanCharge` discounts by
sustaining status and draws on `creditTransaction` equipment credits allocated
from the member's Stripe subscription. An external system cannot see who is a
sustaining member or what their balance is, so integrating one means either
syncing membership state into a second product or dropping the credit benefit
that makes lending a membership perk in the first place.

Everything else compounds it: `member_standing` gates who may borrow, the
notification bus tells staff a request came in, `/staff/users/[id]` shows a
member's loans beside everything else about them, and a second login for members
is the opposite of what a one-member-record platform is for.

What _is_ worth taking off the shelf is smaller and mechanical:
[`barcode-detector`](https://www.npmjs.com/package/barcode-detector) for scanning
(ZXing-C++ via wasm — **not** `html5-qrcode`, which `IDEAS.md` currently
recommends and which is unmaintained on a dead ZXing port), and `bwip-js` for
rendering bin labels and tag reprints as SVG. `pdfkit` and `puppeteer` do not run
on Workers; label printing is SVG and the browser's own print.

## Permissions

| Action                               | Who    |
| ------------------------------------ | ------ |
| Browse the catalog, request a loan   | member |
| See own loans, report damage         | member |
| View an asset page via `/a/[tag]`    | member |
| Create/edit items, assets, locations | staff  |
| Bind a tag, record a movement        | staff  |
| Receive stock, record an acquisition | staff  |
| Adjust stock, retire an asset        | staff  |
| In-kind and spend reports            | staff  |

There is **no feature flag.** Guards live in the remote layer, which is the only
security boundary — `requireStaff` on everything operational, `requireUser` on
the member surface.

## Surfaces

**Staff** — `/staff/inventory` (items, filterable by kind and low stock),
`/staff/inventory/restock` (everything at or below its reorder point, grouped by
category, with the quantity to buy and a Receive action per row),
`/staff/inventory/spend` (purchase spend per category over a window),
`/staff/inventory/items/[id]` (the item, its assets, its movement history),
`/staff/inventory/assets/[id]` (one unit: condition, location, loans, repairs),
`/staff/inventory/loans` and `/staff/inventory/loans/[id]` (the existing loan
queue), plus receiving and stocktake actions.

**Member** — `/member/equipment` keeps its URL, and the unit page reached by
scanning a tag is new. **The Equipment row appears once there is something to
lend** — `hasLoanableItems()` on the member layout query, surfaced as
`hasLoanableEquipment`, with "My Loans" nested under it.

Data, not a flag. The row used to be withheld by hand because gear lending was
arranged in person, which was true for exactly as long as the catalogue held
nothing. Deriving it means the nav corrects itself the moment the first loanable
item is entered, and nobody has to remember to flip anything.

Deliberately **existence, not availability**: if every amp is out on loan the
catalogue is still worth showing, because a member can see what the collective
has and put in a request for when it comes back. Hiding it then would answer
"can I borrow an amp?" with "we don't lend equipment", which is false. The query
falls back to hidden on error — a missing row is a link someone has to be told
about, a row onto an empty catalogue is a promise the collective is not keeping.

`/member/equipment/assets/[id]` stays out of the nav permanently: it is reached
by pointing a phone at a sticker, and there is no "the unit" for a row to point
at. It remains in `src/routes/member/nav-items.spec.ts`'s stranded list for that
reason.

**Resolver** — `/a/[tag]`.

## Phases

**Phase 1 — the unified ledger. ✅ Shipped (#286).** Locations, items, assets,
movements, loans, and the acquisition pair; the staff panel at `/staff/inventory`,
the member catalog, tag binding and `/a/[tag]` scan resolution. Replaced the
equipment module outright. Behaviour is documented in
[business-workflows §6](../development/business-workflows.md#6-inventory-gear-and-consumables).

**Phase 2 — spend and replenishment. ✅ Shipped.** Low stock on the staff
dashboard, a `/staff/inventory/restock` shopping list, and a
`/staff/inventory/spend` report by category over a window. `spendByCategory()`
and `inKindContributions()` gained the coverage they shipped without — see
`reports.spec.ts`, which runs them against a real in-memory SQLite because a
mocked `db` cannot tell you a `GROUP BY` is wrong.

**No schema was added.** Two things the original Phase 2 called for were dropped
on purpose:

- **The `supplier` table.** It would normalise `acquisition.sourceName` to give
  vendor-level spend. The collective buys from a handful of shops, so free text
  plus a `GROUP BY` answers that; and the same _local business_ entity is wanted
  by the **Local Resources Directory** and **Affiliate Commissions** entries in
  IDEAS.md. Building a thin `supplier` now means two tables describing Guitar
  Center later. Revisit when free text actually fragments, or when one of those
  features forces the entity into being.
- **A stored link from a suggestion to the item it became.** See
  [Acquiring things](#acquiring-things).

**Phase 3 — nonprofit compliance.** 📋 Much smaller than first scoped, because
CMC has never been asked for a GAAP financial statement. **ASU 2020-07 binds the
statements, not the organisation**, so the gifts-in-kind disclosure it describes
is not a live obligation. `inKindContributions()` is written and tested and sits
ready for the day a funder asks; building a screen for it now would be building
for a requirement that does not exist.

What is actually owed, in order of value:

1. **A Form 8282 warning. ✅ Shipped.** Disposing of donated property within three
   years of receiving it obliges the organisation to file within **125 days** and
   send the donor a copy. The rule lives in `form-8282.ts` as a pure function with
   `now` injected, because the date arithmetic is the whole of the risk: an
   off-by-one on either window turns a real deadline into silence. Its spec pins
   the boundaries — the third anniversary is _outside_ the window, day 125 is
   still due and day 126 is overdue, and the lookback counts calendar years rather
   than `3 × 365` so a leap day cannot move it.

   It surfaces twice, because the failure mode is time rather than visibility: on
   the unit's own page the moment it is retired, and on
   `/staff/inventory/compliance` for the months afterwards — the disposal and the
   paperwork are usually separated by both.

   **The signed Form 8283 is the trigger, not the donation.** "Charitable
   deduction property" is defined as property the donee organisation signed a
   Form 8283 for — sought only above $5,000 — so a gift without one can be
   disposed of the next day and owes nothing. The first version flagged every
   donated disposal and merely displayed the acknowledgment state; for CMC, which
   has never signed an 8283, that produced nothing but false positives, and a
   warning that is always wrong is one people learn to dismiss before the day it
   is right. Unacknowledged disposals now come back as a count on the compliance
   page instead, so "nothing outstanding" still has a denominator.

   **It flags; it does not determine.** What was claimed, and whether a given
   disposal counts, live on paper. A person resolves it. Recording an outcome takes free
   text rather than a checkbox, so "no 8283 was ever signed, so nothing is due" is
   as recordable as "filed on the 2nd" — `form8282ResolvedAt` says a human dealt
   with it, `form8282Note` says which way they went.

2. **Donor acknowledgment.** Somewhere to record that a donor's Form 8283 was
   signed. Only bites above $500. `acknowledgedAt` / `appraisalRef` exist for it.
3. **Schedule M** — the 990's noncash schedule, triggered at **$25,000** of
   noncash contributions in a year, or by any gift of art or historical
   treasures. Worth knowing the trigger; not worth building until it is near.

Note that Schedule M and GAAP disagree about scope: donated _services_ and
donated _use of space_ count under GAAP and are excluded from the 990's noncash
line. This model only holds goods, so it matches the 990 view and would need
extending for the other.

### Why there is no capitalization threshold

An earlier draft of this spec had `CAPITALIZATION_THRESHOLD_CENTS = 100_000` in
config, and Phase 3 wiring `isCapitalized()` into receiving so that value decided
whether an arrival became a tracked asset or stock. Both are gone. Two separate
mistakes:

**It named a policy that does not exist.** No rule sets a capitalization
threshold — the organisation adopts one by board policy, and CMC never has. A
constant reading `100_000` implied a $1,000 policy was in force and that the code
was applying it. That is worse than absent: it is a plausible-looking number
somebody could later cite as _the_ policy.

**It conflated two unrelated questions.** The accounting threshold decides how a
purchase is booked. `kind: serialized | bulk` decides whether a thing needs its
own row and its own history. Those do not correlate: a $200 microphone is far
below any threshold and clearly wants its own record — it has a serial, it goes
out on loan, it comes back damaged — while a $1,500 bulk cable order is above
most thresholds and is emphatically not one asset. **Serialization is an
operational judgement, not a monetary one**, and it is already made correctly
today by the operator, per item, at creation.

If CMC ever adopts a policy, the right home for the number is the accounting
records, and the right behaviour here is a _notice_ — "this arrival is above the
threshold, tell the treasurer" — never a control that routes anything.

For reference should it ever come up: federal awards cap equipment
capitalization at the lower of the organisation's own policy or **$10,000**,
raised from $5,000 in the 2024 revision of 2 CFR 200.

**Phase 4 — attached resources.** 📋 Manuals, tutorials and damage reports.
Deferred, and the reason to keep deferring it is not technical: its value depends
on members scanning tags, and no physical tag has been printed yet. Attaching a
manual to a unit nobody scans is work with no reader. Let the member surface get
used first — the guess here is that damage reports matter more than manuals, and
that is exactly the sort of guess usage settles.

The seams are fixed regardless, because three of them are schema- and URL-shaped:

- Resources split by what they describe. A manual is the same for all four
  K12.2s, so it hangs off the **item**; a damage report is about one unit, so it
  hangs off the **asset**.
- **Tutorials are `helpArticle` rows.** No second CMS — help articles already
  carry publish state, `minRole`, a category and a sync path from
  `src/content/help/`. A thin join table links items to articles.
- **A damage report is a ledger entry**, not a form system: a condition change
  plus a `repair_out` movement carrying the note. What it adds is a member-facing
  entry point and photos.
- **Files need no new table.** An earlier draft specified `inventory_document`,
  on the reasoning that the repo had no generic attachment layer. #289 landed
  one — `media` + `media_attachment`, with `attachableType`/`attachableId`/`slot`
  and an R2 object deliberately outliving the row that points at it. So Phase 4
  adds `'inventory_item'` and `'inventory_asset'` to `attachableTypes` and reuses
  it. A vocabulary extension, not a table, and the lifecycle problem is already
  solved. **Do not build `inventory_document`.**

The consequence for Phase 1 is that the member arm of the asset page has to exist
from the start, because it is where a scanned tag lands a member. Phase 1 ships
it nearly empty and Phase 4 fills it in.

## Deferred

- **Maintenance scheduling.** Assets record repairs reactively; nothing schedules
  a service interval. Worth revisiting once there is repair history to learn from.
- **Per-production staffing and gear holds.** `production-workflow-spec.md`
  reserves gear for a show; that spec's advance stage is where it belongs, and it
  needs productions to exist first.
- **RFID.** The tag model does not preclude it, and nothing about the current
  scale justifies it.
- **Matching riders against the catalog.** Named as out of scope in
  `production-workflow-spec.md` and still is.
- **Consignment and sale.** `retail_selling` is deliberately absent from
  `stockReasons`; the Merch Consignment idea is a different domain.

## Decisions

**Why replace rather than migrate.** Production is empty. Every argument for an
additive migration is an argument about preserving data that does not exist, paid
for with a compatibility layer that would outlive the reason for it.

**Why on-hand is computed, not cached.** The row counts here are small, and the
existing `getAvailableQuantity` already does a SUM over open loans on every read.
A cached counter is the thing this spec exists to remove; adding one back on day
one, before any measurement says it is needed, would be reintroducing the bug in
a nicer hat. If profiling later demands it, the fix is the `creditTransaction`
pattern — a cached column reconciled by cron, with the ledger still canonical.

**Why acquisitions are Phase 1 and not Phase 2.** Spend history is not
backfillable. A `receive` with no cost or source is a permanently impoverished
row, and by the time the reporting is built the receipts are gone.

**Why the `equipment` feature flag was cut rather than renamed.** The first draft
of this spec kept it, reasoning that renaming it meant touching `ALL_FLAGS`, the
site-config defaults, the settings UI and every guard to no functional end. That
was the wrong question. The flag existed to hide a module that had never been
used, and the member nav did not gate on it anyway — so it was defending a
surface nothing linked to, while leaving the flag's name (`equipment`) in
permanent disagreement with the section's (Inventory). Cutting it removed four
hand-maintained lists, four `requireFeature` calls and the contradiction, and it
is why `getMemberEquipment` and friends now guard with `requireUser` alone.

**Why `assetTag` is nullable.** Tags get bound when a physical sticker exists, and
gear will be entered before the roll arrives. A `NOT NULL` here would force a
placeholder, and placeholders in a unique column are how you get `TEMP-7` on two
amps.

## Dev testing

`scripts/seed-dev.ts` replaces its equipment section with: a location tree, items
of both kinds, serialized assets with tags bound on most and one deliberately
unbound, an acquisition history deep enough for a spend report to be non-trivial,
consumables with one already below its reorder point, and loans across every
state. Chunk the inserts — D1 caps a statement at 100 bound parameters.

Specs, colocated:

- `stock-service.spec.ts` — signed sums; every reason in the vocabulary; on-hand
  never read from a stored figure; the invariant that a serialized item's sum
  equals its live asset count.
- `asset-service.spec.ts` — status transitions, terminal states, retirement
  writing a movement rather than deleting.
- `loan-service.spec.ts` — the ported suite, plus asset binding at checkout and
  the two movements a loan writes.
- `acquisition-service.spec.ts` — receiving emits balanced `receive` movements.
- `entity-href.spec.ts` — extended with the new arms, including the signed-out
  `null`.

E2E: create an item, receive it against an acquisition, bind a tag, request a
loan, assign that asset, check out, return, and assert the ledger sums back to
where it started. A consumable run beside it — receive, consume, confirm on-hand
falls with no counter edited. And `/a/[tag]` resolving three ways: staff to the
ops record, member to the asset page, signed-out to the login redirect.
