# #1186 — reminder registry

One job drains a registry of reminder definitions; a sent-mark replaces the
cadence arguments. Design and the rejected alternative: issue #1186.

- [x] `reminder_sent` table + migration
- [x] `src/lib/server/reminders/registry.ts` — the five definitions
- [x] `src/lib/server/reminders/drain.ts` — due → unmarked → emit → mark
- [x] `/api/cron/reminders` on the 15-minute tick
- [x] Migrate: confirmation (window_open + final), reservation reminder,
      shift reminder, shift feedback
- [x] Delete the four route files, their `schedule.ts` entries, `ALL_ENDPOINTS`
- [x] Specs: drain idempotency, each definition's window

**Windows are kept exactly as they are.** The mark makes them belt-and-braces
rather than load-bearing, but widening one would fire a backlog of real email
at real members on the first run. Widening is a separate decision per
definition.

Landed in the PR for #1186. Not converted, deliberately: `complete-shifts`
mutates state rather than notifying, and `send-campaigns` sends a staff-composed
blast with no anchor to derive a time from.
