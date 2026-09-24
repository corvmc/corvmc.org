import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { query } from '$app/server';
import { form } from './_remote';
import { can, requireCapability, requireUser } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import { isFeatureEnabled } from '$lib/server/feature-flags';
import { getStanding } from '$lib/server/moderation/standing-service';
import { listForUser } from '$lib/server/band/band-service';
import { suggestGenres, suggestInstruments } from '$lib/server/directory/directory-service';
import { toBandRef, toGenericRef, toMemberRef } from '$lib/server/entity/refs';
import {
	createFlag,
	countUnresolvedReportsBy,
	FLAG_DESCRIPTION_MAX,
	FLAG_REASON_MAX
} from '$lib/server/flag/flag-service';
import {
	canView,
	closePost,
	createPost,
	getPost,
	listBoard,
	renewPost,
	setVisibility,
	updatePost,
	type ClassifiedTagInput
} from '$lib/server/classified/classified-service';
import { jsonArrayField } from '$lib/utils/zod-json';
import {
	classifiedCategories,
	classifiedKinds,
	classifiedTagKinds,
	classifiedVisibilities,
	CLASSIFIED_BODY_MAX,
	CLASSIFIED_NOTE_MAX,
	CLASSIFIED_TITLE_MAX,
	MAX_UNRESOLVED_REPORTS
} from '$lib/config';

const PAGE_SIZE = 25;

type Row = Awaited<ReturnType<typeof listBoard>>['rows'][number];

/** One status for the row glyph: moderation first, then closed, then expiry. */
function displayStatus(r: Row) {
	if (r.visibility !== 'visible') return r.visibility;
	if (r.status === 'closed') return 'closed';
	return r.isExpired ? 'expired' : 'open';
}

function present<T extends Row>(r: T) {
	return {
		...r,
		displayStatus: displayStatus(r),
		ref: toGenericRef('classified', { id: r.id, title: r.title }),
		author: toMemberRef({ id: r.authorUserId, name: r.authorName }),
		band: r.groupId ? toBandRef({ id: r.groupId, name: r.groupName, slug: r.groupSlug }) : null
	};
}

// ---------------------------------------------------------------------------
// Queries — member
// ---------------------------------------------------------------------------

const boardSchema = z.object({
	kind: z.enum(classifiedKinds).optional(),
	category: z.enum(classifiedCategories).optional(),
	tagKind: z.enum(classifiedTagKinds).optional(),
	tagValue: z.string().max(50).optional(),
	search: z.string().max(200).optional(),
	mine: z.boolean().optional(),
	page: z.number().int().min(1).optional()
});

export const getClassifiedBoard = query(boardSchema, async (f) => {
	const me = requireUser();
	// Field by field: a member must never reach the staff `visibility` filter.
	const { rows, pagination } = await listBoard(
		{
			kind: f.kind,
			category: f.category,
			search: f.search,
			tag: f.tagKind && f.tagValue ? { kind: f.tagKind, value: f.tagValue } : undefined,
			authorUserId: f.mine ? me.id : undefined
		},
		{ page: f.page ?? 1, pageSize: PAGE_SIZE }
	);
	return { rows: rows.map(present), pagination };
});

export const getClassifiedDetail = query(z.string(), async (id) => {
	const me = requireUser();
	const post = await getPost(id).catch(mapDomainError);
	const isStaff = await can('listing.review');
	// 404, not 403: a report must not become a way to confirm a hidden post exists.
	if (!canView(post, me.id, isStaff)) error(404, 'Post not found');
	return {
		...present(post),
		isMine: post.authorUserId === me.id,
		canMessage: post.authorUserId !== me.id && (await isFeatureEnabled('directMessages'))
	};
});

/** What the post form needs: standing wording, bands to post as, and tag suggestions. */
export const getClassifiedComposer = query(async () => {
	const me = requireUser();
	const [standing, groups, instruments, genres] = await Promise.all([
		getStanding(me.id, 'classified'),
		listForUser(me.id, ['band']).catch(() => []),
		suggestInstruments(''),
		suggestGenres('')
	]);
	return {
		requiresReview: standing.status !== 'none',
		bands: groups
			.filter((g) => g.status === 'active' && (g.role === 'owner' || g.role === 'admin'))
			.map((g) => ({ value: g.id, label: g.name })),
		instrumentSuggestions: instruments,
		genreSuggestions: genres
	};
});

// ---------------------------------------------------------------------------
// Queries — staff
// ---------------------------------------------------------------------------

export const getStaffClassifieds = query(
	z.object({
		visibility: z.enum(classifiedVisibilities).optional(),
		search: z.string().max(200).optional(),
		page: z.number().int().min(1).optional()
	}),
	async (f) => {
		await requireCapability('listing.review');
		const { rows, pagination } = await listBoard(
			{ visibility: f.visibility ?? 'pending_review', search: f.search },
			{ page: f.page ?? 1, pageSize: PAGE_SIZE }
		);
		return { rows: rows.map(present), pagination };
	}
);

