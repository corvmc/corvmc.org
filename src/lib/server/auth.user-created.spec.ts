import { describe, it, expect, vi, beforeEach } from 'vitest';

// auth.ts pulls in db + sentry at import time; the rest are the side effects
// the hook is supposed to fire, stubbed so we can watch it fire them.
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));
vi.mock('$lib/server/directory/entry-service', () => ({ ensureUserEntry: vi.fn() }));
vi.mock('$lib/server/user/member-number-service', () => ({ assignMemberNumber: vi.fn() }));
vi.mock('$lib/server/marketing/subscriber-service', () => ({
	linkExistingSubscriberToUser: vi.fn()
}));

import { ensureUserEntry } from '$lib/server/directory/entry-service';
import { linkExistingSubscriberToUser } from '$lib/server/marketing/subscriber-service';
import { onUserCreated } from './auth';

const created = { id: 'user-1', name: 'Alice', email: 'alice@example.com' };

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// #562: a subscriber row under the signup address stayed orphaned, so the
// account page read as if the member had subscribed to nothing.
// ---------------------------------------------------------------------------

describe('onUserCreated', () => {
	it('links an existing subscriber to the new account, keyed on its own email', async () => {
		await onUserCreated(created);

		expect(linkExistingSubscriberToUser).toHaveBeenCalledWith('user-1', 'alice@example.com');
	});

	// Each step is caught on its own so one failure cannot swallow the others,
	// and none of them may cost the member the account that already committed.
	it('still links when an earlier step throws', async () => {
		vi.mocked(ensureUserEntry).mockRejectedValueOnce(new Error('boom'));

		await expect(onUserCreated(created)).resolves.toBeUndefined();

		expect(linkExistingSubscriberToUser).toHaveBeenCalledWith('user-1', 'alice@example.com');
	});
});
