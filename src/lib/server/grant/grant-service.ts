import { db } from '#lib/server/db/index.js';
import { organization } from '#lib/server/db/schema/party.js';
import { requireRole } from '#lib/server/party/organization-service.js';
import {
	grantApplication,
	type GrantApplication,
	type NewGrantApplication
} from '#lib/server/db/schema/grant.js';
import { eq, inArray, sql } from 'drizzle-orm';
import { DomainError } from '#lib/server/domain-error.js';
import {
	grantDeadlineLabels,
	openGrantStatuses,
	type GrantDeadlineKind,
	type GrantStatus
} from '#lib/config.js';
import { byDeadline, due, earliest, type Deadline } from '#lib/utils/deadline.js';
import {
	deleteFundingProjectWrites,
	fundingCommitteeId,
	fundingProjectWrites,
	renameFundingProject,
	stampGrantStage
} from '#lib/server/development/funding-project.js';
import { grantDayAt } from '#lib/server/volunteer/duty-list-service.js';
import { placePendingWorkOrders } from '#lib/server/volunteer/retime-work-orders.js';

export class GrantNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Grant application not found');
	}
}

export type GrantDeadline = Deadline<GrantDeadlineKind>;

type GrantDates = Pick<GrantApplication, 'status' | 'applyBy' | 'endsOn'>;

/**
 * The dates on the grant itself. A prospect owes its application; an award runs
 * to its end. Reports are tasks on the grant's project, reminded as tasks.
 */
function openDeadlines(g: GrantDates): { kind: GrantDeadlineKind; on: string }[] {
	if (g.status === 'prospect') return g.applyBy ? [{ kind: 'apply', on: g.applyBy }] : [];
	if (g.status === 'awarded' && g.endsOn) return [{ kind: 'end', on: g.endsOn }];
	return [];
}

/** What comes due next on the grant itself. */
export function grantDeadline(g: GrantDates, today: string): GrantDeadline | null {
	return earliest<GrantDeadlineKind>(...openDeadlines(g).map((d) => due(d.kind, d.on, today)));
}

/** Each open deadline with a subject id of its own, for the reminder sweep. */
export function grantDeadlineItems(g: GrantDates & { id: string }) {
	return openDeadlines(g).map((d) => ({
		kind: d.kind,
		on: d.on,
		subjectId: `${d.kind}:${g.id}`,
		title: grantDeadlineLabels[d.kind]
	}));
}

/** Every open grant deadline falling on a day in `[from, to]`. */
export async function listGrantDeadlinesBetween(from: string, to: string) {
	const apps = await db
		.select({
			id: grantApplication.id,
			title: grantApplication.title,
			status: grantApplication.status,
			applyBy: grantApplication.applyBy,
			endsOn: grantApplication.endsOn,
			funderName: organization.name
		})
		.from(grantApplication)
		.innerJoin(organization, eq(organization.id, grantApplication.organizationId))
		.where(inArray(grantApplication.status, ['prospect', 'awarded']));
	return apps.flatMap((g) =>
		grantDeadlineItems(g)
			.filter((d) => d.on >= from && d.on <= to)
			.map((d) => ({ ...d, parentId: g.id, parentTitle: g.title, counterparty: g.funderName }))
	);
}

/** Attach each application's deadline and sort soonest first, undated last. */
export function withDeadlines<
	G extends Pick<GrantApplication, 'id' | 'status' | 'applyBy' | 'endsOn'> & { funderName: string }
>(apps: G[], today: string) {
	return apps
		.map((g) => ({ ...g, deadline: grantDeadline(g, today) }))
		.sort(byDeadline((r) => r.funderName));
}

const open: readonly GrantStatus[] = openGrantStatuses;

export async function listGrants(opts: { today: string; includeClosed?: boolean }) {
	const apps = await db
		.select({
			id: grantApplication.id,
			projectId: grantApplication.projectId,
			title: grantApplication.title,
			status: grantApplication.status,
			amountRequestedCents: grantApplication.amountRequestedCents,
			amountAwardedCents: grantApplication.amountAwardedCents,
			applyBy: grantApplication.applyBy,
			endsOn: grantApplication.endsOn,
			funderId: grantApplication.organizationId,
			funderName: organization.name
		})
		.from(grantApplication)
		.innerJoin(organization, eq(organization.id, grantApplication.organizationId));
	return withDeadlines(apps, opts.today).filter(
		(g) => opts.includeClosed || open.includes(g.status) || g.deadline
	);
}

export async function getGrant(id: string, today: string) {
	const [row] = await db
		.select({ grant: grantApplication, funderName: organization.name })
		.from(grantApplication)
		.innerJoin(organization, eq(organization.id, grantApplication.organizationId))
		.where(eq(grantApplication.id, id))
		.limit(1);
	if (!row) throw new GrantNotFoundError();
	return {
		...row.grant,
		funderId: row.grant.organizationId,
		funderName: row.funderName,
		deadline: grantDeadline(row.grant, today)
	};
}

export type GrantInput = Omit<
	NewGrantApplication,
	'id' | 'projectId' | 'fundsProjectId' | 'createdAt' | 'updatedAt'
>;

/**
 * The application, its project owned by the committee holding `grant.manage`,
 * and the "Grant application" template stamped into it.
 */
export async function createGrant(
	input: GrantInput,
	opts: { createdByUserId?: string | null } = {}
): Promise<GrantApplication> {
	await requireRole(input.organizationId, 'funder');
	const createdByUserId = opts.createdByUserId ?? null;
	const projectId = crypto.randomUUID();
	const id = crypto.randomUUID();
	await db.batch([
		...fundingProjectWrites({
			projectId,
			kind: 'grant',
			name: input.title,
			ownerGroupId: await fundingCommitteeId('grant'),
			createdByUserId
		}),
		db.insert(grantApplication).values({ ...input, id, projectId })
	]);
	await stampGrantStage(projectId, 'application', createdByUserId);
	const [row] = await db.select().from(grantApplication).where(eq(grantApplication.id, id));
	return row;
}

/** Template work waiting on a grant date is placed once the date is set. */
function placeGrantWork(projectId: string, input: GrantInput) {
	const dates = [
		['apply_by', input.applyBy],
		['award_start', input.startsOn],
		['award_end', input.endsOn]
	] as const;
	return dates.flatMap(([anchor, day]) => {
		if (!day) return [];
		const at = Math.floor(grantDayAt(day).getTime() / 1000);
		return placePendingWorkOrders({ projectId }, [anchor], sql`${at}`);
	});
}

export async function updateGrant(id: string, input: GrantInput): Promise<void> {
	await requireRole(input.organizationId, 'funder');
	const rows = await db
		.update(grantApplication)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(grantApplication.id, id))
		.returning({ projectId: grantApplication.projectId });
	if (rows.length === 0) throw new GrantNotFoundError();
	const projectId = rows[0].projectId;
	if (!projectId) return;
	await db.batch([
		renameFundingProject(projectId, input.title),
		...placeGrantWork(projectId, input)
	]);
}

/** Its project and that project's tasks go with it. */
export async function deleteGrant(id: string): Promise<void> {
	const [row] = await db
		.select({ projectId: grantApplication.projectId })
		.from(grantApplication)
		.where(eq(grantApplication.id, id))
		.limit(1);
	if (!row) throw new GrantNotFoundError();
	await db.batch([
		db.delete(grantApplication).where(eq(grantApplication.id, id)),
		...(row.projectId ? deleteFundingProjectWrites(row.projectId) : [])
	]);
}
