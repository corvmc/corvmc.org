import { and, desc, eq, isNotNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '#lib/server/db/index.js';
import {
	listAuditEntriesForSubject,
	type AuditSubjectFilter
} from '#lib/server/audit/audit-service.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { project } from '#lib/server/db/schema/project.js';
import { suggestion } from '#lib/server/db/schema/suggestion.js';
import { ballot } from '#lib/server/db/schema/ballot.js';
import { volunteerRole, workOrder, workTask } from '#lib/server/db/schema/volunteer.js';
import { auditFeedItem } from '#lib/utils/audit-display.js';
import {
	FEED_MAX,
	FEED_PAGE,
	feedLimit,
	mergeFeed,
	type FeedItem,
	type FeedPage
} from '#lib/types/activity.js';

/**
 * A project's history, or one work order's: audit entries on the project and on
 * its work orders, duty ticks (read from `work_task`, never audited), and for a
 * project its origin chain read from the suggestion, ballot and project rows.
 * Newest first. Each source is read with `limit + 1` and merged, so `hasMore`
 * is exact without counting.
 */

export type ActivityScope = { projectId: string } | { workOrderId: string };

export interface ActivityItem extends FeedItem {
	actorName: string;
	/** The work order it is about, when it is about one. */
	task: { id: string; title: string } | null;
	/** An origin step's record, for a link. */
	origin: { kind: 'suggestion' | 'ballot'; id: string } | null;
}

export type ActivityPage = FeedPage<ActivityItem>;

export const ACTIVITY_PAGE = FEED_PAGE;
export const ACTIVITY_MAX = FEED_MAX;

const taskTitle = sql<string>`coalesce(${workOrder.title}, ${volunteerRole.name}, 'Untitled task')`;

/** A project's work orders as a subquery, so no number of them adds a bound parameter. */
function projectWorkOrders(projectId: string) {
	return db.select({ id: workOrder.id }).from(workOrder).where(eq(workOrder.projectId, projectId));
}

/** Whose audit entries the scope reads. Exported so a spec can read the SQL it makes. */
export function activitySubjects(scope: ActivityScope): AuditSubjectFilter[] {
	return 'workOrderId' in scope
		? [{ type: 'work_order', id: scope.workOrderId }]
		: [
				{ type: 'project', id: scope.projectId },
				{ type: 'work_order', ids: projectWorkOrders(scope.projectId) }
			];
}

async function auditItems(scope: ActivityScope, limit: number): Promise<ActivityPage> {
	const [{ entries, hasMore }, titles] = await Promise.all([
		listAuditEntriesForSubject(activitySubjects(scope), { limit }),
		db
			.select({ id: workOrder.id, title: taskTitle })
			.from(workOrder)
			.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
			.where(
				'workOrderId' in scope
					? eq(workOrder.id, scope.workOrderId)
					: eq(workOrder.projectId, scope.projectId)
			)
	]);
	const titleOf = new Map(titles.map((t) => [t.id, t.title]));
	const items = entries.map((entry) => {
		const title = entry.subjectType === 'work_order' ? titleOf.get(entry.subjectId) : undefined;
		return {
			...auditFeedItem(entry),
			actorName: entry.actorName,
			task: title !== undefined ? { id: entry.subjectId, title } : null,
			origin: null
		};
	});
	return { items, hasMore };
}

async function tickItems(scope: ActivityScope, limit: number): Promise<ActivityItem[]> {
	const rows = await db
		.select({
			id: workTask.id,
			label: workTask.label,
			at: workTask.doneAt,
			actorId: workTask.doneByUserId,
			actorName: user.name,
			taskId: workOrder.id,
			taskTitle
		})
		.from(workTask)
		.innerJoin(workOrder, eq(workOrder.id, workTask.workOrderId))
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.leftJoin(user, eq(user.id, workTask.doneByUserId))
		.where(
			and(
				'workOrderId' in scope
					? eq(workTask.workOrderId, scope.workOrderId)
					: eq(workOrder.projectId, scope.projectId),
				isNotNull(workTask.doneAt)
			)
		)
		.orderBy(desc(workTask.doneAt), desc(workTask.id))
		.limit(limit);
	return rows.map((r) => ({
		id: `tick:${r.id}`,
		at: r.at!,
		actorId: r.actorId,
		actorName: r.actorName ?? 'Someone',
		summary: `Ticked “${r.label}”`,
		task: { id: r.taskId, title: r.taskTitle },
		origin: null
	}));
}

/** Suggestion → ballot → project, each step from its own row. */
async function originItems(projectId: string): Promise<ActivityItem[]> {
	const creator = alias(user, 'creator');
	const author = alias(user, 'author');
	const opener = alias(user, 'opener');
	const certifier = alias(user, 'certifier');
	const [[p], ballots] = await Promise.all([
		db
			.select({
				createdAt: project.createdAt,
				createdBy: project.createdByUserId,
				creatorName: creator.name,
				suggestionId: suggestion.id,
				suggestionTitle: suggestion.title,
				suggestedAt: suggestion.createdAt,
				authorId: suggestion.authorUserId,
				authorName: author.name
			})
			.from(project)
			.leftJoin(creator, eq(creator.id, project.createdByUserId))
			.leftJoin(suggestion, eq(suggestion.id, project.suggestionId))
			.leftJoin(author, eq(author.id, suggestion.authorUserId))
			.where(eq(project.id, projectId))
			.limit(1),
		db
			.select({
				id: ballot.id,
				title: ballot.title,
				openedAt: ballot.openedAt,
				openerId: ballot.createdById,
				openerName: opener.name,
				certifiedAt: ballot.certifiedAt,
				certifierId: ballot.certifierId,
				certifierName: certifier.name,
				passed: ballot.passed
			})
			.from(ballot)
			.leftJoin(opener, eq(opener.id, ballot.createdById))
			.leftJoin(certifier, eq(certifier.id, ballot.certifierId))
			.where(
				and(
					or(
						eq(ballot.projectId, projectId),
						sql`${ballot.id} = (select "ballot_id" from "project" where "id" = ${projectId})`
					),
					isNotNull(ballot.openedAt)
				)
			)
	]);
	if (!p) return [];

	const items: ActivityItem[] = [
		{
			id: 'origin:project',
			at: p.createdAt,
			actorId: p.createdBy,
			actorName: p.creatorName ?? 'Staff',
			summary: 'Started the project',
			task: null,
			origin: null
		}
	];
	if (p.suggestionId && p.suggestedAt) {
		items.push({
			id: 'origin:suggestion',
			at: p.suggestedAt,
			actorId: p.authorId,
			actorName: p.authorName ?? 'A member',
			summary: `Suggested “${p.suggestionTitle}”`,
			task: null,
			origin: { kind: 'suggestion', id: p.suggestionId }
		});
	}
	for (const b of ballots) {
		const origin = { kind: 'ballot' as const, id: b.id };
		items.push({
			id: `origin:ballot-opened:${b.id}`,
			at: b.openedAt!,
			actorId: b.openerId,
			actorName: b.openerName ?? 'Staff',
			summary: `Put “${b.title}” to a ballot`,
			task: null,
			origin
		});
		if (b.certifiedAt) {
			items.push({
				id: `origin:ballot-certified:${b.id}`,
				at: b.certifiedAt,
				actorId: b.certifierId,
				actorName: b.certifierName ?? 'Staff',
				summary: `Certified “${b.title}”: ${b.passed ? 'passed' : 'did not pass'}`,
				task: null,
				origin
			});
		}
	}
	return items;
}

export async function listActivity(
	scope: ActivityScope,
	opts: { limit?: number } = {}
): Promise<ActivityPage> {
	const limit = feedLimit(opts.limit);
	const [audits, ticks, origin] = await Promise.all([
		auditItems(scope, limit),
		tickItems(scope, limit + 1),
		'projectId' in scope ? originItems(scope.projectId) : Promise.resolve([])
	]);
	return mergeFeed(limit, audits, { items: [...ticks, ...origin], hasMore: false });
}
