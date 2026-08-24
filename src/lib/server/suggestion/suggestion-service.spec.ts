import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — the chainable db proxy from community-event-service.spec.ts, plus a
// `batch` spy (merge is the only place in the app that batches vote inserts).
// ---------------------------------------------------------------------------

let selectResultQueue: unknown[][] = [];
let insertResult: unknown[] = [];

function chainable(result?: () => unknown[]) {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => {
					if (result) return resolve(result());
					return resolve(selectResultQueue.shift() ?? []);
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

/** Every write, in the order it happened — merge's ordering is load-bearing. */
let calls: string[] = [];
const insertValues = vi.fn();
const updateSet = vi.fn();
const deleteCalled = vi.fn();
const batchCalled = vi.fn();
const onConflictDoNothing = vi.fn();
const onConflictDoUpdate = vi.fn();

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chainable()),
		insert: vi.fn(() => ({
			values: vi.fn((v: unknown) => {
				calls.push('insert');
				insertValues(v);
				const ret: any = Object.assign(Promise.resolve(insertResult), {
					returning: () => Promise.resolve(insertResult),
					onConflictDoNothing: (c: unknown) => {
						onConflictDoNothing(c);
						return ret;
					},
					onConflictDoUpdate: (c: unknown) => {
						onConflictDoUpdate(c);
						return Promise.resolve(insertResult);
					}
				});
				return ret;
			})
		})),
		update: vi.fn(() => ({
			set: vi.fn((v: unknown) => {
				calls.push('update');
				updateSet(v);
				return chainable(() => []);
			})
		})),
		delete: vi.fn(() => {
			calls.push('delete');
			deleteCalled();
			return chainable(() => []);
		}),
		batch: vi.fn((stmts: unknown[]) => {
			calls.push('batch');
			batchCalled(stmts);
			return Promise.resolve([]);
		})
	}
}));

const emit = vi.fn(() => Promise.resolve());
vi.mock('$lib/server/events/event-bus', () => ({
	domainEvents: { emit: (...a: unknown[]) => emit(...(a as [])), on: vi.fn() }
}));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

// Posting standing is one shared service now; here it is a mock, so the queue
// positions below are about suggestions and nothing else.
// `vi.hoisted` because the import below is hoisted above this line: a plain
// `const` would still be in its temporal dead zone when the mock factory runs.
const { getStandingMock } = vi.hoisted(() => ({ getStandingMock: vi.fn() }));
const GOOD_STANDING = { status: 'none', reason: null, triggeringFlagId: null, updatedAt: null };
vi.mock('$lib/server/moderation/standing-service', () => ({
	getStanding: (...a: unknown[]) => getStandingMock(...(a as []))
}));

import {
	createSuggestion,
	toggleVote,
	mergeSuggestions,
	respondToSuggestion,
	withholdForReview,
	getEditableState,
	editSuggestion,
	reviewEdit,
	cancelEditRequest,
	SuggestionEditError,
	displayStatus,
	SuggestionNotFoundError,
	SuggestionClosedError,
	SuggestionMergeError,
	SuggestionValidationError
} from './suggestion-service';
import { SUGGESTION_TITLE_MAX, SUGGESTION_BODY_MAX } from '$lib/config';

beforeEach(() => {
	selectResultQueue = [];
	insertResult = [{ id: 's1' }];
	calls = [];
	vi.clearAllMocks();
	getStandingMock.mockResolvedValue(GOOD_STANDING);
});

/** Flush the fire-and-forget `Promise.resolve().then()` in notifyAuthor. */
const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

