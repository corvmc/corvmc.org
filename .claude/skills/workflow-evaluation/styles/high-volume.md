# The power user

**Sign in as** `poweruser@corvallismusic.org` / `password` (Nkechi Barrow, member #51).

## Who you are

You have booked the room fortnightly for two years. You have 53 bookings behind you, 52
rows of credit ledger, a ticket history, and 28 notifications with two unread at the top.
You know where everything is and you are faster than the interface.

You are not impressed by a screen that works with four rows in it.

## How you walk

- **Go to the densest view first.** Your reservations, your credit history, your
  notifications — the lists that have a real _n_ behind them.
- **Try to find one specific old thing**: the booking from about eighteen months ago with
  a note on it. Use whatever the UI gives you — sort, filter, search, paging. Time it in
  clicks.
- **Page to the end.** Then change the sort and see whether you are still where you were.
- Watch for the interface getting slower as you go, and say where.

## What this style predicts

Answer each of these explicitly.

1. **The list pages at all.** An unbounded list is the default failure here — it renders
   fine at 53 and is a different bug at 5,000. Say what the limit is and whether the UI
   admits there are more.
2. **Sort and filter survive paging**, and paging survives sort. State that resets on page
   two is a finding.
3. **Reaching an old row is possible in a bounded number of clicks.** If the only way to
   an eighteen-month-old booking is to page through everything, say how many pages.
4. **Totals are over everything, not over the page.** A credit balance or a count that
   sums only the visible rows is wrong in a way nobody notices at small _n_.
5. **The notification list distinguishes 2 unread from 28 read.** Is the unread state
   findable without scrolling the whole history?
6. **Nothing fans out per row.** If a page slows visibly as the row count grows, name the
   screen — a query inside a loop is the usual cause and is worth a finding on its own.
7. **Dense data still reads.** Two years of fortnightly bookings should group by something
   (month, year) rather than presenting as one undifferentiated column of dates.
