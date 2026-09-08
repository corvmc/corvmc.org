import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let queryResults: unknown[][] = [];
let queryIndex = 0;
let lastUpdate: { set: Record<string, unknown>; where: string } | null = null;

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				const results = queryResults[queryIndex] ?? [];
				queryIndex++;
				return (resolve: (v: unknown[]) => void) => resolve(results);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chainable(),
		update: vi.fn(() => ({
			set: vi.fn((data: Record<string, unknown>) => ({
				where: vi.fn((condition: unknown) => {
					lastUpdate = { set: data, where: String(condition) };
					return Promise.resolve({ rowCount: 1 });
				})
			}))
		}))
	}
}));

vi.mock('$lib/server/auth', () => ({
	auth: {
		api: {
			changePassword: vi.fn().mockResolvedValue({ token: null, user: {} }),
			signInEmail: vi.fn().mockResolvedValue({}),
			signOut: vi.fn().mockResolvedValue({})
		}
	}
}));

vi.mock('$lib/server/authorization', () => ({
	requireUser: vi.fn(() => ({ id: 'user-1', name: 'Test User' })),
	hasRole: vi.fn().mockResolvedValue(false),
	hasAnyRole: vi.fn().mockResolvedValue(false),
	getUserRoles: vi.fn().mockResolvedValue([])
}));

vi.mock('$lib/server/reservation/reservation-service', () => ({
	cancel: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/server/finance/subscription-service', () => ({
	cancel: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/server/user/user-service', () => ({
	deactivateUser: vi.fn().mockResolvedValue(undefined)
}));

// Mock getRequestEvent for remote functions
const mockLocals = { user: mockUser({ id: 'user-1', name: 'Test User' }) };
const mockHeaders = new Headers({ cookie: 'session=abc' });

vi.mock('$lib/server/marketing/audience-service', () => ({
	getSubscriptionsForUser: vi.fn().mockResolvedValue([]),
	getOptInAudiencesForUser: vi.fn().mockResolvedValue([]),
	addSubscriber: vi.fn().mockResolvedValue(undefined),
	unsubscribe: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/server/marketing/subscriber-service', () => ({
	findOrCreateForUser: vi.fn().mockResolvedValue({ id: 'sub-1' }),
	clearSelfServiceSuppression: vi.fn()
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: mockLocals,
		request: { headers: mockHeaders }
	}),
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		const fn = handler;
		(fn as any).__ = { type: 'form' };
		return fn;
	},
	query: (_schema: unknown, handler: (...args: any[]) => any) => {
		const fn = (...args: unknown[]) => {
			const result = handler(...args);
			if (result && typeof result.then === 'function') {
				return Object.assign(result, { refresh: vi.fn() });
			}
			return Object.assign(Promise.resolve(result), { refresh: vi.fn() });
		};
		(fn as any).__ = { type: 'query' };
		(fn as any).refresh = vi.fn();
		return fn;
	},
	command: (_schema: unknown, handler: (...args: any[]) => any) => {
		const fn = handler;
		(fn as any).__ = { type: 'command' };
		return fn;
	}
}));

import { auth } from '$lib/server/auth';
import { requireUser, hasAnyRole } from '$lib/server/authorization';
import { deactivateUser } from '$lib/server/user/user-service';
import {
	getSubscriptionsForUser,
	getOptInAudiencesForUser,
	addSubscriber,
	unsubscribe as unsubscribeService
} from '$lib/server/marketing/audience-service';
import {
	findOrCreateForUser,
	clearSelfServiceSuppression
} from '$lib/server/marketing/subscriber-service';

const {
	updateProfile,
	changePassword,
	getMySubscriptions,
	getAvailableLists,
	subscribe,
	unsubscribe: unsubscribeFromList,
	deleteAccount
} = (await import('$lib/remote/account.remote')) as any;

beforeEach(() => {
	vi.clearAllMocks();
	queryResults = [];
	queryIndex = 0;
	lastUpdate = null;
	mockLocals.user = mockUser({ id: 'user-1', name: 'Test User' }) as any;
	vi.mocked(requireUser).mockReturnValue(mockLocals.user);
});

// `subscriberForCurrentUser` reads `emailVerified` off the user row rather than
// the session, so the fixture's own flag never reaches it — the verified case is
// set through the db mock here.
function setUserEmailVerified(emailVerified: boolean) {
	queryResults = [[{ emailVerified }]];
	queryIndex = 0;
}

// ---------------------------------------------------------------------------
// Profile update
// ---------------------------------------------------------------------------

