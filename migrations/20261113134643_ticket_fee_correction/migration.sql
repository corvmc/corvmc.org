-- #2731: a collective ticket's rows took the card fee twice. The ledger is
-- append-only (decision 0016), so each short payment gets correcting rows,
-- dated now so no reported month changes. Only a payment short by exactly its
-- one fee row qualifies, which also makes a second run write nothing.
INSERT INTO financial_entry (id, amount_cents, kind, category, occurred_at, settlement,
	stripe_payment_record_id, settlement_group, subject_type, subject_id, project_id, user_id,
	description, metadata, created_at)
WITH pay AS (
	SELECT e.subject_id, e.stripe_payment_record_id,
		max(e.project_id) AS project_id, max(e.user_id) AS user_id,
		sum(e.amount_cents) AS ledger,
		-sum(CASE WHEN e.category = 'card_fees' THEN e.amount_cents ELSE 0 END) AS fee,
		sum(CASE WHEN e.category = 'card_fees' THEN 1 ELSE 0 END) AS fee_rows,
		sum(CASE WHEN e.category = 'fee_coverage' THEN e.amount_cents ELSE 0 END) AS covered_rows,
		sum(CASE WHEN e.category = 'band_ticket_sales'
			OR json_extract(e.metadata, '$.reversalOf') IS NOT NULL
			OR json_extract(e.metadata, '$.correction') IS NOT NULL THEN 1 ELSE 0 END) AS skip
	FROM financial_entry e
	WHERE e.subject_type = 'ticket' AND e.settlement = 'stripe' AND e.kind <> 'in_kind'
	GROUP BY e.subject_id, e.stripe_payment_record_id
),
bought AS (
	SELECT purchase_id,
		sum(coalesce(unit_price_cents, 0)) + sum(contribution_cents) + sum(fee_covered_cents) AS charge,
		sum(fee_covered_cents) AS covered
	FROM ticket GROUP BY purchase_id
),
short AS (
	SELECT pay.*, bought.covered,
		min(pay.fee, max(0, bought.covered - pay.covered_rows)) AS to_coverage
	FROM pay JOIN bought ON bought.purchase_id = pay.subject_id
	WHERE pay.skip = 0 AND pay.fee_rows = 1 AND pay.fee > 0
		AND bought.charge - pay.fee - pay.ledger = pay.fee
)
SELECT lower(hex(randomblob(16))), to_coverage, 'earned', 'fee_coverage', unixepoch(), 'stripe',
	stripe_payment_record_id, NULL, 'ticket', subject_id, project_id, user_id,
	'Correction: buyer covered card processing',
	json_object('correction', 2731), unixepoch()
FROM short WHERE to_coverage > 0
UNION ALL
SELECT lower(hex(randomblob(16))), fee - to_coverage, 'earned', 'ticket_sales', unixepoch(), 'stripe',
	stripe_payment_record_id, NULL, 'ticket', subject_id, project_id, user_id,
	'Correction: card fee counted twice',
	json_object('correction', 2731), unixepoch()
FROM short WHERE fee - to_coverage > 0;
