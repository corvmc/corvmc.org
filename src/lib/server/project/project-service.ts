import { db } from '$lib/server/db';
import { project } from '$lib/server/db/schema/project';
import { group } from '$lib/server/db/schema/group';
import { suggestion } from '$lib/server/db/schema/suggestion';
import { workOrder, volunteerHourLog, volunteerRole } from '$lib/server/db/schema/volunteer';
import { contractorJob } from '$lib/server/db/schema/contractor';
import { acquisition, purchaseOrder, purchaseOrderLine } from '$lib/server/db/schema/inventory';
import { eventListing } from '$lib/server/db/schema/event';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import { valueOfMinutesCents, type ProjectStatus } from '$lib/config';
import { getHourValueCents } from '$lib/server/volunteer/hour-value';

/**
 * A body of work with a budget and an owner — docs/specs/project-spec.md.
 *
 * The container the schema kept describing and never had: a facility
 * improvement is a dozen work orders, an electrician's invoice and a purchase
 * order, and until this table there was nowhere to say they were one job.
 *
 * **Nothing here stores what a project has cost.** `getProjectBurn` sums the
 * ledgers that already hold the atoms, every time it is asked, following the
 * habit `contractorJobStatuses` states: a stored total needs something to come
 * along and keep it right, and nothing would.
 */

export class ProjectNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Project not found');
	}
}

export class ProjectStateError extends DomainError {
	readonly httpStatus = 409;
	constructor(message: string) {
		super(message);
	}
}

export class ProjectOwnerError extends DomainError {
	readonly httpStatus = 400;
	constructor(message: string) {
		super(message);
	}
}

export interface CreateProjectInput {
	name: string;
	description?: string | null;
	/** The owning committee. A `group` with `kind = 'committee'`, checked here. */
	groupId?: string | null;
	/** The suggestion this answers. At most one project per suggestion. */
	suggestionId?: string | null;
	budgetCents?: number | null;
	startsAt?: Date | null;
	endsAt?: Date | null;
	status?: ProjectStatus;
	createdByUserId?: string | null;
}

/**
 * A CHECK cannot cross tables, so "the owner is a committee" is enforced here.
 *
 * It is a real rule rather than a nicety: `project.groupId` is what a
 * committee-scoped view reads, and a band or a club appearing in that list
 * would be a group whose members are not the people doing the work.
 */
async function assertCommittee(groupId: string) {
	const [row] = await db
		.select({ kind: group.kind, deletedAt: group.deletedAt })
		.from(group)
		.where(eq(group.id, groupId))
		.limit(1);

	if (!row || row.deletedAt) throw new ProjectOwnerError('That group does not exist');
	if (row.kind !== 'committee') {
		throw new ProjectOwnerError('Only a committee can own a project');
	}
}

/** The suggestion exists, and nothing else has already claimed it. */
async function assertClaimableSuggestion(suggestionId: string, exceptProjectId?: string) {
	const [row] = await db
		.select({ id: suggestion.id })
		.from(suggestion)
		.where(eq(suggestion.id, suggestionId))
		.limit(1);
	if (!row) throw new ProjectStateError('That suggestion does not exist');

	const [taken] = await db
		.select({ id: project.id })
		.from(project)
		.where(eq(project.suggestionId, suggestionId))
		.limit(1);

	// The partial unique index refuses this too; catching it here is what turns a
	// D1 constraint error into a 409 a caller can act on.
	if (taken && taken.id !== exceptProjectId) {
		throw new ProjectStateError('A project already answers that suggestion');
	}
}

export async function createProject(data: CreateProjectInput) {
	if (data.groupId) await assertCommittee(data.groupId);
	if (data.suggestionId) await assertClaimableSuggestion(data.suggestionId);

	const [row] = await db.insert(project).values(data).returning();
	return row;
}

export async function updateProject(id: string, data: Partial<CreateProjectInput>) {
	await getProjectById(id);
	if (data.groupId) await assertCommittee(data.groupId);
	if (data.suggestionId) await assertClaimableSuggestion(data.suggestionId, id);

	const [row] = await db
		.update(project)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(project.id, id))
		.returning();
	return row;
}

