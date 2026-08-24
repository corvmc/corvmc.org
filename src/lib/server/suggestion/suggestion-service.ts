import { db } from '$lib/server/db';
import { memberRefColumns } from '$lib/server/entity/refs';
import {
	suggestion,
	suggestionVote,
	suggestionEdit,
	type Suggestion,
	type SuggestionCategory,
	type SuggestionStatus,
	type SuggestionVisibility
} from '$lib/server/db/schema/suggestion';
import { user } from '$lib/server/db/schema/authentication';
import { eq, and, or, desc, count, like, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { paginate, type PaginationInput } from '$lib/server/db/paginate';
import { DomainError } from '$lib/server/errors';
import { domainEvents, type DomainEvents } from '$lib/server/events/event-bus';
import { captureException } from '$lib/server/sentry';
import { getStanding } from '$lib/server/moderation/standing-service';
import {
	SUGGESTION_TITLE_MAX,
	SUGGESTION_BODY_MAX,
	SUGGESTION_RESPONSE_MAX,
	SUGGESTION_NOTE_MAX,
	suggestionStatusLabels
} from '$lib/config';
import { ne } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * D1 caps a statement at 100 bound params. A vote row binds id + suggestion_id
 * + user_id, so 25 rows leaves comfortable headroom.
 */
const VOTE_INSERT_CHUNK = 25;

/** How many merge targets the staff picker offers. */
const MERGE_CANDIDATE_LIMIT = 50;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SuggestionNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor(message = 'Suggestion not found') {
		super(message);
	}
}

export class SuggestionValidationError extends DomainError {
	readonly httpStatus = 400;
}

/** Voting on something that isn't on the board. */
export class SuggestionClosedError extends DomainError {
	readonly httpStatus = 409;
	constructor(message = 'This suggestion is not open for voting') {
		super(message);
	}
}

export class SuggestionMergeError extends DomainError {
	readonly httpStatus = 422;
}