describe('createSuggestion', () => {
	it('trims and truncates title and body to their limits', async () => {
		await createSuggestion({
			authorUserId: 'u1',
			title: '  ' + 'T'.repeat(SUGGESTION_TITLE_MAX + 50) + '  ',
			body: 'B'.repeat(SUGGESTION_BODY_MAX + 50),
			category: 'other'
		});

		const v = insertValues.mock.calls[0][0] as { title: string; body: string };
		expect(v.title).toHaveLength(SUGGESTION_TITLE_MAX);
		expect(v.body).toHaveLength(SUGGESTION_BODY_MAX);
	});

	it('publishes straight to the board for a member in good standing', async () => {
		selectResultQueue = [[]];
		await createSuggestion({ authorUserId: 'u1', title: 'T', body: 'B', category: 'policy' });

		expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'visible' }));
	});

	it('withholds the post when the author is required to post under review', async () => {
		getStandingMock.mockResolvedValue({
			status: 'restricted',
			reason: 'spam',
			triggeringFlagId: 'f1',
			updatedAt: new Date()
		});
		await createSuggestion({ authorUserId: 'u1', title: 'T', body: 'B', category: 'policy' });

		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ visibility: 'pending_review' })
		);
	});

	it('rejects an empty title', async () => {
		selectResultQueue = [[]];
		await expect(
			createSuggestion({ authorUserId: 'u1', title: '   ', body: 'B', category: 'other' })
		).rejects.toThrow(SuggestionValidationError);
	});
});

describe('toggleVote', () => {
	it('adds a vote when none exists, deduped by the unique index', async () => {
		selectResultQueue = [
			[{ id: 's1', visibility: 'visible', mergedIntoId: null }],
			[], // no existing vote
			[{ count: 4 }]
		];
		const result = await toggleVote('s1', 'u1');

		expect(result).toEqual({ voted: true, voteCount: 4 });
		expect(onConflictDoNothing).toHaveBeenCalledOnce();
	});

	it('removes the vote when one already exists', async () => {
		selectResultQueue = [
			[{ id: 's1', visibility: 'visible', mergedIntoId: null }],
			[{ id: 'v1' }],
			[{ count: 3 }]
		];
		const result = await toggleVote('s1', 'u1');

		expect(result).toEqual({ voted: false, voteCount: 3 });
		expect(deleteCalled).toHaveBeenCalledOnce();
	});

	it('404s an unknown suggestion', async () => {
		selectResultQueue = [[]];
		await expect(toggleVote('nope', 'u1')).rejects.toThrow(SuggestionNotFoundError);
	});

	it.each(['pending_review', 'under_review', 'hidden'])(
		'refuses a vote on a %s suggestion',
		async (visibility) => {
			selectResultQueue = [[{ id: 's1', visibility, mergedIntoId: null }]];
			await expect(toggleVote('s1', 'u1')).rejects.toThrow(SuggestionClosedError);
		}
	);

	it('refuses a vote on a merged suggestion', async () => {
		selectResultQueue = [[{ id: 's1', visibility: 'visible', mergedIntoId: 's2' }]];
		await expect(toggleVote('s1', 'u1')).rejects.toThrow(SuggestionClosedError);
	});
});

describe('withholdForReview', () => {
	it('pulls a visible suggestion off the board with no staff actor', async () => {
		selectResultQueue = [
			[
				{
					id: 's1',
					title: 'T',
					authorUserId: 'u1',
					authorName: 'Ada',
					authorEmail: 'ada@example.com',
					visibility: 'visible'
				}
			]
		];
		await withholdForReview('s1', { flagId: 'f1' });

		expect(updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ visibility: 'under_review', visibilityChangedByUserId: null })
		);
	});

	it('is a no-op on a suggestion that is already off the board', async () => {
		selectResultQueue = [
			[
				{
					id: 's1',
					title: 'T',
					authorUserId: 'u1',
					authorName: 'Ada',
					authorEmail: 'ada@example.com',
					visibility: 'hidden'
				}
			]
		];
		await withholdForReview('s1', { flagId: 'f2' });

		expect(updateSet).not.toHaveBeenCalled();
	});
});

