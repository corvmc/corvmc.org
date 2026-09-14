-- Backfill `financial_entry` from what the local tables already record.
--
--   wrangler d1 execute corvmc-db --local  --file=scripts/db/backfill/financial-entries.sql
--   wrangler d1 execute corvmc-db --remote --file=scripts/db/backfill/financial-entries.sql
--
-- Phase 3 of docs/specs/financial-record-spec.md. Run AFTER the phase-2 write
-- paths are deployed, which is the ordering the spec gives: a backfill written
-- before the writers settle gets written twice.
--
-- D1 has no transactions, so idempotence is the safety property. Every insert
-- is guarded on `NOT EXISTS` against the subject it describes, so a second run
-- is a no-op. `financial-entries.spec.ts` asserts that.
--
-- Every row is tagged `metadata.backfilled`. These reconstruct what was
-- *intended* from local columns, which know nothing of disputes or partial
-- refunds — per the spec, historical figures here orient rather than attest,
-- and the Stripe baseline per period is what says by how much they are off.
--
-- ONE CONSTANT TO CHECK BEFORE RUNNING: 750, the cents a single credit is
-- worth. A credit is 30 minutes (`MINUTES_PER_CREDIT`), so it is half the
-- hourly rate — 750 at the $15/hr the site config defaults to. The rate lives
-- in KV rather than in D1, so this file cannot read it, and it is written out
-- here rather than hidden in an expression. **If the hourly rate has ever been
-- something other than $15, this number is wrong and so is every credit row
-- below.**

-- ---------------------------------------------------------------------------
-- Ticket sales — deliberately NOT reconstructed here
-- ---------------------------------------------------------------------------
-- Checked against production before this file was ever run: all 35 valid
-- tickets across 28 purchases have `unit_price_cents`, `contribution_cents`,
-- `acts_cents` and `collective_cents` at zero. No ticket has ever carried a
-- split. Those columns arrived with the sliding scale on 2026-09-10 and
-- nothing has sold since.
--
-- Reconstructing from them would write 28 rows of $0, which the spec's "a free
-- sale still writes a $0 entry" rule makes look deliberate — a priced show
-- would be permanently indistinguishable from a free one. Absent beats wrong
-- wearing the costume of a rule.
--
-- Ticket history has to come from Stripe, where the money actually is:
-- $10,272.86 gross across 334 charges since Dec 2024. Two facts the
-- reconstruction will need, both confirmed by the collective:
--
--   * the split has only ever been 30% collective / 70% acts
--   * the hourly rate has only ever been $15
--
-- That makes the Stripe baseline the *primary source* for ticket history
-- rather than a cross-check on it — see #825 phase 3.

-- ---------------------------------------------------------------------------
-- Reservations — the cash half only
-- ---------------------------------------------------------------------------
-- Both halves. `cash_due_cents` is what was owed after credits and is stored
-- exactly; the credit half is `credits_used` valued at the constant above.
--
-- Valuing credits at today's rate is only sound because the rate has never
-- moved. It is not stored per reservation, so if it ever does move, a later
-- re-run cannot tell the eras apart — which is the argument for recording the
-- rate on the reservation before that happens.

INSERT INTO financial_entry (
	id, amount_cents, kind, category, occurred_at, settlement,
	stripe_payment_record_id, subject_type, subject_id, user_id, description, metadata, created_at
)
SELECT
	lower(hex(randomblob(16))),
	r.cash_due_cents,
	'earned', 'reservation',
	COALESCE(r.paid_at, r.starts_at),
	CASE WHEN r.stripe_payment_record_id IS NULL THEN 'cash' ELSE 'stripe' END,
	r.stripe_payment_record_id,
	'reservation', r.id, r.created_by_user_id,
	'Practice room (backfilled)',
	json_object('backfilled', json('true'), 'creditsUsed', COALESCE(r.credits_used, 0)),
	unixepoch()
FROM reservation r
WHERE r.status IN ('confirmed', 'completed')
  AND COALESCE(r.cash_due_cents, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM financial_entry e
     WHERE e.subject_type = 'reservation' AND e.subject_id = r.id
  );

-- The credit half, as its own row and its own settlement. `stripeSettledCents`
-- sums what cleared, so merging these into the cash figure would make the
-- ledger permanently unreconcilable against Stripe.
INSERT INTO financial_entry (
	id, amount_cents, kind, category, occurred_at, settlement,
	subject_type, subject_id, user_id, description, metadata, created_at
)
SELECT
	lower(hex(randomblob(16))),
	CAST(ROUND(r.credits_used * 750) AS INTEGER),
	'earned', 'reservation',
	COALESCE(r.paid_at, r.starts_at),
	'credit',
	'reservation', r.id || ':credit', r.created_by_user_id,
	'Practice room, settled with credits (backfilled)',
	json_object('backfilled', json('true'), 'creditsUsed', r.credits_used, 'creditValueCents', 750),
	unixepoch()
FROM reservation r
WHERE r.status IN ('confirmed', 'completed')
  AND COALESCE(r.credits_used, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM financial_entry e
     WHERE e.subject_type = 'reservation' AND e.subject_id = r.id || ':credit'
  );

-- ---------------------------------------------------------------------------
-- Donated acquisitions
-- ---------------------------------------------------------------------------
-- Gifts in kind already carrying a fair value. One valued at zero is a gift
-- nobody has priced yet, and writing a $0 in-kind row would assert it is
-- worthless rather than unvalued.

INSERT INTO financial_entry (
	id, amount_cents, kind, category, occurred_at, settlement,
	subject_type, subject_id, user_id, description, metadata, created_at
)
SELECT
	lower(hex(randomblob(16))),
	a.fair_value_cents,
	'in_kind', 'donation',
	a.occurred_at,
	'none',
	'acquisition', a.id, a.donor_user_id,
	'Gift in kind (backfilled)',
	json_object('backfilled', json('true')),
	unixepoch()
FROM acquisition a
WHERE a.kind = 'donation'
  AND COALESCE(a.fair_value_cents, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM financial_entry e
     WHERE e.subject_type = 'acquisition' AND e.subject_id = a.id
  );