export const getStaffClassifiedDetail = query(z.string(), async (id) => {
	await requireCapability('listing.review');
	const post = await getPost(id).catch(mapDomainError);
	return present(post);
});

// ---------------------------------------------------------------------------
// Mutations — author
// ---------------------------------------------------------------------------

const tagList = jsonArrayField(z.string().max(50), 'Invalid tags').optional();

const postSchema = z.object({
	kind: z.enum(classifiedKinds),
	category: z.enum(classifiedCategories),
	title: z.string().trim().min(1, 'A title is required').max(CLASSIFIED_TITLE_MAX),
	body: z.string().trim().min(1, 'Say a bit more about it').max(CLASSIFIED_BODY_MAX),
	groupId: z.string().optional(),
	instruments: tagList,
	genres: tagList,
	skills: tagList
});

function tagsOf(data: z.infer<typeof postSchema>): ClassifiedTagInput[] {
	return [
		...(data.instruments ?? []).map((value) => ({ kind: 'instrument' as const, value })),
		...(data.genres ?? []).map((value) => ({ kind: 'genre' as const, value })),
		...(data.skills ?? []).map((value) => ({ kind: 'skill' as const, value }))
	];
}

function inputOf(data: z.infer<typeof postSchema>) {
	return {
		kind: data.kind,
		category: data.category,
		title: data.title,
		body: data.body,
		groupId: data.groupId || null,
		tags: tagsOf(data)
	};
}

export const createClassified = form(postSchema, async (data) => {
	const me = requireUser();
	try {
		const row = await createPost({ ...inputOf(data), authorUserId: me.id });
		return { id: row.id, visibility: row.visibility };
	} catch (err) {
		mapDomainError(err);
	}
});

export const editClassified = form(
	postSchema.extend({ postId: z.string().min(1) }),
	async (data) => {
		const me = requireUser();
		try {
			await updatePost(data.postId, me.id, inputOf(data));
		} catch (err) {
			mapDomainError(err);
		}
		void getClassifiedDetail(data.postId).refresh();
		return { success: true };
	}
);

export const renewClassified = form(z.object({ postId: z.string().min(1) }), async (data) => {
	const me = requireUser();
	try {
		await renewPost(data.postId, me.id);
	} catch (err) {
		mapDomainError(err);
	}
	void getClassifiedDetail(data.postId).refresh();
	return { success: true };
});

export const closeClassified = form(z.object({ postId: z.string().min(1) }), async (data) => {
	const me = requireUser();
	try {
		await closePost(data.postId, me.id);
	} catch (err) {
		mapDomainError(err);
	}
	void getClassifiedDetail(data.postId).refresh();
	return { success: true };
});

/** Its own remote, not `submitFlag`: a report withholds the post as a side effect. */
export const reportClassified = form(
	z.object({
		postId: z.string().min(1),
		reason: z.string().trim().min(1, 'Say what the problem is').max(FLAG_REASON_MAX),
		description: z.string().trim().max(FLAG_DESCRIPTION_MAX).optional()
	}),
	async (data, issue) => {
		const me = requireUser();
		const post = await getPost(data.postId).catch(mapDomainError);
		if (!canView(post, me.id, false) || post.authorUserId === me.id) {
			error(404, 'Post not found');
		}
		if ((await countUnresolvedReportsBy(me.id)) >= MAX_UNRESOLVED_REPORTS) {
			invalid(
				issue.reason('You have several reports waiting for staff. Try again once they are handled.')
			);
		}
		try {
			await createFlag({
				entityType: 'classified_post',
				entityId: data.postId,
				reportedByUserId: me.id,
				reportedByName: me.name,
				reason: data.reason,
				description: data.description
			});
		} catch (err) {
			mapDomainError(err);
		}
		return { success: true };
	}
);

// ---------------------------------------------------------------------------
// Mutations — staff
// ---------------------------------------------------------------------------

export const moderateClassified = form(
	z.object({
		postId: z.string().min(1),
		visibility: z.enum(['visible', 'hidden']),
		note: z.string().trim().max(CLASSIFIED_NOTE_MAX).optional()
	}),
	async (data, issue) => {
		const staff = await requireCapability('listing.review');
		// The note is the author's whole route back, so a takedown without one is refused.
		if (data.visibility === 'hidden' && !data.note) {
			invalid(issue.note('Tell the author what to change'));
		}
		try {
			await setVisibility(data.postId, {
				visibility: data.visibility,
				note: data.visibility === 'hidden' ? data.note : null,
				staffId: staff.id
			});
		} catch (err) {
			mapDomainError(err);
		}
		void getStaffClassifiedDetail(data.postId).refresh();
		return { success: true };
	}
);