/**
 * Move the project along its lifecycle, and carry the suggestion with it.
 *
 * This is the whole point of `suggestionId`. The loop was open: a suggestion
 * reached `done` because a staffer said so, with no link to the work that did
 * it. One `db.batch` — never `db.transaction`, which is broken on D1 — keeps
 * the two from disagreeing about the same fact.
 */
export async function setProjectStatus(id: string, status: ProjectStatus) {
	const current = await getProjectById(id);
	const now = new Date();

	const updateProjectRow = db
		.update(project)
		.set({ status, updatedAt: now })
		.where(eq(project.id, id));

	if (current.suggestionId) {
		await db.batch([
			updateProjectRow,
			db
				.update(suggestion)
				.set({ status, updatedAt: now })
				.where(eq(suggestion.id, current.suggestionId))
		]);
	} else {
		await updateProjectRow;
	}

	return getProjectById(id);
}

export async function getProjectById(id: string) {
	const [row] = await db.select().from(project).where(eq(project.id, id)).limit(1);
	if (!row) throw new ProjectNotFoundError();
	return row;
}

/**
 * The committees that may own a project.
 *
 * Here rather than in a remote module because two of them need it — the project
 * pages and the "start a project" action on a suggestion — and because a remote
 * function that reaches for `db` itself is a service in the wrong layer. It is
 * also what lets a spec mock this module and get the whole surface.
 */
export async function listCommittees() {
	return db
		.select({ id: group.id, name: group.name })
		.from(group)
		.where(and(eq(group.kind, 'committee'), isNull(group.deletedAt)))
		.orderBy(asc(group.name));
}

export async function listProjects(
	opts: { status?: ProjectStatus; groupId?: string; unowned?: boolean } = {}
) {
	return db
		.select()
		.from(project)
		.where(
			and(
				opts.status ? eq(project.status, opts.status) : undefined,
				opts.groupId ? eq(project.groupId, opts.groupId) : undefined,
				opts.unowned ? isNull(project.groupId) : undefined
			)
		)
		.orderBy(desc(project.createdAt));
}

/**
 * The project answering a suggestion, if one does.
 *
 * A thin projection rather than the whole row: both callers are a line on
 * somebody else's page — the member's own suggestion, and the staff view of it
 * — and neither has any business with a budget.
 */
export async function getProjectForSuggestion(suggestionId: string) {
	const [row] = await db
		.select({ id: project.id, name: project.name, status: project.status })
		.from(project)
		.where(eq(project.suggestionId, suggestionId))
		.limit(1);
	return row ?? null;
}

/**
 * Commit to a suggestion: create the project that answers it, and move the
 * suggestion to `planned` in the same breath.
 *
 * The two writes are one `db.batch` because they are one fact. A project
 * created without its suggestion following it leaves the board saying nobody
 * has decided anything, which is the exact gap this column was added to close
 * — and D1 has no transaction to fall back on.
 */
export async function startProjectFromSuggestion(
	suggestionId: string,
	data: Omit<CreateProjectInput, 'suggestionId' | 'status'>
) {
	await assertClaimableSuggestion(suggestionId);
	if (data.groupId) await assertCommittee(data.groupId);

	const id = crypto.randomUUID();
	const now = new Date();

	await db.batch([
		db.insert(project).values({ ...data, id, suggestionId, status: 'planned' }),
		db
			.update(suggestion)
			.set({ status: 'planned', updatedAt: now })
			.where(eq(suggestion.id, suggestionId))
	]);

	return getProjectById(id);
}

// ---------------------------------------------------------------------------
// Attachment
// ---------------------------------------------------------------------------

/**
 * The five tables that carry `project_id`, keyed by the word a caller uses.
 *
 * One map rather than ten near-identical functions: every attachment is the
 * same statement against a different table, and the differences that would
 * justify separate functions — validation, side effects — do not exist. A work
 * order keeps its `eventId` and `assetId` when it gains a project; these are
 * independent anchors, not a choice between them.
 */
const ATTACHABLE = {
	work_order: workOrder,
	contractor_job: contractorJob,
	purchase_order: purchaseOrder,
	acquisition,
	event_listing: eventListing
} as const;

export type AttachableKind = keyof typeof ATTACHABLE;