export class SuggestionEditError extends DomainError {
	readonly httpStatus = 409;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trimTo(value: string, max: number): string {
	return value.trim().slice(0, max);
}

/**
 * Vote count as a grouped aggregate rather than a correlated subquery.
 *
 * `src/lib/server/correlated-sql.spec.ts` documents why: a correlated fragment
 * inside a SINGLE-table select renders its outer column reference unqualified
 * and silently matches everything. Every query below joins, so columns render
 * qualified and the trap doesn't apply — but do not "optimise" this into a
 * subquery on a bare `.from(suggestion)`.
 */
const voteCountSql = sql<number>`cast(count(${suggestionVote.id}) as integer)`;

function hasVotedSql(viewerUserId: string | undefined) {
	// No viewer (or a signed-out one) can never have voted; '' matches no user id.
	return sql<number>`cast(max(case when ${suggestionVote.userId} = ${viewerUserId ?? ''} then 1 else 0 end) as integer)`;
}

/** `merged` is derived, never stored — mergedIntoId is the source of truth. */
export function displayStatus(row: {
	status: SuggestionStatus;
	mergedIntoId: string | null;
}): SuggestionStatus | 'merged' {
	return row.mergedIntoId ? 'merged' : row.status;
}

/**
 * Everything a notification listener needs, so listeners stay DB-free — the
 * shape `EventUnpublishedByStaffEvent` and friends already use.
 */
async function loadForNotification(suggestionId: string) {
	const [row] = await db
		.select({
			id: suggestion.id,
			title: suggestion.title,
			visibility: suggestion.visibility,
			authorUserId: suggestion.authorUserId,
			authorName: user.name,
			authorEmail: user.email
		})
		.from(suggestion)
		.leftJoin(user, eq(user.id, suggestion.authorUserId))
		.where(eq(suggestion.id, suggestionId))
		.limit(1);
	return row ?? null;
}

function selection(viewerUserId: string | undefined) {
	return {
		id: suggestion.id,
		title: suggestion.title,
		body: suggestion.body,
		category: suggestion.category,
		status: suggestion.status,
		visibility: suggestion.visibility,
		visibilityNote: suggestion.visibilityNote,
		responseBody: suggestion.responseBody,
		responseAt: suggestion.responseAt,
		mergedIntoId: suggestion.mergedIntoId,
		editedAt: suggestion.editedAt,
		authorUserId: suggestion.authorUserId,
		authorName: user.name,
		createdAt: suggestion.createdAt,
		voteCount: voteCountSql,
		hasVoted: hasVotedSql(viewerUserId)
	};
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CreateSuggestionParams {
	authorUserId: string;
	title: string;
	body: string;
	category: SuggestionCategory;
}

export async function createSuggestion(params: CreateSuggestionParams): Promise<Suggestion> {
	const title = trimTo(params.title, SUGGESTION_TITLE_MAX);
	const body = trimTo(params.body, SUGGESTION_BODY_MAX);
	if (!title) throw new SuggestionValidationError('A title is required');
	if (!body) throw new SuggestionValidationError('A description is required');

	// A member who has had a report upheld posts under review until staff lift
	// it. Absence of a standing row is the common case and means trusted.
	const standing = await getStanding(params.authorUserId, 'suggestion');
	const requiresReview = standing.status !== 'none';
	const visibility: SuggestionVisibility = requiresReview ? 'pending_review' : 'visible';

	const [row] = await db
		.insert(suggestion)
		.values({
			authorUserId: params.authorUserId,
			title,
			body,
			category: params.category,
			visibility,
			visibilityChangedAt: requiresReview ? new Date() : null
		})
		.returning();

	return row;
}

/**
 * Add or remove this member's vote.
 *
 * Not atomic, and it doesn't need to be: a double-submit either conflicts (the
 * unique index absorbs it) or deletes twice (a no-op), and the trailing
 * re-count means the returned number is truthful even when a race happened.
 */
export async function toggleVote(
	suggestionId: string,
	userId: string
): Promise<{ voted: boolean; voteCount: number }> {
	const [target] = await db
		.select({
			id: suggestion.id,
			visibility: suggestion.visibility,
			mergedIntoId: suggestion.mergedIntoId
		})
		.from(suggestion)
		.where(eq(suggestion.id, suggestionId))
		.limit(1);

	if (!target) throw new SuggestionNotFoundError();
	if (target.mergedIntoId) {
		throw new SuggestionClosedError('This suggestion was merged into another one');
	}
	if (target.visibility !== 'visible') {
		throw new SuggestionClosedError('This suggestion is not on the board');
	}

	const [existing] = await db
		.select({ id: suggestionVote.id })
		.from(suggestionVote)
		.where(and(eq(suggestionVote.suggestionId, suggestionId), eq(suggestionVote.userId, userId)))
		.limit(1);

	if (existing) {
		await db.delete(suggestionVote).where(eq(suggestionVote.id, existing.id));
	} else {
		await db
			.insert(suggestionVote)
			.values({ suggestionId, userId })
			.onConflictDoNothing({ target: [suggestionVote.suggestionId, suggestionVote.userId] });
	}

	return { voted: !existing, voteCount: await countVotes(suggestionId) };
}

export interface RespondParams {
	status: SuggestionStatus;
	response?: string | null;
	staffId: string;
}

/**
 * Status and response are set together, on purpose.
 *
 * Split into two mutations, the normal staff workflow (mark Planned, then write
 * the reply) would fire two notifications for what the member experiences as
 * one act. One mutation, one event, one notification.
 */
export async function respondToSuggestion(
	suggestionId: string,
	params: RespondParams
): Promise<void> {
	const existing = await loadForNotification(suggestionId);
	if (!existing) throw new SuggestionNotFoundError();

	const response = params.response ? trimTo(params.response, SUGGESTION_RESPONSE_MAX) : '';

	await db
		.update(suggestion)
		.set({
			status: params.status,
			responseBody: response || null,
			responseByUserId: response ? params.staffId : null,
			responseAt: response ? new Date() : null,
			updatedAt: new Date()
		})
		.where(eq(suggestion.id, suggestionId));

	notifyAuthor('suggestion.responded', existing, params.staffId, {
		suggestionId,
		title: existing.title,
		status: params.status,
		statusLabel: suggestionStatusLabels[params.status],
		responseBody: response || null
	});
}

export interface SetVisibilityParams {
	visibility: SuggestionVisibility;
	note?: string | null;
	/** Null when the system moved it rather than a person. */
	staffId: string | null;
}

export async function setVisibility(
	suggestionId: string,
	params: SetVisibilityParams
): Promise<void> {
	const existing = await loadForNotification(suggestionId);
	if (!existing) throw new SuggestionNotFoundError();
	if (existing.visibility === params.visibility) return;

	const note = params.note ? trimTo(params.note, SUGGESTION_NOTE_MAX) : null;

	await db
		.update(suggestion)
		.set({
			visibility: params.visibility,
			visibilityNote: note,
			visibilityChangedAt: new Date(),
			visibilityChangedByUserId: params.staffId,
			updatedAt: new Date()
		})
		.where(eq(suggestion.id, suggestionId));

	notifyAuthor('suggestion.moderated', existing, params.staffId, {
		suggestionId,
		title: existing.title,
		visibility: params.visibility,
		note
	});
}

/**
 * Pull a suggestion off the board because it was reported. Called by
 * flag-service on every incoming report.
 *
 * Only `visible` rows move, which makes a second report on an already-withheld
 * suggestion a no-op rather than a state churn — and stops a report from
 * resurrecting something staff had already hidden.
 */
export async function withholdForReview(
	suggestionId: string,
	params: { flagId: string }
): Promise<void> {
	const existing = await loadForNotification(suggestionId);
	if (!existing || existing.visibility !== 'visible') return;

	await db
		.update(suggestion)
		.set({
			visibility: 'under_review',
			visibilityNote: null,
			visibilityChangedAt: new Date(),
			// No staff id: a member's report did this, not a person on the desk.
			visibilityChangedByUserId: null,
			updatedAt: new Date()
		})
		.where(and(eq(suggestion.id, suggestionId), eq(suggestion.visibility, 'visible')));

	notifyAuthor('suggestion.moderated', existing, null, {
		suggestionId,
		title: existing.title,
		visibility: 'under_review',
		note: null,
		flagId: params.flagId
	});
}

/** The `pending_review` decision: onto the board, or down. */
export async function reviewSuggestion(
	suggestionId: string,
	params: { decision: 'approve' | 'reject'; note?: string | null; staffId: string }
): Promise<void> {
	await setVisibility(suggestionId, {
		visibility: params.decision === 'approve' ? 'visible' : 'hidden',
		note: params.note ?? null,
		staffId: params.staffId
	});
}

export interface MergeParams {
	sourceId: string;
	targetId: string;
	staffId: string;
}

/**
 * Fold a duplicate into the suggestion it duplicates.
 *
 * There are no transactions on D1, so the ORDER of the two steps is the safety
 * property. Votes move first: a crash between the steps leaves both suggestions
 * on the board with nothing lost, which is obvious and re-runnable. The reverse
 * order would hide the source with its votes stranded, silently under-counting
 * the target.
 */
export async function mergeSuggestions(params: MergeParams): Promise<{ transferred: number }> {
	const { sourceId, targetId, staffId } = params;
	if (sourceId === targetId) {
		throw new SuggestionMergeError('A suggestion cannot be merged into itself');
	}

	const rows = await db
		.select({
			id: suggestion.id,
			title: suggestion.title,
			mergedIntoId: suggestion.mergedIntoId
		})
		.from(suggestion)
		.where(inArray(suggestion.id, [sourceId, targetId]));

	const source = rows.find((r) => r.id === sourceId);
	const target = rows.find((r) => r.id === targetId);
	if (!source || !target) throw new SuggestionNotFoundError();

	// Reject a merged target rather than following the chain. Simpler, and it
	// closes the only cycle: A→B then B→A is impossible once A is merged.
	if (target.mergedIntoId) {
		throw new SuggestionMergeError(
			'That suggestion was itself merged — merge into the one it points at'
		);
	}
	if (source.mergedIntoId && source.mergedIntoId !== targetId) {
		throw new SuggestionMergeError('This suggestion is already merged into a different one');
	}

	// --- Step 1: transfer votes. Additive and idempotent. ---
	const voters = await db
		.select({ userId: suggestionVote.userId })
		.from(suggestionVote)
		.where(eq(suggestionVote.suggestionId, sourceId));

	const statements = [];
	for (let i = 0; i < voters.length; i += VOTE_INSERT_CHUNK) {
		statements.push(
			db
				.insert(suggestionVote)
				.values(
					voters
						.slice(i, i + VOTE_INSERT_CHUNK)
						.map((v) => ({ suggestionId: targetId, userId: v.userId }))
				)
				// The dedup. Anyone who had already voted on the target is dropped by
				// the unique index, so nobody's vote counts twice — and it stays
				// race-safe against someone voting on the target mid-merge.
				.onConflictDoNothing({ target: [suggestionVote.suggestionId, suggestionVote.userId] })
		);
	}
	if (statements.length) {
		await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
	}

	// --- Step 2: only now point the source at the target. ---
	// The isNull guard makes a concurrent double-merge a no-op for the second
	// writer. There is deliberately no early return above when the source is
	// already merged to this same target: re-running repairs a half-finished merge.
	await db
		.update(suggestion)
		.set({
			mergedIntoId: targetId,
			mergedAt: new Date(),
			mergedByUserId: staffId,
			updatedAt: new Date()
		})
		.where(and(eq(suggestion.id, sourceId), isNull(suggestion.mergedIntoId)));

	// The source's own vote rows are kept. Merge stays purely additive: nothing
	// is destroyed, re-running is a total no-op, and the source is invisible on
	// the board so those rows are never double-counted anywhere.
	return { transferred: voters.length };
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

export interface EditableState {
	/** Whether this user may change the text at all. */
	canEdit: boolean;
	/**
	 * False once somebody else has voted: from then on an edit is a request
	 * staff approve, not a write.
	 */
	direct: boolean;
	/** A request already waiting on staff, if any. */
	pendingEditId: string | null;
}

/**
 * Who may change a suggestion, and whether it applies straight away.
 *
 * The rule is votes, not time. An author can rewrite freely while the only
 * person who has voted is themselves — typo fixes overwhelmingly happen in the
 * first minutes, and nobody is misled by a change nobody has endorsed. The
 * moment another member upvotes, the words become something they put their
 * name to, so changing them silently would be a bait-and-switch.
 */
export async function getEditableState(
	suggestionId: string,
	userId: string
): Promise<EditableState> {
	const [row] = await db
		.select({
			authorUserId: suggestion.authorUserId,
			visibility: suggestion.visibility,
			mergedIntoId: suggestion.mergedIntoId
		})
		.from(suggestion)
		.where(eq(suggestion.id, suggestionId))
		.limit(1);

	if (!row) throw new SuggestionNotFoundError();

	// Merged or taken down: there is nothing useful to edit, and editing a
	// hidden post would be a way to launder it back past the reason it went down.
	const editable =
		row.authorUserId === userId &&
		!row.mergedIntoId &&
		(row.visibility === 'visible' || row.visibility === 'pending_review');

	if (!editable) return { canEdit: false, direct: false, pendingEditId: null };

	const [pending] = await db
		.select({ id: suggestionEdit.id })
		.from(suggestionEdit)
		.where(and(eq(suggestionEdit.suggestionId, suggestionId), eq(suggestionEdit.status, 'pending')))
		.limit(1);

	return {
		canEdit: true,
		direct: (await countOtherVotes(suggestionId, userId)) === 0,
		pendingEditId: pending?.id ?? null
	};
}

/** Votes from anyone but the author. An author's own vote never locks their post. */
async function countOtherVotes(suggestionId: string, authorUserId: string): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(suggestionVote)
		.where(
			and(eq(suggestionVote.suggestionId, suggestionId), ne(suggestionVote.userId, authorUserId))
		);
	return row?.count ?? 0;
}

export interface EditSuggestionParams {
	title: string;
	body: string;
	category: SuggestionCategory;
	userId: string;
}

/**
 * Apply an edit, or file it for review — the caller does not choose which.
 *
 * Returning the outcome rather than taking it as an argument is deliberate: a
 * client that could ask for `direct` would be asking to skip the check.
 */
export async function editSuggestion(
	suggestionId: string,
	params: EditSuggestionParams
): Promise<{ applied: boolean; editId: string | null }> {
	const title = trimTo(params.title, SUGGESTION_TITLE_MAX);
	const body = trimTo(params.body, SUGGESTION_BODY_MAX);
	if (!title) throw new SuggestionValidationError('A title is required');
	if (!body) throw new SuggestionValidationError('A description is required');

	const state = await getEditableState(suggestionId, params.userId);
	if (!state.canEdit) throw new SuggestionEditError('This suggestion can no longer be edited');
	if (state.pendingEditId) {
		throw new SuggestionEditError('You already have an edit waiting for staff on this suggestion');
	}

	const current = await getSuggestionForModeration(suggestionId);
	if (!current) throw new SuggestionNotFoundError();

	if (state.direct) {
		await db
			.update(suggestion)
			.set({
				title,
				body,
				category: params.category,
				// Only stamp editedAt when something actually changed, so a member who
				// opens the form and saves without touching it doesn't mark the post.
				...(title !== current.title || body !== current.body ? { editedAt: new Date() } : {}),
				updatedAt: new Date()
			})
			.where(eq(suggestion.id, suggestionId));
		return { applied: true, editId: null };
	}

	const [row] = await db
		.insert(suggestionEdit)
		.values({
			suggestionId,
			requestedByUserId: params.userId,
			proposedTitle: title,
			proposedBody: body,
			proposedCategory: params.category,
			// Snapshot, not a live join: staff should review the change the author
			// was actually looking at, even if the post moved underneath them.
			originalTitle: current.title,
			originalBody: current.body,
			originalCategory: current.category
		})
		.returning();

	return { applied: false, editId: row.id };
}

/** Let the author take back a request staff have not got to yet. */
export async function cancelEditRequest(editId: string, userId: string): Promise<void> {
	const [row] = await db
		.select({
			id: suggestionEdit.id,
			requestedByUserId: suggestionEdit.requestedByUserId,
			status: suggestionEdit.status
		})
		.from(suggestionEdit)
		.where(eq(suggestionEdit.id, editId))
		.limit(1);

	if (!row) throw new SuggestionNotFoundError('Edit request not found');
	if (row.requestedByUserId !== userId)
		throw new SuggestionEditError('That is not your edit request');
	if (row.status !== 'pending')
		throw new SuggestionEditError('That edit has already been reviewed');

	await db.delete(suggestionEdit).where(eq(suggestionEdit.id, editId));
}

/**
 * Staff decide on a proposed edit.
 *
 * Approving writes the new text FIRST, then marks the request. No transactions
 * on D1, so a crash between the two leaves an approved-in-substance request
 * still showing as pending — visible and re-runnable, where the reverse order
 * would show "approved" over text that never changed.
 */
export async function reviewEdit(
	editId: string,
	params: { decision: 'approve' | 'reject'; notes?: string | null; staffId: string }
): Promise<void> {
	const [row] = await db
		.select({
			id: suggestionEdit.id,
			suggestionId: suggestionEdit.suggestionId,
			status: suggestionEdit.status,
			proposedTitle: suggestionEdit.proposedTitle,
			proposedBody: suggestionEdit.proposedBody,
			proposedCategory: suggestionEdit.proposedCategory
		})
		.from(suggestionEdit)
		.where(eq(suggestionEdit.id, editId))
		.limit(1);

	if (!row) throw new SuggestionNotFoundError('Edit request not found');
	if (row.status !== 'pending')
		throw new SuggestionEditError('That edit has already been reviewed');

	const target = await loadForNotification(row.suggestionId);

	if (params.decision === 'approve') {
		await db
			.update(suggestion)
			.set({
				title: row.proposedTitle,
				body: row.proposedBody,
				category: row.proposedCategory,
				editedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(suggestion.id, row.suggestionId));
	}

	await db
		.update(suggestionEdit)
		.set({
			status: params.decision === 'approve' ? 'approved' : 'rejected',
			reviewNotes: params.notes ? trimTo(params.notes, SUGGESTION_NOTE_MAX) : null,
			reviewedByUserId: params.staffId,
			reviewedAt: new Date()
		})
		.where(and(eq(suggestionEdit.id, editId), eq(suggestionEdit.status, 'pending')));

	if (target) {
		notifyAuthor('suggestion.edit_reviewed', target, params.staffId, {
			suggestionId: row.suggestionId,
			title: params.decision === 'approve' ? row.proposedTitle : target.title,
			approved: params.decision === 'approve',
			notes: params.notes ?? null
		});
	}
}

export async function getEditRequest(editId: string) {
	const requester = alias(user, 'edit_requester');
	const [row] = await db
		.select({
			id: suggestionEdit.id,
			suggestionId: suggestionEdit.suggestionId,
			status: suggestionEdit.status,
			proposedTitle: suggestionEdit.proposedTitle,
			proposedBody: suggestionEdit.proposedBody,
			proposedCategory: suggestionEdit.proposedCategory,
			originalTitle: suggestionEdit.originalTitle,
			originalBody: suggestionEdit.originalBody,
			originalCategory: suggestionEdit.originalCategory,
			reviewNotes: suggestionEdit.reviewNotes,
			createdAt: suggestionEdit.createdAt,
			requestedByName: requester.name
		})
		.from(suggestionEdit)
		.leftJoin(requester, eq(requester.id, suggestionEdit.requestedByUserId))
		.where(eq(suggestionEdit.id, editId))
		.limit(1);
	return row ?? null;
}

/** The pending edit for a suggestion, if there is one. */
export async function getPendingEditFor(suggestionId: string) {
	const [row] = await db
		.select({ id: suggestionEdit.id })
		.from(suggestionEdit)
		.where(and(eq(suggestionEdit.suggestionId, suggestionId), eq(suggestionEdit.status, 'pending')))
		.limit(1);
	return row ? getEditRequest(row.id) : null;
}

/** Every edit waiting on staff, newest last so the oldest is dealt with first. */
export async function listPendingEdits() {
	const requester = alias(user, 'edit_requester');
	return db
		.select({
			id: suggestionEdit.id,
			suggestionId: suggestionEdit.suggestionId,
			proposedTitle: suggestionEdit.proposedTitle,
			originalTitle: suggestionEdit.originalTitle,
			createdAt: suggestionEdit.createdAt,
			requestedByName: requester.name,
			// The `user` join is aliased here — one query, two people, if the
			// suggestion's own author is ever added beside the requester.
			requestedBy: memberRefColumns(requester)
		})
		.from(suggestionEdit)
		.leftJoin(requester, eq(requester.id, suggestionEdit.requestedByUserId))
		.where(eq(suggestionEdit.status, 'pending'))
		.orderBy(desc(suggestionEdit.createdAt));
}

export async function countPendingEdits(): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(suggestionEdit)
		.where(eq(suggestionEdit.status, 'pending'));
	return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface SuggestionFilters {
	status?: SuggestionStatus;
	category?: SuggestionCategory;
	search?: string;
	sort?: 'top' | 'new';
	/** Staff only. Omitted on the member board, which is always `visible`. */
	visibility?: SuggestionVisibility;
	/** Staff only. Without it, merged rows are excluded. */
	includeMerged?: boolean;
}

export type SuggestionListRow = Awaited<ReturnType<typeof listSuggestions>>['rows'][number];

// Return type is inferred from `paginate` so the row shape stays tied to
// `selection()` — annotating it by hand is how a column silently goes missing.
export async function listSuggestions(
	filters: SuggestionFilters,
	pagination: PaginationInput,
	viewerUserId?: string
) {
	const conditions = [];

	// Every predicate here MUST reference `suggestion` columns only: the count
	// query below is join-free, so a condition touching `user` or
	// `suggestion_vote` would break the total silently.
	conditions.push(eq(suggestion.visibility, filters.visibility ?? 'visible'));
	if (!filters.includeMerged) conditions.push(isNull(suggestion.mergedIntoId));
	if (filters.status) conditions.push(eq(suggestion.status, filters.status));
	if (filters.category) conditions.push(eq(suggestion.category, filters.category));
	if (filters.search?.trim()) {
		const term = `%${filters.search.trim()}%`;
		conditions.push(or(like(suggestion.title, term), like(suggestion.body, term)));
	}
	const where = and(...conditions);

	const dataQ = db
		.select(selection(viewerUserId))
		.from(suggestion)
		.leftJoin(user, eq(user.id, suggestion.authorUserId))
		.leftJoin(suggestionVote, eq(suggestionVote.suggestionId, suggestion.id))
		.where(where)
		.groupBy(suggestion.id)
		.orderBy(
			...(filters.sort === 'new'
				? [desc(suggestion.createdAt)]
				: [desc(voteCountSql), desc(suggestion.createdAt)])
		)
		.$dynamic();

	const countQ = db.select({ count: count() }).from(suggestion).where(where);

	return paginate(dataQ, countQ, pagination);
}

export async function getSuggestion(id: string, viewerUserId?: string) {
	const responder = alias(user, 'responder');
	const mergeTarget = alias(suggestion, 'merge_target');

	const [row] = await db
		.select({
			...selection(viewerUserId),
			body: suggestion.body,
			visibilityChangedAt: suggestion.visibilityChangedAt,
			responderName: responder.name,
			mergedIntoTitle: mergeTarget.title,
			updatedAt: suggestion.updatedAt
		})
		.from(suggestion)
		.leftJoin(user, eq(user.id, suggestion.authorUserId))
		.leftJoin(responder, eq(responder.id, suggestion.responseByUserId))
		.leftJoin(mergeTarget, eq(mergeTarget.id, suggestion.mergedIntoId))
		.leftJoin(suggestionVote, eq(suggestionVote.suggestionId, suggestion.id))
		.where(eq(suggestion.id, id))
		.groupBy(suggestion.id)
		.limit(1);

	if (!row) throw new SuggestionNotFoundError();
	return row;
}

/** Minimal read for flag-service, which only needs to know whose post it is. */
export async function getSuggestionForModeration(id: string) {
	const [row] = await db
		.select({
			id: suggestion.id,
			title: suggestion.title,
			body: suggestion.body,
			category: suggestion.category,
			authorUserId: suggestion.authorUserId,
			visibility: suggestion.visibility
		})
		.from(suggestion)
		.where(eq(suggestion.id, id))
		.limit(1);
	return row ?? null;
}

export async function countVotes(suggestionId: string): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(suggestionVote)
		.where(eq(suggestionVote.suggestionId, suggestionId));
	return row?.count ?? 0;
}

/** Merge targets for the staff picker: on the board, not merged, not itself. */
export async function listMergeCandidates(excludeId: string) {
	return db
		.select({
			id: suggestion.id,
			title: suggestion.title,
			voteCount: voteCountSql
		})
		.from(suggestion)
		.leftJoin(suggestionVote, eq(suggestionVote.suggestionId, suggestion.id))
		.where(
			and(
				eq(suggestion.visibility, 'visible'),
				isNull(suggestion.mergedIntoId),
				sql`${suggestion.id} <> ${excludeId}`
			)
		)
		.groupBy(suggestion.id)
		.orderBy(desc(voteCountSql), desc(suggestion.createdAt))
		.limit(MERGE_CANDIDATE_LIMIT);
}

/** Suggestions members cannot see while they wait. Leads the staff nav badge. */
export async function countAwaitingModeration(): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(suggestion)
		.where(inArray(suggestion.visibility, ['pending_review', 'under_review']));
	return row?.count ?? 0;
}

/** On the board, open, and nobody has written back yet. */
export async function countAwaitingResponse(): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(suggestion)
		.where(
			and(
				eq(suggestion.visibility, 'visible'),
				eq(suggestion.status, 'open'),
				isNull(suggestion.responseBody),
				isNull(suggestion.mergedIntoId)
			)
		);
	return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Side effects
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget domain event, skipped when there is nobody to tell or when
 * the actor IS the author (nobody needs notifying of their own action).
 */
function notifyAuthor<
	K extends 'suggestion.responded' | 'suggestion.moderated' | 'suggestion.edit_reviewed'
>(
	name: K,
	author: { authorUserId: string | null; authorName: string | null; authorEmail: string | null },
	actorId: string | null,
	payload: Omit<DomainEvents[K], 'authorUserId' | 'authorName' | 'authorEmail'>
): void {
	const { authorUserId, authorName, authorEmail } = author;
	// No author (deleted account), no address to write to, or the actor IS the
	// author — nobody needs notifying of their own action.
	if (!authorUserId || !authorEmail || authorUserId === actorId) return;

	Promise.resolve().then(async () => {
		try {
			await domainEvents.emit(name, {
				...payload,
				authorUserId,
				authorName: authorName ?? 'there',
				authorEmail
			} as DomainEvents[K]);
		} catch (err) {
			captureException(err, { event: name, suggestionId: payload.suggestionId });
		}
	});
}
