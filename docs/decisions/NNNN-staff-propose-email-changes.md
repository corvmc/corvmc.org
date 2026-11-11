# NNNN Staff propose a login email change and the new mailbox confirms it

- **Date:** 2026-08-03
- **Status:** Accepted
- **Issue:** [#820](https://github.com/corvmc/corvmc.org/issues/820)

## Context

A member who mistyped their address at signup could not sign in, and staff could not correct it:
the email field on the member's record was read-only and `updateUser` ignored an `email` key. The
only recovery was a second account, which left reservations, credits, bands and the Stripe
customer on the first. The email address is the login credential. Staff who could set it directly
could point any account at a mailbox they control and reset its password from there.

## Decision

1. **Staff propose; the new mailbox confirms.** The address does not change until someone clicks
   the link sent to the new address and submits the confirmation.
2. **The old address is told, and has no veto.** For a mistyped signup it is the address that
   does not work. Reversing a change is staff proposing the old address again.
3. **The link expires after 24 hours and works only while its pending request exists.**
   Cancelling or replacing the request revokes it.
4. **Confirming is a POST.** The landing page only reads, so a mail client prefetching the link
   changes nothing.
5. **Every session is signed out on confirm.** The password is untouched.
6. **Uniqueness is checked twice**: when staff propose, and again on confirm.
7. **The pending request lives in better-auth's `verification` table**, not a new table.
8. **Guarded by its own capability, `user.setEmail`**, and audited at both steps.

## Alternatives rejected

- **Make the field editable.** Turns the panel into an account-takeover tool for anyone with
  panel access.
- **Require the old mailbox to approve.** The old address is usually the one that does not work.
- **A GET link that applies the change.** A mail scanner or prefetch would apply it.
- **better-auth's admin plugin.** The app runs `better-auth/minimal` and does not enable it.

## Consequences

- A member who cannot receive mail at either address cannot be recovered through the app.
- Merging two existing accounts is a separate problem; a proposal to an address already in use
  is refused.
- A resend spends one of five daily sends per member.
