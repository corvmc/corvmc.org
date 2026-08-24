import { z } from 'zod';
import { toGenericRef, toMemberRef } from '$lib/server/entity/refs';
import { error, invalid } from '@sveltejs/kit';
import { query, form } from '$app/server';
import { requireStaff, requireUser } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import { getStanding } from '$lib/server/moderation/standing-service';
import { allowRateLimited } from '$lib/server/rate-limit';
import {
	suggestionCategories,
	suggestionStatuses,
	suggestionVisibilities,
	SUGGESTION_TITLE_MAX,
	SUGGESTION_BODY_MAX,
	SUGGESTION_RESPONSE_MAX,
	SUGGESTION_NOTE_MAX
} from '$lib/config';
import {
	listSuggestions,
	getSuggestion,
	listMergeCandidates,
	createSuggestion as createSuggestionSvc,
	toggleVote,
	respondToSuggestion as respondToSuggestionSvc,
	reviewSuggestion as reviewSuggestionSvc,
	setVisibility,
	mergeSuggestions,
	getEditableState,
	editSuggestion as editSuggestionSvc,
	cancelEditRequest,
	reviewEdit,
	getPendingEditFor,
	getEditRequest,
	listPendingEdits,
	SuggestionNotFoundError
} from '$lib/server/suggestion/suggestion-service';
import { createFlag, FLAG_REASON_MAX, FLAG_DESCRIPTION_MAX } from '$lib/server/flag/flag-service';

const BOARD_PAGE_SIZE = 20;
const STAFF_PAGE_SIZE = 25;

/** Reports are cheap to file and expensive to review, so throttle them. */
const FLAGS_PER_MEMBER = 5;
const FLAG_WINDOW_SECONDS = 3600;

// ---------------------------------------------------------------------------
// Queries — member
// ---------------------------------------------------------------------------

const boardFiltersSchema = z.object({
	category: z.enum(suggestionCategories).optional(),
	status: z.enum(suggestionStatuses).optional(),
	search: z.string().optional(),
	sort: z.enum(['top', 'new']).default('top'),
	page: z.number().optional()
});

export const getSuggestionBoard = query(boardFiltersSchema, async (filters) => {
	const me = requireUser();
	// Built field by field rather than spread. `visibility` and `includeMerged`
	// are already absent from the member schema, but that makes the guarantee
	// depend on zod stripping unknown keys — a library default, and one a future
	// `.passthrough()` or a looser schema would quietly undo. Naming the four
	// fields the board is allowed to filter on keeps the rule local and visible.
	const { rows, pagination } = await listSuggestions(
		{
			category: filters.category,
			status: filters.status,
			search: filters.search,
			sort: filters.sort
		},
		{ page: filters.page ?? 1, pageSize: BOARD_PAGE_SIZE },
		me.id
	);
	return {
		rows: rows.map((s) => ({
			...s,
			ref: toGenericRef('suggestion', { id: s.id, title: s.title })
		})),
		pagination
	};
});

export const getSuggestionDetail = query(z.string(), async (id) => {
	const me = requireUser();
	const row = await getSuggestion(id, me.id).catch(mapDomainError);

	// Only the author can reach their own withheld or hidden suggestion. For
	// anyone else it must 404 rather than 403 — otherwise flagging a post
	// becomes a way to confirm one exists.
	if (row.visibility !== 'visible' && row.authorUserId !== me.id) {
		error(404, 'Suggestion not found');
	}
	return row;
});

/**
 * Whether the signed-in member may change this suggestion, and whether it would
 * apply straight away. The page needs both to label the button honestly — "Edit"
 * versus "Request an edit" is the difference between a write and a review.
 */
export const getSuggestionEditState = query(z.string(), async (suggestionId) => {
	const me = requireUser();
	try {
		const state = await getEditableState(suggestionId, me.id);
		return {
			...state,
			pendingEdit: state.pendingEditId ? await getEditRequest(state.pendingEditId) : null
		};
	} catch (err) {
		mapDomainError(err);
	}
});

export const getMySuggestionStanding = query(async () => {
	const me = requireUser();
	// viewerUserId rides along so the board can tell which cards are the member's
	// own (you don't flag your own post) without a second round trip.
	return { ...(await getStanding(me.id, 'suggestion')), viewerUserId: me.id };
});