export async function attachToProject(kind: AttachableKind, rowId: string, projectId: string) {
	await getProjectById(projectId);
	const table = ATTACHABLE[kind];

	const [row] = await db
		.update(table)
		.set({ projectId })
		.where(eq(table.id, rowId))
		.returning({ id: table.id });

	if (!row) throw new ProjectStateError(`No ${kind} with that id`);
	return row;
}

export async function detachFromProject(kind: AttachableKind, rowId: string) {
	const table = ATTACHABLE[kind];

	const [row] = await db
		.update(table)
		.set({ projectId: null })
		.where(eq(table.id, rowId))
		.returning({ id: table.id });

	if (!row) throw new ProjectStateError(`No ${kind} with that id`);
	return row;
}

// ---------------------------------------------------------------------------
// Burn
// ---------------------------------------------------------------------------

/**
 * What a project has cost, in two columns that are never added together.
 *
 * `cash` is money that left the account. `contributed` is what was given —
 * volunteer time and donated goods — and it belongs in a grant report rather
 * than against a budget. Summing them produces a figure that is wrong for both
 * audiences, which is why this DTO keeps them apart and the UI labels them.
 *
 * `contributed` carries **two valuations that are never added together**, and
 * the minutes behind them. Every approved minute counts toward
 * `volunteerValueCents` at the site rate; only hours under a specialized role
 * count toward `recognizableServicesCents`, at that role's own rate. The two
 * overlap by construction -- a donated audio engineer's hour is in both -- so
 * there is no combined contributed total here to be misread as one.
 *
 * `stock_movement` is deliberately absent. The prior-art report lists it as a
 * burn source, but the table carries a quantity and no value — consumption
 * reaches money through the order or the acquisition that bought the stock,
 * both of which are already counted here.
 */
export interface ProjectBurn {
	budgetCents: number | null;
	cash: {
		contractorCents: number;
		purchaseOrderCents: number;
		acquisitionCents: number;
		totalCents: number;
	};
	contributed: {
		volunteerMinutes: number;
		specializedVolunteerMinutes: number;
		/**
		 * Specialized minutes on a role with no rate set. Zero-valued rather
		 * than valued at the impact rate, and surfaced so the page can say the
		 * recognizable figure is incomplete.
		 */
		unpricedSpecializedMinutes: number;
		/** Every approved minute, at `volunteer.hourValueCents`. */
		volunteerValueCents: number;
		/** Specialized minutes only, each at its own role's market rate. */
		recognizableServicesCents: number;
		/** Work a contractor did and did not invoice for. */
		donatedServicesCents: number;
		donatedGoodsCents: number;
		/** The rate used, so a report built on this can cite itself. */
		hourValueCents: number;
	};
	/** Budget minus cash spend. Null when no budget is set — not zero. */
	remainingCents: number | null;
}

