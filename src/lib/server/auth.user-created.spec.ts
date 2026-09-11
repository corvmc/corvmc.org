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
import { assignMemberNumber } from '$lib/server/user/member-number-service';
import { linkExistingSubscriberToUser } from '$lib/server/marketing/subscriber-service';
import { onUserCreated } from './auth';

const created = { id: 'user-1', name: 'Alice', email: 'alice@example.com' };

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// #562 linked the subscriber row here, at signup. #757 moved it to
// verification: typing an address into a form is not proof of holding it, and
// the row carries a stranger's memberships and suppression state.
// ---------------------------------------------------------------------------

describe('onUserCreated', () => {
	it('does not claim a subscriber row off an unproven address', async () => {
		await onUserCreated(created);

		expect(linkExistingSubscriberToUser).not.toHaveBeenCalled();
	});

	// Each step is caught on its own so one failure cannot swallow the others,
	// and none of them may cost the member the account that already committed.
	it('runs the later steps when an earlier one throws', async () => {
		vi.mocked(ensureUserEntry).mockRejectedValueOnce(new Error('boom'));

		await expect(onUserCreated(created)).resolves.toBeUndefined();

		expect(assignMemberNumber).toHaveBeenCalledWith('user-1');
	});
});
