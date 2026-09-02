import { db } from '$lib/server/db';
import {
	equipmentCategory,
	inventoryAsset,
	inventoryItem,
	inventoryLoan
} from '$lib/server/db/schema/inventory';
import { user } from '$lib/server/db/schema/authentication';
import { eq, and, sql, like, or, desc, count } from 'drizzle-orm';
import { paginate, type PaginationInput } from '$lib/server/db/paginate';
import { memberRefColumns, toGenericRef, toMemberRef } from '$lib/server/entity/refs';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { getBalance, deductCredits, addCredits } from '$lib/server/finance/credit-service';
import { InsufficientCreditsError } from '$lib/server/finance/credit-service';
import { recordCashPayment } from '$lib/server/finance/payment-service';
import { isSustainingMember } from '$lib/server/finance/subscription-service';
import { getAvailableQuantity } from './stock-service';
import { setAssetStatus } from './asset-service';
import { hasBlockingFlag, raiseFlag } from './asset-flag-service';
import type { EquipmentCondition } from '$lib/config';
import { movementStatement, recordMovement } from './stock-service';
import { loanDailyRateCents, loanChargeDays, estimateLoanCost } from '$lib/config';
import { captureException } from '$lib/server/sentry';
import type { PricingTier, LoanStatus } from '$lib/config';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class LoanNotFoundError extends Error {
	constructor() {
		super('Loan not found');
		this.name = 'LoanNotFoundError';
	}
}

export class InvalidLoanTransitionError extends Error {
	constructor(from: string, to: string) {
		super(`Cannot transition loan from '${from}' to '${to}'`);
		this.name = 'InvalidLoanTransitionError';
	}
}

export class InsufficientQuantityError extends Error {
	constructor(available: number, requested: number) {
		super(`Only ${available} available, requested ${requested}`);
		this.name = 'InsufficientQuantityError';
	}
}

export class AssetRequiredError extends Error {
	constructor() {
		super('A serialized item needs a specific unit assigned before checkout');
		this.name = 'AssetRequiredError';
	}
}

// ---------------------------------------------------------------------------
// Pricing helpers
// ---------------------------------------------------------------------------

// Rate and day-count rules live in $lib/config (loanDailyRateCents /
// loanChargeDays) so the member-facing estimate and this settlement can never
// drift apart. These wrappers keep the established server-side names.
export function calculateDailyRate(pricingTier: PricingTier, isSustainingMember: boolean): number {
	return loanDailyRateCents(pricingTier, isSustainingMember);
}

export function calculateLoanCharge(
	dailyRateCents: number,
	checkedOutAt: Date,
	returnedAt: Date
): number {
	return dailyRateCents * loanChargeDays(checkedOutAt, returnedAt);
}

async function settleReturn(
	userId: string,
	stripeCustomerId: string | null,
	totalCents: number,
	loanId: string
): Promise<{ creditsCents: number; cashCents: number }> {
	if (totalCents <= 0) return { creditsCents: 0, cashCents: 0 };

	// Apply as many equipment credits as the wallet holds, cash for the rest.
	// The read-then-deduct pair can race a concurrent spend; on
	// InsufficientCreditsError re-read and retry with the fresh balance rather
	// than abandoning the member's remaining credits.
	let creditsUsed = 0;
	for (let attempt = 0; attempt < 3; attempt++) {
		const creditBalance = await getBalance(userId, 'equipment_credits');
		const creditsToUse = Math.min(creditBalance, totalCents);
		if (creditsToUse <= 0) break;

		try {
			await deductCredits(
				userId,
				'equipment_credits',
				creditsToUse,
				'checkout',
				loanId,
				`Equipment loan ${loanId}`
			);
			creditsUsed = creditsToUse;
			break;
		} catch (err) {
			if (err instanceof InsufficientCreditsError) continue; // balance moved — retry
			throw err;
		}
	}

	const cashRemaining = totalCents - creditsUsed;
	if (cashRemaining > 0 && stripeCustomerId) {
		try {
			await recordCashPayment({
				userId,
				stripeCustomerId,
				amountCents: cashRemaining,
				metadata: { equipment_loan_id: loanId },
				reference: loanId
			});
		} catch (err) {
			// The credits above are already spent, and D1 has no transaction to roll
			// back — nor could one hold an external API call. So put them back before
			// the throw propagates, the way `checkout()` reverses its own deductions
			// on a failed session.
			//
			// Without this the member pays and gets nothing: the deduction stands,
			// no payment is recorded, `returnLoan` aborts with the loan still
			// `checked_out`, and retrying charges them a second time from a balance
			// that has already been spent. Observed for real when the Stripe payload
			// was wrong — three cents, which is exactly small enough that nobody
			// would have caught it.
			if (creditsUsed > 0) {
				try {
					await addCredits(
						userId,
						'equipment_credits',
						creditsUsed,
						'checkout_failed',
						loanId,
						`Reversed ${creditsUsed} equipment_credits — payment failed for loan ${loanId}`
					);
				} catch (reverseErr) {
					// Never let the compensation's failure replace the original cause:
					// that error is what says why the return failed. This one is a
					// balance now owed to a member, which is a person's problem to
					// resolve, so it has to be loud somewhere other than the stack.
					captureException(reverseErr, {
						loanId,
						userId,
						creditsUsed,
						note: 'equipment credits deducted but neither charged nor reversed'
					});
				}
			}
			throw err;
		}
	}

	return { creditsCents: creditsUsed, cashCents: cashRemaining };
}

