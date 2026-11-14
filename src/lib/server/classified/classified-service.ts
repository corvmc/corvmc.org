import { db } from '#lib/server/db/index.js';
import { classifiedPost, classifiedPostTag } from '#lib/server/db/schema/classified.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { group, groupMember } from '#lib/server/db/schema/group.js';
import { directoryEntry, directoryTag } from '#lib/server/db/schema/directory.js';
import { and, count, desc, eq, gt, inArray, lte, ne, or, type SQL } from 'drizzle-orm';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import { containsLiteral } from '#lib/server/db/like.js';
import { paginate, type PaginationInput } from '#lib/server/db/paginate.js';
import { DomainError } from '../domain-error';
import { getStanding } from '#lib/server/moderation/standing-service.js';
import { domainEvents, type ClassifiedModeratedEvent } from '#lib/server/event-bus/event-bus.js';
import { captureException } from '#lib/server/sentry.js';
import {
	CLASSIFIED_BODY_MAX,
	CLASSIFIED_LIFETIME_DAYS,
	CLASSIFIED_NOTE_MAX,
	CLASSIFIED_TAGS_MAX,
	CLASSIFIED_TAG_MAX,
	CLASSIFIED_TITLE_MAX,
	MAX_OPEN_CLASSIFIEDS,
	type ClassifiedCategory,
	type ClassifiedKind,
	type ClassifiedTagKind,
	type ClassifiedVisibility
} from '#lib/config.js';

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Also what a non-author gets for someone else's post: existence is not confirmed. */
export class ClassifiedNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor(message = 'Post not found') {
		super(message);
	}
}

export class ClassifiedValidationError extends DomainError {
	readonly httpStatus = 400;
}

export class ClassifiedForbiddenError extends DomainError {
	readonly httpStatus = 403;
	constructor(message = 'You can only post as a band you run') {
		super(message);
	}
}

export class ClassifiedLimitError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super(
			`You already have ${MAX_OPEN_CLASSIFIEDS} open posts. Close one, or wait for one to expire.`
		);
	}
}

