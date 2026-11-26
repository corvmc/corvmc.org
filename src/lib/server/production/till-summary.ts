import { db } from '#lib/server/db/index.js';
import { productionTillCount } from '#lib/server/db/schema/production.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { asc, eq } from 'drizzle-orm';
import { doorCheck, oneCounter, type DoorCheck } from '#lib/production/door-check.js';

/**
 * The door cash counts of one show, read as the settlement uses them (#3273).
 * Writes are in `till-count-service.ts`; this file only reads, so the status
 * service can warn from it without importing the writers.
 */

export interface TillCountLine {
	id: string;
	cashCents: number;
	byUserId: string | null;
	byName: string | null;
	at: Date;
}

export interface TillSummary {
	handoffs: TillCountLine[];
	/** Null when nobody handed the till over. */
	handoffTotalCents: number | null;
	staff: TillCountLine | null;
	/** The figure the settlement uses: the staff count, else the handoffs' sum. */
	cashCents: number | null;
	check: DoorCheck;
	oneCounter: boolean;
}

export async function tillSummary(productionId: string): Promise<TillSummary> {
	const rows = await db
		.select({
			id: productionTillCount.id,
			kind: productionTillCount.kind,
			cashCents: productionTillCount.cashCents,
			byUserId: productionTillCount.countedByUserId,
			byName: user.name,
			at: productionTillCount.countedAt
		})
		.from(productionTillCount)
		.leftJoin(user, eq(user.id, productionTillCount.countedByUserId))
		.where(eq(productionTillCount.productionId, productionId))
		.orderBy(
			asc(productionTillCount.countedAt),
			asc(productionTillCount.createdAt),
			asc(productionTillCount.id)
		);

	const line = ({ kind: _kind, ...rest }: (typeof rows)[number]): TillCountLine => rest;
	const handoffs = rows.filter((r) => r.kind === 'handoff').map(line);
	const staffRow = rows.find((r) => r.kind === 'staff');
	const staff = staffRow ? line(staffRow) : null;
	const handoffTotalCents =
		handoffs.length === 0 ? null : handoffs.reduce((t, h) => t + h.cashCents, 0);

	return {
		handoffs,
		handoffTotalCents,
		staff,
		cashCents: staff?.cashCents ?? handoffTotalCents,
		check: doorCheck(handoffTotalCents, staff?.cashCents ?? null),
		oneCounter: oneCounter(
			handoffs.map((h) => h.byUserId),
			staff?.byUserId ?? null
		)
	};
}
