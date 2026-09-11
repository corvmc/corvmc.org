import { db } from '$lib/server/db';
import { financialEntry } from '$lib/server/db/schema/financial';
import { and, eq, gte, lte, sql, sum } from 'drizzle-orm';
import { captureException } from '$lib/server/sentry';
import type {
	FinancialCategory,
	FinancialEntryKind,
	FinancialSettlement,
	FinancialSubject
} from '$lib/config';

/**
 * Writing and reading the financial record.
 *
 * Append-only: there is no update and no delete here, and a correction is a
 * reversing entry. See `docs/specs/financial-record-spec.md`.
 */

export interface RecordEntryInput {
	amountCents: number;
	kind: FinancialEntryKind;
	category: FinancialCategory;
	occurredAt: Date;
	settlement: FinancialSettlement;
	subjectType: FinancialSubject;
	subjectId: string;
	description: string;
	stripePaymentRecordId?: string | null;
	settlementGroup?: string | null;
	projectId?: string | null;
	userId?: string | null;
	recordedByUserId?: string | null;
	metadata?: Record<string, unknown> | null;
}

/** One entry. Callers that write several should use `recordEntries`. */
export async function recordEntry(input: RecordEntryInput): Promise<void> {
	await recordEntries([input]);
}

/**
 * Several entries as one statement.
 *
 * A sale writes three or four rows that only make sense together — the earned
 * share, the acts' pass-through, the card fee — so they go in one insert rather
 * than a loop. D1 has no interactive transactions and `db.batch` is the local
 * substitute, but a single multi-row insert is already atomic and cheaper.
 */
export async function recordEntries(inputs: RecordEntryInput[]): Promise<void> {
	if (inputs.length === 0) return;
	await db.insert(financialEntry).values(
		inputs.map((i) => ({
			amountCents: i.amountCents,
			kind: i.kind,
			category: i.category,
			occurredAt: i.occurredAt,
			settlement: i.settlement,
			stripePaymentRecordId: i.stripePaymentRecordId ?? null,
			settlementGroup: i.settlementGroup ?? null,
			subjectType: i.subjectType,
			subjectId: i.subjectId,
			projectId: i.projectId ?? null,
			userId: i.userId ?? null,
			description: i.description,
			recordedByUserId: i.recordedByUserId ?? null,
			metadata: i.metadata ?? null
		}))
	);
}

/**
 * Best-effort write, for a path that has already taken the member's money.
 *
 * A ledger row that fails must not fail the checkout it describes — the same
 * rule the cache writes follow, and the reason the reconciliation query exists.
 */
export async function recordEntriesBestEffort(inputs: RecordEntryInput[]): Promise<void> {
	try {
		await recordEntries(inputs);
	} catch (err) {
		captureException(err, { event: 'financial-entry.record', count: inputs.length });
	}
}

export interface RangeFilter {
	from: Date;
	to: Date;
}

const inRange = (r: RangeFilter) =>
	and(gte(financialEntry.occurredAt, r.from), lte(financialEntry.occurredAt, r.to));

const asCents = (v: string | null) => Number(v ?? 0);

/** What the collective kept over a window. Excludes in-kind and pass-through by construction. */
export async function totalEarnedCents(range: RangeFilter): Promise<number> {
	const [row] = await db
		.select({ total: sum(financialEntry.amountCents) })
		.from(financialEntry)
		.where(and(inRange(range), eq(financialEntry.kind, 'earned')));
	return asCents(row?.total ?? null);
}

/** Totals by category for one kind — the shape every report line is built from. */
export async function totalsByCategory(
	kind: FinancialEntryKind,
	range: RangeFilter
): Promise<{ category: FinancialCategory; totalCents: number }[]> {
	const rows = await db
		.select({ category: financialEntry.category, total: sum(financialEntry.amountCents) })
		.from(financialEntry)
		.where(and(inRange(range), eq(financialEntry.kind, kind)))
		.groupBy(financialEntry.category);
	return rows.map((r) => ({ category: r.category, totalCents: asCents(r.total) }));
}

/**
 * What a pool still holds, read per group.
 *
 * `0` is settled, `> 0` money held and still owed, `< 0` paid out more than came
 * in — which after settlement is a refund the collective absorbed. Whether a
 * pool is *closed* is `production.status`, not this number.
 */
export async function poolBalanceCents(settlementGroup: string): Promise<number> {
	const [row] = await db
		.select({ total: sum(financialEntry.amountCents) })
		.from(financialEntry)
		.where(
			and(
				eq(financialEntry.settlementGroup, settlementGroup),
				eq(financialEntry.kind, 'pass_through')
			)
		);
	return asCents(row?.total ?? null);
}

/** The Stripe cross-check: what the record says cleared over a window. */
export async function stripeSettledCents(range: RangeFilter): Promise<number> {
	const [row] = await db
		.select({ total: sum(financialEntry.amountCents) })
		.from(financialEntry)
		.where(and(inRange(range), eq(financialEntry.settlement, 'stripe')));
	return asCents(row?.total ?? null);
}

/** Everything recorded against one thing, oldest first — the audit view. */
export async function listForSubject(subjectType: FinancialSubject, subjectId: string) {
	return db
		.select()
		.from(financialEntry)
		.where(
			and(eq(financialEntry.subjectType, subjectType), eq(financialEntry.subjectId, subjectId))
		)
		.orderBy(sql`${financialEntry.occurredAt} asc`);
}
