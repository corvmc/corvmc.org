import { project } from '../../src/lib/server/db/schema/project';
import { group } from '../../src/lib/server/db/schema/group';
import { suggestion } from '../../src/lib/server/db/schema/suggestion';
import { workOrder, volunteerHourLog } from '../../src/lib/server/db/schema/volunteer';
import { contractorJob } from '../../src/lib/server/db/schema/contractor';
import { acquisition, purchaseOrder } from '../../src/lib/server/db/schema/inventory';
import { event } from '../../src/lib/server/db/schema/event';
import { batchInsert, db } from './db';
import { randomUUID } from 'crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { SeedEvent } from './types';

/**
 * Projects: the container over work orders, contractor jobs, purchase orders,
 * acquisitions and events.
 *
 * Three rows, because three shapes have to be reachable locally and each one
 * renders differently:
 *
 * - **A facility improvement** — a committee owner, a budget, and something on
 *   every burn line, so the detail page is never seen with an empty table. It
 *   is deliberately **over budget**: a burn bar that only ever runs green is a
 *   bar nobody has looked at.
 * - **A project answering a suggestion** — the loop `suggestionId` closes, and
 *   the only project a member can see.
 * - **A festival** — one project, two nights, no budget. Proves the
 *   many-events case and the "no budget set" rendering, which is not zero.
 *
 * Rows are attached by looking them up rather than being threaded through from
 * the seeders that made them, the same shortcut `seedContractors` takes: one
 * query beats a return value through four unrelated seeders.
 */
export async function seedProjects(events: SeedEvent[], staffId: string) {
	console.log('Seeding projects...');

	const [facilities] = await db
		.select({ id: group.id })
		.from(group)
		.where(eq(group.slug, 'facilities-committee'))
		.limit(1);

	const [programming] = await db
		.select({ id: group.id })
		.from(group)
		.where(eq(group.slug, 'programming-committee'))
		.limit(1);

	// The seeded suggestion about soundproofing: a member asked, and this is the
	// work that answers it. Matched on title so it survives the suggestion
	// seeder's ordering changing.
	const [soundproofing] = await db
		.select({ id: suggestion.id })
		.from(suggestion)
		.where(eq(suggestion.title, 'Better soundproofing in room B'))
		.limit(1);

	const now = new Date();
	const day = 86_400_000;

	const ids = { facility: randomUUID(), suggested: randomUUID(), festival: randomUUID() };

	const rows = await batchInsert(
		project,
		[
			{
				id: ids.facility,
				name: 'Live room refresh',
				description:
					'Repaint, rewire the stage subpanel, and replace the worst of the cabling. Runs through the autumn.',
				status: 'in_progress' as const,
				groupId: facilities?.id ?? null,
				// Set just under what the attached ledgers come to, so the over-budget
				// rendering is reachable locally without editing anything — and only
				// just under, because a burn bar at 400% tests nothing a bar at 110%
				// does not.
				budgetCents: 100_000,
				startsAt: new Date(now.getTime() - 30 * day),
				endsAt: new Date(now.getTime() + 60 * day),
				createdByUserId: staffId
			},
			{
				id: ids.suggested,
				name: 'Soundproofing for room B',
				description:
					'Acoustic panels on the shared wall, plus a door sweep. Came off the suggestion board.',
				status: 'planned' as const,
				groupId: facilities?.id ?? null,
				suggestionId: soundproofing?.id ?? null,
				budgetCents: 120_000,
				createdByUserId: staffId
			},
			{
				id: ids.festival,
				name: 'Winter showcase',
				description: 'Two nights in December. One budget, one backlog, two shows.',
				status: 'open' as const,
				groupId: programming?.id ?? null,
				// Deliberately null: "no budget set" is a different rendering from
				// zero, and nothing else in the seed exercises it.
				budgetCents: null,
				startsAt: new Date(now.getTime() + 80 * day),
				createdByUserId: staffId
			}
		],
		10
	);

	// --- Attach real rows to the facility project, one per burn line ----------

	// The electrician's subpanel job — the building work whose orphan status is
	// the reason this table exists.
	const [subpanel] = await db
		.select({ id: contractorJob.id })
		.from(contractorJob)
		.where(sql`${contractorJob.summary} like 'Add a dedicated circuit%'`)
		.limit(1);
	if (subpanel) {
		await db
			.update(contractorJob)
			.set({ projectId: ids.facility })
			.where(eq(contractorJob.id, subpanel.id));
	}

	// Two work orders, so the labour line has approved hours behind it. Unscheduled
	// ones by preference — bare work orders are what a project backlog looks like.
	const shifts = await db
		.select({ id: workOrder.id })
		.from(workOrder)
		.where(isNull(workOrder.cancelledAt))
		.orderBy(asc(workOrder.createdAt))
		.limit(2);
	for (const s of shifts) {
		await db.update(workOrder).set({ projectId: ids.facility }).where(eq(workOrder.id, s.id));
	}

	// Approve one hour log on those shifts, so `getProjectBurn`'s labour line is
	// non-zero: it counts approved hours only, and the seed's are mostly pending.
	const shiftIds = shifts.map((s) => s.id);
	if (shiftIds.length > 0) {
		const [log] = await db
			.select({ id: volunteerHourLog.id })
			.from(volunteerHourLog)
			.where(sql`${volunteerHourLog.shiftId} in ${shiftIds}`)
			.orderBy(asc(volunteerHourLog.id))
			.limit(1);
		if (log) {
			await db
				.update(volunteerHourLog)
				.set({ status: 'approved' })
				.where(eq(volunteerHourLog.id, log.id));
		}
	}

	// One placed order and one acquisition, for the parts and materials lines.
	const [order] = await db
		.select({ id: purchaseOrder.id })
		.from(purchaseOrder)
		.where(eq(purchaseOrder.status, 'placed'))
		.limit(1);
	if (order) {
		await db
			.update(purchaseOrder)
			.set({ projectId: ids.facility })
			.where(eq(purchaseOrder.id, order.id));
	}

	// One of each kind: a purchase carries `total_cents` and lands in the cash
	// column, a donation carries `fair_value_cents` and lands in contributed.
	// Both, so the detail page shows two visibly different numbers rather than
	// leaving the reader to trust that the split exists.
	for (const kind of ['purchase', 'donation'] as const) {
		// Ordered, not just limited: an unordered `limit(1)` picks whatever row
		// SQLite hands back first, which makes the seeded burn move between runs
		// and turns any diff of it into noise.
		const [row] = await db
			.select({ id: acquisition.id })
			.from(acquisition)
			.where(eq(acquisition.kind, kind))
			.orderBy(asc(acquisition.totalCents), asc(acquisition.id))
			.limit(1);
		if (row) {
			await db
				.update(acquisition)
				.set({ projectId: ids.facility })
				.where(eq(acquisition.id, row.id));
		}
	}

	// --- The festival's two nights -------------------------------------------

	const upcoming = events
		.filter((e) => e.status === 'published' && e.startsAt >= now)
		.slice(0, 2)
		.map((e) => e.id);
	for (const id of upcoming) {
		await db.update(event).set({ projectId: ids.festival }).where(eq(event.id, id));
	}

	const [{ attached } = { attached: 0 }] = await db
		.select({ attached: sql<number>`count(*)` })
		.from(workOrder)
		.where(and(sql`${workOrder.projectId} is not null`));

	return {
		projects: rows.length,
		events: upcoming.length,
		workOrders: Number(attached ?? 0)
	};
}
