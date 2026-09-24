# Market Vendors — applications for a market day CMC hosts

> **Shipped** (#609). How it behaves now is in
> [business-workflows §18](../../development/business-workflows.md). This file keeps the design.

Tracking issue: #609. Decisions left open: #1502 (table fees), #1503 (who approves), #1504 (what
the public sees). Deferred: #1505 (day-of check-in, no-shows, invite-back).

## Purpose

CMC is going to host a market day. Vendors need somewhere to apply, staff need one list to accept
or decline from and to assign tables on, and shoppers need to see who will be there. Today a
vendor would email, a staffer would keep a spreadsheet, and the event page would say nothing.

## The workflow, as handoffs

1. **Staff open a market day for applications.** An event listing becomes a market, with a closing
   date and a number of tables.
2. **A vendor applies**, on a public form linked from the event page and open until the closing
   date. They give their name, email, optional phone, business name, what they sell, an optional
   website, how many tables they need, whether they need power, and any notes.
3. **Staff decide.** Accept, with a table label, or decline. Either way the vendor is told by email.
4. **The vendor replies**, if they reply, into the same conversation. A vendor who withdraws is
   marked withdrawn.
5. **Shoppers see accepted vendors** on the event page.

## What already exists

Checked against `main` on 2026-09-23.

- **The event.** `event_listing` is the advertisement, and `kind` is display-only, with no CHECK
  constraint in SQL. So a new kind costs no migration.
- **The conversation.** A public contact form becomes a `web` `inbox_thread` through
  `findOrCreateThread` + `addInboundMessage` (`handleContactForm`). A staff reply on a `web` thread
  is emailed by `addOutboundMessage` → `dispatchReply`, and the vendor's answer threads back in
  through the signed Reply-To. The vendor's contact details are already private there: only the
  staff inbox reads `inbox_thread`.
- **Public form protection.** `submitContactForm` verifies Turnstile. The vendor form copies it.
- **Nothing** models a vendor, an application to an event, or a table.

## What gets built

### Schema

- `eventKinds` gains **`market`**, labelled "Markets".
- **`market_day`**: one row per market listing. It is the vendor-intake setup, kept off
  `event_listing` because it is back-of-house.
  - `event_id` (PK, FK `event_listing`, cascade)
  - `applications_close_at` (timestamp, nullable; null means open until the event starts)
  - `table_count` (integer, nullable)
  - `created_at`, `updated_at`
- **`market_vendor`**: one application.
  - `id`, `event_id` (FK `event_listing`, cascade)
  - `thread_id` (FK `inbox_thread`, set null): the conversation, which also holds the contact
    name, email and phone. **No contact column lives on this table**, so the public vendor list
    cannot serialize one.
  - `business_name`, `offering` (what they sell), `website` (nullable)
  - `tables_requested` (integer, 1–4, default 1), `needs_power` (boolean), `notes` (nullable)
  - `status`: `marketVendorStatuses` = `applied | accepted | declined | withdrawn`, default
    `applied`, in `config.ts` with labels in `StatusBadge`
  - `table_label` (nullable, set on acceptance and editable while accepted)
  - `decided_by_user_id` (FK `user`, set null), `decided_at`
  - `created_at`, `updated_at`
  - index on `(event_id, status)`

### Service: `src/lib/server/market/market-service.ts`

- `openMarketDay(eventId, { applicationsCloseAt, tableCount })` upserts `market_day` and sets the
  listing's `kind` to `market`, in one `db.batch`.
- `getMarketDay(eventId)` returns the setup plus derived counts (applied, accepted, tables
  assigned).
- `isAcceptingApplications(marketDay, event, now)` is true when the listing is published, the
  market row exists, and `now` is before both `applications_close_at` (if set) and `starts_at`.
- `submitApplication(eventId, input)` refuses with `MarketClosedError` (4xx) when the market is
  not accepting applications. Otherwise it creates the `web` thread (subject
  `Vendor application: <business> — <event title>`), posts the application as its first inbound
  message, and inserts the `market_vendor` row pointing at it.
- `listApplications(eventId)` is the staff read: every row, with the thread's contact name and
  email joined in.
- `decideApplication(vendorId, { decision, tableLabel?, message }, actor)` moves `applied` to
  `accepted` or `declined`, stamps the decider, and sends `message` on the thread through
  `addOutboundMessage`. An `accepted` vendor may be moved to `declined` or `withdrawn`, and a
  `declined` one back to `accepted`. `withdrawn` is terminal.
- `setTableLabel(vendorId, label)` works on accepted vendors only.
- `withdrawApplication(vendorId)` is used when the vendor says so on the thread.
- `listPublicVendors(eventId)` selects `business_name`, `offering`, `website` and `table_label`
  **by name**, for `accepted` rows only, ordered by business name.

Input limits use `SHORT_TEXT_MAX` / `LONG_TEXT_MAX`.

### Remote: `src/lib/remote/market.remote.ts`

- Public: `getMarketApplicationInfo(eventId)` (event title, date, open or closed, closing date),
  `getPublicVendors(eventId)`, and `submitVendorApplicationForm` (Turnstile, then Zod, then the
  service).
- Staff, all `requireCapability('event.manage')` (#1503): `getMarketVendorsAdmin(eventId)`,
  `openMarketDayForm`, `decideVendorForm`, `setTableLabelForm` and `withdrawVendorForm`.

### Staff surface: `/staff/events/[id]/vendors`

- A **Market setup** card holds closing date and table count, and a button that opens the market
  if it is not one yet.
- An **Applications** table has columns for business, what they sell, tables and power, contact,
  status, table and actions. Tabs filter by status. The contact column links to the inbox thread.
- **Accept** opens a modal with the table label and a message pre-filled with the event, date
  and table, which staff can edit. **Decline** opens a modal with a message and no pre-fill
  beyond a greeting.
- The staff event page links to it with a "Vendors" header action when the listing is a market.

### Public surfaces

- `/events/[id]/vendors/apply` is the application form (`Form`, `FormField`, `SubmitButton`),
  with Turnstile. It states what will be published if the vendor is accepted: business name,
  what they sell, and website. It shows a closed state after the deadline.
- `/events/[id]` for a market gets a **Vendors** section listing accepted vendors, and an
  "Apply for a table" button while applications are open.

### Seed

`scripts/seed/market.ts` creates one published market-day listing, about three weeks out, with
applications open. It has one vendor in each status, one with no website, and one needing power
and two tables. Each vendor has a web thread.

## Delivery

On a feature branch, `feature/market-vendors`, because the public form is the feature:

1. **Phase 1:** schema, migration, service and specs, the staff vendors page, and the seed.
2. **Phase 2:** the public application form, the vendors section on the event page, the catalog
   row, the business-workflows section and help, and retiring this spec.
3. **Landing PR** to `main`, with `Fixes #609`.

## Not in this spec

- Table fees and payment: #1502.
- Check-in, no-shows, reassignment on the day, and the invite-back record: #1505.
- A table map or floor plan. `table_label` is free text.
- A vendor-facing token page. The email thread is the vendor's channel.