export async function getProjectBurn(projectId: string): Promise<ProjectBurn> {
	const proj = await getProjectById(projectId);

	// Two aggregates from one pass. A donated job has no `cost_cents` today, but
	// reading the flag rather than relying on that keeps a mis-entered row out of
	// cash spend instead of quietly inflating it.
	const [contractorSpend] = await db
		.select({
			cents: sql<number>`coalesce(sum(case when ${contractorJob.isDonated} then 0 else coalesce(${contractorJob.costCents}, 0) end), 0)`,
			donatedCents: sql<number>`coalesce(sum(case when ${contractorJob.isDonated} then coalesce(${contractorJob.fairValueCents}, 0) else 0 end), 0)`
		})
		.from(contractorJob)
		.where(eq(contractorJob.projectId, projectId));

	// Ordered rather than received: an order that is placed has committed the
	// money, and a project's burn has to show it before the boxes arrive.
	const [orders] = await db
		.select({
			cents: sql<number>`coalesce(sum(${purchaseOrderLine.unitCostCents} * ${purchaseOrderLine.quantityOrdered}), 0)`
		})
		.from(purchaseOrderLine)
		.innerJoin(purchaseOrder, eq(purchaseOrderLine.orderId, purchaseOrder.id))
		.where(
			and(eq(purchaseOrder.projectId, projectId), sql`${purchaseOrder.status} != 'cancelled'`)
		);

	// `total_cents` is what was paid and `fair_value_cents` what a gift was
	// worth, so the same table feeds both columns and neither reads the other's.
	const [acquired] = await db
		.select({
			paidCents: sql<number>`coalesce(sum(${acquisition.totalCents}), 0)`,
			donatedCents: sql<number>`coalesce(sum(${acquisition.fairValueCents}), 0)`
		})
		.from(acquisition)
		.where(eq(acquisition.projectId, projectId));

	// Approved hours only. A pending log is a claim, not a contribution, and a
	// grant report built on unreviewed time is one nobody can defend.
	const [labour] = await db
		.select({
			minutes: sql<number>`coalesce(sum(${volunteerHourLog.minutes}), 0)`,
			specializedMinutes: sql<number>`coalesce(sum(case when ${volunteerRole.isSpecializedSkill} then ${volunteerHourLog.minutes} else 0 end), 0)`,
			unpricedSpecializedMinutes: sql<number>`coalesce(sum(case when ${volunteerRole.isSpecializedSkill} and ${volunteerRole.marketRateCents} is null then ${volunteerHourLog.minutes} else 0 end), 0)`,
			// Minute-cents; divided by 60 below. SQLite integer division
			// truncates, and each role carries its own rate, so the weighting
			// has to happen inside the sum.
			specializedMinuteCents: sql<number>`coalesce(sum(case when ${volunteerRole.isSpecializedSkill} and ${volunteerRole.marketRateCents} is not null then ${volunteerHourLog.minutes} * ${volunteerRole.marketRateCents} else 0 end), 0)`
		})
		.from(volunteerHourLog)
		.innerJoin(workOrder, eq(volunteerHourLog.shiftId, workOrder.id))
		.innerJoin(volunteerRole, eq(volunteerHourLog.volunteerRoleId, volunteerRole.id))
		.where(and(eq(workOrder.projectId, projectId), eq(volunteerHourLog.status, 'approved')));

	const hourValueCents = await getHourValueCents();

	const contractorCents = Number(contractorSpend?.cents ?? 0);
	const purchaseOrderCents = Number(orders?.cents ?? 0);
	const acquisitionCents = Number(acquired?.paidCents ?? 0);
	const totalCents = contractorCents + purchaseOrderCents + acquisitionCents;

	const volunteerMinutes = Number(labour?.minutes ?? 0);

	return {
		budgetCents: proj.budgetCents,
		cash: { contractorCents, purchaseOrderCents, acquisitionCents, totalCents },
		contributed: {
			volunteerMinutes,
			specializedVolunteerMinutes: Number(labour?.specializedMinutes ?? 0),
			unpricedSpecializedMinutes: Number(labour?.unpricedSpecializedMinutes ?? 0),
			volunteerValueCents: valueOfMinutesCents(volunteerMinutes, hourValueCents),
			recognizableServicesCents: Math.round(Number(labour?.specializedMinuteCents ?? 0) / 60),
			donatedServicesCents: Number(contractorSpend?.donatedCents ?? 0),
			donatedGoodsCents: Number(acquired?.donatedCents ?? 0),
			hourValueCents
		},
		remainingCents: proj.budgetCents === null ? null : proj.budgetCents - totalCents
	};
}

/** Everything hanging off the project, for its detail page. */
export async function listProjectAttachments(projectId: string) {
	const [workOrders, jobs, orders, acquisitions, events] = await Promise.all([
		db
			.select()
			.from(workOrder)
			.where(eq(workOrder.projectId, projectId))
			.orderBy(asc(workOrder.startsAt)),
		db
			.select()
			.from(contractorJob)
			.where(eq(contractorJob.projectId, projectId))
			.orderBy(desc(contractorJob.createdAt)),
		db
			.select()
			.from(purchaseOrder)
			.where(eq(purchaseOrder.projectId, projectId))
			.orderBy(desc(purchaseOrder.createdAt)),
		db
			.select()
			.from(acquisition)
			.where(eq(acquisition.projectId, projectId))
			.orderBy(desc(acquisition.occurredAt)),
		db
			.select()
			.from(eventListing)
			.where(eq(eventListing.projectId, projectId))
			.orderBy(asc(eventListing.startsAt))
	]);

	return { workOrders, jobs, orders, acquisitions, events };
}