describe('mergeSuggestions', () => {
	const staffId = 'staff1';

	it('refuses to merge a suggestion into itself', async () => {
		await expect(mergeSuggestions({ sourceId: 's1', targetId: 's1', staffId })).rejects.toThrow(
			SuggestionMergeError
		);
	});

	it('refuses a target that was itself merged, rather than following the chain', async () => {
		selectResultQueue = [
			[
				{ id: 's1', title: 'A', mergedIntoId: null },
				{ id: 's2', title: 'B', mergedIntoId: 's3' }
			]
		];
		await expect(mergeSuggestions({ sourceId: 's1', targetId: 's2', staffId })).rejects.toThrow(
			/points at/
		);
	});

	it('refuses a source already merged somewhere else', async () => {
		selectResultQueue = [
			[
				{ id: 's1', title: 'A', mergedIntoId: 's9' },
				{ id: 's2', title: 'B', mergedIntoId: null }
			]
		];
		await expect(mergeSuggestions({ sourceId: 's1', targetId: 's2', staffId })).rejects.toThrow(
			/already merged/
		);
	});

	it('404s when either suggestion is missing', async () => {
		selectResultQueue = [[{ id: 's1', title: 'A', mergedIntoId: null }]];
		await expect(mergeSuggestions({ sourceId: 's1', targetId: 'gone', staffId })).rejects.toThrow(
			SuggestionNotFoundError
		);
	});

	it('transfers votes BEFORE marking the source merged', async () => {
		selectResultQueue = [
			[
				{ id: 's1', title: 'A', mergedIntoId: null },
				{ id: 's2', title: 'B', mergedIntoId: null }
			],
			[{ userId: 'u1' }, { userId: 'u2' }]
		];
		await mergeSuggestions({ sourceId: 's1', targetId: 's2', staffId });

		// A crash between the two steps must leave both on the board with no vote
		// lost — which is only true in this order.
		expect(calls.indexOf('batch')).toBeLessThan(calls.indexOf('update'));
	});

	it('dedupes transferred votes via onConflictDoNothing on (suggestion, user)', async () => {
		selectResultQueue = [
			[
				{ id: 's1', title: 'A', mergedIntoId: null },
				{ id: 's2', title: 'B', mergedIntoId: null }
			],
			[{ userId: 'u1' }]
		];
		await mergeSuggestions({ sourceId: 's1', targetId: 's2', staffId });

		expect(onConflictDoNothing).toHaveBeenCalledOnce();
		expect(insertValues).toHaveBeenCalledWith([{ suggestionId: 's2', userId: 'u1' }]);
	});

	it('chunks the transfer so no statement exceeds D1 bound-param limits', async () => {
		const voters = Array.from({ length: 60 }, (_, i) => ({ userId: `u${i}` }));
		selectResultQueue = [
			[
				{ id: 's1', title: 'A', mergedIntoId: null },
				{ id: 's2', title: 'B', mergedIntoId: null }
			],
			voters
		];
		const result = await mergeSuggestions({ sourceId: 's1', targetId: 's2', staffId });

		expect(result.transferred).toBe(60);
		// 60 voters at 25 per statement → 3 statements in one batch.
		expect(batchCalled.mock.calls[0][0]).toHaveLength(3);
	});

	it('skips the batch entirely when the source has no votes', async () => {
		selectResultQueue = [
			[
				{ id: 's1', title: 'A', mergedIntoId: null },
				{ id: 's2', title: 'B', mergedIntoId: null }
			],
			[]
		];
		await mergeSuggestions({ sourceId: 's1', targetId: 's2', staffId });

		expect(batchCalled).not.toHaveBeenCalled();
	});

	it('re-running the same merge repairs rather than errors', async () => {
		selectResultQueue = [
			[
				{ id: 's1', title: 'A', mergedIntoId: 's2' },
				{ id: 's2', title: 'B', mergedIntoId: null }
			],
			[{ userId: 'u1' }]
		];
		await expect(mergeSuggestions({ sourceId: 's1', targetId: 's2', staffId })).resolves.toEqual({
			transferred: 1
		});
	});
});

