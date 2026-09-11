# Member Portal & Membership Page

A member-facing portal at `/member/` with a sustaining membership page as the first route. The membership page explains what sustaining membership is, shows benefits and community impact stats, and lets members create, modify, or cancel their subscription. Active members see a dashboard with their credit balance, contribution details, the card on file and their billing history.

> **Superseded, 2026-09.** The Stripe Customer Portal this spec leaned on is gone; the in-house checkout work replaced it. Payment methods, invoice history and cancelling are all in-app now. The sections below are annotated where they no longer describe the code.

No new domain models. This feature is a UI layer over the existing `subscription-service`, `credit-service`, and `credit_transaction` ledger.

---

## Route structure

```
src/routes/member/
├── +layout.server.ts       ← auth gate: redirect to /demo/login if no user
├── +layout.svelte          ← sidebar + topbar (mirrors staff layout)
└── membership/
    ├── +page.server.ts     ← load function + form actions
    └── +page.svelte        ← membership page
```

The member layout follows the staff layout pattern: check `event.locals.user`, redirect if missing. No role check — any authenticated user can access `/member/`. The sidebar starts with a single "Membership" item and is extensible for future pages.

---

## Page data

The load function in `+page.server.ts` returns:

```typescript
interface MembershipPageData {
	subscription: SubscriptionInfo | null;
	credits: Credits;
	communityStats: {
		sustainingMemberCount: number;
		totalFreeHoursAllocated: number;
		participationPercent: number;
	};
}
```

### Subscription

From `getSubscription(user.stripeId)`. Returns null when no active subscription exists.

### Credits

From `getAllBalances(user.id)`. Returns `{ free_hours, equipment_credits }`.

### Billing details — no longer part of this payload

The billing portal URL used to be generated here, inside the same `Promise.all` as everything else, which made a convenience link load-bearing: a Stripe outage or a customer deleted from the dashboard took the whole page down for every sustaining member.

The card on file and the invoice history that replaced it are `getBilling()` in `src/lib/remote/billing.remote.ts`, loaded beside this query behind its own `<svelte:boundary>`. Nothing in `getMemberMembership` talks to Stripe any more.

### Community stats

Cached in-memory with a 24-hour TTL. These are approximate vanity stats — freshness doesn't matter, just ballpark accuracy.

A module-level `getCommunityStats()` function in `src/lib/server/finance/community-stats.ts` holds the cached value and its expiry timestamp. On first call (or after expiry), it runs the queries and caches the result. All page loads within the TTL window share the same cached value.

```typescript
let cached: { stats: CommunityStats; expiresAt: number } | null = null;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function getCommunityStats(): Promise<CommunityStats> {
	if (cached && Date.now() < cached.expiresAt) return cached.stats;
	const stats = await queryStats();
	cached = { stats, expiresAt: Date.now() + TTL_MS };
	return stats;
}
```

The underlying queries:

- **sustainingMemberCount** — count of distinct users with a `credit_transaction` where `source = 'monthly_allocation'` and `created_at` is within the current month. This counts users who received an allocation this billing cycle, which is a reliable proxy for "active sustaining member" without querying Stripe.

- **totalFreeHoursAllocated** — sum of `amount` from `credit_transaction` where `credit_type = 'free_hours'` and `source = 'monthly_allocation'` and `created_at` is within the current month. This is the total hours allocated this month across all sustaining members.

- **participationPercent** — `sustainingMemberCount / totalActiveUsers * 100`, where `totalActiveUsers` is the count of users where `deletedAt` is null.

These queries hit the `credit_transaction` table (indexed on `user_id` and `user_id, credit_type`) with a `created_at` filter. They run at most once per day.

---

## Form actions

Four form actions on the page server, all requiring an authenticated user with a `stripeId`:

### createSubscription

Creates a new subscription checkout session and redirects to Stripe.

