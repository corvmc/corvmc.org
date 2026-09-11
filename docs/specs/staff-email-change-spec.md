# Staff Email Change — Spec

## Purpose

A member types their email wrong at signup and cannot log in. Today staff have
no way to fix it: the email field on `/staff/users/[id]` is `readonly`, and
`updateUser` explicitly refuses an `email` key in the payload (verified in the
audit — adding one to the POST does nothing). The only recovery is to create a
second account, which orphans the member's reservations, credits, band
memberships and Stripe customer.

This is the most common front-desk correction there is, and it is the one thing
the panel cannot do.

## Why it is not just "make the field editable"

The email address **is** the login credential. `better-auth` matches
`/sign-in/email` against `user.email`, and the deactivation gate in
`src/lib/server/auth.ts` looks the account up the same way. A staff member who
can freely set any user's email can point any account at an address they
control and then use password reset to take it over. Making the field writable
turns the panel into an account-takeover tool for anyone holding `staff` —
which, per the `admin`-vs-`staff` spec, is currently everyone with panel access.

So the change has to be **proposed by staff and confirmed by the mailbox**, not
applied directly.

## Auth layer constraints

- The app uses `better-auth/minimal` (`src/lib/server/auth.ts`) with exactly one
  plugin: `sveltekitCookies`. **The admin plugin is not enabled**, so there is no
  `auth.api.setUserEmail`-style administrative path to lean on, and no built-in
  `changeEmail` flow either.
- Passwords are PBKDF2-SHA-256 via Web Crypto (Workers caps iterations at
  100 000). Nothing in the email change touches the password — the existing
  credential row in `account` is keyed on `userId`, not on the email, so the
  member's password keeps working across the change.
- The `verification` table (better-auth core,
  `src/lib/server/db/schema/authentication.ts:162`) already exists and is the
  natural place to park the pending change token rather than adding a table.
- Transactional email goes out through
  `src/lib/server/notification/` (Postmark). A new template is needed.

## Decisions

- **Two-step: staff proposes, the new mailbox confirms.** Staff enter the
  corrected address; the account's email does not change yet. A signed
  confirmation link goes to the **new** address. Clicking it applies the change.
  Nothing staff can do on their own moves the credential.
- **Notify the old address too, without giving it a veto.** A "your email was
  changed to j••••@example.com by CMC staff" notice goes to the old address at
  the moment the change is applied. For a typo'd signup the old address usually
  does not exist and the notice bounces harmlessly; for a real hijack attempt it
  is the member's early warning. It is a notification, not a confirmation step —
  requiring the old mailbox to approve would defeat the entire purpose, since
  the old address is exactly the one that does not work.
- **The token is short-lived and single-use.** 24 hours, consumed on first
  successful use, and invalidated if a second pending change is created for the
  same user. Unlike the unsubscribe token (deliberately eternal, unsigned
  expiry), this one grants account access and must expire.
- **The confirmation endpoint must be a POST.** Same defect as
  `getUnsubscribeInfo` before it was split: a mail client prefetching the link
  must not apply the change. The landing page is a `query` that validates and
  displays; a `form` applies it.
- **Sessions are cleared on apply.** Same reasoning as `deactivateUser`, which
  already deletes `session` rows: after the login identity changes, existing
  sessions should be re-established.
- **Uniqueness is checked twice** — when staff propose (fast feedback) and again
  when the token is redeemed (the address may have been taken in between). The
  second check is the authoritative one.
- **Audited.** `user.email_change_requested` and `user.email_changed` entries,
  per the audit-log spec. This is precisely the action that needs a name
  attached to it.

## Workflows

### 1. The typo (the 95% case)

1. Member calls: "I can't log in, I think I typed my email wrong."
2. Staff opens `/staff/users/[id]`, clicks **Change email** in the Account Info
   card, enters `jordan@example.com`.
3. Validation: well-formed, not already in use, different from the current one.
4. A `pending_email_change` is created and a confirmation email goes to
   `jordan@example.com`. The card now shows "Pending: jordan@example.com —
   sent 2 min ago" with **Resend** and **Cancel** actions.
