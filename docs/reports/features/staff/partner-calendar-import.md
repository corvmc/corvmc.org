# Partner calendar import

Status: ✅ On /staff/venues/{id}

Staff add a partner venue's iCalendar feed (`calendar_source`, always a venue's) on that venue's page, and pause, remove or **Fetch now** there. `/api/cron/import-partner-calendars` in the daily batch copies each unpaused feed's next year of timed shows onto the guide as `published` `community` listings at that venue, authored by the staffer who added the feed and keyed on `(import_source_id, import_uid)`. The feed overwrites a listing that is still public and honours `STATUS:CANCELLED`. It never puts back a listing staff pulled, leaves alone a show that vanishes from the feed, and skips a show a band or member already listed at that venue that day. Upholding a report unpublishes an imported listing and costs nobody standing. A failed fetch is written to the feed's row. Parsed with `ical.js`; decisions #2208–#2211. See `docs/decisions/0012-partner-feeds-import-as-community-listings.md`