// ---------------------------------------------------------------------------
// Queries — staff
// ---------------------------------------------------------------------------

const staffFiltersSchema = boardFiltersSchema.extend({
	visibility: z.enum(suggestionVisibilities).optional(),
	includeMerged: z.boolean().optional()
});

export const getSuggestionsQueue = query(staffFiltersSchema, async (filters) => {
	await requireStaff();
	const { rows, pagination } = await listSuggestions(filters, {
		page: filters.page ?? 1,
		pageSize: STAFF_PAGE_SIZE
	});
	// Projected here rather than in `listSuggestions`: the member-facing board
	// reads the same service and draws the author its own way.
	return {
		rows: rows.map((s) => ({
			...s,
			ref: toGenericRef('suggestion', { id: s.id, title: s.title }),
			// "A former member", not the generic fallback: a suggestion outlives the
			// account that made it, and that is worth saying precisely.
			author: {
				...toMemberRef({ id: s.authorUserId, name: s.authorName }),
				title: s.authorName ?? 'A former member'
			}
		})),
		pagination
	};
});

export const getStaffSuggestionDetail = query(z.string(), async (id) => {
	await requireStaff();
	return getSuggestion(id).catch(mapDomainError);
});

export const getMergeCandidates = query(z.string(), async (excludeId) => {
	await requireStaff();
	return listMergeCandidates(excludeId);
});

export const getPendingSuggestionEdits = query(async () => {
	await requireStaff();
	const rows = await listPendingEdits();
	return rows.map((e) => ({
		...e,
		// The row is a proposed change; it opens the suggestion it would change.
		ref: toGenericRef('suggestion', { id: e.suggestionId, title: e.proposedTitle }),
		requestedBy: {
			...toMemberRef(e.requestedBy),
			title: e.requestedByName ?? 'A former member'
		}
	}));
});

export const getSuggestionPendingEdit = query(z.string(), async (suggestionId) => {
	await requireStaff();
	return getPendingEditFor(suggestionId);
});

// ---------------------------------------------------------------------------
// Mutations — member
// ---------------------------------------------------------------------------

