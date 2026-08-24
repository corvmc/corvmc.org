# Staff feature enablement

Getting the staff side of every feature-flagged feature working, and making the staff panel
independent of the flags. Started Aug 3 2026.

**Design decision:** feature flags gate the member, band and public surfaces only. The staff panel
always shows every feature, so staff can set one up before it is switched on and keep running it if
it is switched back off.

## Done

- [x] **Staff panel ignores flags** — unconditional staff nav; `getStaffLayout` no longer reads
      `getAllFeatureFlags`; `requireFeature` removed from the staff-only remote functions in
      `inbox`, `flags`, `equipment` (`getEquipment`), `help` (`getStaffArticles`), `marketing`
      (`getAudiences`); inbound `/api/inbox/{postmark,twilio}` no longer flag-gated (the per-channel
      toggle is the real switch); `feature.staffInbox` default flipped back to `false`.
- [x] **bandPremium** — `tier`/`subscription` in `getByIdWithDetails` and `tier` in `listAll`; tier
      badge + billing details on `/staff/bands/[id]`; `setBandTier` comp/revoke that refuses
      Stripe-backed bands (a comped band is `tier: premium` + `subscription: null`, which
      `clearStaleBands` skips); tier column and filter on `/staff/bands`.
- [x] **bandReservations** (no longer flagged) — `band` case in `BookerTypeIcon`; band joined into
      the staff list and detail queries; search covers band names; booker-type filter;
      create-on-behalf-of-band in `CreateModal` (picking a band prefills the member with its
      owner).
- [x] **band events** (no longer flagged) — source + band name on the staff list with a source
      filter; band attribution on the detail page; `location` and `externalTicketUrl` editable by
      staff; `unpublishWithBandNotice` extracted to the event service so both the flag queue and
      the staff event page notify every band on the bill.
- [x] **emailMarketing** — `Schedule` on campaign new/edit wired to the existing
      `createAndSchedule` / `scheduleCampaign`, with a client-side future-date guard;
      `PUBLIC_BASE_URL` consolidated onto `PUBLIC_SITE_URL` so unsubscribe links follow the
      environment instead of hard-coding production.
- [x] **equipment** — `CreateLoanAction` awaits `getAvailableEquipment` instead of fetching the
      non-existent `/api/equipment`; deactivated gear reachable via `includeDeleted` plus a
      "Show deactivated" toggle, which makes the Reactivate button reachable again.
- [x] **helpArticles** — bulk publish/unpublish with row checkboxes and "Select all drafts";
      `updateCategory` wired into an edit action; category create form takes icon and minimum role.
- [x] **staffInbox / contentFlags** — seed inserts `inbox_channel_config` rows so the SMS thread is
      repliable locally; removed the `getFlagsQueue({})` refresh that matched no live cache key.
- [x] **Config + docs** — `POSTMARK_WEBHOOK_TOKEN`, `MARKETING_UNSUBSCRIBE_SECRET`, `CRON_SECRET`,
      `TWILIO_*`, `META_*` documented in `.env.example`; parity report and architecture overview
      updated for staff-always-on.

## Deferred (deliberately out of scope)

- Overdue equipment loan notifications — no cron job exists; `isOverdue` is display-only.
- Meta/Messenger inbox channel — coded but unprovisioned by design.
- `productions` — spec only (`docs/specs/production-workflow-spec.md`).
- The always-pass Turnstile test key in `wrangler.toml`.
- Staff access to band-context routes (`/band/[slug]/subscription` still 403s non-members) — comp
  and revoke live on `/staff/bands/[id]` instead.
