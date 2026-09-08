# Band packing list — what goes in the van, and who is bringing it

> **Status: shipped.** All three phases landed from `feature/band-packing-list`
> under tracking issue #729. Live behavior is described in
> [business-workflows.md](../../development/business-workflows.md); what survives
> here is the design rationale — the options weighed and rejected.
>
> The code carries one-line pointers back to the section that argues each
> decision, because the reasoning is longer than an eight-line comment block and
> does not belong inline.

## Purpose

The tech rider asks _"what does the desk have to find?"_ — a question only a band
that has already played out can answer, which is where a new band stops. A packing
list asks _"what do you bring to a gig?"_, which a band can answer on the day it
forms. Same room, friendlier door.

`packing_item.rider_kind` is the bridge: walking through the easy door furnishes
the rider on the way.

The other half of the ask is **delegating who is responsible for what**. Gear does
not get left behind because nobody knew it existed; it gets left behind because
everyone assumed somebody else had it.

## Two tables

### `packing_list` exists for one column

`last_reset_at`. A reset is the one write whose own effect destroys the evidence
it happened — after it, every flag reads false, and "never packed" and "packed,
then cleared an hour ago" are the same picture. Without a head row the load-in
page cannot tell a band its list is a month stale, and a list that has not been
reset since March is lying about a van somebody is standing next to.

**One list per band, and it is durable.** No event link, no per-show copy. A band
packs the same crate every time, and a list that had to be created per show would
be a list nobody created. `uq_packing_list_group` enforces the one-per-band rule;
`ensurePackingList` is racy in principle and relies on that index, with the
loser's insert failing and the retry finding the winner's row.

The unique index lives in the table config rather than as `.unique()` on the
column: a `.unique()` there emits no constraint at all on this drizzle version.

### `packing_item` carries two owner columns, and they are not redundant

| column             | means              | drives                                     |
| ------------------ | ------------------ | ------------------------------------------ |
| `user_id`          | whose gear it is   | what promotion writes onto the rider       |
| `assigned_user_id` | who is carrying it | the load-in page, and the unassigned count |

The case that forces both is the band's own merch tub: nobody owns it, somebody
has to bring it, and collapsing the pair would put the tub on the rider as that
person's stage gear. Say it as _the rider cares whose amp it is; the van cares who
is carrying it._ They agree on most rows, which is exactly why somebody will
eventually try to merge them.

A member leaving nulls both (`on delete set null`) — the gear is still there and
the job is still open, which is what the unassigned count should then show. A
member leaving does not take the merch tub with them.

`assigned_user_id` null means **nobody has this**, which is the state that
actually loses gear and the one the load-in page leads with. `unassignedCount` is
listed before the packed count everywhere it is shown: an unassigned row is
actionable days before load-in, while a packed count only means something during
it.

### Ordering comes from `category`, not `sort_order`

The same split, for the same reason, that makes `rider_element` read by `kind`. If
order were one global sequence, two members saving their own rows would each
renumber from zero and the band's list would depend on who saved last. Deriving
the spine from the vocabulary means nobody coordinates, and nobody can shuffle
somebody else's crate by reordering their own. `sort_order` breaks ties _within_
one owner's rows in one category, and is dense and re-derived on save — the client
never posts an order.

### `packed` is a column, not a second table

One durable list per band with a flag on each row is the whole check-off design:
you tick as you load, and "reset for the next load-in" clears the column. A join
table keyed on a show would be a per-show instance, which is the thing this
feature is deliberately not.

Both quantity bounds are CHECKs in the first migration. Adding a CHECK to a SQLite
table later is a full rebuild, and this is a bound the service has to enforce
anyway since a client can post any number it likes — cheap now, expensive later.

## Three concerns, three permission rules

| verb   | who may                                                                                                        | lifetime      |
| ------ | -------------------------------------------------------------------------------------------------------------- | ------------- |
| edit   | the row's owner, or an admin                                                                                   | forever       |
| assign | anyone may claim an _unassigned_ row for themselves or release their own; an admin assigns or reassigns anyone | until changed |
| pack   | anyone on the roster, on any row                                                                               | one trip      |

Editing is the rider's rule, copied deliberately. The other two are **departures,
and both are load-bearing**: one person walks the list at load-out and it is not
reliably an admin, and _"I'll bring the PA"_ is how a band actually settles this
rather than the owner filing a request.

Packing is the rule a later reader would "fix" back to the rider's. Ownership
governs who may say what the band brings; it does not govern who may carry a box,
and the bassist who stows the shared PA tub must be able to say so.

### Takes-no-argument is how each rule is enforced

Not a role check. `saveOwnItems` takes no owner and `claimItem` takes no assignee;
they write the caller the guard already resolved. `saveItemsFor` and `assignItem`
are the separate admin-guarded paths that name somebody. Two or three functions
rather than one with a flag, because **the flag is the thing that gets passed
wrong**. This is the split `saveOwnElements`/`saveElementsFor` already draws.

The same shape repeats in `packing.remote.ts`, which is the actual security
boundary: remote functions bypass route and layout loads and take their params
from a client header, so the guard has to be in the handler.

### A tick and a claim are not edits

Neither touches `packing_list.updated_at`. That column means "what we bring
changed"; packing the amp you always bring changes nothing about the list.

