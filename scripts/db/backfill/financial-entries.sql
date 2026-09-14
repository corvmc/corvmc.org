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

-- ---------------------------------------------------------------------------
-- Ticket sales
-- ---------------------------------------------------------------------------
-- Three columns, three rows, exactly as a live sale writes them. Only `valid`
-- and `checked_in` count: a `pending` ticket never completed and a `cancelled`
-- one was refunded, which a reversal covers rather than a sale.
--
-- Grouped by purchase, not by ticket: one sale of three tickets is one
-- transaction, and `subject_id` is the purchase everywhere else.

INSERT INTO financial_entry (
	id, amount_cents, kind, category, occurred_at, settlement,
	stripe_payment_record_id, subject_type, subject_id, user_id, description, metadata, created_at
)
SELECT
	lower(hex(randomblob(16))),
	SUM(t.collective_cents),
	'earned', 'ticket_sales',
	MIN(t.created_at),
	CASE WHEN MAX(t.stripe_payment_record_id) IS NULL THEN 'none' ELSE 'stripe' END,
	MAX(t.stripe_payment_record_id),
	'ticket', t.purchase_id, MAX(t.user_id),
	'Ticket sale (backfilled)',
	json_object('backfilled', json('true'), 'tickets', COUNT(*)),
	unixepoch()
FROM ticket t
WHERE t.status IN ('valid', 'checked_in')
  AND NOT EXISTS (
    SELECT 1 FROM financial_entry e
     WHERE e.subject_type = 'ticket' AND e.subject_id = t.purchase_id
  )
GROUP BY t.purchase_id;

-- The acts' share of the same sales. A pass-through nets to zero within its
-- group, and the out-leg is written when settlement pays the act — which is
-- phase 5's third row and not yet built, so these sit as an open pool
-- deliberately.
INSERT INTO financial_entry (
	id, amount_cents, kind, category, occurred_at, settlement,
	stripe_payment_record_id, settlement_group, subject_type, subject_id, description, metadata, created_at
)
SELECT
	lower(hex(randomblob(16))),
	SUM(t.acts_cents),
	'pass_through', 'act_payout',
	MIN(t.created_at),
	CASE WHEN MAX(t.stripe_payment_record_id) IS NULL THEN 'none' ELSE 'stripe' END,
	MAX(t.stripe_payment_record_id),
	t.event_id,
	'ticket', t.purchase_id || ':acts',
	'Acts'' share (backfilled)',
	json_object('backfilled', json('true')),
	unixepoch()
FROM ticket t
WHERE t.status IN ('valid', 'checked_in')
  AND t.acts_cents > 0
  AND NOT EXISTS (
    SELECT 1 FROM financial_entry e
     WHERE e.subject_type = 'ticket' AND e.subject_id = t.purchase_id || ':acts'
  )
GROUP BY t.purchase_id, t.event_id;

-- ---------------------------------------------------------------------------
-- Reservations — the cash half only
-- ---------------------------------------------------------------------------
-- `cash_due_cents` is what was owed after credits and is stored exactly.
--
-- The credit half is deliberately NOT reconstructed. `credits_used` is in
-- credit units — 30-minute blocks — and the hourly rate that valued them is
-- not stored per reservation, so any figure here would be today's rate applied
-- to last year's booking. Wrong silently is worse than absent, and the gap is
-- visible: a backfilled reservation shows its cash and nothing else.

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
