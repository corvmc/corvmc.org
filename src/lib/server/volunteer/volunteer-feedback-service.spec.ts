import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — same chainable shape as the other volunteer specs.
// ---------------------------------------------------------------------------

let selectResultQueue: unknown[][] = [];
let insertedValues: unknown[] = [];
let insertError: Error | null = null;

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(selectResultQueue.shift() ?? []);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('#lib/server/db/index.js', () => ({
	db: {
		select: vi.fn(() => chainable()),
		insert: vi.fn(() => ({
			values: vi.fn((v: unknown) => {
				if (insertError) throw insertError;
				insertedValues.push(v);
				return { returning: vi.fn(() => Promise.resolve([v])) };
			})
		}))
	}
}));

import {
	submitFeedback,
	FeedbackNotAvailableError,
	FeedbackAlreadySubmittedError,
	FeedbackValidationError
} from './volunteer-feedback-service';

const OWN_COMPLETED = [{ id: 'signup-1', status: 'completed' }];

beforeEach(() => {
	vi.clearAllMocks();
	selectResultQueue = [];
	insertedValues = [];
	insertError = null;
});

describe('submitFeedback', () => {
	it('records a response against a completed signup', async () => {
		selectResultQueue = [OWN_COMPLETED];

		await submitFeedback({
			signupId: 'signup-1',
			userId: 'user-1',
			rating: 4,
			wasSetUp: true,
			comment: '  More gaff tape by the desk.  '
		});

		expect(insertedValues[0]).toMatchObject({
			signupId: 'signup-1',
			rating: 4,
			wasSetUp: true,
			comment: 'More gaff tape by the desk.'
		});
	});

	it('stores an empty comment as null', async () => {
		selectResultQueue = [OWN_COMPLETED];

		await submitFeedback({
			signupId: 'signup-1',
			userId: 'user-1',
			rating: 5,
			wasSetUp: true,
			comment: '   '
		});

		expect((insertedValues[0] as { comment: string | null }).comment).toBeNull();
	});

	it.each([0, 6, 2.5])('rejects a rating of %s', async (rating) => {
		await expect(
			submitFeedback({ signupId: 'signup-1', userId: 'user-1', rating, wasSetUp: true })
		).rejects.toThrow(FeedbackValidationError);
		expect(insertedValues).toEqual([]);
	});

	// The signup id arrives in an emailed URL and is not a secret; the session
	// is what authorizes. A signup owned by someone else reads as absent.
	it("refuses a signup that isn't yours", async () => {
		selectResultQueue = [[]];

		await expect(
			submitFeedback({ signupId: 'signup-1', userId: 'somebody-else', rating: 4, wasSetUp: true })
		).rejects.toThrow(FeedbackNotAvailableError);
	});

	it('refuses a signup that has not completed', async () => {
		selectResultQueue = [[{ id: 'signup-1', status: 'confirmed' }]];

		await expect(
			submitFeedback({ signupId: 'signup-1', userId: 'user-1', rating: 4, wasSetUp: true })
		).rejects.toThrow(FeedbackNotAvailableError);
	});

	// Once per signup, enforced by the unique column rather than a read-check —
	// two tabs both passing a check would still land one row.
	it('reads a duplicate submission as already-answered', async () => {
		selectResultQueue = [OWN_COMPLETED];
		insertError = new Error('UNIQUE constraint failed: volunteer_shift_feedback.signup_id');

		await expect(
			submitFeedback({ signupId: 'signup-1', userId: 'user-1', rating: 3, wasSetUp: false })
		).rejects.toThrow(FeedbackAlreadySubmittedError);
	});
});