```
Input:  { quantity: number, coverFees: boolean }
Guard:  quantity >= 2 (minimum $10/month at $5/unit)
Action: createCheckoutSession({ userId, stripeCustomerId, quantity, coverFees, successUrl, cancelUrl })
Result: redirect(303, checkoutUrl)
```

`successUrl` and `cancelUrl` both point to `/member/membership`.

### updateAmount

Modifies the contribution quantity on an existing subscription.

```
Input:  { quantity: number, coverFees: boolean }
Guard:  quantity >= 2
Action: updateQuantity(stripeCustomerId, quantity, coverFees)
Result: return { success: true } (page reloads via invalidation)
```

### resumeSubscription

Reverses a pending cancellation.

```
Input:  (none)
Guard:  subscription exists with cancelAtPeriodEnd === true
Action: resume(stripeCustomerId)
Result: return { success: true }
```

### cancel

`cancelSubscription` in `membership.remote.ts`, a confirm-and-submit `Action` on the contribution card. Sets `cancel_at_period_end` — the member has paid for the month and their free hours are allocated against it. Our `customer.subscription.deleted` webhook handles the downstream credit reset.

Originally this was the Stripe Customer Portal's job, which is why `subscription-service.cancel()` sat exported with no caller for so long.

---

## Page states

The page has three visual modes based on subscription status:

### 1. Non-member (no subscription)

Full marketing page. Sections in order:

1. **Hero** — headline, subtext, "Become a Sustaining Member" CTA button
2. **Benefits grid** — three-column layout (Practice Space, Equipment, Community)
3. **Sliding scale** — explains $5 = 1 hour, shows tier examples, "why sliding scale" callout
4. **Community impact** — three stat counters
5. **FAQ** — collapsible questions
6. **Bottom CTA** — repeat of the sign-up prompt with member count social proof

### 2. Cancelled-but-active (subscription with `cancelAtPeriodEnd: true`)

Banner at the top showing:

- "Your benefits continue until [currentPeriodEnd date]"
- Resume button + Manage Billing link
- Current contribution amount and remaining hours