Keeping them apart is also what lets the editor's `{#key}` remount survive
somebody else ticking a box on their phone mid-edit — bumping `updatedAt` on a
tick would re-seed every open editor on the page under its author's hands.

### A reset clears ticks and leaves assignments alone

Two verbs, two lifetimes. Who is bringing the PA is not a per-trip fact, and a
reset that cleared it too would make the band re-negotiate the load-in from
scratch every show — which is the coordination this feature exists to remove.
"Clear everything" is the intuitive and wrong reading, so it is pinned by a test.

The reset uses `db.batch`, never `db.transaction` — the latter is broken on D1 and
ESLint errors on it. Its parameter count is constant however long the list is, so
it is the one write here the 100-parameter cap has no opinion about. The
`packed = true` filter is not an optimisation: it is what lets
`idx_packing_item_packed` do the work, and it keeps a no-op reset from rewriting a
hundred rows.

## `claimItem` is a conditional write, not read-then-write

The update carries its own `assigned_user_id IS NULL` predicate and reports zero
affected rows as `PackingAlreadyClaimedError`.

Two people tapping "I'll bring it" on the PA at the same moment is the realistic
case here, not an edge one, and a read-then-write lets the second silently
overwrite the first. It is **expected rather than exceptional**: the page's answer
is "Sam already has this one", not a failure — so the remote function catches it
and returns a message rather than mapping it to a 422.

## The save is a diff, not a replacement

The one place the rider's precedent does not transfer.
`replaceElementsForOwner` deletes an owner's elements and rebuilds them, which is
right when the payload is the whole truth — a rider element holds nothing but what
the member typed.

A packing item holds `packed`, `assigned_user_id` and `promoted_at`: **state
nobody typed and nobody can retype**. Delete-and-reinsert would unpack the van and
drop whoever agreed to carry the box every time somebody fixed a spelling.

So drafts carry ids, made safe by the same `(listId, ownerUserId)` scoping the
rider uses: an id the owner filter did not return is **rejected, never adopted**,
so a forged payload cannot reach into another member's crate or another band's
list. `sort_order` is still re-derived from array position.

The rows travel as JSON in one hidden field — the shape `LineupEditor`
established. A remote form's `FormData` cannot express an array of objects, and a
request per row is a round-trip explosion. The parse happens inside the handler
rather than in the schema, because a `.transform()` in a `form()` schema breaks
`fields` inference.

## Promotion stores no foreign key

`promoted_at` is a bare timestamp with no reference in it, and this is the part not
to "fix".

A `rider_element_id` would be correct only until that member next saved their rider
corner — `replaceElementsForOwner` mints fresh UUIDs every time — and would then be
a foreign key meaning _"was true once"_, which makes the promote button lie with a
straight face.

`promoted_at` records that **the band made the decision**. The live _is it on the
rider right now_ answer is a label match computed on read, the same handle the
rider already uses to carry stage-plot placements across a save.

The consequence to honour in the UI: an element the band promoted and then
deliberately deleted from the rider **must not come back as a suggestion** on every
page load. That difference between the stored decision and the computed match is
the whole reason for having both.

`rider_kind` is nullable on purpose. A row with a kind stands on a stage and can be
promoted; a first-aid kit and a box of shirts are neither. Null is the common case
and must not read as unfinished. It uses the rider's own vocabulary rather than a
parallel one — a second list meaning the same things would drift the first time
either grew.

## Names on the page

`ownerName` and `assignedName` coalesce through `group_member.alias` the way
`getRider` does, because the band's word for who somebody is has to agree across
every page that names them. `packedByName` does not, since it is an audit line
rather than a roster position.

## Seed

Hangs off the band and the two logins `seedRiders` already makes, so one account
reaches both features. It covers every rule that would otherwise be taken on faith:
a row owned by one persona and carried by the other, shared rows nobody has, a row
ticked by somebody who neither owns nor carries it, an admin-assigned row where
`assigned_by` differs from `assigned_user_id`, and all three promotion states.

The **settled** state is derived from the rider rather than hardcoded. The match is
on `(owner, label)`, and the rider seed hands corners out round-robin over a roster
this file does not control — so a guessed pair read as settled and silently was
not. That was caught by querying the seeded database, not by reading the code.

## Phases

1. **Tables, vocabulary, service** — PR #486. Sub-issue #730.
2. **The member-facing list** — route, remote functions, the editor, claim,
   release, pack, reset. PR #753. Sub-issue #731.
3. **Promotion onto the rider**, plus the finishing steps. Sub-issue #732.

### What promotion had to work around

`replaceElementsForOwner` is a **replacement**, and `rider_input.element_id` is
`on delete cascade`. A promote that saved only the promoted rows would delete the
rest of that member's corner and every channel hanging off it — a page they were
not looking at, in a feature they were not using. `appendOwnElements` reads the
corner, carries the inputs through, and saves the union; it lives in
`rider-service.ts` next to the rebuild it guards rather than in the packing
service that calls it.

## Not in this spec

- **Per-show packing lists.** See "`packed` is a column".
- **A `rider_element_id` FK.** See "Promotion stores no foreign key".
- **Non-band packing lists** (events, programs, committees). The table hangs off
  `group`, so it is not structurally excluded, but no surface outside a band's own
  panel is planned.
