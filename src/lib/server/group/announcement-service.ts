import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { announcement } from '$lib/server/db/schema/announcement';
import { user } from '$lib/server/db/schema/authentication';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import { DomainError } from '$lib/server/domain-error';
import { renderMarkdown } from '$lib/utils/markdown';

/**
 * Announcements — a group talking to its own roster. Phase 7 of
 * `docs/specs/groups-spec.md`.
 *
 * The whole module is group-scoped by argument: every function takes a
 * `groupId` and every write is scoped to it. Nothing here guards — that is
 * `requireGroupRole`'s job at the remote boundary, and doing it in both places
 * is how two answers to "may this person post" come to disagree.
 *
 * **Publishing is a separate act from writing.** A row exists as a draft until
 * `publish()` stamps `publishedAt`, because the fan-out is irreversible: an
 * announcement emailed to 200 people cannot be unsent, and an editor that
 * notified on every keystroke-save would make that the default. Nothing reaches
 * a member before `publishedAt` is set.
 */

/**
 * The hard cap on a list, because there is no pagination yet and an uncapped
 * read of a decade of committee minutes is not a query anyone chose. A group at
 * 100 posts is the signal to add paging — see docs/specs/groups-spec.md, which
 * names it as the first thing to add if a club stops being small.
 */
const MAX_LIST = 100;

export class AnnouncementNotFoundError extends DomainError {
	readonly httpStatus = 404;

	constructor() {
		super('Announcement not found');
		this.name = 'AnnouncementNotFoundError';
	}
}

/**
 * Publishing twice. An ordinary state — two admins on the same draft, or a
 * double submit — not a fault, so it must not reach Sentry as a 500. It is also
 * the check that keeps the fan-out honest: `publish()` is what emits, and
 * emitting twice would notify a roster twice.
 */
export class AlreadyPublishedError extends DomainError {
	readonly httpStatus = 409;

	constructor() {
		super('This announcement has already been published.');
		this.name = 'AlreadyPublishedError';
	}
}

export interface CreateAnnouncementData {
	title: string;
	body: string;
	pinned?: boolean;
}

/** The columns every read returns, with the author resolved to a member ref. */
function selectColumns() {
	return {
		id: announcement.id,
		groupId: announcement.groupId,
		title: announcement.title,
		body: announcement.body,
		pinned: announcement.pinned,
		publishedAt: announcement.publishedAt,
		notifiedAt: announcement.notifiedAt,
		recipientCount: announcement.recipientCount,
		createdAt: announcement.createdAt,
		updatedAt: announcement.updatedAt,
		author: memberRefColumns()
	};
}

function runSelect(where: ReturnType<typeof and>) {
	return (
		db
			.select(selectColumns())
			.from(announcement)
			.leftJoin(user, eq(user.id, announcement.authorId))
			.where(where)
			// Pinned first, then newest. A draft has no `publishedAt`, so it sorts by
			// `createdAt` — which is why both are in the order rather than one.
			.orderBy(
				desc(announcement.pinned),
				desc(announcement.publishedAt),
				desc(announcement.createdAt)
			)
			.limit(MAX_LIST)
	);
}

type Row = Awaited<ReturnType<typeof runSelect>>[number];

function shape(row: Row) {
	return {
		id: row.id,
		groupId: row.groupId,
		title: row.title,
		body: row.body,
		/** Sanitized on the way out — `renderMarkdown` runs the allowlist filter. */
		bodyHtml: renderMarkdown(row.body),
		pinned: row.pinned,
		publishedAt: row.publishedAt,
		notifiedAt: row.notifiedAt,
		recipientCount: row.recipientCount,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		// Null once the author's account is gone. The post is still the group's.
		author: row.author?.id ? toMemberRef(row.author) : null
	};
}

export type AnnouncementView = ReturnType<typeof shape>;

/**
 * What a member sees: published, not deleted.
 *
 * Drafts are deliberately absent rather than filtered in the caller. A member
 * list and an editor list differ by more than a flag, and one function returning
 * both behind a boolean is how a draft ends up rendered to the roster.
 */
