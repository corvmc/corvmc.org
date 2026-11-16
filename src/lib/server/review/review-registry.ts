import { db } from '#lib/server/db/index.js';
import { and, asc, eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { user } from '#lib/server/db/schema/authentication.js';
import { suggestion, suggestionEdit } from '#lib/server/db/schema/suggestion.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { localResource } from '#lib/server/db/schema/local-resource.js';
import { moderationAppeal } from '#lib/server/db/schema/moderation.js';
import { classifiedPost } from '#lib/server/db/schema/classified.js';
import { contentFlag } from '#lib/server/db/schema/flag.js';
import { inventoryAsset, inventoryItem, workRequest } from '#lib/server/db/schema/inventory.js';
import {
	groupApplication,
	groupApplicationChoice
} from '#lib/server/db/schema/group-application.js';
import { group } from '#lib/server/db/schema/group.js';
import { marketVendor } from '#lib/server/db/schema/market.js';
import {
	volunteerHourLog,
	volunteerProfile,
	volunteerRole,
	volunteerShift,
	volunteerSignup,
	workOrder
} from '#lib/server/db/schema/volunteer.js';
import {
	awaitingModeration,
	awaitingResponse,
	pendingEdit
} from '#lib/server/suggestion/suggestion-service.js';
import { pendingListing } from '#lib/server/event/community-event-service.js';
import { pendingTip } from '#lib/server/local-resource/local-resource-service.js';
import { pendingAppeal } from '#lib/server/moderation/appeal-service.js';
import { outstandingClaimWhere } from '#lib/server/volunteer/volunteer-signup-service.js';
import { minorAwaitingSignOff } from '#lib/server/volunteer/volunteer-profile-service.js';
import { pendingPost } from '#lib/server/classified/classified-service.js';
import { DIRECT_CONVERSATION_LABEL, pendingFlag } from '#lib/server/flag/flag-service.js';
import { untriagedRequest } from '#lib/server/inventory/work-request-service.js';
import { openStaffApplication } from '#lib/server/group/application-service.js';
import { appliedVendor } from '#lib/server/market/market-service.js';
import { captureException } from '#lib/server/sentry.js';
import { hasCapability, surfaces, type Capability, type Surface } from '#lib/config.js';
import type { EntityRef } from '#lib/types/entity.js';
import type { FeedPage } from '#lib/types/activity.js';
import { mergeFeedOldestFirst } from '#lib/types/activity.js';
import type { ReviewItem, ReviewKind } from '#lib/types/review.js';
import { reviewKinds } from '#lib/types/review.js';

/** What each kind's `list` selects; `toItem` turns it into a feed row. */
interface Row {
	id: string;
	at: Date;
	actorId: string | null;
	actorName: string | null;
	summary: string | null;
	/** The record the decision is made on, when it is not the row itself. */
	refId?: string | null;
}

/**
 * One kind of thing waiting on a staff decision.
 *
 * `where` is the waiting predicate, and both `count` and `list` are built from
 * it, so the nav badge, a filter chip and the rows cannot disagree.
 * `review-registry.spec.ts` checks that against a real database.
 */
export interface ReviewKindDefinition {
	kind: ReviewKind;
	capability: Capability;
	/** A kind on a surface that is off is offered to nobody. */
	surface?: Surface;
	count(now: Date): Promise<number>;
	/** Rows waiting longest first, `limit` of them. */
	list(opts: { limit: number; now: Date }): Promise<ReviewItem[]>;
}

/** Shapes a kind from its predicate, its query and the record a row links to. */
function defineReviewKind(def: {
	kind: ReviewKind;
	capability: Capability;
	surface?: Surface;
	count: (now: Date) => Promise<number>;
	rows: (opts: { limit: number; now: Date }) => Promise<Row[]>;
	ref: (row: Row) => EntityRef;
}): ReviewKindDefinition {
	return {
		kind: def.kind,
		capability: def.capability,
		surface: def.surface,
		count: def.count,
		async list(opts) {
			const rows = await def.rows(opts);
			return rows.map((row) => ({
				id: `${def.kind}:${row.id}`,
				subjectId: row.id,
				at: row.at,
				actorId: row.actorId,
				actorName: row.actorName,
				summary: row.summary ?? '',
				kind: def.kind,
				ref: def.ref(row)
			}));
		}
	};
}

const actor = { actorId: user.id, actorName: user.name };

/** A long body as one line of a feed row. */
const SUMMARY_CHARS = 120;
const oneLine = (body: SQLWrapper) =>
	sql<string>`substr(replace(${body}, char(10), ' '), 1, ${SUMMARY_CHARS})`;

/** `count(*)` of a query joined and filtered the way the kind's `rows` are. */
const total = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
const countAll = () => ({ n: sql<number>`count(*)` });

/** What a report is about, by name; a private conversation gets a content-free label. */
const flagTarget = () => sql<string | null>`case ${contentFlag.entityType}
	when 'member_profile' then (select t.name from ${user} t where t.id = ${contentFlag.entityId})
	when 'band_profile' then (select ${group.name} from ${group} where ${group.id} = ${contentFlag.entityId})
	when 'event' then (select ${eventListing.title} from ${eventListing} where ${eventListing.id} = ${contentFlag.entityId})
	when 'suggestion' then (select ${suggestion.title} from ${suggestion} where ${suggestion.id} = ${contentFlag.entityId})
	when 'classified_post' then (select ${classifiedPost.title} from ${classifiedPost} where ${classifiedPost.id} = ${contentFlag.entityId})
	when 'inbox_thread' then ${DIRECT_CONVERSATION_LABEL}
end`;

function suggestionKind(kind: ReviewKind, capability: Capability, where: () => SQL | undefined) {
	return defineReviewKind({
		kind,
		capability,
		count: () => db.$count(suggestion, where()),
		rows: ({ limit }) =>
			db
				.select({
					id: suggestion.id,
					at: suggestion.createdAt,
					summary: suggestion.title,
					...actor
				})
				.from(suggestion)
				.leftJoin(user, eq(user.id, suggestion.authorUserId))
				.where(where())
				.orderBy(asc(suggestion.createdAt), asc(suggestion.id))
				.limit(limit),
		ref: (r) => ({ type: 'suggestion', id: r.id, title: r.summary ?? '' })
	});
}

/** Declaration order is the tie-break for rows that started waiting in the same second. */
export const reviewRegistry: Record<ReviewKind, ReviewKindDefinition> = {
	suggestion_moderation: suggestionKind(
		'suggestion_moderation',
		'suggestion.review',
		awaitingModeration
	),
	suggestion_answer: suggestionKind('suggestion_answer', 'suggestion.respond', awaitingResponse),

	suggestion_edit: defineReviewKind({
		kind: 'suggestion_edit',
		capability: 'suggestion.review',
		count: () => db.$count(suggestionEdit, pendingEdit()),
		rows: ({ limit }) =>
			db
				.select({
					id: suggestionEdit.id,
					refId: suggestionEdit.suggestionId,
					at: suggestionEdit.createdAt,
					summary: suggestion.title,
					...actor
				})
				.from(suggestionEdit)
				.innerJoin(suggestion, eq(suggestion.id, suggestionEdit.suggestionId))
				.leftJoin(user, eq(user.id, suggestionEdit.requestedByUserId))
				.where(pendingEdit())
				.orderBy(asc(suggestionEdit.createdAt), asc(suggestionEdit.id))
				.limit(limit),
		ref: (r) => ({ type: 'suggestion', id: r.refId ?? null, title: r.summary ?? '' })
	}),

	listing: defineReviewKind({
		kind: 'listing',
		capability: 'listing.review',
		count: () => db.$count(eventListing, pendingListing()),
		rows: ({ limit }) =>
			db
				.select({
					id: eventListing.id,
					at: eventListing.createdAt,
					summary: eventListing.title,
					...actor
				})
				.from(eventListing)
				.leftJoin(user, eq(user.id, eventListing.createdByUserId))
				.where(pendingListing())
				.orderBy(asc(eventListing.createdAt), asc(eventListing.id))
				.limit(limit),
		ref: (r) => ({ type: 'event', id: r.id, title: r.summary ?? '' })
	}),

	classified: (() => {
		// Held at posting or on an edit; a post held before the column existed has none.
		const since = sql`coalesce(${classifiedPost.visibilityChangedAt}, ${classifiedPost.createdAt})`;
		return defineReviewKind({
			kind: 'classified',
			capability: 'listing.review',
			surface: 'classifieds',
			count: () => db.$count(classifiedPost, pendingPost()),
			rows: ({ limit }) =>
				db
					.select({
						id: classifiedPost.id,
						at: since.mapWith(classifiedPost.createdAt),
						summary: classifiedPost.title,
						...actor
					})
					.from(classifiedPost)
					.leftJoin(user, eq(user.id, classifiedPost.authorUserId))
					.where(pendingPost())
					.orderBy(asc(since), asc(classifiedPost.id))
					.limit(limit),
			ref: (r) => ({ type: 'classified', id: r.id, title: r.summary ?? '' })
		});
	})(),

	resource_tip: defineReviewKind({
		kind: 'resource_tip',
		capability: 'localResource.manage',
		count: () => db.$count(localResource, pendingTip()),
		rows: ({ limit }) =>
			db
				.select({
					id: localResource.id,
					at: localResource.createdAt,
					summary: localResource.name,
					actorId: user.id,
					// A tip from the public form has an email and no account.
					actorName: sql<string | null>`coalesce(${user.name}, ${localResource.submitterEmail})`
				})
				.from(localResource)
				.leftJoin(user, eq(user.id, localResource.submittedByUserId))
				.where(pendingTip())
				.orderBy(asc(localResource.createdAt), asc(localResource.id))
				.limit(limit),
		ref: (r) => ({ type: 'local_resource', id: r.id, title: r.summary ?? '' })
	}),

	flag: defineReviewKind({
		kind: 'flag',
		capability: 'moderation.reviewFlags',
		count: () => db.$count(contentFlag, pendingFlag()),
		rows: ({ limit }) =>
			db
				.select({
					id: contentFlag.id,
					at: contentFlag.createdAt,
					summary: sql<string>`coalesce(${flagTarget()}, ${contentFlag.reason})`,
					...actor
				})
				.from(contentFlag)
				.leftJoin(user, eq(user.id, contentFlag.reportedByUserId))
				.where(pendingFlag())
				.orderBy(asc(contentFlag.createdAt), asc(contentFlag.id))
				.limit(limit),
		ref: (r) => ({ type: 'flag', id: r.id, title: r.summary ?? '' })
	}),

	appeal: defineReviewKind({
		kind: 'appeal',
		capability: 'moderation.reviewFlags',
		count: () => db.$count(moderationAppeal, pendingAppeal()),
		rows: ({ limit }) =>
			db
				.select({
					id: moderationAppeal.id,
					refId: moderationAppeal.flagId,
					at: moderationAppeal.createdAt,
					summary: oneLine(moderationAppeal.body),
					...actor
				})
				.from(moderationAppeal)
				.leftJoin(user, eq(user.id, moderationAppeal.appellantUserId))
				.where(pendingAppeal())
				.orderBy(asc(moderationAppeal.createdAt), asc(moderationAppeal.id))
				.limit(limit),
		// An appeal is decided on the report it contests.
		ref: (r) => ({ type: 'flag', id: r.refId ?? null, title: r.summary ?? '' })
	}),

	problem: defineReviewKind({
		kind: 'problem',
		capability: 'inventory.manageAssets',
		count: () => db.$count(workRequest, untriagedRequest()),
		rows: ({ limit }) =>
			db
				.select({
					id: workRequest.id,
					at: workRequest.createdAt,
					// The unit's item, or where in the building a building problem is.
					summary: sql<
						string | null
					>`coalesce(${inventoryItem.name}, ${workRequest.location}, ${oneLine(workRequest.note)})`,
					...actor
				})
				.from(workRequest)
				.leftJoin(inventoryAsset, eq(inventoryAsset.id, workRequest.assetId))
				.leftJoin(inventoryItem, eq(inventoryItem.id, inventoryAsset.itemId))
				.leftJoin(user, eq(user.id, workRequest.reportedByUserId))
				.where(untriagedRequest())
				.orderBy(asc(workRequest.createdAt), asc(workRequest.id))
				.limit(limit),
		ref: (r) => ({ type: 'work_request', id: r.id, title: r.summary ?? '' })
	}),

	group_application: defineReviewKind({
		kind: 'group_application',
		capability: 'committee.reviewApplications',
		count: () =>
			total(
				db
					.select(countAll())
					.from(groupApplicationChoice)
					.innerJoin(
						groupApplication,
						eq(groupApplication.id, groupApplicationChoice.applicationId)
					)
					.innerJoin(user, eq(user.id, groupApplication.userId))
					.innerJoin(group, eq(group.id, groupApplicationChoice.groupId))
					.where(openStaffApplication())
			),
		rows: ({ limit }) =>
			db
				.select({
					id: groupApplicationChoice.id,
					refId: group.id,
					at: groupApplication.createdAt,
					summary: group.name,
					...actor
				})
				.from(groupApplicationChoice)
				.innerJoin(groupApplication, eq(groupApplication.id, groupApplicationChoice.applicationId))
				.innerJoin(user, eq(user.id, groupApplication.userId))
				.innerJoin(group, eq(group.id, groupApplicationChoice.groupId))
				.where(openStaffApplication())
				.orderBy(asc(groupApplication.createdAt), asc(groupApplicationChoice.id))
				.limit(limit),
		ref: (r) => ({
			type: 'group_application',
			id: r.id,
			groupId: r.refId ?? null,
			title: r.summary ?? ''
		})
	}),

	market_vendor: defineReviewKind({
		kind: 'market_vendor',
		capability: 'event.manage',
		count: () => db.$count(marketVendor, appliedVendor()),
		rows: ({ limit }) =>
			db
				.select({
					id: marketVendor.id,
					refId: marketVendor.eventId,
					at: marketVendor.createdAt,
					summary: marketVendor.businessName,
					// A vendor applies from a public form, with no account.
					actorId: sql<string | null>`null`,
					actorName: sql<string | null>`null`
				})
				.from(marketVendor)
				.where(appliedVendor())
				.orderBy(asc(marketVendor.createdAt), asc(marketVendor.id))
				.limit(limit),
		ref: (r) => ({
			type: 'market_vendor',
			id: r.id,
			eventId: r.refId ?? null,
			title: r.summary ?? ''
		})
	}),

	hour_log: defineReviewKind({
		kind: 'hour_log',
		capability: 'volunteer.reviewHours',
		count: () => db.$count(volunteerHourLog, eq(volunteerHourLog.status, 'pending')),
		rows: ({ limit }) =>
			db
				.select({
					id: volunteerHourLog.id,
					at: volunteerHourLog.createdAt,
					summary: sql<
						string | null
					>`coalesce(${volunteerRole.name}, ${oneLine(volunteerHourLog.description)})`,
					...actor
				})
				.from(volunteerHourLog)
				.leftJoin(volunteerRole, eq(volunteerRole.id, volunteerHourLog.volunteerRoleId))
				.leftJoin(user, eq(user.id, volunteerHourLog.userId))
				.where(eq(volunteerHourLog.status, 'pending'))
				.orderBy(asc(volunteerHourLog.createdAt), asc(volunteerHourLog.id))
				.limit(limit),
		ref: (r) => ({ type: 'hour_log', id: r.id, title: r.summary ?? '' })
	}),

	shift_claim: (() => {
		const where = (now: Date) =>
			and(eq(volunteerSignup.status, 'claimed'), outstandingClaimWhere(now));
		// A claim older than `claimed_at` has none; it waited from the signup.
		const since = sql`coalesce(${volunteerSignup.claimedAt}, ${volunteerSignup.createdAt})`;
		return defineReviewKind({
			kind: 'shift_claim',
			capability: 'volunteer.manageRoster',
			count: async (now) => {
				const [row] = await db
					.select({ n: sql<number>`count(*)` })
					.from(volunteerSignup)
					.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
					.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
					.where(where(now));
				return Number(row?.n ?? 0);
			},
			rows: ({ limit, now }) =>
				db
					.select({
						id: volunteerSignup.id,
						refId: volunteerShift.id,
						at: since.mapWith(volunteerSignup.createdAt),
						summary: volunteerRole.name,
						...actor
					})
					.from(volunteerSignup)
					.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
					.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
					.leftJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
					.leftJoin(user, eq(user.id, volunteerSignup.userId))
					.where(where(now))
					.orderBy(asc(since), asc(volunteerSignup.id))
					.limit(limit),
			ref: (r) => ({ type: 'shift', id: r.refId ?? null, title: r.summary ?? '' })
		});
	})(),

	minor_volunteer: defineReviewKind({
		kind: 'minor_volunteer',
		capability: 'volunteer.manageRoster',
		count: () =>
			total(
				db
					.select(countAll())
					.from(volunteerProfile)
					.innerJoin(user, eq(user.id, volunteerProfile.userId))
					.where(minorAwaitingSignOff())
			),
		rows: ({ limit }) =>
			db
				.select({
					id: volunteerProfile.userId,
					at: volunteerProfile.createdAt,
					summary: sql<string>`${volunteerProfile.firstName} || ' ' || ${volunteerProfile.lastName}`,
					...actor
				})
				.from(volunteerProfile)
				.innerJoin(user, eq(user.id, volunteerProfile.userId))
				.where(minorAwaitingSignOff())
				.orderBy(asc(volunteerProfile.createdAt), asc(volunteerProfile.id))
				.limit(limit),
		ref: (r) => ({ type: 'volunteer', id: r.id, title: r.summary ?? '' })
	})
};

/** The kinds this viewer may decide, in registry order. */
export function reviewKindsFor(capabilities: readonly string[]): ReviewKindDefinition[] {
	return reviewKinds
		.map((k) => reviewRegistry[k])
		.filter((def) => !def.surface || surfaces[def.surface])
		.filter((def) => hasCapability(capabilities, def.capability));
}

/** A kind that fails reads as empty: one broken query is never worth a failed page. */
function degrade<T>(kind: ReviewKind, fallback: T) {
	return (err: unknown) => {
		captureException(err, { reviewKind: kind });
		return fallback;
	};
}

export interface ReviewCounts {
	total: number;
	/** Only the kinds with something waiting. */
	byKind: Partial<Record<ReviewKind, number>>;
}

/** How much is waiting on this viewer, per kind they may decide. */
export async function countReviewFeed(
	capabilities: readonly string[],
	now = new Date()
): Promise<ReviewCounts> {
	const kinds = reviewKindsFor(capabilities);
	const counts = await Promise.all(kinds.map((def) => def.count(now).catch(degrade(def.kind, 0))));
	const byKind: Partial<Record<ReviewKind, number>> = {};
	kinds.forEach((def, i) => {
		if (counts[i] > 0) byKind[def.kind] = counts[i];
	});
	return { total: counts.reduce((a, b) => a + b, 0), byKind };
}

/** Everything waiting on this viewer, oldest first; `kind` narrows it to one. */
export async function listReviewFeed(
	capabilities: readonly string[],
	{ kind, limit }: { kind?: ReviewKind; limit: number },
	now = new Date()
): Promise<FeedPage<ReviewItem>> {
	const kinds = reviewKindsFor(capabilities).filter((def) => !kind || def.kind === kind);
	const pages = await Promise.all(
		kinds.map(async (def) => {
			const items = await def.list({ limit: limit + 1, now }).catch(degrade(def.kind, []));
			return { items: items.slice(0, limit), hasMore: items.length > limit };
		})
	);
	return mergeFeedOldestFirst(limit, ...pages);
}