5. Member clicks the link, lands on `/confirm-email/[token]`, presses
   **Confirm**. The address is swapped, `emailVerified` is set, sessions are
   cleared, the old address is notified, and the member is sent to `/login`.

### 2. Member changed their real address

Same flow. The old-address notice actually arrives and is expected.

### 3. Staff cancels a mistaken request

Cancel deletes the pending row. No email is sent to either address.

### 4. Token expires or is reused

The landing page renders "This link has expired or has already been used" and
offers nothing else. Staff can issue a fresh request.

### 5. The new address is already an account

Rejected at proposal time with "That address already belongs to another
account." Merging two accounts is explicitly **out of scope** — it is a separate,
much larger piece of work (reservations, credits, bands, Stripe customer).

## Proposed model

Reuse the better-auth `verification` table rather than adding one. Its shape
(`identifier`, `value`, `expiresAt`) fits:

- `identifier` = `email-change:{userId}`
- `value` = the proposed address
- `expiresAt` = now + 24h

The token handed to the user is a signed HMAC over `{userId}:{newEmail}`,
mirroring `src/lib/server/marketing/unsubscribe.ts` — that module is the house
pattern for signed one-shot links and should be generalised rather than copied.
Verification requires both a valid signature **and** a live `verification` row,
so cancelling a request genuinely revokes the link even though the token itself
is stateless.

Service: `src/lib/server/user/email-change-service.ts`

```ts
// mutations
requestEmailChange(userId, newEmail, actor): Promise<{ sentTo: string }>
cancelEmailChange(userId): Promise<void>
confirmEmailChange(token): Promise<{ userId: string }>
// query
getPendingEmailChange(userId): Promise<PendingEmailChange | null>
```

Remote functions in `src/lib/remote/users.remote.ts`, all four behind
`requireStaff()` except `confirmEmailChange`, which is authenticated by the
token alone (the member confirming is, by definition, locked out).

## UI

- **Account Info card** gains a **Change email** `Action` (form-modal mode) next
  to the read-only email field. The field itself stays `readonly` — there is no
  path where typing into it saves.
- Pending state renders inline under the field with Resend / Cancel.
- **`/confirm-email/[token]`** is a new public route: a `query` that validates
  and shows "Confirm jordan@example.com as the login for this account?", and a
  `Form` + `SubmitButton` that applies it. Same shape as the corrected
  unsubscribe page.
- All of it uses `Form`/`FormField`/`SubmitButton` per CLAUDE.md.

## Open questions

1. **Should a member be able to do this themselves?** The same machinery would
   serve a self-service email change from `/member/profile`, which is arguably
   where it belongs; the staff path is the recovery case. Building both at once
   is more code but avoids a second design pass. Recommend: build the service to
   be actor-agnostic, ship the staff UI first.
2. **Rate limiting.** Resend is a mail-sending endpoint that staff can trigger
   at will. Needs a cooldown (60 s?) and a cap per user per day. What enforces
   it — the service, or Turnstile-style middleware?
3. **Does the Stripe customer email need updating too?** The user row carries
   `stripeId`; Stripe holds its own copy of the email for receipts. If they
   diverge, receipts keep going to the dead address. Probably yes, best-effort
   and non-fatal, matching how `deactivateUser` treats subscription
   cancellation.
4. **What about accounts with no working mailbox at all?** A member whose
   address was typed wrong _and_ who cannot receive at the corrected one (wrong
   domain entirely, mailbox closed) still cannot be recovered. Is an
   in-person-verified override needed, and if so what stops it being the
   takeover path this design exists to prevent?
5. **`emailVerified` semantics.** ~~Setting it true on confirm is right for the
   new address, but the account may have been unverified before. Does confirming
   an email change also imply the member has completed onboarding gates keyed on
   `emailVerified`?~~ Settled by #757: nothing is gated on `emailVerified`. It
   governs one thing — whether an unclaimed `subscriber` row under the address
   may be claimed — so setting it true on confirm carries exactly that meaning
   and no onboarding gate rides along.
6. **Generalising the token helper.** `unsubscribe.ts` should probably become a
   shared `signed-token.ts` with a purpose/expiry parameter before this adds a
   second near-copy of it.