Below the banner, the same marketing content as non-member (to remind them what they'll lose).

### 3. Active sustaining member

Dashboard view. Sections in order:

1. **Hero** — thank-you message
2. **Contribution card** — current amount/month, fee coverage indicator, next billing date, inline modify form, Manage Billing link
3. **Credit balance card** — three stat boxes (Total Hours / Remaining / Used), refresh date, feature list (recurring reservations, priority booking)
4. **Benefits grid** — two-column (Equipment Access, Community Perks) — more compact than the non-member version since they already have the benefits
5. **Community impact** — same three stat counters

---

## Subscription form

Shared between the "create" and "modify" flows. Renders inline on the page (not a modal).

Fields:

- **Contribution amount** — input in dollars, minimum $10, step $5. Displays the equivalent free hours as the user types (`$X/month = Y free hours`). The form converts dollars to quantity units by dividing by 5 before submitting.
- **Cover processing fees** — checkbox. Shows the calculated fee amount when checked (from `calculateTotalWithFeeCoverage`). Copy: "Cover processing fees so the Collective receives 100% of your contribution"

For the "create" flow, the submit button says "Start Contributing" and triggers the `createSubscription` action. For the "modify" flow, the button says "Update Amount" and triggers `updateAmount`.

---

## Copy

### Hero (non-member)

**Headline:** Play More. Pay Less. Keep the Collective Going.

**Subtext:** Sustaining members chip in monthly and get free practice hours, gear perks, and half-price events. You set the amount — we keep the lights on and the amps warm.

### Hero (active member)

**Headline:** You're Part of What Makes This Work

**Subtext:** Your monthly contribution keeps the practice rooms open, the gear library stocked, and the community humming. Here's where things stand.

### Benefits grid (non-member — three columns)

**Practice Time**

For every $5 you put in each month, you get an hour of free practice time. Set up recurring reservations so your favorite slot is always waiting, and jump the line when last-minute openings pop up.

**Gear Library**

The Collective has a whole library of gear you can borrow. Sustaining members get free accessory rentals (cables, stands, the stuff you always forget), monthly equipment credits that match your contribution, and better rates on the bigger stuff.

**Shows & Community**

Half-price tickets to every Collective event and show, first dibs on workshops, and the satisfaction of knowing you're helping keep independent music going in Corvallis.

### Benefits grid (active member — two columns)

**Gear Library**

- Free accessory rentals — cables, stands, mic clips, all the essentials
- Monthly equipment credits that match your contribution
- Better rates on premium gear

**Shows & Community**

- Half-price tickets to every Collective event and show
- First dibs on workshops and special events
- You're directly keeping music happening in Corvallis

### Sliding scale

**Headline:** Pick What Works for You

**Subtext:** There's no wrong number here. Every dollar goes to the Collective, and every $5 earns you another hour of practice time.

**Tiers:**

| Amount    | Hours         |
| --------- | ------------- |
| $10/month | 2 free hours  |
| $25/month | 5 free hours  |
| $50/month | 10 free hours |
| $60/month | 12 free hours |

**"Why sliding scale?" callout:**

Music shouldn't be gated by budget. Every tier gets the same benefits — the only difference is how many practice hours you walk away with. Contribute what feels right.

**Footer note:** Change or cancel anytime. No commitments, no awkward conversations.

### Cancelled banner

**Text:** Your sustaining membership has been cancelled, but your benefits — including [N] free practice hours — are still active until **[date]**. You can pick it back up anytime before then.

### Community impact

**Headline:** What We're Building Together

**Stat labels:**

- **[N] Sustaining Members** — showing up for the Collective every month
- **[N] Free Hours** — of practice time funded this month
- **[N]% of Members** — chipping in to keep things running

### FAQ

Six collapsible items:

1. **How do free practice hours work?** — For every $5 you contribute, you get one free hour each month. They show up automatically when your billing cycle renews and refresh monthly. Heads up — unused hours don't roll over, so use them while you've got them.

2. **Can I change my contribution amount?** — Anytime. Adjust it right here on this page. The new amount kicks in at your next billing cycle, and your hours adjust to match.

3. **What happens if I cancel?** — Nothing dramatic. You keep all your benefits until the end of your current billing period. After that, you're still a member — you just book practice space at the standard rate. And you can always come back.

4. **Can I use my hours for band rehearsals?** — That's the idea. Solo practice, band rehearsals, recording sessions — if you're the one making the reservation, your hours are good for it.

5. **What are recurring reservations?** — A sustaining member perk. Set up a weekly reservation and the same slot books automatically. Especially handy if your band has a regular practice night.

6. **How do equipment credits work?** — They match your contribution dollar for dollar — $25/month gets you $25 in equipment credits. Use them on premium gear rentals. The smaller stuff (cables, stands, mic clips) is free for all sustaining members.

### Bottom CTA (non-member only)

**Headline:** Sounds Good?

**Text:** [N] members are already in. Your contribution — whatever the amount — keeps the spaces open, the gear available, and the music going.

**Button:** Become a Sustaining Member

**Footer:** Cancel anytime. Seriously.

---

## Component breakdown

All components live in `src/lib/components/member/membership/`:

- **MembershipHero.svelte** — heading, subtext, optional CTA button. Props: `variant: 'marketing' | 'dashboard'`, optional `onAction` for the CTA.
- **ContributionCard.svelte** — current amount, fee coverage badge, next billing date, inline modify form, cancel action. Props: `subscription: SubscriptionInfo`, `updateRemote`, `cancelAction`.
- **CreditBalanceCard.svelte** — three stat boxes (total/remaining/used hours), refresh date, feature checklist. Props: `credits: Credits`, `subscription: SubscriptionInfo`.
- **BenefitsGrid.svelte** — benefit columns. Props: `variant: 'full' | 'compact'` (three-column for non-members, two-column for active members).
- **SlidingScale.svelte** — tier table, "why sliding scale" callout, footer note. No props (static content).
- **CommunityImpact.svelte** — three stat counters. Props: `stats: CommunityStats`.
- **MembershipFAQ.svelte** — collapsible details elements. No props (static content).
- **SubscriptionForm.svelte** — quantity input (in dollars), fee coverage checkbox, fee preview, submit button. Props: `mode: 'create' | 'modify'`, `currentQuantity?: number`, `currentCoverFees?: boolean`.
- **CancelledBanner.svelte** — warning banner with resume button. Props: `subscription: SubscriptionInfo`, `resumeAction`.
- **PaymentMethodsCard.svelte** — the cards on file, which one is billed, add/make-default/remove. Props: `cards: SavedCard[]`, `available: boolean`, `driver`.
- **AddCardModal.svelte** / **SetupElement.svelte** — a SetupIntent confirmed by Stripe's Payment Element under the `stripe` driver, and a card-number form under `fake`.
- **InvoiceHistoryCard.svelte** — every charge with its hosted receipt and PDF. Props: `invoices: BillingInvoice[]`, `available: boolean`.

---

## "Used this month" calculation

The credit balance card shows "Hours Used" this month. This is calculated as:

```
usedThisMonth = totalAllocatedThisMonth - currentBalance
```

Where `totalAllocatedThisMonth` comes from the most recent `credit_transaction` with `source = 'monthly_allocation'` and `credit_type = 'free_hours'` for this user (the `amount` field on that row is the monthly allocation). `currentBalance` is `credits.free_hours` from `getAllBalances()`.

This calculation is done in the load function, not in a component.

---

## Member layout

### Auth gate (`+layout.server.ts`)

```typescript
export const load: LayoutServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) redirect(302, '/demo/login');
	return { user };
};
```

No role check — any authenticated user can see the member portal.

### Layout component (`+layout.svelte`)

Mirrors the staff layout: daisyUI drawer with `Sidebar` and `Topbar` components. The sidebar nav items start with:

```typescript
const navItems = [{ href: '/member/membership', label: 'Membership', icon: starIcon }];
```

Reuses the existing `Sidebar`, `Topbar`, and `UserFooter` components from `$lib/components/staff/`. If those components have staff-specific assumptions (colors, titles), they should be parameterized. Otherwise they can be used directly.

---

## What changes

| Area       | Change                                                                  |
| ---------- | ----------------------------------------------------------------------- |
| Routes     | New `/member/` route group with layout and membership page              |
| Components | New `member/membership/` component directory                            |
| Stripe     | Setup intents, payment methods and invoice list, from `billing-service` |
| DB queries | New community stats aggregation queries against `credit_transaction`    |

## What doesn't change

| Area                      | Notes                                                            |
| ------------------------- | ---------------------------------------------------------------- |
| subscription-service      | Used as-is — no changes to the API                               |
| credit-service            | Used as-is — `getAllBalances()` and `getBalance()` already exist |
| payment-service           | Used as-is — `checkout()` called via subscription-service        |
| webhook handlers          | No changes — existing handlers cover the subscription lifecycle  |
| credit_transaction schema | No schema changes — queries use existing columns and indexes     |
| Staff portal              | No changes to existing staff routes or layout                    |

## Deferred

- ~~**Payment history page**~~ — shipped as `InvoiceHistoryCard` when the portal was replaced.
- **Equipment credits display** — the credit balance card focuses on free hours. Equipment credits are a future addition when the equipment module is built.
- **Notification on subscription events** — email confirmations for subscription create/cancel/resume. Deferred until the notification system is in place.
- **Additional member portal pages** — reservations dashboard, band management, profile settings. The member layout is built to support these but they're separate features.

## Open questions

None. The backend services are complete and the UI is a presentation layer. The Stripe Customer Portal that this spec deferred the hard billing flows to has since been replaced in-app — see the annotations above.