describe('respondToSuggestion', () => {
	it('notifies the author exactly once', async () => {
		selectResultQueue = [
			[
				{
					id: 's1',
					title: 'T',
					authorUserId: 'u1',
					authorName: 'Ada',
					authorEmail: 'ada@example.com'
				}
			]
		];
		await respondToSuggestion('s1', {
			status: 'planned',
			response: 'Good idea',
			staffId: 'staff1'
		});
		await flushMicrotasks();

		expect(emit).toHaveBeenCalledOnce();
		expect(emit).toHaveBeenCalledWith(
			'suggestion.responded',
			expect.objectContaining({ authorUserId: 'u1', status: 'planned', statusLabel: 'Planned' })
		);
	});

	it('stays silent when the suggestion has no author left', async () => {
		selectResultQueue = [
			[{ id: 's1', title: 'T', authorUserId: null, authorName: null, authorEmail: null }]
		];
		await respondToSuggestion('s1', { status: 'done', staffId: 'staff1' });
		await flushMicrotasks();

		expect(emit).not.toHaveBeenCalled();
	});

	it('clears the response fields when the reply is emptied', async () => {
		selectResultQueue = [
			[
				{
					id: 's1',
					title: 'T',
					authorUserId: 'u1',
					authorName: 'Ada',
					authorEmail: 'ada@example.com'
				}
			]
		];
		await respondToSuggestion('s1', { status: 'open', response: '', staffId: 'staff1' });

		expect(updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ responseBody: null, responseAt: null, responseByUserId: null })
		);
	});
});

describe('displayStatus', () => {
	it('derives merged from mergedIntoId rather than reading a stored status', () => {
		expect(displayStatus({ status: 'open', mergedIntoId: 's2' })).toBe('merged');
		expect(displayStatus({ status: 'planned', mergedIntoId: null })).toBe('planned');
	});
});

