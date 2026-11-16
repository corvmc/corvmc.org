# 0059 The Practice space page runs the space

- **Date:** 2026-11-11
- **Status:** Accepted
- **Issue:** [#2586](https://github.com/corvmc/corvmc.org/issues/2586)
- **PRs:** [#2587](https://github.com/corvmc/corvmc.org/pull/2587),
  [#2588](https://github.com/corvmc/corvmc.org/pull/2588),
  [#2590](https://github.com/corvmc/corvmc.org/pull/2590)

## Context

Staff ran the practice space from three places: the reservations list, a Resolve modal for
sessions that ended owing money, and global Settings, which held the space's pricing, booking
rules, operating hours, room, orientation and the U-tec lock card beside organisation-wide
settings.

## Decision

1. **One filter row.** Booker type joined to search, a Date preset or custom range, and Status
   with a count per option. Filter state lives in the URL.
2. **Payment due is a status, not a queue.** It lists confirmed, unpaid bookings, ended or
   upcoming. A session that ended owing shows Cash received and No-show on its own row. The SQL
   reading (`confirmedUnpaidSql`) and the row's reading (`owesMoney`) are held together by a
   spec over every combination of the columns they read.
3. **Building access is a sidebar of the page.** Lock status comes from the daily job's last
   health reading in KV, so the page and the sidebar never wait on U-tec. Codes leave the server
   as their last two digits.
4. **The space has its own settings page** at `/staff/reservations/settings`. Old
   `/staff/settings?tab=` links redirect. Capabilities did not change.

## Alternatives rejected

- **Keeping the Resolve modal beside the filters.** Two lists of the same rows can disagree.
- **A live U-tec reading for the header dot.** It would put a vendor call on every page load.
- **Recent usage from the lock.** No U-tec directive for access history is confirmed; #2589
  tracks it.