export class ClassifiedStateError extends DomainError {
	readonly httpStatus = 409;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface ClassifiedTagInput {
	kind: ClassifiedTagKind;
	value: string;
}

/** Trimmed, lowercased and capped as `directory_tag` values are, then de-duplicated. */
export function normaliseTags(tags: ClassifiedTagInput[]): ClassifiedTagInput[] {
	const seen = new Set<string>();
	const out: ClassifiedTagInput[] = [];
	for (const t of tags) {
		const value = t.value.trim().toLowerCase().slice(0, CLASSIFIED_TAG_MAX);
		const key = `${t.kind}:${value}`;
		if (!value || seen.has(key)) continue;
		seen.add(key);
		out.push({ kind: t.kind, value });
	}
	return out.slice(0, CLASSIFIED_TAGS_MAX);
}

function expiryFrom(now: Date): Date {
	return new Date(now.getTime() + CLASSIFIED_LIFETIME_DAYS * DAY_MS);
}

function onBoard(now: Date): SQL {
	return and(
		eq(classifiedPost.status, 'open'),
		eq(classifiedPost.visibility, 'visible'),
		gt(classifiedPost.expiresAt, now)
	)!;
}

/** A post held for a moderator before it shows: the review feed's predicate. */
export const pendingPost = () => eq(classifiedPost.visibility, 'pending_review');

/** On the board to everyone; in any state to its author and to staff. */
export function canView(
	post: { authorUserId: string; status: string; visibility: string; expiresAt: Date },
	viewerUserId: string,
	isStaff: boolean,
	now: Date = new Date()
): boolean {
	if (isStaff || post.authorUserId === viewerUserId) return true;
	return (
		post.status === 'open' &&
		post.visibility === 'visible' &&
		post.expiresAt.getTime() > now.getTime()
	);
}

function validateText(title: string, body: string) {
	const t = title.trim().slice(0, CLASSIFIED_TITLE_MAX);
	const b = body.trim().slice(0, CLASSIFIED_BODY_MAX);
	if (!t) throw new ClassifiedValidationError('A title is required');
	if (!b) throw new ClassifiedValidationError('Say a bit more about it');
	return { title: t, body: b };
}

async function assertRunsGroup(userId: string, groupId: string) {
	const [row] = await db
		.select({ role: groupMember.role })
		.from(groupMember)
		.where(
			and(
				eq(groupMember.groupId, groupId),
				eq(groupMember.userId, userId),
				eq(groupMember.status, 'active'),
				inArray(groupMember.role, ['owner', 'admin'])
			)
		)
		.limit(1);
	if (!row) throw new ClassifiedForbiddenError();
}

async function loadOwned(postId: string, userId: string) {
	const [row] = await db
		.select()
		.from(classifiedPost)
		.where(and(eq(classifiedPost.id, postId), eq(classifiedPost.authorUserId, userId)))
		.limit(1);
	if (!row) throw new ClassifiedNotFoundError();
	return row;
}

async function isRestricted(userId: string): Promise<boolean> {
	return (await getStanding(userId, 'classified')).status !== 'none';
}

function tagRows(postId: string, tags: ClassifiedTagInput[]) {
	return normaliseTags(tags).map((t) => ({ postId, kind: t.kind, value: t.value }));
}

// ---------------------------------------------------------------------------
// Mutations — author
// ---------------------------------------------------------------------------

export interface PostInput {
	kind: ClassifiedKind;
	category: ClassifiedCategory;
	title: string;
	body: string;
	tags: ClassifiedTagInput[];
	groupId?: string | null;
}

function validateKind(kind: ClassifiedKind, category: ClassifiedCategory) {
	if (kind === 'trade' && category !== 'gear') {
		throw new ClassifiedValidationError('Only gear posts can be trades');
	}
}

export async function createPost(
	params: PostInput & { authorUserId: string },
	now: Date = new Date()
) {
	validateKind(params.kind, params.category);
	const { title, body } = validateText(params.title, params.body);
	if (params.groupId) await assertRunsGroup(params.authorUserId, params.groupId);

	const [open] = await db
		.select({ count: count() })
		.from(classifiedPost)
		.where(
			and(
				eq(classifiedPost.authorUserId, params.authorUserId),
				eq(classifiedPost.status, 'open'),
				gt(classifiedPost.expiresAt, now)
			)
		);
	if ((open?.count ?? 0) >= MAX_OPEN_CLASSIFIEDS) throw new ClassifiedLimitError();

	const restricted = await isRestricted(params.authorUserId);
	const id = crypto.randomUUID();
	const tags = tagRows(id, params.tags);
	const insertPost = db
		.insert(classifiedPost)
		.values({
			id,
			authorUserId: params.authorUserId,
			groupId: params.groupId || null,
			kind: params.kind,
			category: params.category,
			title,
			body,
			visibility: restricted ? 'pending_review' : 'visible',
			visibilityChangedAt: restricted ? now : null,
			expiresAt: expiryFrom(now),
			createdAt: now,
			updatedAt: now
		})
		.returning();

	const [[row]] = tags.length
		? await db.batch([insertPost, db.insert(classifiedPostTag).values(tags)])
		: [await insertPost];
	return row;
}

/**
 * The return path: an edit to a hidden post, or any edit while the author is
 * restricted, goes to `pending_review`. Other edits keep their visibility.
 */
export async function updatePost(
	postId: string,
	userId: string,
	params: PostInput,
	now: Date = new Date()
) {
	const existing = await loadOwned(postId, userId);
	validateKind(params.kind, params.category);
	const { title, body } = validateText(params.title, params.body);
	if (params.groupId && params.groupId !== existing.groupId) {
		await assertRunsGroup(userId, params.groupId);
	}

	const toReview = existing.visibility === 'hidden' || (await isRestricted(userId));
	const tags = tagRows(postId, params.tags);

	const update = db
		.update(classifiedPost)
		.set({
			kind: params.kind,
			category: params.category,
			title,
			body,
			groupId: params.groupId || null,
			updatedAt: now,
			...(toReview && existing.visibility !== 'pending_review'
				? { visibility: 'pending_review' as const, visibilityChangedAt: now }
				: {})
		})
		.where(eq(classifiedPost.id, postId));
	const clear = db.delete(classifiedPostTag).where(eq(classifiedPostTag.postId, postId));

	if (tags.length) await db.batch([update, clear, db.insert(classifiedPostTag).values(tags)]);
	else await db.batch([update, clear]);
}

export async function renewPost(postId: string, userId: string, now: Date = new Date()) {
	const existing = await loadOwned(postId, userId);
	if (existing.status !== 'open') throw new ClassifiedStateError('A closed post cannot be renewed');
	if (existing.visibility === 'hidden') {
		throw new ClassifiedStateError('Edit a hidden post to send it back for review');
	}
	await db
		.update(classifiedPost)
		.set({ expiresAt: expiryFrom(now), updatedAt: now })
		.where(eq(classifiedPost.id, postId));
}

export async function closePost(postId: string, userId: string, now: Date = new Date()) {
	const existing = await loadOwned(postId, userId);
	if (existing.status === 'closed') return;
	await db
		.update(classifiedPost)
		.set({ status: 'closed', closedAt: now, updatedAt: now })
		.where(eq(classifiedPost.id, postId));
}

// ---------------------------------------------------------------------------
// Mutations — moderation
// ---------------------------------------------------------------------------

export async function setVisibility(
	postId: string,
	params: { visibility: ClassifiedVisibility; note?: string | null; staffId: string | null }
) {
	const [existing] = await db
		.select({
			visibility: classifiedPost.visibility,
			title: classifiedPost.title,
			authorUserId: classifiedPost.authorUserId,
			authorName: user.name,
			authorEmail: user.email
		})
		.from(classifiedPost)
		.leftJoin(user, eq(user.id, classifiedPost.authorUserId))
		.where(eq(classifiedPost.id, postId))
		.limit(1);
	if (!existing) throw new ClassifiedNotFoundError();
	if (existing.visibility === params.visibility) return;

	const note = params.note ? params.note.trim().slice(0, CLASSIFIED_NOTE_MAX) : null;
	await db
		.update(classifiedPost)
		.set({
			visibility: params.visibility,
			visibilityNote: note,
			visibilityChangedAt: new Date(),
			visibilityChangedByUserId: params.staffId,
			updatedAt: new Date()
		})
		.where(eq(classifiedPost.id, postId));
	await recordAuditEntry({
		action: 'classified.visibility_changed',
		subject: { type: 'classified', id: postId, label: existing.title },
		details: { from: existing.visibility, to: params.visibility }
	});

	const { visibility } = params;
	if (visibility !== 'visible' && visibility !== 'hidden') return;
	if (!existing.authorEmail || existing.authorUserId === params.staffId) return;
	notifyModerated({
		postId,
		title: existing.title,
		visibility,
		note,
		authorUserId: existing.authorUserId,
		authorName: existing.authorName ?? 'there',
		authorEmail: existing.authorEmail
	});
}

/** Fire-and-forget: a failed notification never fails the staff decision. */
function notifyModerated(payload: ClassifiedModeratedEvent): void {
	Promise.resolve().then(async () => {
		try {
			await domainEvents.emit('classified.moderated', payload);
		} catch (err) {
			captureException(err, { event: 'classified.moderated', postId: payload.postId });
		}
	});
}

/** Called by flag-service on each report. Only `visible` rows move, so repeats are no-ops. */
export async function withholdForReview(postId: string) {
	await db
		.update(classifiedPost)
		.set({
			visibility: 'under_review',
			visibilityNote: null,
			visibilityChangedAt: new Date(),
			visibilityChangedByUserId: null,
			updatedAt: new Date()
		})
		.where(and(eq(classifiedPost.id, postId), eq(classifiedPost.visibility, 'visible')));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getPostForModeration(id: string) {
	const [row] = await db
		.select({
			id: classifiedPost.id,
			title: classifiedPost.title,
			authorUserId: classifiedPost.authorUserId,
			visibility: classifiedPost.visibility
		})
		.from(classifiedPost)
		.where(eq(classifiedPost.id, id))
		.limit(1);
	return row ?? null;
}

/**
 * Posts on the board at `from` that leave it by `to`, with their authors: the
 * expiry reminder's query. A post made as a band still reaches its author, the
 * only person who can renew it.
 */
export async function listPostsExpiringBetween(from: Date, to: Date) {
	return db
		.select({
			id: classifiedPost.id,
			title: classifiedPost.title,
			expiresAt: classifiedPost.expiresAt,
			userId: user.id,
			userName: user.name,
			userEmail: user.email
		})
		.from(classifiedPost)
		.innerJoin(user, eq(user.id, classifiedPost.authorUserId))
		.where(and(onBoard(from), lte(classifiedPost.expiresAt, to)))
		.limit(500);
}

const rowSelection = {
	id: classifiedPost.id,
	kind: classifiedPost.kind,
	category: classifiedPost.category,
	title: classifiedPost.title,
	status: classifiedPost.status,
	visibility: classifiedPost.visibility,
	expiresAt: classifiedPost.expiresAt,
	createdAt: classifiedPost.createdAt,
	authorUserId: classifiedPost.authorUserId,
	authorName: user.name,
	groupId: classifiedPost.groupId,
	groupName: group.name,
	groupSlug: group.slug
};

async function tagsFor(postIds: string[]) {
	const byPost = new Map<string, ClassifiedTagInput[]>();
	if (!postIds.length) return byPost;
	const rows = await db
		.select()
		.from(classifiedPostTag)
		.where(inArray(classifiedPostTag.postId, postIds));
	for (const r of rows) {
		const list = byPost.get(r.postId) ?? [];
		list.push({ kind: r.kind, value: r.value });
		byPost.set(r.postId, list);
	}
	return byPost;
}

export interface BoardFilters {
	kind?: ClassifiedKind;
	category?: ClassifiedCategory;
	tag?: ClassifiedTagInput;
	search?: string;
	/** The author's own list, in every state. Replaces the board predicate. */
	authorUserId?: string;
	/** Staff only. Replaces the board predicate with one visibility. */
	visibility?: ClassifiedVisibility;
}

export async function listBoard(
	filters: BoardFilters,
	pagination: PaginationInput,
	now: Date = new Date()
) {
	// Every predicate is on `classified_post` only: the count query does not join.
	const conditions: SQL[] = [];
	if (filters.authorUserId) conditions.push(eq(classifiedPost.authorUserId, filters.authorUserId));
	else if (filters.visibility) conditions.push(eq(classifiedPost.visibility, filters.visibility));
	else conditions.push(onBoard(now));

	if (filters.kind) conditions.push(eq(classifiedPost.kind, filters.kind));
	if (filters.category) conditions.push(eq(classifiedPost.category, filters.category));
	if (filters.search?.trim()) {
		const term = filters.search.trim();
		conditions.push(
			or(containsLiteral(classifiedPost.title, term), containsLiteral(classifiedPost.body, term))!
		);
	}
	const [tag] = filters.tag ? normaliseTags([filters.tag]) : [];
	if (tag) {
		const tagged = db
			.select({ id: classifiedPostTag.postId })
			.from(classifiedPostTag)
			.where(and(eq(classifiedPostTag.kind, tag.kind), eq(classifiedPostTag.value, tag.value)));
		conditions.push(inArray(classifiedPost.id, tagged));
	}
	const where = and(...conditions);

	const dataQ = db
		.select(rowSelection)
		.from(classifiedPost)
		.leftJoin(user, eq(user.id, classifiedPost.authorUserId))
		.leftJoin(group, eq(group.id, classifiedPost.groupId))
		.where(where)
		.orderBy(desc(classifiedPost.createdAt), desc(classifiedPost.id))
		.$dynamic();
	const countQ = db.select({ count: count() }).from(classifiedPost).where(where);

	const { rows, pagination: page } = await paginate(dataQ, countQ, pagination);
	const tags = await tagsFor(rows.map((r) => r.id));
	return {
		rows: rows.map((r) => ({
			...r,
			tags: tags.get(r.id) ?? [],
			isExpired: r.expiresAt.getTime() <= now.getTime()
		})),
		pagination: page
	};
}

export async function getPost(id: string, now: Date = new Date()) {
	const [row] = await db
		.select({
			...rowSelection,
			body: classifiedPost.body,
			visibilityNote: classifiedPost.visibilityNote,
			visibilityChangedAt: classifiedPost.visibilityChangedAt,
			closedAt: classifiedPost.closedAt,
			updatedAt: classifiedPost.updatedAt
		})
		.from(classifiedPost)
		.leftJoin(user, eq(user.id, classifiedPost.authorUserId))
		.leftJoin(group, eq(group.id, classifiedPost.groupId))
		.where(eq(classifiedPost.id, id))
		.limit(1);
	if (!row) throw new ClassifiedNotFoundError();
	const tags = await tagsFor([id]);
	return {
		...row,
		tags: tags.get(id) ?? [],
		isExpired: row.expiresAt.getTime() <= now.getTime()
	};
}

export type ClassifiedDetail = Awaited<ReturnType<typeof getPost>>;

/**
 * Posts on the board that share a tag with the viewer's own profile, newest
 * first, with the shared tags. Genre and skill match their own kind; a post's
 * instrument matches one the viewer plays, or, on an offered post, one their
 * project is seeking. The viewer's own posts are left out.
 */
export async function listPostsMatching(userId: string, limit = 6, now: Date = new Date()) {
	// Joined rather than passed as values: a long profile would pass D1's 100
	// bound-parameter cap.
	const tagMatches = and(
		eq(directoryTag.value, classifiedPostTag.value),
		or(
			eq(directoryTag.kind, classifiedPostTag.kind),
			and(
				eq(directoryTag.kind, 'seeking_instrument'),
				eq(classifiedPostTag.kind, 'instrument'),
				eq(classifiedPost.kind, 'offered')
			)
		)
	);
	const rows = await db
		.select({ ...rowSelection, tagKind: classifiedPostTag.kind, tagValue: classifiedPostTag.value })
		.from(classifiedPostTag)
		.innerJoin(classifiedPost, eq(classifiedPost.id, classifiedPostTag.postId))
		.innerJoin(directoryTag, tagMatches)
		.innerJoin(
			directoryEntry,
			and(eq(directoryEntry.id, directoryTag.entryId), eq(directoryEntry.userId, userId))
		)
		.leftJoin(user, eq(user.id, classifiedPost.authorUserId))
		.leftJoin(group, eq(group.id, classifiedPost.groupId))
		.where(and(onBoard(now), ne(classifiedPost.authorUserId, userId)))
		.orderBy(desc(classifiedPost.createdAt), desc(classifiedPost.id))
		.limit(limit * CLASSIFIED_TAGS_MAX * 2);

	// A post tag can match two profile tags (played and sought), so at most
	// twice CLASSIFIED_TAGS_MAX rows per post: the limit covers `limit` posts.
	type Match = Omit<(typeof rows)[number], 'tagKind' | 'tagValue'> & {
		sharedTags: ClassifiedTagInput[];
	};
	const byPost = new Map<string, Match>();
	for (const { tagKind, tagValue, ...post } of rows) {
		let entry = byPost.get(post.id);
		if (!entry) byPost.set(post.id, (entry = { ...post, sharedTags: [] }));
		if (!entry.sharedTags.some((t) => t.kind === tagKind && t.value === tagValue)) {
			entry.sharedTags.push({ kind: tagKind, value: tagValue });
		}
	}
	return [...byPost.values()].slice(0, limit);
}