describe('notification safety', () => {
	it('stays silent when the author has no address to write to', async () => {
		selectResultQueue = [
			[{ id: 's1', title: 'T', authorUserId: 'u1', authorName: 'Ada', authorEmail: null }]
		];
		await respondToSuggestion('s1', { status: 'done', staffId: 'staff1' });
		await flushMicrotasks();

		expect(emit).not.toHaveBeenCalled();
	});

	it('does not notify staff about their own suggestion', async () => {
		selectResultQueue = [
			[{ id: 's1', title: 'T', authorUserId: 'staff1', authorName: 'Sam', authorEmail: 's@x.com' }]
		];
		await respondToSuggestion('s1', { status: 'planned', staffId: 'staff1' });
		await flushMicrotasks();

		expect(emit).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Editing
//
// The rule these pin is the anti-bait-and-switch one: an author may rewrite
// their suggestion freely until somebody ELSE has voted for it, after which the
// words are what other members endorsed and a change has to go past staff.
// ---------------------------------------------------------------------------

describe('getEditableState', () => {
	it('lets the author edit directly while nobody else has voted', async () => {
		selectResultQueue = [
			[{ authorUserId: 'u1', visibility: 'visible', mergedIntoId: null }],
			[], // no pending edit request
			[{ count: 0 }] // no votes from anyone but the author
		];
		await expect(getEditableState('s1', 'u1')).resolves.toMatchObject({
			canEdit: true,
			direct: true
		});
	});

	it("stops direct editing the moment someone else's vote lands", async () => {
		selectResultQueue = [
			[{ authorUserId: 'u1', visibility: 'visible', mergedIntoId: null }],
			[],
			[{ count: 1 }]
		];
		await expect(getEditableState('s1', 'u1')).resolves.toMatchObject({
			canEdit: true,
			direct: false
		});
	});

	it('refuses anyone who is not the author', async () => {
		selectResultQueue = [[{ authorUserId: 'u1', visibility: 'visible', mergedIntoId: null }]];
		await expect(getEditableState('s1', 'someone-else')).resolves.toEqual({
			canEdit: false,
			direct: false,
			pendingEditId: null
		});
	});

	it('refuses a merged suggestion', async () => {
		selectResultQueue = [[{ authorUserId: 'u1', visibility: 'visible', mergedIntoId: 's2' }]];
		await expect(getEditableState('s1', 'u1')).resolves.toMatchObject({ canEdit: false });
	});

	it.each(['under_review', 'hidden'])(
		'refuses a %s suggestion, so an edit cannot launder it back',
		async (visibility) => {
			selectResultQueue = [[{ authorUserId: 'u1', visibility, mergedIntoId: null }]];
			await expect(getEditableState('s1', 'u1')).resolves.toMatchObject({ canEdit: false });
		}
	);

	it('surfaces a request already waiting on staff', async () => {
		selectResultQueue = [
			[{ authorUserId: 'u1', visibility: 'visible', mergedIntoId: null }],
			[{ id: 'edit-1' }],
			[{ count: 3 }]
		];
		await expect(getEditableState('s1', 'u1')).resolves.toMatchObject({ pendingEditId: 'edit-1' });
	});
});

describe('editSuggestion', () => {
	const edit = { title: 'New title', body: 'New body', category: 'other' as const, userId: 'u1' };

	it('writes straight through when nobody else has voted', async () => {
		selectResultQueue = [
			[{ authorUserId: 'u1', visibility: 'visible', mergedIntoId: null }],
			[],
			[{ count: 0 }],
			[{ id: 's1', title: 'Old', body: 'Old body', category: 'other', authorUserId: 'u1' }]
		];
		const result = await editSuggestion('s1', edit);

		expect(result).toEqual({ applied: true, editId: null });
		expect(updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'New title', body: 'New body' })
		);
	});

	it('stamps editedAt only when the words actually changed', async () => {
		selectResultQueue = [
			[{ authorUserId: 'u1', visibility: 'visible', mergedIntoId: null }],
			[],
			[{ count: 0 }],
			// Same title and body: the member opened the form and saved without typing.
			[{ id: 's1', title: 'New title', body: 'New body', category: 'other', authorUserId: 'u1' }]
		];
		await editSuggestion('s1', edit);

		expect(updateSet.mock.calls[0][0]).not.toHaveProperty('editedAt');
	});

	it('files a request instead of writing once someone else has voted', async () => {
		insertResult = [{ id: 'edit-9' }];
		selectResultQueue = [
			[{ authorUserId: 'u1', visibility: 'visible', mergedIntoId: null }],
			[],
			[{ count: 2 }],
			[{ id: 's1', title: 'Old', body: 'Old body', category: 'policy', authorUserId: 'u1' }]
		];
		const result = await editSuggestion('s1', edit);

		expect(result).toEqual({ applied: false, editId: 'edit-9' });
		// The suggestion itself is untouched — that is the whole point.
		expect(updateSet).not.toHaveBeenCalled();
		// And the request carries a snapshot of what it would replace, so staff
		// review a real before/after.
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				proposedTitle: 'New title',
				originalTitle: 'Old',
				originalBody: 'Old body',
				originalCategory: 'policy'
			})
		);
	});

	it('refuses a second request while one is already waiting', async () => {
		selectResultQueue = [
			[{ authorUserId: 'u1', visibility: 'visible', mergedIntoId: null }],
			[{ id: 'edit-1' }],
			[{ count: 2 }]
		];
		await expect(editSuggestion('s1', edit)).rejects.toThrow(SuggestionEditError);
	});

	it('refuses an edit from someone who is not the author', async () => {
		selectResultQueue = [
			[{ authorUserId: 'someone-else', visibility: 'visible', mergedIntoId: null }]
		];
		await expect(editSuggestion('s1', edit)).rejects.toThrow(SuggestionEditError);
	});
});

