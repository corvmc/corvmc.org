# Inventory: what happens when someone actually uses it

> A hands-on browser pass over the inventory module, driven as the operator, ahead of
> a workflow redesign. Companion to `docs/specs/inventory-spec.md` (design rationale)
> and `docs/development/business-workflows.md#6` (shipped behaviour).
>
> **Status: in progress.**

## Why this exists

The module is fully shipped — 8 tables, 57 remote functions, 13 pages, 33 e2e tests —
and has never held real data. CMC is about to take stock of all its physical gear,
which will be the first time anyone enters more than a fixture row. Automated tests
prove the module _behaves_; they cannot say that entering 200 units takes 200 modal
round-trips.

So this is a friction log, not a bug hunt. Where a bug turned up it is marked
separately.

## How it was driven

Local dev server on the worktree port, dev seed (`pnpm db:reset`), signed in as
`admin@corvallismusic.org` (admin + staff + member). Priority order set by the
collective: initial stocktake, then front-desk lending, then restock and purchasing.

## Severity

| Mark       | Meaning                                                      |
| ---------- | ------------------------------------------------------------ |
| **BLOCKS** | The stocktake cannot proceed through the UI                  |
| **SLOWS**  | Possible, but the cost scales badly with the number of units |
| **WRONG**  | The system records something untrue                          |
| _note_     | Cosmetic or a design question for the redesign               |

---

## A. The initial stocktake

**The scenario.** A room full of gear, nothing in the system, one person with a
laptop. This is the workflow CMC is about to run, and it is the one the module was
least designed for: every surface assumes stock is _arriving_, not that it is
already here and being written down for the first time.

