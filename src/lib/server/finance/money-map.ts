/**
 * What every money column in the schema means to the financial record.
 *
 * An entry cannot be derived from a column, so the relationship is not
 * automated — the question is. `money-map.spec.ts` walks the schema and fails
 * on any money column missing here. See
 * `docs/development/conventions.md#money-columns-declare-themselves`.
 */

/**
 * `unaccounted` is the point of the three states.
 *
 * Without it every gap becomes a `notAccounting` with a plausible sentence,
 * and the map degrades into the checklist it replaces. A column that moves
 * money and reaches no writer is named as such and carries the issue, so the
 * map doubles as the live gap register.
 */
export type MoneyColumn =
	| { movement: string; writer: string }
	| { notAccounting: string }
	| { unaccounted: string; issue: number };

export const moneyColumns = {
	// The ledger itself.
	'financial_entry.amount_cents': {
		notAccounting: 'the entry, not a source for one'
	},

	// ---------------------------------------------------------------- tickets
	// One movement, five columns. The split is stamped on the purchase's first
	// ticket, which is why summing across a `purchaseId` counts it once.
	'ticket.unit_price_cents': {
		movement: 'ticket_sale',
		writer: 'src/lib/server/finance/checkout-entries-listener.ts'
	},
	'ticket.contribution_cents': {
		movement: 'ticket_sale',
		writer: 'src/lib/server/finance/checkout-entries-listener.ts'
	},
	'ticket.acts_cents': {
		movement: 'ticket_sale',
		writer: 'src/lib/server/finance/checkout-entries-listener.ts'
	},
	'ticket.collective_cents': {
		movement: 'ticket_sale',
		writer: 'src/lib/server/finance/checkout-entries-listener.ts'
	},
	'ticket.fee_covered_cents': {
		movement: 'ticket_sale',
		writer: 'src/lib/server/finance/checkout-entries-listener.ts'
	},
	'event_listing.ticket_price_floor_cents': {
		notAccounting: 'a price the buyer may not go below, not an amount that moved'
	},

	// ----------------------------------------------------------- reservations
	'reservation.cash_due_cents': {
		movement: 'reservation_settled',
		writer: 'src/lib/server/finance/reservation-entries.ts'
	},

	// ------------------------------------------------------------ productions
	// The drawer count at the end of the night. #929 added the column so a
	// settlement including door cash is auditable; it deliberately does not
	// write the ledger rows — the split is derived at read time, and who owes
	// whom what once it is counted is #825's question.
	'production.door_cash_cents': {
		unaccounted: 'counted but never posted — the split is derived, not journalled',
		issue: 825
	},
	'production_slot.guarantee_cents': {
		notAccounting: 'the deal. What was handed over is `paid_cents`'
	},
	'production_slot.paid_cents': {
		movement: 'act_payout',
		writer: 'src/lib/server/finance/payout-entries.ts'
	},
	'production_expense.amount_cents': {
		movement: 'production_expense',
		writer: 'src/lib/server/finance/production-expense-entries.ts'
	},

	// -------------------------------------------------------------- agreement
	'agreement.amount_cents': {
		notAccounting:
			'the amount asked or awarded. The cheque itself is a manual `grant` entry when it arrives'
	},

	// ------------------------------------------------------------- contractor
	'contractor_job.quoted_cents': {
		notAccounting: 'what they said it would cost, before the invoice'
	},
	'contractor_job.cost_cents': {
		movement: 'contractor_job',
		writer: 'src/lib/server/finance/contractor-entries.ts'
	},
	'contractor_job.fair_value_cents': {
		movement: 'contractor_donation',
		writer: 'src/lib/server/finance/contractor-entries.ts'
	},

	// -------------------------------------------------------------- inventory
	'acquisition.total_cents': {
		movement: 'acquisition_purchase',
		writer: 'src/lib/server/finance/in-kind-acquisition.ts'
	},
	'acquisition.fair_value_cents': {
		movement: 'acquisition_donation',
		writer: 'src/lib/server/finance/in-kind-acquisition.ts'
	},
	'acquisition_line.unit_value_cents': {
		notAccounting: "a line's share of the acquisition totals above"
	},
	'purchase_order_line.unit_cost_cents': {
		notAccounting: 'an estimate at order time; the acquisition records what was paid'
	},
	'inventory_loan.daily_rate_cents': {
		notAccounting: 'a rate; the charge it produces is total_charge_cents'
	},
	'inventory_loan.estimated_cost_cents': { notAccounting: 'an estimate, before the return' },
	'inventory_loan.total_charge_cents': {
		movement: 'equipment_loan_charge',
		writer: 'src/lib/server/finance/equipment-entries.ts'
	},
	'inventory_loan.cash_cents': {
		movement: 'equipment_loan_charge',
		writer: 'src/lib/server/finance/equipment-entries.ts'
	},
	'inventory_loan.credits_cents': {
		movement: 'equipment_loan_charge',
		writer: 'src/lib/server/finance/equipment-entries.ts'
	},

	// ------------------------------------------------------------ band audio
	'audio_release.price_min_cents': {
		notAccounting: 'the floor a buyer may name, not an amount that moved'
	},
	'release_purchase.amount_paid_cents': {
		movement: 'audio_sale',
		writer: 'src/lib/server/finance/audio-entries.ts'
	},
	'release_purchase.platform_fee_cents': {
		movement: 'audio_sale',
		writer: 'src/lib/server/finance/audio-entries.ts'
	},
	'release_purchase.band_net_cents': {
		// Recorded by that writer as the thing it deliberately does NOT enter: a
		// destination charge moves this to the band's own Stripe account at the
		// moment of sale, so the collective never holds it and it is not a
		// pass-through.
		movement: 'audio_sale',
		writer: 'src/lib/server/finance/audio-entries.ts'
	},
	'release_purchase.fee_covered_cents': {
		movement: 'audio_sale',
		writer: 'src/lib/server/finance/audio-entries.ts'
	},

	// --------------------------------------------------------------- the rest
	'payment_cache.amount_cents': {
		// Every kind of payment it mirrors now reaches an entry of its own, so
		// classifying this as a movement would double-count all of them.
		notAccounting:
			'a mirror of the Stripe Payment Record; the movement is what the payment paid for'
	},
	'credit_transaction.amount': {
		notAccounting: 'credits are not currency; the cash they displace is recorded where it settles'
	},
	'project.budget_cents': { notAccounting: 'a plan, not a movement' },
	'volunteer_role.market_rate_cents': {
		notAccounting: 'a rate the in-kind listener multiplies by the hours approved'
	}
} satisfies Record<string, MoneyColumn>;

/**
 * Categories with no writer on purpose — a grant cheque, rent: it arrives
 * outside the app. Declared rather than quietly absent, because
 * `annual-report-service.ts` reads only `totalsByKindAndCategory`, so a
 * category nothing writes is a silent zero on the report.
 */
export const manualOnlyCategories = {
	grant: 'A grant arrives as a cheque or a transfer, outside any app flow',
	facility: 'Rent and utilities are paid from the bank, not from here',
	payout_rounding: 'Reserved for the cash round-up a settlement has not needed yet',
	refund_absorbed: 'A refund the collective ate, entered by hand when it happens',
	other: 'The escape hatch a manual entry uses'
} as const;

/**
 * Categories that should be written and are not, by the issue tracking each.
 *
 * The category twin of `unaccounted` above, and the half a column map cannot
 * reach: membership revenue has no column anywhere — it exists in Stripe and
 * in `payment_cache` — so only the chart of accounts can notice it missing.
 * Moving one here is a claim that it is owed a writer, not that it is exempt.
 */
export const unwrittenCategories = {} as const;
