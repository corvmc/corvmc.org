# 0029 One durable packing list per band

- **Date:** 2026-09-08
- **Status:** Accepted
- **Issue:** [#729](https://github.com/corvmc/corvmc.org/issues/729)
- **PRs:** #486, #753

## Context

A tech rider asks what the venue desk has to find, which only a band that has played out can
answer. A packing list asks what the band brings to a gig, which a new band can answer. Gear gets
left behind when everyone assumes somebody else has it, so the list also has to say who is carrying
each thing. Rows with a `rider_kind` can be promoted onto the rider.

## Decision

1. **One list per band, no per-show copy.** `packing_list` exists for `last_reset_at`, so the page
   can say how stale the ticks are. `uq_packing_list_group` enforces one per band.
2. **Two owner columns.** `user_id` is whose gear it is and drives promotion; `assigned_user_id` is
   who is carrying it and drives the unassigned count. A member leaving nulls both.
3. **Three verbs, three rules.** The owner or an admin edits; anyone claims an unassigned row or
   releases their own, and an admin assigns anyone; anyone on the roster packs any row.
4. **The rule is in the signature.** `saveOwnItems` and `claimItem` take no person and act as the
   caller; `saveItemsFor` and `assignItem` are separate admin paths.
5. **A claim is a conditional write** carrying `assigned_user_id IS NULL`; zero rows is
   `PackingAlreadyClaimedError`, shown as a message.
6. **A save is a diff.** Drafts carry ids scoped by `(listId, ownerUserId)`; an unknown id is
   rejected. `packed`, `assigned_user_id` and `promoted_at` survive an edit.
7. **A reset clears ticks and keeps assignments.** Neither a tick nor a claim touches
   `packing_list.updated_at`.
8. **Promotion stores `promoted_at`, no foreign key.** Whether a row is on the rider now is a label
   match computed on read.
9. **Order comes from `category`**; `sort_order` breaks ties within one owner's rows.

## Alternatives rejected

- **A list per show, or a packed-per-show table.** A list that has to be created per show is a list
  nobody creates.
- **One owner column.** The band's merch tub has no owner and still needs a carrier.
- **Packing restricted to owners and admins, as on the rider.** One person walks the list at
  load-out and is not reliably an admin.
- **Delete-and-reinsert on save, as the rider does.** It would unpack the van and drop every claim on
  each spelling fix.
- **A `rider_element_id` foreign key.** The rider mints fresh ids on every save, so the key would
  mean "was true once".
- **A global `sort_order`.** Two members saving their own rows would reorder each other's.

## Consequences

- A promoted row the band later deletes from the rider is not suggested again, because the nudge
  reads `promoted_at` as well as the match.
- Promotion goes through `appendOwnElements`, which carries the member's existing rider corner and
  inputs through; a save of only the new rows would cascade away their inputs.
- Quantity bounds are CHECKs from the first migration, since adding one later rebuilds the table.
