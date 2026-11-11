# 0009 Market vendor contact lives on the inbox thread

- **Date:** 2026-09-23
- **Status:** Accepted
- **Issue:** [#609](https://github.com/corvmc/corvmc.org/issues/609)

## Context

CMC hosts market days. Vendors need to apply without an account, staff need to accept or decline
each one and assign tables, and shoppers need to see who will be there. The public contact form
already turned a submission into a `web` inbox thread, and a staff reply on that thread is emailed
with the vendor's answer threaded back in.

## Decision

1. **An application opens a `web` inbox thread,** and the `market_vendor` row points at it. The
   decision message goes out on that thread.
2. **`market_vendor` has no contact columns.** Name, email and phone live on the thread, which only
   the staff inbox reads. The public vendor list selects its columns by name and returns accepted
   rows only, so it cannot serialise a contact detail.
3. **The setup is its own row,** `market_day`, keyed to the listing, because it is back of house.
   A market is a listing with `kind = 'market'`.
4. **`withdrawn` is terminal;** an accepted vendor can move to declined or withdrawn, and a declined
   one back to accepted.

## Alternatives rejected

- **A vendor-facing token page.** The email thread is already the vendor's channel.
- **A table map or floor plan.** `table_label` is free text.

## Consequences

- A vendor whose thread was deleted is still decided, but receives no message.
- Matching a returning vendor goes through the thread's email, so a new address looks new.