/**
 * Availability as a single SQL predicate, for the atomic guard on `scheduleLoan`.
 *
 * The service-level check a few lines above it is the friendly error; this is
 * the one that actually holds, because two staffers scheduling the last amp at
 * the same moment both pass the read and only one may pass the write.
 */
function availabilityAtLeast(itemId: string, quantity: number) {
	return sql`(
		CASE (SELECT kind FROM inventory_item WHERE id = ${itemId})
			WHEN 'serialized' THEN
				(SELECT COUNT(*) FROM inventory_asset
				 WHERE item_id = ${itemId} AND status = 'in_service')
			ELSE
				(SELECT COALESCE(SUM(quantity), 0) FROM stock_movement WHERE item_id = ${itemId})
		END
		- COALESCE((SELECT SUM(quantity) FROM inventory_loan
		            WHERE item_id = ${itemId} AND status = 'scheduled'), 0)
	) >= ${quantity}`;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export interface RequestLoanData {
	itemId?: string;
	quantity?: number;
	requestedPickupDate: Date;
	estimatedReturnDate: Date;
	memberNotes?: string;
}

export async function requestLoan(userId: string, data: RequestLoanData) {
	const qty = data.quantity ?? 1;

	if (data.estimatedReturnDate <= data.requestedPickupDate) {
		throw new Error('Estimated return date must be after the pickup date');
	}

	if (data.itemId) {
		const available = await getAvailableQuantity(data.itemId);
		if (available < qty) {
			throw new InsufficientQuantityError(available, qty);
		}
	}

	let estimatedCostCents: number | null = null;
	if (data.itemId) {
		const [item] = await db
			.select({ pricingTier: equipmentCategory.pricingTier })
			.from(inventoryItem)
			.innerJoin(equipmentCategory, eq(inventoryItem.categoryId, equipmentCategory.id))
			.where(eq(inventoryItem.id, data.itemId))
			.limit(1);

		if (item) {
			const sustaining = await isSustainingMember(userId);
			estimatedCostCents = estimateLoanCost(
				data.requestedPickupDate,
				data.estimatedReturnDate,
				item.pricingTier as PricingTier,
				sustaining
			);
		}
	}

	const [loan] = await db
		.insert(inventoryLoan)
		.values({
			itemId: data.itemId ?? null,
			userId,
			quantity: qty,
			requestedPickupDate: data.requestedPickupDate,
			estimatedReturnDate: data.estimatedReturnDate,
			estimatedCostCents,
			memberNotes: data.memberNotes ?? null,
			status: 'requested'
		})
		.returning();

	const [member] = await db
		.select({ name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	let equipmentName: string | null = null;
	if (data.itemId) {
		const [item] = await db
			.select({ name: inventoryItem.name })
			.from(inventoryItem)
			.where(eq(inventoryItem.id, data.itemId))
			.limit(1);
		equipmentName = item?.name ?? null;
	}

	Promise.resolve().then(async () => {
		try {
			await domainEvents.emit('equipment.loan_requested', {
				loanId: loan.id,
				userId,
				userName: member?.name ?? 'Unknown',
				userEmail: member?.email ?? '',
				equipmentName,
				memberNotes: data.memberNotes ?? null,
				requestedPickupDate: data.requestedPickupDate.toISOString()
			});
		} catch (err) {
			captureException(err, { event: 'equipment.loan_requested', loanId: loan.id });
		}
	});

	return loan;
}

export interface ScheduleLoanData {
	itemId: string;
	scheduledPickupDate: Date;
}

export async function scheduleLoan(loanId: string, data: ScheduleLoanData) {
	const loan = await getLoanRaw(loanId);
	if (!loan) throw new LoanNotFoundError();
	if (loan.status !== 'requested') throw new InvalidLoanTransitionError(loan.status, 'scheduled');

	const available = await getAvailableQuantity(data.itemId);
	if (available < loan.quantity) {
		throw new InsufficientQuantityError(available, loan.quantity);
	}

	const [updated] = await db
		.update(inventoryLoan)
		.set({
			itemId: data.itemId,
			scheduledPickupDate: data.scheduledPickupDate,
			status: 'scheduled',
			updatedAt: new Date()
		})
		.where(and(eq(inventoryLoan.id, loanId), availabilityAtLeast(data.itemId, loan.quantity)))
		.returning();

	if (!updated) throw new InsufficientQuantityError(0, loan.quantity);

	const [member] = await db
		.select({ name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, loan.userId))
		.limit(1);

	const [item] = await db
		.select({ name: inventoryItem.name })
		.from(inventoryItem)
		.where(eq(inventoryItem.id, data.itemId))
		.limit(1);

	Promise.resolve().then(async () => {
		try {
			await domainEvents.emit('equipment.loan_scheduled', {
				loanId,
				userId: loan.userId,
				userName: member?.name ?? 'Unknown',
				userEmail: member?.email ?? '',
				equipmentName: item?.name ?? 'Unknown',
				scheduledPickupDate: data.scheduledPickupDate.toISOString()
			});
		} catch (err) {
			captureException(err, { event: 'equipment.loan_scheduled', loanId });
		}
	});

	return updated;
}

export interface CheckoutLoanData {
	dueDate: Date;
	/** Which physical unit is being handed over. Required for serialized items. */
	assetId?: string;
	actorId?: string;
}

export async function checkoutLoan(loanId: string, data: CheckoutLoanData) {
	const loan = await getLoanRaw(loanId);
	if (!loan) throw new LoanNotFoundError();
	if (loan.status !== 'scheduled') throw new InvalidLoanTransitionError(loan.status, 'checked_out');
	if (!loan.itemId) throw new Error('Loan must have an item assigned before checkout');

	const [item] = await db
		.select({
			name: inventoryItem.name,
			kind: inventoryItem.kind,
			pricingTier: equipmentCategory.pricingTier
		})
		.from(inventoryItem)
		.innerJoin(equipmentCategory, eq(inventoryItem.categoryId, equipmentCategory.id))
		.where(eq(inventoryItem.id, loan.itemId))
		.limit(1);

	// A serialized loan has to name the unit that left the building — otherwise
	// its history is attached to a type, and "which amp came back broken" has no
	// answer.
	//
	// A unit already bound to the loan counts. The write below has always fallen
	// back to `loan.assetId`, but this guard read only the incoming value, so a
	// loan created with a specific unit already named could never be checked out
	// at all — it threw on the way to the line that would have used it.
	const assetId = data.assetId ?? loan.assetId;
	if (item.kind === 'serialized' && !assetId) throw new AssetRequiredError();

	const sustaining = await isSustainingMember(loan.userId);
	const dailyRate = calculateDailyRate(item.pricingTier as PricingTier, sustaining);

	const [member] = await db
		.select({ name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, loan.userId))
		.limit(1);

	const now = new Date();
	const loanUpdate = db
		.update(inventoryLoan)
		.set({
			assetId,
			checkedOutAt: now,
			dueDate: data.dueDate,
			dailyRateCents: dailyRate,
			status: 'checked_out',
			updatedAt: now
		})
		.where(eq(inventoryLoan.id, loanId))
		.returning();

	// Also keyed on the resolved unit: a pre-bound loan would otherwise leave its
	// asset reading `in_service` while the ledger said it had gone out.
	const custodyUpdate = assetId
		? db
				.update(inventoryAsset)
				.set({ status: 'on_loan', updatedAt: now })
				.where(eq(inventoryAsset.id, assetId))
		: null;

	const ledgerEntry = movementStatement({
		itemId: loan.itemId,
		assetId,
		quantity: loan.quantity,
		reason: 'loan_out',
		loanId,
		actorId: data.actorId ?? null,
		occurredAt: now
	});

	// The loan, the unit's custody and the ledger are three records of the one
	// event of handing an amp over, so they commit as one write. As three awaits,
	// a worker dying part-way through left an amp that was out on loan and still
	// counted as stock, with nothing to reconcile it against.
	// db.batch, never db.transaction — the latter is broken on D1.
	const [[updated]] = custodyUpdate
		? await db.batch([loanUpdate, custodyUpdate, ledgerEntry])
		: await db.batch([loanUpdate, ledgerEntry]);

	Promise.resolve().then(async () => {
		try {
			await domainEvents.emit('equipment.checked_out', {
				loanId,
				userId: loan.userId,
				userName: member?.name ?? 'Unknown',
				userEmail: member?.email ?? '',
				equipmentName: item?.name ?? 'Unknown'
			});
		} catch (err) {
			captureException(err, { event: 'equipment.checked_out', loanId });
		}
	});

	return updated;
}

export interface ReturnInspection {
	/** What the duty volunteer saw when they checked it back in. */
	condition?: EquipmentCondition;
	/** Anything they noticed while checking it, raised against this loan. */
	flags?: { note: string; blocksUse: boolean; condition?: EquipmentCondition | null }[];
}

export async function returnLoan(
	loanId: string,
	staffNotes?: string,
	opts: { actorId?: string } & ReturnInspection = {}
) {
	const loan = await getLoanRaw(loanId);
	if (!loan) throw new LoanNotFoundError();
	if (loan.status !== 'checked_out') throw new InvalidLoanTransitionError(loan.status, 'returned');

	// The inspection happens before anything else is decided, because it is the
	// *input* to the decision. `committees-and-roles-spec.md:522` marks "condition
	// at both ends" as covered; only the checkout end existed, so a unit could
	// come back visibly worse and the only record was free text on the loan.
	//
	// Flags are raised first so `hasBlockingFlag` below can see them: the whole
	// point is that something noticed on the counter keeps the unit off the shelf.
	if (loan.assetId && opts.flags?.length) {
		for (const f of opts.flags) {
			await raiseFlag({
				assetId: loan.assetId,
				note: f.note,
				reportedByUserId: opts.actorId ?? loan.userId,
				blocksUse: f.blocksUse,
				condition: f.condition ?? null,
				loanId
			});
		}
	}

	const now = new Date();
	const totalCharge = calculateLoanCharge(loan.dailyRateCents ?? 0, loan.checkedOutAt!, now);

	const [member] = await db
		.select({ name: user.name, email: user.email, stripeId: user.stripeId })
		.from(user)
		.where(eq(user.id, loan.userId))
		.limit(1);

	const { creditsCents, cashCents } = await settleReturn(
		loan.userId,
		member?.stripeId ?? null,
		totalCharge,
		loanId
	);

	const [updated] = await db
		.update(inventoryLoan)
		.set({
			returnedAt: now,
			status: 'returned',
			totalChargeCents: totalCharge,
			creditsCents,
			cashCents,
			staffNotes: staffNotes ?? loan.staffNotes,
			updatedAt: now
		})
		.where(eq(inventoryLoan.id, loanId))
		.returning();

	// Custody comes back here, so this is where availability is decided. The unit
	// stayed `on_loan` the whole time it was out, even if somebody flagged it
	// mid-loan -- noticing a crackle does not hand the amp back to the collective.
	//
	// The loan movements are written first, below, so the ledger reads in the
	// order things happened: it came back, and then it went to the shop.
	const assetNeedsService = loan.assetId ? await hasBlockingFlag(loan.assetId) : false;

	if (loan.itemId) {
		await recordMovement({
			itemId: loan.itemId,
			assetId: loan.assetId,
			quantity: loan.quantity,
			reason: 'loan_return',
			loanId,
			actorId: opts.actorId ?? null,
			occurredAt: now
		});
	}

	if (loan.assetId) {
		const [asset] = await db
			.select({ status: inventoryAsset.status })
			.from(inventoryAsset)
			.where(eq(inventoryAsset.id, loan.assetId))
			.limit(1);

		// Only out of `on_loan`. `retired` and `lost` are decisions somebody made
		// about the unit while it was out, and handing it back does not reverse
		// them.
		if (asset?.status === 'on_loan') {
			// Through the single writer, so `maintenance` derives its own
			// `repair_out` and `in_service` derives nothing -- the `loan_return`
			// above already accounted for the unit coming back.
			await setAssetStatus(loan.assetId, assetNeedsService ? 'maintenance' : 'in_service', {
				actorId: opts.actorId,
				condition: opts.condition,
				notes: assetNeedsService ? 'Open report on return' : undefined
			});
		}
	}

	let equipmentName = 'Unknown';
	if (loan.itemId) {
		const [item] = await db
			.select({ name: inventoryItem.name })
			.from(inventoryItem)
			.where(eq(inventoryItem.id, loan.itemId))
			.limit(1);
		equipmentName = item?.name ?? 'Unknown';
	}

	const daysBorrowed = Math.max(
		1,
		Math.ceil((now.getTime() - loan.checkedOutAt!.getTime()) / (1000 * 60 * 60 * 24))
	);

	Promise.resolve().then(async () => {
		try {
			await domainEvents.emit('equipment.returned', {
				loanId,
				userId: loan.userId,
				userName: member?.name ?? 'Unknown',
				userEmail: member?.email ?? '',
				equipmentName,
				totalChargeCents: totalCharge,
				creditsCents,
				cashCents,
				daysBorrowed
			});
		} catch (err) {
			captureException(err, { event: 'equipment.returned', loanId });
		}
	});

	return updated;
}

export async function cancelLoan(loanId: string) {
	const loan = await getLoanRaw(loanId);
	if (!loan) throw new LoanNotFoundError();
	if (loan.status !== 'requested' && loan.status !== 'scheduled') {
		throw new InvalidLoanTransitionError(loan.status, 'cancelled');
	}

	const [updated] = await db
		.update(inventoryLoan)
		.set({ status: 'cancelled', updatedAt: new Date() })
		.where(eq(inventoryLoan.id, loanId))
		.returning();

	return updated;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function getLoanRaw(id: string) {
	const [row] = await db.select().from(inventoryLoan).where(eq(inventoryLoan.id, id)).limit(1);
	return row ?? null;
}

export async function getLoanById(id: string) {
	const [row] = await db
		.select({
			loan: inventoryLoan,
			equipmentName: inventoryItem.name,
			// The checkout form needs this to know whether to ask which unit is
			// being handed over: only a serialized loan has one to name.
			itemKind: inventoryItem.kind,
			categoryName: equipmentCategory.name,
			pricingTier: equipmentCategory.pricingTier,
			assetTag: inventoryAsset.assetTag,
			member: memberRefColumns()
		})
		.from(inventoryLoan)
		.innerJoin(user, eq(inventoryLoan.userId, user.id))
		.leftJoin(inventoryItem, eq(inventoryLoan.itemId, inventoryItem.id))
		.leftJoin(equipmentCategory, eq(inventoryItem.categoryId, equipmentCategory.id))
		.leftJoin(inventoryAsset, eq(inventoryLoan.assetId, inventoryAsset.id))
		.where(eq(inventoryLoan.id, id))
		.limit(1);

	if (!row) return null;

	return {
		...row.loan,
		equipmentName: row.equipmentName,
		itemKind: row.itemKind,
		categoryName: row.categoryName,
		pricingTier: row.pricingTier,
		assetTag: row.assetTag,
		member: toMemberRef(row.member),
		isOverdue:
			row.loan.status === 'checked_out' && row.loan.dueDate != null && row.loan.dueDate < new Date()
	};
}

export interface ListLoansOptions {
	status?: LoanStatus;
	userId?: string;
	itemId?: string;
	search?: string;
}

export async function listLoans(opts: ListLoansOptions = {}, pagination: PaginationInput = {}) {
	const conditions = [];

	if (opts.status) conditions.push(eq(inventoryLoan.status, opts.status));
	if (opts.userId) conditions.push(eq(inventoryLoan.userId, opts.userId));
	if (opts.itemId) conditions.push(eq(inventoryLoan.itemId, opts.itemId));
	if (opts.search) {
		conditions.push(or(like(user.name, `%${opts.search}%`), like(user.email, `%${opts.search}%`)));
	}

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const dataQ = db
		.select({
			loan: inventoryLoan,
			equipmentName: inventoryItem.name,
			member: memberRefColumns()
		})
		.from(inventoryLoan)
		.innerJoin(user, eq(inventoryLoan.userId, user.id))
		.leftJoin(inventoryItem, eq(inventoryLoan.itemId, inventoryItem.id))
		.where(where)
		.orderBy(desc(inventoryLoan.createdAt))
		.$dynamic();

	const countQ = db
		.select({ count: count() })
		.from(inventoryLoan)
		.innerJoin(user, eq(inventoryLoan.userId, user.id))
		.where(where);

	const result = await paginate(dataQ, countQ, pagination);
	return {
		...result,
		rows: result.rows.map((row) => ({
			...row.loan,
			equipmentName: row.equipmentName,
			// The loan is the row; what was borrowed is its title. A free-form
			// request has no item record behind it, so it says so and does
			// not link.
			ref: toGenericRef('loan', {
				id: row.loan.id,
				title: row.equipmentName ?? '(free-form request)'
			}),
			member: toMemberRef(row.member),
			isOverdue:
				row.loan.status === 'checked_out' &&
				row.loan.dueDate != null &&
				row.loan.dueDate < new Date()
		}))
	};
}

export async function listUserLoans(userId: string) {
	const { rows } = await listLoans({ userId });
	return rows;
}

export async function getLoanHistory(itemId: string) {
	const { rows } = await listLoans({ itemId });
	return rows;
}