**What was driven.** Created a category-correct serialized item ("Yamaha Stage
Custom Snare"), then added four units through both available doors, bound tags,
and read the results back out of D1.

### A1. You cannot create a location — **BLOCKS**

`addLocation` is a working remote function with **no caller anywhere in the app**
(`src/lib/remote/inventory.remote.ts:665`). `getLocations` has exactly two callers,
both of them `<select>` pickers — `AddAssetAction.svelte:27` and
`ReceiveStockAction.svelte:28`. Locations can be _chosen_ and never _created_.

The staff toolbar offers **Categories** and **Add Item**, and the Categories modal
manages only categories. There is no Locations equivalent on any of the ten staff
inventory pages.

Worse on a clean install: both pickers are wrapped in `{#if locations.length > 0}`,
so with no locations seeded the Location field **does not render at all**. A real
stocktake starts with zero locations, which means every unit is filed as
"Unassigned" and there is no in-app way out of it. "Main room → stage left rack" —
the hierarchy the spec opens with — cannot be expressed.

_The four locations used in this pass exist only because `seed-dev.ts` wrote them._

### A2. Saving a unit silently erases its location — **WRONG** (data loss)

The worst thing found in this pass, and it sits directly on the stocktake path.

The unit edit form submits four fields — `id`, `serialNumber`, `condition`,
`notes` (`src/routes/staff/inventory/assets/[id]/+page.svelte:76-91`). It has **no
location field**. But the handler coerces the absent value to null anyway:

```ts
// inventory.remote.ts:458
await updateAsset(data.id, { …, locationId: data.locationId || null, … });
```

and `updateAsset` guards on `!== undefined`, which `null` passes
(`asset-service.ts:163`). So the write lands.

**Demonstrated:** unit `CMC-000202`, location "Main room". Typed a serial number,
pressed Save. Location became "Unassigned" — in the UI and in D1 — with no warning
and nothing on screen that mentioned location. The two units left untouched kept
theirs.

This compounds A4: `Receive` is the only door that sets a location, and the
fix-up pass that follows it is exactly the Save that erases it. Do the stocktake in
the obvious order and every unit ends up Unassigned.

### A3. An item's category cannot be changed, and renders as stray text — **BUG**

On `/staff/inventory/[id]` the Category field draws six lines of plain text
(`Guitars Amplifiers Microphones Drum Hardware Cables & Accessories Consumables`)
instead of a dropdown.

`FormField` with `type="select"` builds its `<select>` **only** from a `rest.options`
prop and ignores any children (`FormField.svelte:279-287`). The page passes
`<CategoryOptions>` as children with no `options` prop
(`staff/inventory/[id]/+page.svelte:70-72`), so the `<option>` elements are emitted
as direct children of the `<fieldset>` with no `<select>` around them.

Consequences: the form submits no `categoryId` (verified: the FormData keys are
`id, name, description, unitOfMeasure, gtin, b:isLoanable, resourceId, notes`), and
because `updateItem` skips undefined fields the save _succeeds_ — so **an item's
category is fixed at creation, permanently, with no error to explain it**. During
bulk entry a mis-filed item can only be fixed by deleting and re-creating it.

### A4. Two doors into stock, and neither finishes the job — **SLOWS**

Both were driven on the same item. What each produced, read back from D1:

|                   | tag     | serial  | condition     | location | cost / source |
| ----------------- | ------- | ------- | ------------- | -------- | ------------- |
| **Add Unit** ×1   | ✅      | ✅      | ✅            | ✅       | ❌ **none**   |
| **Receive** qty 3 | ❌ null | ❌ null | forced `good` | ✅       | ✅            |

- **Add Unit** captures the unit's identity and writes its `receive` movement with
  `acquisitionId: null` — no cost, no supplier, no provenance. One modal per
  physical unit.
- **Receive** records the acquisition and auto-creates one asset per unit
  (`acquisition-service.ts:100-113`) — but every unit comes out anonymous.
  Restoring identity costs **two more form submissions per unit** (Bind tag is a
  separate action from the serial-number Save), plus a navigation each way.

For four speakers that is 8 extra submissions; extrapolated to ~200 units it is
roughly **400**, every one of which currently erases a location (A2).

**The fix is mostly already written.** `recordAcquisition` accepts `line.units`
with per-unit `assetTag` / `serialNumber` / `condition`
(`acquisition-service.ts:99-106`). The `receiveStock` **form** simply never offers
it — it passes `{itemId, quantity, unitValueCents}` and nothing else
(`inventory.remote.ts:552-557`). One door that captures both money and identity is
a form change, not a schema change.

### A5. Nothing can be backdated, and the spend report pays for it — **WRONG**

`receiveStock` hardcodes `occurredAt: new Date()` (`inventory.remote.ts:539`), and
`editAcquisition` omits both `occurredAt` and `kind` from its schema
(`inventory.remote.ts:1030-1041`). An acquisition's date is "whenever it was typed
in", forever, with no correction path.

**Demonstrated:** receiving 3 snares at $180 — gear notionally owned for years —
put **$540 into 2026's spend report** within seconds. `/staff/inventory/spend` went
to Drum Hardware $680 (seeded $140 + this $540).

So a stocktake entered in one sitting reports the collective's _entire historical
asset base as this year's purchasing_. For a nonprofit that reports spend, that is
not a cosmetic problem.

Related: `acquisitionKinds` is `purchase | donation | grant`
(`config.ts:300`). There is no kind meaning **"already owned, provenance unknown"**
— the opening-balance case every stock system needs on day one. Recording existing
gear means either inventing a purchase or leaving the money blank.

### A6. Everything is one item at a time — **SLOWS**

`receiveStock` always writes `lines: [oneLine]` (`inventory.remote.ts:552`), even
though `acquisition_line` is a real one-to-many table and `recordAcquisition` loops
over `data.lines`. A six-item shop trip is six separate acquisitions with the
supplier and receipt number retyped each time — and six rows in the register where
one receipt exists.

There is **no bulk entry of any kind**: no CSV import, no paste-a-list, no
duplicate-last-unit. Confirmed by search across the remote layer and staff routes.

### A7. Smaller things

- **A new item defaults to a consumable.** "Tracked as" defaults to _Bulk — a
  count_ and "Members can borrow this" defaults _off_, so every piece of loanable
  gear needs both flipped. For a gear library that is the wrong way round.
- **`acquisition.total_cents` is never set by the UI** — only `unit_value_cents` on
  the line. The list and spend report both derive the value correctly, so this is
  latent rather than broken, but 3 of 8 acquisitions carry a null total.
- **Acquisition dates render without a year** ("Nov 3", "Jul 26") in a register
  that already spans two.
- **The ledger invariant held throughout.** On-hand tracked the live asset count
  through both doors — 4 units, 4 `receive` movements, on-hand 4. The ledger design
  is doing its job; it is the surfaces above it that are thin.

---

## B. Front-desk lending

**What was driven.** A seeded `requested` loan (Gibson Les Paul → Sage Dubois)
taken all the way through **schedule → check out naming a unit → return**, with the
ledger and the money read back out of D1.

**The core is sound.** This is the part of the module that has clearly been used in
anger. The five-state machine behaved exactly as specified, the checkout form asked
which unit was being handed over and bound it, and the ledger closed cleanly:

```
receive +1  →  loan_out −1  →  loan_return +1     on-hand 1 = 1 live asset
```

The unit returned to `in_service`, and the charge preview ("1 day × $5.00/day =
$5.00") matched what was actually settled. None of the traps the spec warns about
(`AssetRequiredError`, silent `z.uuid()` failures) fired — those are genuinely fixed.

The problems are all around the edges.

### B1. Dates display one day earlier than they were entered — **WRONG**

Entered a scheduled pickup of **2026-09-01**; the page rendered **"Mon, Aug 31"**.
Entered a due date of **2026-09-05**; it rendered **"Fri, Sep 4"**.

The value is stored correctly — D1 holds `1788220800` = `2026-09-01T00:00:00Z`. The
fault is on the way out: a date-only value stored at UTC midnight is formatted in
local time, and Corvallis is UTC−7. Every date-only field in the module is exposed
to this.

The clearest demonstration is a single screen contradicting itself. The loan detail
page shows, of what is meant to be the same day:

```
Requested pickup   Tue, Sep 1     ← seeded (written at local midnight)
Scheduled pickup   Mon, Aug 31    ← entered through the form
```

For a front desk that runs on "when is this due back", a silent one-day shift is
not cosmetic.

### B2. A member's credit balance is displayed in the wrong unit — **WRONG**

`src/lib/config.ts:79` is explicit: _"Equipment credits are denominated in cents
(1 credit = 1¢…)"_, with a `maxBalance` of 25000 — that is $250.

The settlement honours this. The member catalog does not:

```svelte
<!-- src/routes/member/equipment/+page.svelte:96 -->
<Badge variant="info">{meta.creditBalance} credits</Badge>
```

So a member holding $25.00 of equipment credit is told they have **"2500 credits"**,
with no way to learn what one is worth. Observed at the other end of the scale in
this pass: a balance of `1` settled as **$0.01** against a $5.00 loan.

The staff side already does it correctly — the loan page rendered "Paid via credits
**$0.01**" through `formatCents`. It is the member-facing number that is raw.

### B3. Staff retype the date the member already gave — _note_

The loan shows "Requested pickup Tue, Sep 1" directly above a **Schedule Pickup**
form whose date field is empty. The overwhelmingly common action — accept the date
the member asked for — costs a manual re-entry, and it is the step where B1's
off-by-one gets introduced.

### B4. Loan status is legible only on hover — _note_

The queue's status column is an icon with no text. The icons do carry `aria-label`
and a tooltip (`Requested`, `Scheduled`, `Checked out`, …), so this is not an
accessibility failure — but "which of these needs me to do something" is the entire
question a front-desk queue answers, and answering it currently means hovering
seven rows one at a time. Only `Overdue` gets a text badge.

### B5. Stripe was never reached, and that was provable in advance

The return settled **$5.00 = $0.01 credits + $4.99 cash** and made no Stripe call.
`settleReturn` guards with `cashRemaining > 0 && stripeCustomerId`
(`loan-service.ts:108`), and this member's `stripeId` is null, so the paid leg is
unreachable for them.

**Still outstanding:** the leg where a member _does_ have a Stripe customer writes a
real `paymentRecords.reportPayment` (`payment-service.ts:363`). That was not
exercised, because this worktree still carries the live `rk_live` key. It needs a
test key before anyone drives it.
---

## C. Restock and purchasing

**What was driven.** Staff dashboard → restock list → received both low items on one
shop trip → checked the spend report and the acquisitions register → recorded a
stocktake correction.

**This loop mostly works, and it is the best-designed part of the module.** The
restock list groups by category, computes the quantity to buy, shows the barcode to
scan in the shop, and offers Receive on the row you are reading. Receiving cleared
each row from the list immediately, and the page ended on a correct empty state
("Every counted item is above its reorder point"). Stock moved 4 → 24 and 3 → 13.

### C1. One shop trip becomes many acquisitions — **SLOWS**

Both items came off one receipt, `GC-99001`. The register now holds **two
acquisitions** with that reference:

```
acq f3c3e35e  Guitar Center  GC-99001  lines=[{qty:20, unit:350}]
acq 7cd5667e  Guitar Center  GC-99001  lines=[{qty:10, unit:1200}]
```

Supplier and receipt number were retyped for the second, and nothing links them —
`reference` is free text. A ten-item trip is ten rows, ten retypes, and ten chances
to spell the supplier differently, which is precisely what makes a later
`GROUP BY sourceName` (the reason the spec declined to build a `supplier` table)
unreliable.

`acquisition_line` is already one-to-many and `recordAcquisition` already loops over
`data.lines`. Only the form is single-line.

### C2. "Stocktake" makes the operator do the arithmetic — **SLOWS**

The action named **Stocktake** — the one a person uses while standing at a shelf —
asks for the _difference_, not the count. Its own help text says so:

> The system currently shows **24** on hand. Enter the difference, not the new
> total — a negative number if there are fewer than we thought.

So counting 17 batteries means entering **−7**. The correction itself is recorded
beautifully (ledger row `Adjusted −7` carrying the note "Counted the shelf: 17
actually present"), and showing the current figure does help — but the natural
input at a shelf is the number you counted, and every line costs a subtraction. An
arithmetic slip writes a wrong ledger entry that then looks authoritative.

The delta is the right thing to _store_; it is the wrong thing to _ask for_.
Accepting a counted total and deriving the delta changes no schema.

### C3. The dashboard says what is low, not how low — _note_

`/staff` shows "Running low" with only an On hand column — "9V Batteries 4",
"Vic Firth 5A Drumsticks 3". Without the reorder point beside it, 4 is not
obviously a problem. The restock list has the full picture; the dashboard panel is
one column short of being actionable on its own.

### C4. The spend report is correct, and that is the problem

`/staff/inventory/spend` totalled $3726 for 2026 and attributed the new purchases to
the right categories. It derives value from `acquisition_line.unit_value_cents`, so
the never-populated `acquisition.total_cents` does not break it.

But see **A5**: because nothing can be backdated, every row a stocktake creates is
dated today. The report is accurately reporting bad dates.

### C5. Checked and found sound

- Reorder point and quantity **are** correctly prefilled on the item form
  (`n:reorderPoint=5`, `n:reorderQuantity=20`) — an earlier suspicion, disproved.
- `isLoanable` is correctly unchecked for consumables, so the derived
  "Bulk Consumable" label matches the data.
- The consume path (`Use`) and its ledger entries behave as designed.

---

## What this adds up to

**The ledger is right. The doors into it are thin.**

Every objective check passed. On-hand equalled the live asset count through both
entry paths; the loan machine wrote `loan_out` / `loan_return` and settled credits
and cash correctly; corrections landed as their own auditable rows; the restock and
spend reports computed correct answers from correct data. The design the spec argues
for is sound and is working.

What is missing is that **nobody has yet had to put 200 real things into it.** The
surfaces were built to _maintain_ a catalog that already exists. Every one of the
blocking findings is about _establishing_ one:

|                   | Maintaining a catalog  | Establishing one                           |
| ----------------- | ---------------------- | ------------------------------------------ |
| Locations         | pick from a list       | must create the list — **impossible** (A1) |
| A unit's identity | edit one unit          | 200 units, 2 forms each (A4)               |
| Provenance        | this arrival's receipt | gear owned for years, no receipt (A5)      |
| Dates             | today is right         | today is wrong for everything (A5)         |
| Counting          | correct a drift        | establish the baseline (C2)                |

### Blocking the stocktake

1. **A1 — locations cannot be created.** Hard stop. `addLocation` exists and has no
   caller. On a clean install the location picker does not even render.
2. **A2 — saving a unit erases its location.** Silent data loss, on the exact path
   a stocktake takes.
3. **A5 — nothing can be backdated**, and there is no acquisition kind meaning
   "already owned", so the stocktake reports itself as this year's spending.

### Slows it down badly

4. **A4 — neither entry door captures both identity and provenance**, though the
   service layer already supports doing both at once (`line.units`).
5. **C1 / A6 — one item per acquisition**, no multi-line receipt, no bulk import.
6. **C2 — the stocktake action asks for a delta**, not the number counted.

### Genuine bugs, independent of the stocktake

7. **A3 — the item Category field renders as stray text** and cannot be changed
   after creation (`FormField type="select"` ignores children).
8. **B1 — date-only values display one day early** west of UTC.
9. **B2 — member credit balance is shown in the wrong unit** — "2500 credits" for
   $25.00.
10. **B6 — every cash payment 500s** and takes the loan return with it. Not an
    inventory bug: reservation cash payments share the call. **Fixed and verified
    end to end.**
11. **B7 — a failed payment burns the member's credits**, because `settleReturn`
    deducts before it calls Stripe and nothing compensates. Left for a decision.

### Cheapest high-value fixes

Roughly in order of value per line changed:

- Give `addLocation` a surface, and drop the `{#if locations.length > 0}` guard.
- Stop `editAsset` coercing an absent `locationId` to null — or put the field on the
  form. One line either way.
- Pass `options` to the category `Field`, or teach `FormField` to accept children.
- Format the member credit badge with `formatCents`.
- Format date-only values in UTC, or store them at local midnight.
- Let `receiveStock` take `occurredAt`, several lines, and per-unit tags/serials —
  it is a form change over a service that already does all three.
- Let the stocktake modal accept the counted total.

### B6. Every cash payment in the app is broken — **WRONG** (found on the paid leg)

Re-run with a Stripe **test** key and a member who has a real test-mode customer,
the paid return does not merely fail to charge — **it 500s and the loan is never
returned at all**. Status stayed `checked_out`, `returned_at` null, the ledger
untouched. A member hands the gear back and the system keeps it on loan.

```
StripeInvalidRequestError: You may only specify one of these parameters: display_name, type.
  param: payment_method_details[custom][display_name]
[500] POST /staff/inventory/loans/5ac43ab7-…
```

`recordCashPayment` (`src/lib/server/finance/payment-service.ts:363`) sends

```ts
payment_method_details: {
  custom: { display_name: displayName, type: 'custom' },  // ← both, and Stripe allows one
  type: 'custom'
}
```

Probing the live test API found **two** incompatibilities, not one. This shape is
accepted (verified, HTTP 200, `pr_test_…`):

```
payment_method_details[type]=custom
payment_method_details[custom][display_name]=Cash        # display_name only
processor_details[type]=custom
processor_details[custom][payment_reference]=<ref>       # required, currently absent entirely
```

So the call is wrong in the `custom` object _and_ omits a now-required
`processor_details` block.

**It never worked — this is not version drift.** The first read of this blamed the
unpinned API version. That was wrong, and the matrix says so: the payload is
refused identically on the SDK's version and the account's, so `recordCashPayment`
has never succeeded on any version. It is "deployed but never exercised", not a
regression.

| payload                        | `2026-05-27.dahlia` | `2026-07-29.dahlia` |
| ------------------------------ | ------------------- | ------------------- |
| `custom.type` + `display_name` | rejected            | rejected            |
| no `processor_details`         | rejected            | rejected            |
| corrected                      | ✅                  | ✅                  |

**This is not an inventory bug.** `recordCashPayment` has three callers:

- `src/lib/server/inventory/loan-service.ts` — the loan return above
- `src/lib/remote/reservations.remote.ts:1220` — the $0 credit settlement
- `src/lib/remote/reservations.remote.ts:1924` — reservation cash

so **reservation cash payments were broken the same way**. Nothing caught it
because it needs a real Stripe call: the unit tests mock the client, and local QA
has always been steered off Stripe flows by the live key in `.env`.

**Why the existing test passed.** `payment-service.spec.ts` asserted the call with
`expect.objectContaining({ amount_requested, metadata, customer_details })` — and
`objectContaining` waves through every key it does not name, including the one
that was wrong. A mocked client agrees with any payload at all.

**Fixed.** The payload now sends `display_name` alone and the required
`processor_details`, with `payment_reference` carrying the loan or reservation id
so a Stripe record can be reconciled back to what it paid for. Verified end to
end: the SM58 loan returned for **$70.00**, `pr_test_…` retrieved from Stripe with
`processor_details.custom.payment_reference` equal to the loan id, ledger closed
(`loan_out −1`, `loan_return +1`, on-hand 2 = 2 live units). The regression test
asserts both sub-objects exactly, and fails on the old payload.

The API version is now pinned to the SDK's own `ApiVersion`, which is hygiene
rather than a fix — unpinned, the request version could move without a commit.

### B7. A failed payment burns the member's credits — **WRONG**

Found because the first attempt failed: the 500 above did not leave the loan
untouched. `settleReturn` deducts credits **before** it calls Stripe, and nothing
compensates when the call throws. After the failed return:

```
credit_transaction  equipment_credits  −3  balance_after 0
                    source: checkout   source_id: 5ac43ab7-…
inventory_loan      status: checked_out   returned_at: null
```

Three cents, so nobody would have noticed — but the shape is the problem, not the
amount. The member paid, the collective recorded no payment, and the gear is still
booked out. Retrying the return then charges them again from a balance that has
already been spent.

D1 has no transactions and an external API call could not join one anyway, so
this wants an explicit compensating credit-refund on failure — or deferring the
deduction until Stripe has answered. That is a change to money-handling order and
is left for a decision rather than folded into the payload fix.

### Not yet exercised

- **Member self-serve and the scan resolver** (`/a/[tag]`) from a genuine
  non-staff account — the dev seed has only the admin login, and `entityHref` routes
  staff differently, so this needs a registered member to be meaningful.
- **Donations, Form 8283/8282 and reimbursement** beyond reading the register.
- Note for whoever picks these up: members have **no per-item page**
  (`/member/equipment/[id]` 302s to the list), so manuals and how-tos are reachable
  only by scanning a tag — and no tag has been printed yet. Phase 4's content is
  currently unreachable in practice.
