# 0028 Local resources are their own table

- **Date:** 2026-09-08
- **Status:** Accepted
- **Issue:** [#575](https://github.com/corvmc/corvmc.org/issues/575)
- **PRs:** #1498

## Context

CMC keeps a public, staff-curated list of music businesses around Corvallis. Three existing shapes
could have held it: a supplier record (deferred in the inventory design partly so it could be
shared with this list), `directory_entry` (which already allows a row with no owner), and `contact`
(the private party record for external acts).

## Decision

1. **`local_resource` and `local_resource_category` are new tables.** Categories are a table
   because staff add them; the foreign key restricts deletes.
2. **A local resource is not a supplier.** A supplier is who CMC buys from and answers "what did we
   spend at X". A resource is who CMC points the community at. A shop that is both is two rows.
3. **Not `directory_entry`.** Its columns are shaped for acts and people, and every directory query
   would need a kind predicate to keep shops out of the member directory.
4. **Contact details are public, on the row.** An address, phone and website are the point of the
   listing. `contact` stays private and unused here.
5. **A returned listing is editable and can be published later.** `rejected` carries a staff note
   and is not terminal.
6. **A public tip creates a `pending` row**, Turnstile-guarded, and the submitter is emailed the
   outcome.

## Alternatives rejected

- **A shared supplier and resource table.** It would put public descriptions on a spend rollup and
  invoice data near a public listing.
- **Unowned `directory_entry` rows.** A third meaning for one table, and a leak risk in every
  directory query.
- **Categories as a `config.ts` constant.** Adding a category would need a deploy.
- **A terminal rejection.** Staff could not hand a listing back with a note.

## Consequences

- No slug and no detail page; a resource renders as a card until it has more to say.
- The address is one free-text line, which suits rendering and not a map.
- A shop has no way to correct its own listing.
