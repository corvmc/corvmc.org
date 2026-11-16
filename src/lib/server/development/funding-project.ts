import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { db } from '#lib/server/db/index.js';
import { group, groupCapability } from '#lib/server/db/schema/group.js';
import { project } from '#lib/server/db/schema/project.js';
import { dutyList, volunteerRole, workOrder } from '#lib/server/db/schema/volunteer.js';
import { DomainError } from '#lib/server/domain-error.js';
import { ownerRow } from '#lib/server/project/project-service.js';
import {
	applyDutyList,
	DutyListAlreadyAppliedError,
	type ApplyDutyListResult
} from '#lib/server/volunteer/duty-list-service.js';
import { captureException } from '#lib/server/sentry.js';
import { fundingProjectKinds, projectArchivedStatuses, type GrantStage } from '#lib/config.js';

/**
 * A grant application or a sponsorship is a project of its own kind, holding
 * the work while the side table holds the money (#2622). These are the writes
 * that open and remove that project, shared by both modules.
 */

export type FundingKind = 'grant' | 'sponsorship';

/** The capability whose committee owns each kind's work: Development's, on production. */
const ownerCapability = {
	grant: 'grant.manage',
	sponsorship: 'sponsor.manage'
} as const satisfies Record<FundingKind, string>;

/**
 * The live committee holding the kind's manage capability, `development-committee`
 * first when several do. Null when none does: the project is then staff's alone.
 */
export async function fundingCommitteeId(kind: FundingKind): Promise<string | null> {
	const [row] = await db
		.select({ id: group.id })
		.from(group)
		.innerJoin(
			groupCapability,
			and(
				eq(groupCapability.groupId, group.id),
				eq(groupCapability.capability, ownerCapability[kind])
			)
		)
		.where(and(eq(group.kind, 'committee'), isNull(group.deletedAt)))
		.orderBy(desc(sql`${group.slug} = 'development-committee'`), asc(group.name))
		.limit(1);
	return row?.id ?? null;
}

export interface FundingProjectInput {
	projectId: string;
	kind: FundingKind;
	/** The application's or sponsorship's title; the project is named for it. */
	name: string;
	ownerGroupId: string | null;
	createdByUserId: string | null;
}

/**
 * The project and its owner row, as batch items. They go ahead of the side
 * table's insert in the same batch: its `project_id` is a real foreign key.
 */
export function fundingProjectWrites(
	input: FundingProjectInput
): [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] {
	return [
		db.insert(project).values({
			id: input.projectId,
			name: input.name,
			kind: input.kind,
			createdByUserId: input.createdByUserId
		}),
		...(input.ownerGroupId ? [ownerRow(input.projectId, input.ownerGroupId)] : [])
	];
}

/** Keep the project named for its application or sponsorship. */
export function renameFundingProject(projectId: string, name: string) {
	return db
		.update(project)
		.set({ name, updatedAt: new Date() })
		.where(and(eq(project.id, projectId), sql`${project.name} != ${name}`));
}

/**
 * The project and its tasks, after the side-table row that restricts it. A task
 * with a contractor job refuses the batch, so nothing is removed.
 */
export function deleteFundingProjectWrites(projectId: string): BatchItem<'sqlite'>[] {
	return [
		db.delete(workOrder).where(eq(workOrder.projectId, projectId)),
		db.delete(project).where(eq(project.id, projectId))
	];
}

/** The live template for a grant stage, if staff have not deactivated it. */
export async function grantStageTemplateId(stage: GrantStage): Promise<string | null> {
	const [row] = await db
		.select({ id: dutyList.id })
		.from(dutyList)
		.where(and(eq(dutyList.grantStage, stage), eq(dutyList.isActive, true)))
		.limit(1);
	return row?.id ?? null;
}

/**
 * Stamp a stage's template into a grant's project. Null when there is no such
 * template, or it was already applied. Any other failure is reported and
 * swallowed: the grant stands without its checklist, which can be added by hand.
 */
export async function stampGrantStage(
	projectId: string,
	stage: GrantStage,
	createdByUserId: string | null
): Promise<ApplyDutyListResult | null> {
	try {
		const templateId = await grantStageTemplateId(stage);
		if (!templateId) return null;
		return await applyDutyList(templateId, { kind: 'project', id: projectId }, createdByUserId);
	} catch (err) {
		if (err instanceof DutyListAlreadyAppliedError) return null;
		captureException(err, { event: 'grant.template', projectId, stage });
		return null;
	}
}

export class FundedProjectError extends DomainError {
	readonly httpStatus = 400;
	constructor() {
		super('Pick a project the money pays for, not a grant or sponsorship.');
	}
}

/** What the money pays for must be a real project, and not another funding record's. */
export async function assertFundable(projectId: string | null | undefined): Promise<void> {
	if (!projectId) return;
	const [row] = await db
		.select({ kind: project.kind })
		.from(project)
		.where(eq(project.id, projectId))
		.limit(1);
	if (!row || (fundingProjectKinds as readonly string[]).includes(row.kind)) {
		throw new FundedProjectError();
	}
}

/**
 * The projects money can be pointed at: live ones that are not themselves a
 * grant or sponsorship, plus any in `keep` that a record already names, archived or not.
 */
export async function listFundableProjects(keep: (string | null | undefined)[] = []) {
	const kept = keep.filter((id): id is string => Boolean(id));
	return db
		.select({ id: project.id, name: project.name })
		.from(project)
		.where(
			and(
				notInArray(project.kind, [...fundingProjectKinds]),
				or(
					notInArray(project.status, [...projectArchivedStatuses]),
					kept.length ? inArray(project.id, kept) : undefined
				)
			)
		)
		.orderBy(asc(project.name));
}

export interface NextTask {
	id: string;
	title: string;
	dueAt: Date | null;
}

/**
 * Each project's earliest open task: the soonest due, then undated ones in list
 * order. What "next step" means on a grant or sponsorship.
 */
export async function nextOpenTasks(projectIds: string[]): Promise<Map<string, NextTask>> {
	if (projectIds.length === 0) return new Map();
	const rows = await db
		.select({
			projectId: workOrder.projectId,
			id: workOrder.id,
			title: sql<string>`coalesce(${workOrder.title}, ${volunteerRole.name}, 'Untitled task')`,
			dueAt: workOrder.dueAt
		})
		.from(workOrder)
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(
			and(
				inArray(workOrder.projectId, projectIds),
				isNull(workOrder.resolvedAt),
				isNull(workOrder.cancelledAt)
			)
		)
		.orderBy(sql`${workOrder.dueAt} is null`, asc(workOrder.dueAt), asc(workOrder.sortOrder));
	const next = new Map<string, NextTask>();
	for (const { projectId, ...task } of rows) {
		if (projectId && !next.has(projectId)) next.set(projectId, task);
	}
	return next;
}

/** The stages whose template is on the project, counting only work not called off. */
export async function appliedGrantStages(projectId: string): Promise<Set<GrantStage>> {
	const rows = await db
		.selectDistinct({ stage: dutyList.grantStage })
		.from(workOrder)
		.innerJoin(dutyList, eq(dutyList.id, workOrder.dutyListId))
		.where(
			and(
				eq(workOrder.projectId, projectId),
				isNull(workOrder.cancelledAt),
				isNotNull(dutyList.grantStage)
			)
		);
	return new Set(rows.flatMap((r) => (r.stage ? [r.stage] : [])));
}
