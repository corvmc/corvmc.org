import { db } from '#lib/server/db/index.js';
import { organization } from '#lib/server/db/schema/party.js';
import { requireRole } from '#lib/server/party/organization-service.js';
import {
	grantApplication,
	type GrantApplication,
	type NewGrantApplication
} from '#lib/server/db/schema/grant.js';
import { eq, inArray, sql } from 'drizzle-orm';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import { DomainError } from '#lib/server/domain-error.js';
import { grantDeadlineLabels, type GrantDeadlineKind, type GrantStage } from '#lib/config.js';
import { addIsoDays, due, earliest, type Deadline } from '#lib/utils/deadline.js';
import {
	appliedGrantStages,
	assertFundable,
	deleteFundingProjectWrites,
	fundingCommitteeId,
	fundingProjectWrites,
	grantStageTemplateId,
	nextOpenTasks,
	renameFundingProject,
	stampGrantStage
} from '#lib/server/development/funding-project.js';
import { applyDutyList, grantDayAt } from '#lib/server/volunteer/duty-list-service.js';
import { placePendingWorkOrders } from '#lib/server/volunteer/retime-work-orders.js';

export class GrantNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Grant application not found');
	}
}

export class GrantStageUnavailableError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('That template is switched off or missing. Add the tasks by hand.');
	}
}

export type GrantDeadline = Deadline<GrantDeadlineKind>;

/** How far ahead of the award end the close-out template is offered. */
const CLOSE_OUT_LEAD_DAYS = 30;

/**
 * The stage templates to offer on a grant, never applied unasked: the award's
 * once it is awarded, and the close-out's from a month before the award ends.
 * A stage already on the project is not offered again.
 */
export function grantStageOffers(
	g: Pick<GrantApplication, 'status' | 'endsOn'>,
	applied: ReadonlySet<GrantStage>,
	today: string
): GrantStage[] {
	if (g.status !== 'awarded') return [];
	const offers: GrantStage[] = [];
	if (!applied.has('award')) offers.push('award');
	const ending = g.endsOn !== null && addIsoDays(today, CLOSE_OUT_LEAD_DAYS) >= g.endsOn;
	if (ending && !applied.has('close_out')) offers.push('close_out');
	return offers;
}

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

export async function getGrant(id: string, today: string) {
	const [row] = await db
		.select({ grant: grantApplication, funderName: organization.name })
		.from(grantApplication)
		.innerJoin(organization, eq(organization.id, grantApplication.organizationId))
		.where(eq(grantApplication.id, id))
		.limit(1);
	if (!row) throw new GrantNotFoundError();
	const projectId = row.grant.projectId;
	const [next, applied] = await Promise.all([
		nextOpenTasks(projectId ? [projectId] : []),
		projectId ? appliedGrantStages(projectId) : new Set<GrantStage>()
	]);
	const offered = grantStageOffers(row.grant, applied, today);
	const live = await Promise.all(offered.map(grantStageTemplateId));
	return {
		...row.grant,
		funderId: row.grant.organizationId,
		funderName: row.funderName,
		deadline: grantDeadline(row.grant, today),
		nextTask: (projectId && next.get(projectId)) || null,
		/** Stage templates to offer, each with a live template behind it. */
		offers: offered.filter((_, i) => live[i] !== null)
	};
}

export type GrantInput = Omit<NewGrantApplication, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>;

/**
 * The application, its project owned by the committee holding `grant.manage`,
 * and the "Grant application" template stamped into it.
 */
export async function createGrant(
	input: GrantInput,
	opts: { createdByUserId?: string | null } = {}
): Promise<GrantApplication> {
	await requireRole(input.organizationId, 'funder');
	await assertFundable(input.fundsProjectId);
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
	await assertFundable(input.fundsProjectId);
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
		.select({
			projectId: grantApplication.projectId,
			title: grantApplication.title,
			funderId: grantApplication.organizationId,
			funderName: organization.name
		})
		.from(grantApplication)
		.leftJoin(organization, eq(organization.id, grantApplication.organizationId))
		.where(eq(grantApplication.id, id))
		.limit(1);
	if (!row) throw new GrantNotFoundError();
	await db.batch([
		db.delete(grantApplication).where(eq(grantApplication.id, id)),
		...(row.projectId ? deleteFundingProjectWrites(row.projectId) : [])
	]);
	await recordAuditEntry({
		action: 'grant.deleted',
		subject: { type: 'organization', id: row.funderId, label: row.funderName },
		details: { grantId: id, title: row.title }
	});
}

/** Stamp a stage's template into the grant's project, on staff's say-so. */
export async function applyGrantStage(
	id: string,
	stage: GrantStage,
	createdByUserId: string
): Promise<void> {
	const [row] = await db
		.select({ projectId: grantApplication.projectId })
		.from(grantApplication)
		.where(eq(grantApplication.id, id))
		.limit(1);
	if (!row) throw new GrantNotFoundError();
	const templateId = await grantStageTemplateId(stage);
	if (!templateId || !row.projectId) throw new GrantStageUnavailableError();
	await applyDutyList(templateId, { kind: 'project', id: row.projectId }, createdByUserId);
}
