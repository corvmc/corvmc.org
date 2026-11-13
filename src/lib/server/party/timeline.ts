import { db } from '#lib/server/db/index.js';
import { activity } from '#lib/server/db/schema/activity.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { workOrder, volunteerRole } from '#lib/server/db/schema/volunteer.js';
import { contractorJob } from '#lib/server/db/schema/contractor.js';
import { grantApplication } from '#lib/server/db/schema/grant.js';
import { sponsorship } from '#lib/server/db/schema/sponsor.js';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import {
	listAuditEntriesForSubject,
	type AuditSubjectFilter
} from '#lib/server/audit/audit-service.js';
import { linkedTo } from '#lib/server/task/work-order-link.js';
import { auditFeedItem } from '#lib/utils/audit-display.js';
import { clubInstant } from '#lib/utils/format.js';
import { feedLimit, mergeFeed, type FeedItem, type FeedPage } from '#lib/types/activity.js';
import type { ActivityKind } from '#lib/config.js';
import { ownedBy, type PartyRef } from './activity-service';
import { filedThreads } from './thread-filing';

/**
 * One timeline per organization or person (#2622), newest first: the notes
 * staff logged, the Inbox conversations filed to it, the audit entries for its
 * grants, sponsorships and jobs, and the tasks about it that were marked done. Each source is read with
 * `limit + 1` and merged, so "Show older" is exact.
 */

export type TimelineItem = FeedItem &
	(
		| {
				source: 'note';
				note: { id: string; kind: ActivityKind; occurredOn: string; body: string };
		  }
		| { source: 'audit' }
		| { source: 'task'; workOrderId: string }
		| { source: 'thread'; threadId: string }
	);

async function notes(party: PartyRef, limit: number): Promise<FeedPage<TimelineItem>> {
	const rows = await db
		.select({
			id: activity.id,
			kind: activity.kind,
			occurredOn: activity.occurredOn,
			body: activity.body,
			authorUserId: activity.authorUserId,
			authorName: user.name
		})
		.from(activity)
		.leftJoin(user, eq(user.id, activity.authorUserId))
		.where(ownedBy(party))
		.orderBy(desc(activity.occurredOn), desc(activity.createdAt), desc(activity.id))
		.limit(limit + 1);
	return {
		items: rows.slice(0, limit).map((r) => ({
			source: 'note',
			id: `note:${r.id}`,
			// A day, not a time: noon keeps it inside the day in any reading of the zone.
			at: clubInstant(r.occurredOn, '12:00'),
			actorId: r.authorUserId,
			actorName: r.authorName,
			summary: r.body,
			note: { id: r.id, kind: r.kind, occurredOn: r.occurredOn, body: r.body }
		})),
		hasMore: rows.length > limit
	};
}

/** The audit subjects that are this party's: itself, and for an organization its funding and jobs. */
function auditSubjects(party: PartyRef): AuditSubjectFilter[] {
	if (party.type === 'contact') return [{ type: 'contact', id: party.id }];
	const fundingProjects = db
		.select({ id: grantApplication.projectId })
		.from(grantApplication)
		.where(
			and(eq(grantApplication.organizationId, party.id), isNotNull(grantApplication.projectId))
		)
		.union(
			db
				.select({ id: sponsorship.projectId })
				.from(sponsorship)
				.where(and(eq(sponsorship.organizationId, party.id), isNotNull(sponsorship.projectId)))
		);
	const jobs = db
		.select({ id: contractorJob.workOrderId })
		.from(contractorJob)
		.where(eq(contractorJob.organizationId, party.id));
	return [
		{ type: 'organization', id: party.id },
		{ type: 'project', ids: fundingProjects },
		{ type: 'work_order', ids: jobs }
	];
}

async function audits(party: PartyRef, limit: number): Promise<FeedPage<TimelineItem>> {
	const { entries, hasMore } = await listAuditEntriesForSubject(auditSubjects(party), { limit });
	return {
		items: entries.map((e) => ({ ...auditFeedItem(e), source: 'audit' as const })),
		hasMore
	};
}

/** Tasks about the party (`work_order_link`) that were marked done. */
async function doneTasks(party: PartyRef, limit: number): Promise<FeedPage<TimelineItem>> {
	const resolver = db.select({ id: user.id, name: user.name }).from(user).as('resolver');
	const rows = await db
		.select({
			id: workOrder.id,
			title: sql<string>`coalesce(${workOrder.title}, ${volunteerRole.name}, 'Task')`,
			resolvedAt: workOrder.resolvedAt,
			resolvedByUserId: workOrder.resolvedByUserId,
			resolverName: resolver.name
		})
		.from(workOrder)
		.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.leftJoin(resolver, eq(resolver.id, workOrder.resolvedByUserId))
		.where(
			and(
				linkedTo(party.type === 'organization' ? 'organizationId' : 'contactId', party.id),
				isNotNull(workOrder.resolvedAt),
				isNull(workOrder.cancelledAt)
			)
		)
		.orderBy(desc(workOrder.resolvedAt), desc(workOrder.id))
		.limit(limit + 1);
	return {
		items: rows.slice(0, limit).map((r) => ({
			source: 'task',
			id: `task:${r.id}`,
			at: r.resolvedAt!,
			actorId: r.resolvedByUserId,
			actorName: r.resolverName,
			summary: r.title,
			workOrderId: r.id
		})),
		hasMore: rows.length > limit
	};
}

export async function partyTimeline(
	party: PartyRef,
	opts: { limit?: number } = {}
): Promise<FeedPage<TimelineItem>> {
	const limit = feedLimit(opts.limit);
	const pages = await Promise.all([
		notes(party, limit),
		audits(party, limit),
		doneTasks(party, limit),
		filedThreads(party, limit)
	]);
	return mergeFeed(limit, ...pages);
}
