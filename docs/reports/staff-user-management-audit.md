# Staff Panel — User Management Audit

**Date:** 2026-08-02
**Scope:** `/staff/users`, `/staff/users/[id]`, `src/lib/remote/users.remote.ts`, `src/lib/server/user/user-service.ts`
**Method:** Played a practice space manager through the user-management workflows against a
worktree-local dev server (seeded D1, dummy Stripe key), plus direct calls to the remote
endpoints to check what the UI doesn't reach.

Two defects here caused **silent data loss or privilege escalation** and are fixed in this
change. The rest are recorded as follow-ups.

---

## Fixed in this change

### 1. Unauthenticated privilege escalation and PII disclosure — _critical_

`getUser`, `getAllRoles`, `getUserPayments`, `getUserCredits` and `updateUser` had no
authorization check. Remote functions are directly addressable endpoints, and SvelteKit
dispatches them **before** any route or layout load runs (`respond.js` reaches
`handle_remote_call` with the page's load functions skipped). There is no `+layout.server.ts`
under `/staff`, so nothing else stood in front of them.

`updateUser` also took its target from `params.id`. For a remote call SvelteKit derives params
from the caller-supplied `x-sveltekit-pathname` header, so the target was fully attacker-chosen
— and since the handler rewrites `model_has_roles` wholesale, **any caller could grant
themselves `admin`**.

Reproduced live against the pre-fix code with no session at all:

```
GET /_app/remote/<hash>/getUser?payload=…
→ 200  {"id":…,"name":"…","email":"…","phone":…,"stripeId":…}

GET /_app/remote/<hash>/getUserPayments?payload=…
→ 200  [{"userEmail":"…","amountCents":…,"paymentMethod":…}, …]
```

**Fix:** `await requireStaff()` on all five; `updateUser` now takes a validated `id` field
(matching `deactivateUser`/`reactivateUser`/`purgeUser`) instead of trusting `params`.
Verified post-fix: all five return 401 anonymous, 403 for a signed-in non-staff member, and a
member posting `roles=["admin"]` at their own id is rejected.

Regression tests: `src/lib/remote/users.remote.spec.ts`.

**Rule this establishes:** a remote function is only as guarded as its own first line. Route
and layout guards do not protect it.

### 2. Every profile save silently deleted the user's roles — _critical_

`FormField` destructures `value` into its own prop, so it was not part of `...rest`, and the
`type="tags"` branch never forwarded it to `TagInput`. The Roles field therefore always
rendered empty and its hidden input always serialised `[]` — regardless of the user's actual
roles. Because `updateUser` replaces the whole role set, **correcting a phone number stripped
every role from that member**, including `staff` and `admin`.

Reproduced end to end: a member holding `member` had a phone edit saved through the real form
payload; afterwards `phone` was updated and their role count had gone 1 → 0.

**Fix:** forward `value` in the tags branch of `FormField.svelte`. Verified the field now
pre-fills (`member`, `staff` chips render) and a save preserves roles.
Regression tests in `FormField.svelte.spec.ts`. This was the only `type="tags"` call site, so
the blast radius was exactly this page — which is why it went unnoticed.

_Note:_ this is the second instance of this bug shape in this component — an existing test
covers "`field` + `value` both provided, value dropped". Worth a look at whether `FormField`
should forward `value` uniformly rather than per-branch.

### 3. Nothing prevented locking yourself (or everyone) out of the panel

Role editing let a staff member remove their own `staff`/`admin` role, and let the last `admin`
be demoted — unrecoverable from the UI in both cases.

**Fix:** `updateUser` refuses both, with specific messages. Verified live: self-demotion → 400
"You cannot remove your own staff access"; a staff user demoting the sole remaining admin → 409
"This is the last admin — assign another admin before removing this role."

### 4. "This is reversible" was false — _high_

The Danger Zone said deactivation "is reversible". It is not: `deactivateUser` cancels every
future personal reservation and the Stripe subscription, and `reactivateUser` only clears
`deletedAt`. Verified — a member with 3 confirmed future bookings had all 3 cancelled on
deactivation, and they were **still cancelled** after reactivation.

**Fix:** copy on the detail page, the confirm dialog, and the bulk dialog now state what is
permanent. Restoring the cancelled records is a product decision, left as a follow-up.

### 5. Malformed input returned 500 instead of a validation error

`roles` / `ids` used `.transform((s) => JSON.parse(s))`; a throw inside a zod transform escapes
validation as a 500. Posting `roles=notjson` crashed the endpoint.

**Fix:** new `jsonArrayField()` helper (`src/lib/utils/zod-json.ts`) reports a field issue
instead. Deliberately **no** `.catch([])` — silently coercing malformed roles to `[]` would
recreate defect #2. The same `JSON.parse`-in-transform pattern appears ~10 more times in
`directory.remote.ts` and twice in `band-page-editor.remote.ts`; those are untouched here and
should adopt the helper.

### 6. Over-deducting credits returned 500

`credit-service` correctly throws a typed `InsufficientCreditsError`, but `adjustCredits`
didn't catch it, so a staff member deducting more than the balance got a bare "Internal Error".

**Fix:** mapped to 409 with the real numbers — "Insufficient free_hours: requested 99999,
available 60" — plus a 400 for a non-numeric amount.

### 7. Impersonate was a dead link

The row menu linked to `/staff/users/[id]/impersonate`, which does not exist (verified 404).
Impersonation is explicitly deferred in `docs/specs/shipped/staff-bands-spec.md:206`.

**Fix:** menu item removed. ~~**Still outstanding:** `src/content/help/staff-guide/` documents
impersonation as a working feature (`staff-impersonate.md`, referenced from
`staff-users-overview.md` and `staff-edit-user.md`), and `docs/manual/README.md:133` ticks it
off.~~ **Resolved in the follow-up change:** `staff-impersonate.md` deleted (the help sync
removes orphaned static rows), both references dropped, and the manual entry unticked and
marked blocked.

---

## Guard sweep across all remote files

All 22 `src/lib/remote/*.remote.ts` were scanned for exports with no authorization call
anywhere in the body, then each hit was read.

**`users.remote.ts` was the only file with genuinely missing guards.** The other 28 unguarded
exports are intentionally public and were left alone:

| Group                                                                        | Why it's fine                                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `getPublic*`, gig guide, public calendar, directory profiles, band microsite | Public pages; profile serialisers already scope to public fields                                       |
| `submitContactForm`, `submitBandContactForm`, `subscribeToAudience`          | Turnstile-verified                                                                                     |
| `getUnsubscribeInfo`                                                         | Signed-token verified                                                                                  |
| `getTicketPurchaseSuccess`                                                   | Guest checkout can't require login; `purchaseId` is a `randomUUID` capability token                    |
| `getMemberEvents`, `getMemberSlots`, `previewRecurringInstances`             | Names imply private data but return only public event fields / free-slot availability / pure date math |
| `getSocialLinks`, `getOrgAddress`                                            | Already pinned public by `settings.remote.spec.ts`                                                     |

The four whose names don't self-document now carry a comment saying why they're unguarded, so
the next sweep is cheap.

**Drive-by, outside this scope:** ~~`getUnsubscribeInfo` performs the unsubscribe as a side
effect inside a `query` (a GET). Link-prefetching email clients and security scanners can
unsubscribe someone who never clicked. It should be a `form`/`command`.~~
**Resolved in the follow-up change:** split into a read-only `getUnsubscribeInfo` query and a
`confirmUnsubscribe` form; the page now asks before writing. Regression test:
`src/lib/remote/marketing.remote.spec.ts`.

---

## Behaviour verified as correct

- Search by partial name, partial email, and mixed case; 300 ms debounce; paging resets; "No
  users found" empty state; clearing restores the list.
- Status filter Active / Deactivated / All; deactivated rows show the badge and their
  checkboxes (and the header checkbox) are disabled.
- Pagination at 21 users across 2 pages.
- Row click navigates to the detail page; checkbox and row-menu clicks do not.
- Bulk deactivate: confirm dialog, **acting staff member correctly skipped** ("2 deactivated,
  1 skipped"), list refreshed, selection cleared.
- Deactivation clears sessions, soft-deletes, cancels future personal reservations.
- Purge refuses an active user (409) and a deactivated band owner (409) with clear messages;
  succeeds on a clean deactivated user.
- Field validation for empty/over-long name, pronouns, phone, and bad role ids.
- Email is read-only and cannot be changed by adding an `email` field to the POST.
- Credit adjustments: add, deduct, zero rejected, both credit types, description required.
- Access control at the page level: non-staff member → `/`, anonymous → `/login`.
- Long (190-char) and emoji/accented names don't break layout; mobile viewport scrolls the
  table inside its own container, not the page body.

---

## Follow-ups

### Resolved in the follow-up change (PR: staff audit follow-ups)

5. ~~**Selection persists across pages invisibly.**~~ Selection is now scoped to the rows on
   screen: paging, searching and changing the status filter all clear it, so the "N selected"
   count always matches what the operator can see and verify before confirming. Covered by
   `e2e/staff-users.e2e.ts`.
6. ~~**Dashboard "Permissions" stat is always 0.**~~ Stat dropped; the grid is now 3-up. The
   `permissions` / `model_has_permissions` / `role_has_permissions` tables were **kept** —
   `scripts/migrate-from-postgres.ts` still copies the legacy Laravel grants into them, and
   dropping them would discard rows that exist in Postgres today and cannot be recovered after
   the cutover. `src/lib/server/db/schema/authorization.ts` now says so.
7. ~~**"Deleted" vs "Deactivated" terminology.**~~ The detail page badge and the Details row
   both say _Deactivated_. "Deleted" now appears only on purge, which does delete. `StatusBadge`
   never had a deleted/deactivated variant, so nothing to change there.
8. ~~**Payment Records card disappears when empty.**~~ The card always renders; empty shows an
   `EmptyState`, so it is distinguishable from the `{:catch}` alert.
9. ~~**Detail page grid is half empty.**~~ Dropped to one column.
10. ~~**No staff/admin e2e fixture.**~~ `e2e/fixtures/seed-staff-user.ts` seeds a staff+admin
    operator with a credential account, an edit target holding `member`, and 24 filler members
    so the list paginates. `e2e/staff-users.e2e.ts` covers list access, a profile edit that
    preserves roles (the end-to-end pin for defect #2), and the selection scoping above.

Also resolved: the `getUnsubscribeInfo` drive-by above, the impersonation help content in
defect #7, and the remaining `JSON.parse`-in-transform sites from defect #5 — nine in
`directory.remote.ts` and two in `band-page-editor.remote.ts` now use `jsonArrayField()` /
`jsonObjectField()`. The five save-form sites were the destructive ones: their `catch` returned
`[]`, which erased the member's instruments/genres/links exactly the way defect #2 erased roles.
Regression tests in `src/lib/remote/directory.remote.spec.ts`. The four filter sites returned
`undefined` (non-destructive) and now report a validation issue instead.

### Spec'd, not built

Each of these now has a design doc in `docs/specs/`; none of them are implemented.

1. **No audit trail.** → `docs/specs/audit-log-spec.md`
2. **Email is uneditable.** → `docs/specs/staff-email-change-spec.md`
3. **Reactivation doesn't restore what deactivation destroyed.** →
   `docs/specs/reactivation-restore-spec.md`
4. **User detail lacks the manager's context.** →
   `docs/specs/shipped/staff-user-detail-context-spec.md`
5. **`admin` and `staff` are interchangeable everywhere.** →
   `docs/specs/admin-vs-staff-spec.md`

### Found while writing those specs

- **Help-article `minRole` is an exact membership test, not a hierarchy.**
  `src/lib/server/help/help-service.ts` filters with `inArray(minRole, roles)`, so an article
  marked `minRole: 'staff'` is invisible to a user holding only `admin`. Latent today because
  everyone with panel access holds both; it becomes reachable the moment the `admin`/`staff`
  split lands.

---

## Notes on the test environment

- The shared dev server on `:5173` runs a **different worktree** and was 500ing throughout;
  this audit used a worktree-local server on `:5199`.
- The worktree's `.env` was a **symlink to the main repo's `.env`** — editing it in place would
  have changed the main setup. It was replaced with a local copy (`ORIGIN` → `:5199`, Stripe
  key → a dummy `sk_test`) and **the symlink is restored**; the main `.env` still has its
  original `ORIGIN` and live `rk_live` key.
- `better-auth` requires `ORIGIN` and does _not_ auto-detect it from the request, so a worktree
  server needs its own `ORIGIN`.
- Browser-console errors captured during the run include entries from the audit's own
  deliberate 401/403 probes and from mid-session HMR reloads. A cold-start server serves
  `/staff` and `/staff/users` as 200 and renders clean.