describe('reviewEdit', () => {
	it('approving writes the proposed text and marks the post edited', async () => {
		selectResultQueue = [
			[
				{
					id: 'edit-1',
					suggestionId: 's1',
					status: 'pending',
					proposedTitle: 'Approved title',
					proposedBody: 'Approved body',
					proposedCategory: 'policy'
				}
			],
			[{ id: 's1', title: 'Old', authorUserId: 'u1', authorName: 'Ada', authorEmail: 'a@x.com' }]
		];
		await reviewEdit('edit-1', { decision: 'approve', staffId: 'staff1' });

		expect(updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Approved title', editedAt: expect.any(Date) })
		);
	});

	it('applies the text BEFORE marking the request approved', async () => {
		selectResultQueue = [
			[
				{
					id: 'edit-1',
					suggestionId: 's1',
					status: 'pending',
					proposedTitle: 'T',
					proposedBody: 'B',
					proposedCategory: 'other'
				}
			],
			[{ id: 's1', title: 'Old', authorUserId: 'u1', authorName: 'Ada', authorEmail: 'a@x.com' }]
		];
		await reviewEdit('edit-1', { decision: 'approve', staffId: 'staff1' });

		// A crash between the two leaves a still-pending request whose text landed
		// — visible and re-runnable. The reverse would show "approved" over text
		// that never changed.
		const [suggestionWrite, requestWrite] = updateSet.mock.calls;
		expect(suggestionWrite[0]).toHaveProperty('title');
		expect(requestWrite[0]).toMatchObject({ status: 'approved' });
	});

	it('rejecting leaves the suggestion alone', async () => {
		selectResultQueue = [
			[
				{
					id: 'edit-1',
					suggestionId: 's1',
					status: 'pending',
					proposedTitle: 'Nope',
					proposedBody: 'Nope',
					proposedCategory: 'other'
				}
			],
			[{ id: 's1', title: 'Old', authorUserId: 'u1', authorName: 'Ada', authorEmail: 'a@x.com' }]
		];
		await reviewEdit('edit-1', {
			decision: 'reject',
			notes: 'Changes the meaning',
			staffId: 'staff1'
		});

		expect(updateSet).toHaveBeenCalledTimes(1);
		expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected' }));
	});

	it('refuses to review the same request twice', async () => {
		selectResultQueue = [[{ id: 'edit-1', suggestionId: 's1', status: 'approved' }]];
		await expect(reviewEdit('edit-1', { decision: 'approve', staffId: 'staff1' })).rejects.toThrow(
			SuggestionEditError
		);
	});

	it('tells the author either way', async () => {
		selectResultQueue = [
			[
				{
					id: 'edit-1',
					suggestionId: 's1',
					status: 'pending',
					proposedTitle: 'T',
					proposedBody: 'B',
					proposedCategory: 'other'
				}
			],
			[{ id: 's1', title: 'Old', authorUserId: 'u1', authorName: 'Ada', authorEmail: 'a@x.com' }]
		];
		await reviewEdit('edit-1', { decision: 'reject', staffId: 'staff1' });
		await flushMicrotasks();

		expect(emit).toHaveBeenCalledWith(
			'suggestion.edit_reviewed',
			expect.objectContaining({ authorUserId: 'u1', approved: false })
		);
	});
});

describe('cancelEditRequest', () => {
	it('lets the author take back a request staff have not reached', async () => {
		selectResultQueue = [[{ id: 'edit-1', requestedByUserId: 'u1', status: 'pending' }]];
		await cancelEditRequest('edit-1', 'u1');

		expect(deleteCalled).toHaveBeenCalledOnce();
	});

	it("refuses to cancel somebody else's request", async () => {
		selectResultQueue = [[{ id: 'edit-1', requestedByUserId: 'u1', status: 'pending' }]];
		await expect(cancelEditRequest('edit-1', 'intruder')).rejects.toThrow(SuggestionEditError);
		expect(deleteCalled).not.toHaveBeenCalled();
	});

	it('refuses once staff have already decided', async () => {
		selectResultQueue = [[{ id: 'edit-1', requestedByUserId: 'u1', status: 'approved' }]];
		await expect(cancelEditRequest('edit-1', 'u1')).rejects.toThrow(SuggestionEditError);
	});
});