export async function listPublished(groupId: string): Promise<AnnouncementView[]> {
	const rows = await runSelect(
		and(
			eq(announcement.groupId, groupId),
			isNull(announcement.deletedAt),
			isNotNull(announcement.publishedAt)
		)
	);
	return rows.map(shape);
}

/** What an owner or admin sees: drafts included. */
export async function listForManager(groupId: string): Promise<AnnouncementView[]> {
	const rows = await runSelect(
		and(eq(announcement.groupId, groupId), isNull(announcement.deletedAt))
	);
	return rows.map(shape);
}

/**
 * One announcement, scoped to its group.
 *
 * `groupId` is not decorative: the caller's guard proves they administer *a*
 * group, so an id alone would let an admin of one group read or edit another's
 * draft. The same argument `group_invite.revoke` carries.
 */
export async function getById(id: string, groupId: string): Promise<AnnouncementView> {
	const [row] = await runSelect(
		and(eq(announcement.id, id), eq(announcement.groupId, groupId), isNull(announcement.deletedAt))
	);
	if (!row) throw new AnnouncementNotFoundError();
	return shape(row);
}

export async function create(
	groupId: string,
	authorId: string,
	data: CreateAnnouncementData
): Promise<AnnouncementView> {
	const [row] = await db
		.insert(announcement)
		.values({
			groupId,
			authorId,
			title: data.title.trim(),
			body: data.body,
			pinned: data.pinned ?? false
		})
		.returning({ id: announcement.id });

	return getById(row.id, groupId);
}

export async function update(
	id: string,
	groupId: string,
	data: Partial<CreateAnnouncementData>
): Promise<AnnouncementView> {
	const result = await db
		.update(announcement)
		.set({
			...(data.title !== undefined ? { title: data.title.trim() } : {}),
			...(data.body !== undefined ? { body: data.body } : {}),
			...(data.pinned !== undefined ? { pinned: data.pinned } : {}),
			updatedAt: new Date()
		})
		.where(
			and(
				eq(announcement.id, id),
				eq(announcement.groupId, groupId),
				isNull(announcement.deletedAt)
			)
		)
		.returning({ id: announcement.id });

	if (result.length === 0) throw new AnnouncementNotFoundError();
	return getById(id, groupId);
}

/**
 * Stamp `publishedAt` and hand the caller what the fan-out needs.
 *
 * Conditional on `published_at IS NULL` in the UPDATE itself rather than a
 * SELECT first: two admins clicking Publish on the same draft would otherwise
 * both pass the check and both emit, and the roster would be notified twice.
 * No row back means somebody got there first.
 */
export async function publish(id: string, groupId: string): Promise<AnnouncementView> {
	const result = await db
		.update(announcement)
		.set({ publishedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(announcement.id, id),
				eq(announcement.groupId, groupId),
				isNull(announcement.deletedAt),
				isNull(announcement.publishedAt)
			)
		)
		.returning({ id: announcement.id });

	if (result.length === 0) {
		// Distinguish the two ways to get no row, so the admin is told which.
		const [existing] = await db
			.select({ publishedAt: announcement.publishedAt })
			.from(announcement)
			.where(
				and(
					eq(announcement.id, id),
					eq(announcement.groupId, groupId),
					isNull(announcement.deletedAt)
				)
			)
			.limit(1);
		if (existing) throw new AlreadyPublishedError();
		throw new AnnouncementNotFoundError();
	}

	return getById(id, groupId);
}

/**
 * Soft delete. The post comes off the tab and stops being editable; the row
 * stays, because a committee's announcements are part of the record of the
 * committee and "we never said that" is not a claim a delete button should be
 * able to make.
 */
export async function remove(id: string, groupId: string): Promise<void> {
	const result = await db
		.update(announcement)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(announcement.id, id),
				eq(announcement.groupId, groupId),
				isNull(announcement.deletedAt)
			)
		)
		.returning({ id: announcement.id });

	if (result.length === 0) throw new AnnouncementNotFoundError();
}
