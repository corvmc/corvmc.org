import { project, projectCommittee, projectSection } from '../../src/lib/server/db/schema/project';
import { group } from '../../src/lib/server/db/schema/group';
import { suggestion } from '../../src/lib/server/db/schema/suggestion';
import {
	workOrder,
	volunteerHourLog,
	volunteerProfile,
	volunteerRole,
	volunteerSignup,
	workTask
} from '../../src/lib/server/db/schema/volunteer';
import { contractorJob } from '../../src/lib/server/db/schema/contractor';
import { acquisition, purchaseOrder } from '../../src/lib/server/db/schema/inventory';
import { eventListing } from '../../src/lib/server/db/schema/event';
import { batchInsert, db } from './db';
import { randomUUID } from 'crypto';
import { and, asc, eq, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';
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
		.where(eq(group.slug, 'booking-committee'))
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
				suggestionId: soundproofing?.id ?? null,
				budgetCents: 120_000,
				createdByUserId: staffId
			},
			{
				id: ids.festival,
				name: 'Winter showcase',
				description: 'Two nights in December. One budget, one backlog, two shows.',
				status: 'open' as const,
				// Deliberately null: "no budget set" is a different rendering from
				// zero, and nothing else in the seed exercises it.
				budgetCents: null,
				startsAt: new Date(now.getTime() + 80 * day),
				createdByUserId: staffId
			}
		],
		10
	);

	const owners = [
		{ projectId: ids.facility, groupId: facilities?.id },
		{ projectId: ids.suggested, groupId: facilities?.id },
		{ projectId: ids.festival, groupId: programming?.id }
	].flatMap((o) => (o.groupId ? [{ ...o, groupId: o.groupId, role: 'owner' as const }] : []));
	if (owners.length) await db.insert(projectCommittee).values(owners);

	// --- Attach real rows to the facility project, one per burn line ----------

	// The facility project's task list: three sections with work in them and an
	// empty one, because an empty section is a state the list has to render.
	const section = {
		prep: randomUUID(),
		electrical: randomUUID(),
		finish: randomUUID(),
		closeOut: randomUUID()
	};
	await batchInsert(
		projectSection,
		[
			{ id: section.prep, projectId: ids.facility, name: 'Prep', sortOrder: 0 },
			{ id: section.electrical, projectId: ids.facility, name: 'Electrical', sortOrder: 1 },
			{ id: section.finish, projectId: ids.facility, name: 'Finish', sortOrder: 2 },
			{ id: section.closeOut, projectId: ids.facility, name: 'Close-out', sortOrder: 3 }
		],
		10
	);

	// The electrician's subpanel job — the building work whose orphan status is
	// the reason this table exists. `seedContractors` made its work order (no
	// role, no posting, resolved when the job was); this files it under the
	// project, which is what puts the job's cost in the burn.
	const [circuitTask] = await db
		.select({ id: workOrder.id })
		.from(workOrder)
		.innerJoin(contractorJob, eq(contractorJob.workOrderId, workOrder.id))
		.where(sql`${workOrder.title} like 'Add a dedicated circuit%'`)
		.limit(1);
	if (circuitTask) {
		await db
			.update(workOrder)
			.set({ projectId: ids.facility, sectionId: section.electrical, sortOrder: 0 })
			.where(eq(workOrder.id, circuitTask.id));
	}

	// Unassigned: no role, no posting, nobody on it — a task just typed into the
	// list, with only a deadline set.
	await db.insert(workOrder).values({
		title: 'Replace the worst of the XLR runs',
		projectId: ids.facility,
		sectionId: section.finish,
		sortOrder: 0,
		dueAt: new Date(now.getTime() + 21 * day),
		createdByUserId: staffId
	});

	// Derived: done when its own duties are, so the list has an app-ticked row.
	const punchList = randomUUID();
	await db.insert(workOrder).values({
		id: punchList,
		title: 'Walk the room with the punch list',
		projectId: ids.facility,
		sectionId: section.finish,
		sortOrder: 1,
		doneWhen: 'tasks_ticked',
		createdByUserId: staffId
	});
	await batchInsert(
		workTask,
		[
			{ workOrderId: punchList, label: 'Touch up the trim', sortOrder: 0, done: true, doneAt: now },
			{ workOrderId: punchList, label: 'Test every wall outlet', sortOrder: 1 }
		],
		10
	);

	// The project's own work orders, and its own hour log against one of them.
	//
	// Borrowing existing rows looked simpler and was not reproducible: which
	// shifts carry logged hours, how many minutes each carries, and which are
	// approved are all randomised upstream in `seedVolunteerHours`, so the labour
	// line read 3.5 hours on one seed, 7.5 on the next and 0 on a third. Writing
	// our own rows is what makes the seeded burn the same number on every machine.
	//
	// Unscheduled deliberately: a bare work order is work that needs doing with
	// nobody booked to do it, which is what a project backlog looks like.
	const [facilityRole] = await db
		.select({ id: volunteerRole.id })
		.from(volunteerRole)
		.where(eq(volunteerRole.name, 'Facilities & Maintenance'))
		.limit(1);

	// Members mode: a role, not posted, and the people staff put on it.
	let membersTaskId: string | null = null;
	if (facilityRole) {
		const backlog = [
			{
				id: randomUUID(),
				title: 'Mask and prime the live room walls',
				volunteerRoleId: facilityRole.id,
				projectId: ids.facility,
				sectionId: section.prep,
				sortOrder: 0,
				capacity: 2,
				notes: 'Mask and prime the live room walls.',
				createdByUserId: staffId
			},
			// Open: posted to the claim board, so it sets `posted_at` itself — the
			// backfill ran before the seed did.
			{
				id: randomUUID(),
				title: 'Pull the old cable runs',
				volunteerRoleId: facilityRole.id,
				projectId: ids.facility,
				sectionId: section.prep,
				sortOrder: 1,
				capacity: 1,
				notes: 'Pull the old cable runs before the electrician comes back.',
				postedAt: now,
				postedByUserId: staffId,
				createdByUserId: staffId
			}
		];
		await batchInsert(workOrder, backlog, 10);
		membersTaskId = backlog[0].id;

		// Duties on the open task, one ticked, so the list has a row to unfold.
		await batchInsert(
			workTask,
			[
				['Photograph the current runs', true],
				['Pull runs from the stage trough', false],
				['Coil and label anything worth keeping', false]
			].map(([label, done], i) => ({
				workOrderId: backlog[1].id,
				label: label as string,
				sortOrder: i,
				done: done as boolean,
				doneAt: done ? now : null,
				doneByUserId: done ? staffId : null
			})),
			10
		);

		// Ordered so the same two volunteers are assigned on every seed.
		const assignees = await db
			.select({ userId: volunteerProfile.userId })
			.from(volunteerProfile)
			.where(eq(volunteerProfile.status, 'active'))
			.orderBy(asc(volunteerProfile.userId))
			.limit(2);
		if (assignees.length) {
			await db.insert(volunteerSignup).values(
				assignees.map((a) => ({
					shiftId: backlog[0].id,
					userId: a.userId,
					status: 'confirmed' as const,
					claimedAt: now,
					confirmedAt: now
				}))
			);
		}

		await db.insert(volunteerHourLog).values({
			userId: staffId,
			volunteerRoleId: facilityRole.id,
			shiftId: backlog[0].id,
			workedOn: new Date(now.getTime() - 14 * day),
			minutes: 240,
			description: 'Masking and priming, live room refresh.',
			// Approved, because `getProjectBurn` counts approved hours only — a
			// pending log is a claim, not a contribution.
			status: 'approved' as const
		});
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

	// Only listings with no production: a show's listing names its own project
	// (production-projects-spec.md), and a festival over shows is deferred.
	const free = await db
		.select({ id: eventListing.id })
		.from(eventListing)
		.where(isNull(eventListing.productionId));
	const unproduced = new Set(free.map((r) => r.id));
	const upcoming = events
		.filter((e) => e.status === 'published' && e.startsAt >= now && unproduced.has(e.id))
		.slice(0, 2)
		.map((e) => e.id);
	// A third night still in draft, so Booking has something to publish from its own page.
	const draft = events.find(
		(e) => e.status === 'draft' && e.startsAt >= now && unproduced.has(e.id)
	);
	if (draft) upcoming.push(draft.id);
	for (const id of upcoming) {
		await db.update(eventListing).set({ projectId: ids.festival }).where(eq(eventListing.id, id));
	}

	const [{ attached } = { attached: 0 }] = await db
		.select({ attached: sql<number>`count(*)` })
		.from(workOrder)
		.where(sql`${workOrder.projectId} is not null`);

	return {
		projects: rows.length,
		events: upcoming.length,
		workOrders: Number(attached ?? 0),
		sections: 4,
		unpostedWorkOrderIds: membersTaskId ? [membersTaskId] : []
	};
}

/**
 * What the posted-at backfill migration did to production, done to the seed's
 * own rows: every work order with a role is on the claim board. The migration
 * ran before the seed wrote anything, so without this none of it would be.
 * `keepUnposted` is the work deliberately staffed by assignment instead.
 */
export async function postSeededWorkOrders(keepUnposted: string[]) {
	const posted = await db
		.update(workOrder)
		.set({ postedAt: sql`${workOrder.createdAt}` })
		.where(
			and(
				isNull(workOrder.postedAt),
				isNotNull(workOrder.volunteerRoleId),
				keepUnposted.length ? notInArray(workOrder.id, keepUnposted) : undefined
			)
		)
		.returning({ id: workOrder.id });
	return posted.length;
}