describe('updateProfile', () => {
	it('updates name, pronouns, and phone', async () => {
		await updateProfile({
			name: 'New Name',
			pronouns: 'they/them',
			phone: '555-9999'
		});

		expect(lastUpdate).not.toBeNull();
		expect(lastUpdate!.set.name).toBe('New Name');
		expect(lastUpdate!.set.pronouns).toBe('they/them');
		expect(lastUpdate!.set.phone).toBe('555-9999');
	});

	it('clears optional fields when empty strings provided', async () => {
		await updateProfile({
			name: 'Just Name',
			pronouns: '',
			phone: ''
		});

		expect(lastUpdate!.set.pronouns).toBeNull();
		expect(lastUpdate!.set.phone).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Password change
// ---------------------------------------------------------------------------

describe('changePassword', () => {
	it('delegates to better-auth API with correct params', async () => {
		await changePassword({
			currentPassword: 'old-pass',
			newPassword: 'new-pass-123',
			confirmPassword: 'new-pass-123'
		});

		expect(auth.api.changePassword).toHaveBeenCalledWith(
			expect.objectContaining({
				body: {
					currentPassword: 'old-pass',
					newPassword: 'new-pass-123',
					revokeOtherSessions: false
				}
			})
		);
	});
});

// ---------------------------------------------------------------------------
// Email subscriptions
// ---------------------------------------------------------------------------

describe('getMySubscriptions', () => {
	it('returns subscriptions for the current user', async () => {
		const mockSubs = [{ id: 'sub-1', audienceId: 'aud-1' }];
		vi.mocked(getSubscriptionsForUser).mockResolvedValueOnce(mockSubs as any);

		const result = await getMySubscriptions();

		expect(getSubscriptionsForUser).toHaveBeenCalledWith('user-1');
		expect(result).toEqual(mockSubs);
	});
});

describe('getAvailableLists', () => {
	it('returns opt-in audiences for the current user', async () => {
		const mockAudiences = [{ id: 'aud-1', name: 'Newsletter' }];
		vi.mocked(getOptInAudiencesForUser).mockResolvedValueOnce(mockAudiences as any);

		const result = await getAvailableLists();

		expect(getOptInAudiencesForUser).toHaveBeenCalledWith('user-1');
		expect(result).toEqual(mockAudiences);
	});
});

describe('subscribe', () => {
	it('finds or creates subscriber then adds to audience', async () => {
		setUserEmailVerified(true);

		await subscribe({ audienceId: 'aud-99' });

		expect(findOrCreateForUser).toHaveBeenCalledWith(
			'user-1',
			mockLocals.user.email,
			mockLocals.user.name,
			{ emailVerified: true }
		);
		expect(addSubscriber).toHaveBeenCalledWith('aud-99', 'sub-1');
	});

	// Without this, opting back in after "unsubscribe from all" reports success
	// while global suppression silently keeps every campaign away.
	it('lifts a previous global opt-out so the subscription actually delivers', async () => {
		setUserEmailVerified(true);

		await subscribe({ audienceId: 'aud-99' });

		expect(clearSelfServiceSuppression).toHaveBeenCalledWith('sub-1');
	});
});

describe('unsubscribeFromList', () => {
	it('resolves the subscriber and unsubscribes from the audience', async () => {
		setUserEmailVerified(true);

		await unsubscribeFromList({ audienceId: 'aud-99' });

		expect(unsubscribeService).toHaveBeenCalledWith('sub-1', 'aud-99');
	});

	// A member can be in a built-in audience — membership is a predicate over
	// their account, not an audience_member row — without ever having had a
	// subscriber record. Bailing out when none exists left them unable to opt
	// out of mail they were still receiving.
	it('creates a subscriber record when the member has none, so opt-out still lands', async () => {
		setUserEmailVerified(true);

		await unsubscribeFromList({ audienceId: 'aud-99' });

		expect(findOrCreateForUser).toHaveBeenCalledWith(
			'user-1',
			mockLocals.user.email,
			mockLocals.user.name,
			{ emailVerified: true }
		);
		expect(unsubscribeService).toHaveBeenCalledWith('sub-1', 'aud-99');
	});
});

// A subscriber row under this address that belongs to nobody predates the
// account and carries a stranger's audience memberships and suppression state.
// The service refuses to hand it over unverified (#757), and both mutations
// have to say so: a silent no-op would report a subscription change it never
// made.
describe('mailing lists when the address is unconfirmed', () => {
	it('answers subscribe with a 403 instead of reporting success', async () => {
		setUserEmailVerified(false);
		vi.mocked(findOrCreateForUser).mockResolvedValueOnce(null);

		await expect(subscribe({ audienceId: 'aud-99' })).rejects.toMatchObject({
			status: 403,
			body: { message: expect.stringMatching(/confirm your email address/i) }
		});
		expect(addSubscriber).not.toHaveBeenCalled();
	});

	it('answers unsubscribe with a 403 instead of a silent no-op', async () => {
		setUserEmailVerified(false);
		vi.mocked(findOrCreateForUser).mockResolvedValueOnce(null);

		await expect(unsubscribeFromList({ audienceId: 'aud-99' })).rejects.toMatchObject({
			status: 403
		});
		expect(unsubscribeService).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Delete account
// ---------------------------------------------------------------------------

describe('deleteAccount', () => {
	it('verifies the password, delegates offboarding to deactivateUser, and signs out', async () => {
		mockLocals.user = mockUser({ id: 'user-1', name: 'Test User', stripeId: 'cus_123' }) as any;
		vi.mocked(requireUser).mockReturnValue(mockLocals.user);

		await deleteAccount({ password: 'correct-pass' });

		expect(auth.api.signInEmail).toHaveBeenCalled();
		expect(deactivateUser).toHaveBeenCalledWith('user-1');
		expect(auth.api.signOut).toHaveBeenCalled();
	});

	it('rejects deletion for staff/admin accounts without deactivating', async () => {
		vi.mocked(hasAnyRole).mockResolvedValueOnce(true);

		await expect(deleteAccount({ password: 'any' })).rejects.toThrow();
		expect(deactivateUser).not.toHaveBeenCalled();
	});

	it('rejects incorrect password without deactivating', async () => {
		vi.mocked(auth.api.signInEmail).mockRejectedValueOnce(new Error('bad creds'));

		await expect(deleteAccount({ password: 'wrong' })).rejects.toThrow();
		expect(deactivateUser).not.toHaveBeenCalled();
	});
});
