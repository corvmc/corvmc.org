# Notification digest

Status: ✅ Bell and cron

The bell holds low-urgency notices and shows one daily summary row listing them, written from 9am club time by `/api/cron/reminders`; each notification type declares `immediate`, `digest` or `digestIfLater` (digest only when the event is more than 24 hours out). Band invitations and band enquiries stay immediate, email is unchanged, and the bell stream closes while the tab is hidden (#3409, #3419).
