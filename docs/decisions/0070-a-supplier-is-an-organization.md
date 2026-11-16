# 0070 A supplier is an organization

- **Date:** 2026-11-13
- **Status:** Accepted
- **Issue:** [#2622](https://github.com/corvmc/corvmc.org/issues/2622)
- **Amends:** [0045](0045-inventory-stock-is-a-ledger.md), the rejected alternative "A `supplier`
  table".

## Context

0045 kept `purchase_order.supplier_name` as free text, because CMC buys from a few shops and a
supplier table was one more table to keep. Since 0065 every outside party is an `organization`
with roles, so a shop CMC buys from can be the same row that sponsors a season. Production held
no purchase orders (checked 2026-11-13).

## Decision

1. **`purchase_order.organization_id`** names an organization holding the `supplier` role, checked
   by `order-service.ts` on write. `supplier_name` is dropped.
2. **The order forms keep one text field.** It suggests the live suppliers, and a typed name is
   matched trimmed and case-insensitively against every organization, live before archived. A
   match gains the role; no match becomes a new organization with it.
3. **The migration copied existing names** the same way, one organization per name.
4. **Every table that names an organization is listed** in `ORGANIZATION_RECORDS`: a merge moves
   its rows and a role cannot be removed while one names it. `parties.spec.ts` fails on a table
   that references `organization` and is neither listed nor moved another way.
5. **`inventory.manageOrders` opens supplier organizations**, as a role's own capability does for
   funders, sponsors and contractors.

## Alternatives rejected

- **A select of suppliers only.** Ordering from a new shop would mean leaving the form for
  Contacts first.
- **A `supplier` table.** 0065 already made every outside party one table.

## Consequences

- An organization's page lists its purchase orders.
- `acquisition.source_name` stays free text; the spend report still groups it by name.
