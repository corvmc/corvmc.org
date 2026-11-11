# NNNN Payments run against a fake gateway

- **Date:** 2026-09-11
- **Status:** Accepted
- **Issue:** [#522](https://github.com/corvmc/corvmc.org/issues/522)

## Context

Every card payment ended in a redirect to `checkout.stripe.com`, which no test can follow. The
e2e suites stopped at the redirect, so nothing tested a completed payment round trip. #522
brought checkout and billing onto the app's own pages, which made the round trip reachable if
something could stand in for Stripe. A developer `.env` in this project had carried a live
restricted key.

## Decision

1. `src/lib/server/finance/gateway/` defines a narrow `PaymentGateway` port, picked member by
   member from Stripe's own SDK types. The real Stripe client satisfies it as is.
2. `fake-gateway.ts` implements the port in memory, with state that lives for the worker
   isolate, so a session created on one request can be completed on the next.
3. `PAYMENTS_DRIVER` selects the driver, and anything other than `stripe` gets the fake.
   Production opts in through `wrangler.toml`.
4. `gateway.contract.spec.ts` runs one suite against both drivers.

## Alternatives rejected

- **Drive Stripe's hosted pages or the Payment Element from tests.** Stripe's guidance is that
  they block automated testing, and recommends simulated objects instead.
- **`stripe-mock`.** It is stateless, so a session created on one request does not exist on the
  next, which every flow here needs.
- **Default to `stripe`.** A mistyped QA step against a live key would move real money.

## Consequences

- E2E covers cart, credits, coupon, session, payment, webhook and the resulting row, with no
  network.
- Stripe.js, wallets and the browser half of a real payment are checked by hand against a
  sandbox key.
- `apiVersion` is pinned in `stripe-gateway.ts` and the fixtures are typed, so shape drift on a
  Stripe upgrade fails `pnpm check`. Behavioural drift has no automated check.