export const createSuggestion = form(
	z.object({
		title: z.string().trim().min(1, 'A title is required').max(SUGGESTION_TITLE_MAX),
		body: z.string().trim().min(1, 'Tell us a bit more').max(SUGGESTION_BODY_MAX),
		category: z.enum(suggestionCategories)
	}),
	async (data) => {
		const me = requireUser();
		try {
			const row = await createSuggestionSvc({ ...data, authorUserId: me.id });
			return { id: row.id, visibility: row.visibility };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const toggleSuggestionVote = form(
	z.object({ suggestionId: z.string().min(1) }),
	async (data) => {
		const me = requireUser();
		try {
			// No .refresh() here: queries are cached per-argument, and this handler
			// cannot know the filter object the board is holding. The page refreshes
			// in onsuccess, where those exact args are in scope.
			return await toggleVote(data.suggestionId, me.id);
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const editSuggestion = form(
	z.object({
		suggestionId: z.string().min(1),
		title: z.string().trim().min(1, 'A title is required').max(SUGGESTION_TITLE_MAX),
		body: z.string().trim().min(1, 'Tell us a bit more').max(SUGGESTION_BODY_MAX),
		category: z.enum(suggestionCategories)
	}),
	async (data) => {
		const me = requireUser();
		try {
			// Whether this applies or queues is the service's call, not the
			// client's — a request that could ask for a direct write would be asking
			// to skip the check.
			const result = await editSuggestionSvc(data.suggestionId, {
				title: data.title,
				body: data.body,
				category: data.category,
				userId: me.id
			});
			void getSuggestionDetail(data.suggestionId).refresh();
			void getSuggestionEditState(data.suggestionId).refresh();
			return result;
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const cancelSuggestionEdit = form(
	z.object({ suggestionId: z.string().min(1), editId: z.string().min(1) }),
	async (data) => {
		const me = requireUser();
		try {
			await cancelEditRequest(data.editId, me.id);
		} catch (err) {
			mapDomainError(err);
		}
		void getSuggestionEditState(data.suggestionId).refresh();
		return { success: true };
	}
);

export const flagSuggestion = form(
	z.object({
		suggestionId: z.string().min(1),
		reason: z.string().trim().min(1, 'Say what the problem is').max(FLAG_REASON_MAX),
		description: z.string().trim().max(FLAG_DESCRIPTION_MAX).optional()
	}),
	async (data, issue) => {
		// Deliberately no requireFeature('contentFlags'), even though this writes a
		// content_flag row. Reporting is how a suggestion comes off this board — it
		// belongs to the board, not to the optional content-flag surface, and the
		// board itself is not flag-gated. Staff queues are never gated either, so
		// these reports always land somewhere visible.
		const me = requireUser();

		if (
			!(await allowRateLimited(`suggestion-flag:${me.id}`, FLAGS_PER_MEMBER, FLAG_WINDOW_SECONDS))
		) {
			invalid(issue.reason('You have reported a lot recently. Try again later.'));
		}

		try {
			// createFlag pulls the suggestion off the board as a side effect.
			await createFlag({
				entityType: 'suggestion',
				entityId: data.suggestionId,
				reportedByUserId: me.id,
				reportedByName: me.name,
				reason: data.reason,
				description: data.description
			});
		} catch (err) {
			if (err instanceof SuggestionNotFoundError) error(404, 'Suggestion not found');
			mapDomainError(err);
		}
		return { success: true };
	}
);

// ---------------------------------------------------------------------------
// Mutations — staff
// ---------------------------------------------------------------------------

export const respondToSuggestion = form(
	z.object({
		suggestionId: z.string().min(1),
		status: z.enum(suggestionStatuses),
		response: z.string().trim().max(SUGGESTION_RESPONSE_MAX).optional()
	}),
	async (data) => {
		const staff = await requireStaff();
		try {
			await respondToSuggestionSvc(data.suggestionId, {
				status: data.status,
				response: data.response,
				staffId: staff.id
			});
		} catch (err) {
			mapDomainError(err);
		}
		void getStaffSuggestionDetail(data.suggestionId).refresh();
		return { success: true };
	}
);

export const reviewSuggestion = form(
	z.object({
		suggestionId: z.string().min(1),
		decision: z.enum(['approve', 'reject']),
		note: z.string().trim().max(SUGGESTION_NOTE_MAX).optional()
	}),
	async (data) => {
		const staff = await requireStaff();
		try {
			await reviewSuggestionSvc(data.suggestionId, {
				decision: data.decision,
				note: data.note,
				staffId: staff.id
			});
		} catch (err) {
			mapDomainError(err);
		}
		void getStaffSuggestionDetail(data.suggestionId).refresh();
		return { success: true };
	}
);

export const setSuggestionVisibility = form(
	z.object({
		suggestionId: z.string().min(1),
		visibility: z.enum(suggestionVisibilities),
		note: z.string().trim().max(SUGGESTION_NOTE_MAX).optional()
	}),
	async (data) => {
		const staff = await requireStaff();
		try {
			await setVisibility(data.suggestionId, {
				visibility: data.visibility,
				note: data.note,
				staffId: staff.id
			});
		} catch (err) {
			mapDomainError(err);
		}
		void getStaffSuggestionDetail(data.suggestionId).refresh();
		return { success: true };
	}
);

export const mergeSuggestion = form(
	z.object({ sourceId: z.string().min(1), targetId: z.string().min(1) }),
	async (data) => {
		const staff = await requireStaff();
		try {
			await mergeSuggestions({ ...data, staffId: staff.id });
		} catch (err) {
			mapDomainError(err);
		}
		void getStaffSuggestionDetail(data.sourceId).refresh();
		void getStaffSuggestionDetail(data.targetId).refresh();
		return { targetId: data.targetId };
	}
);

export const reviewSuggestionEdit = form(
	z.object({
		suggestionId: z.string().min(1),
		editId: z.string().min(1),
		decision: z.enum(['approve', 'reject']),
		notes: z.string().trim().max(SUGGESTION_NOTE_MAX).optional()
	}),
	async (data) => {
		const staff = await requireStaff();
		try {
			await reviewEdit(data.editId, {
				decision: data.decision,
				notes: data.notes,
				staffId: staff.id
			});
		} catch (err) {
			mapDomainError(err);
		}
		void getStaffSuggestionDetail(data.suggestionId).refresh();
		void getSuggestionPendingEdit(data.suggestionId).refresh();
		void getPendingSuggestionEdits().refresh();
		return { success: true };
	}
);
