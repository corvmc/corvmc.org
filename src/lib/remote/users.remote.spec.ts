import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DomainError } from '$lib/server/domain-error';
import { isValidationError } from '@sveltejs/kit';

// Mirrors SvelteKit's `issue` helper: `issue.field(msg)` only *builds* an issue
// carrying the field path — `invalid()` is what throws it. A handler that calls
// `issue.field()` without `invalid()` is a silent no-op, which is a bug this
// codebase has shipped before (see events-validation.remote.spec.ts).
function makeIssue() {
	return new Proxy(
		{},
		{
			get: (_t, field: string) => (message: string) => ({ message, path: [field] })
		}
	);
}

async function expectFieldIssue(fn: () => Promise<unknown>, field: string, contains: string) {
	let thrown: unknown;
	try {
		await fn();
	} catch (e) {
		thrown = e;
	}
	expect(isValidationError(thrown)).toBe(true);
	const issues = (thrown as { issues: Array<{ path?: string[]; message: string }> }).issues;
	expect(issues.some((i) => i.path?.includes(field))).toBe(true);
	expect(issues.map((i) => i.message).join(' ')).toContain(contains);
}

// Regression: remote functions are directly addressable endpoints. There is no
// +layout.server.ts under /staff, and SvelteKit dispatches remote calls before
// any route load runs (runtime/server/respond.js — `handle_remote_call` is
// reached with the route's load functions skipped), so a remote function is
// only as guarded as its own first line.
//
// getUser / getAllRoles / getUserPayments / getUserCredits shipped with no
// guard at all, exposing a target user's email, phone, Stripe id and full
// payment history to any caller. updateUser was worse: it also had no guard and
// took its target from `params.id`, which for a remote call is derived from the
// caller-supplied `x-sveltekit-pathname` header — and since it rewrites
// model_has_roles wholesale, any caller could grant themselves `admin`.
//
// These tests pin that every one of those endpoints rejects a non-staff caller
// before touching the database, and that updateUser cannot be used to escalate
// privileges or to lock the panel by demoting yourself / the last admin.

const requireStaff = vi.fn<() => Promise<unknown>>(async () => {
	throw new Error('403: Staff access required');
});
const getUserRoles = vi.fn(async () => ['member']);
vi.mock('$lib/server/authorization', () => ({
	requireStaff: (...args: unknown[]) => requireStaff(...(args as [])),
	requireUser: () => ({ id: 'acting-staff', name: 'Acting', email: 'acting@example.com' }),
	getUserRoles: (...args: unknown[]) => getUserRoles(...(args as []))
}));

// Role rows and the remaining-admin count the authorized-path tests read back.
const ROLE_ROWS = [
	{ id: 1, name: 'admin' },
	{ id: 2, name: 'staff' },
	{ id: 3, name: 'member' }
];
let otherAdminCount = 1;

// Any db access on a rejected call is a failure — the guard tests assert these
// spies stay clean. On the authorized path db.select serves the two reads
// updateUser makes: all role rows, then a count of admins other than the target.
const dbSelect = vi.fn((shape?: Record<string, unknown>) => {
	const isCount = !!shape && 'value' in shape;
	const rows = isCount ? [{ value: otherAdminCount }] : ROLE_ROWS;
	const result = {
		from: () => result,
		where: () => result,
		limit: () => result,
		then: (resolve: (v: unknown) => unknown) => resolve(rows)
	};
	return result;
});
// Write builders are inert: the guard tests assert they were never *called*,
// which is the meaningful signal, and the authorized tests need them to work.
const writeBuilder = () => {
	const b = {
		set: () => b,
		values: () => b,
		where: () => b,
		returning: () => b,
		then: (resolve: (v: unknown) => unknown) => resolve([])
	};
	return b;
};
const dbUpdate = vi.fn(writeBuilder);
const dbDelete = vi.fn(writeBuilder);
const dbInsert = vi.fn(writeBuilder);
const dbBatch = vi.fn(async () => []);
vi.mock('$lib/server/db', () => ({
	db: {
		select: (...a: unknown[]) => dbSelect(...(a as [])),
		update: (...a: unknown[]) => dbUpdate(...(a as [])),
		delete: (...a: unknown[]) => dbDelete(...(a as [])),
		insert: (...a: unknown[]) => dbInsert(...(a as [])),
		batch: (...a: unknown[]) => dbBatch(...(a as []))
	}
}));

const listByUser = vi.fn(async () => [{ id: 'pay_1', amountCents: 1500 }]);
vi.mock('$lib/server/finance/payment-cache-service', () => ({
	listByUser: (...a: unknown[]) => listByUser(...(a as [])),
	list: vi.fn(async () => [])
}));

const getAllBalances = vi.fn(async () => ({ free_hours: 240, equipment_credits: 3 }));
const getBalance = vi.fn(async () => 200);
const addCredits = vi.fn(async () => undefined);
const deductCredits = vi.fn(async () => undefined);
const listTransactions = vi.fn(async () => ({ rows: [], pagination: { page: 1, total: 0 } }));
class InsufficientCreditsError extends Error {}
vi.mock('$lib/server/finance/credit-service', () => ({
	getAllBalances: (...a: unknown[]) => getAllBalances(...(a as [])),
	getBalance: (...a: unknown[]) => getBalance(...(a as [])),
	getUsageSinceLastAllocation: vi.fn(async () => 0),
	addCredits: (...a: unknown[]) => addCredits(...(a as [])),
	deductCredits: (...a: unknown[]) => deductCredits(...(a as [])),
	listTransactions: (...a: unknown[]) => listTransactions(...(a as [])),
	InsufficientCreditsError
}));

vi.mock('$lib/server/finance/subscription-service', () => ({
	isSustainingMemberSql: vi.fn(() => null),
	getMemberSubscription: vi.fn(async () => null),
	mapDbSubscription: vi.fn(() => null)
}));

// Hoisted so the purge-mapping tests can drive rejections; the mock factory
// below closes over these rather than creating its own.
//
// These extend the real DomainError rather than a bare Error on purpose:
// mapDomainError resolves a status from `httpStatus`, so a stand-in that only
// extends Error would be re-thrown as a 500 and the test would assert nothing
// about the mapping it exists to cover.
const purgeUserService = vi.fn<(id: string) => Promise<void>>(async () => undefined);
class UserNotFoundError extends DomainError {
	readonly httpStatus = 404;
}
class UserNotDeactivatedError extends DomainError {
	readonly httpStatus = 409;
}
class UserHasOwnedBandsError extends DomainError {
	readonly httpStatus = 409;
}
class UserHasLinkedRecordsError extends DomainError {
	readonly httpStatus = 409;
}
class UserHasPublishedListingsError extends DomainError {
	readonly httpStatus = 409;
}

vi.mock('$lib/server/user/user-service', () => ({
	listActiveSessions: (...a: unknown[]) => listActiveSessions(...(a as [])),
	getLastLoginAt: (...a: unknown[]) => getLastLoginAt(...(a as [])),
	deactivateUser: vi.fn(async () => undefined),
	deactivateUsers: vi.fn(async () => ({ deactivated: [], skipped: [] })),
	reactivateUser: vi.fn(async () => undefined),
	purgeUser: purgeUserService,
	UserNotFoundError,
	UserNotDeactivatedError,
	UserHasOwnedBandsError,
	UserHasLinkedRecordsError,
	UserHasPublishedListingsError
}));

vi.mock('$lib/server/event/event-service', () => ({ listUpcoming: vi.fn(async () => []) }));

// The staff user record's own services. Spied rather than stubbed inline so the
// "argument, not params.id, identifies the target" test can read the userId
// each one actually received.
const getUserOverviewService = vi.fn(async () => ({ counts: {} }));
vi.mock('$lib/server/user/user-overview-service', () => ({
	getUserOverview: (...a: unknown[]) => getUserOverviewService(...(a as []))
}));

const listForMember = vi.fn(async () => ({ upcoming: [], past: [], counts: {} }));
const listActiveSessions = vi.fn(async () => []);
const getLastLoginAt = vi.fn(async () => null);
vi.mock('$lib/server/reservation/reservation-service', () => ({
	listForMember: (...a: unknown[]) => listForMember(...(a as []))
}));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: vi.fn(() => null) }));
vi.mock('$lib/server/db/paginate', () => ({
	paginate: vi.fn(async () => ({ rows: [], pagination: { page: 1, total: 0, totalPages: 0 } }))
}));

// `params.id` for a remote call comes from the caller-supplied
// `x-sveltekit-pathname` header, so a test caller controls it exactly as an
// attacker would.
let currentParams: Record<string, string> = { id: 'victim-user' };
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: null },
		params: currentParams,
		url: new URL('http://localhost/'),
		request: { headers: new Headers() }
	}),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => Promise<unknown>;
		// Real query results expose .refresh(); the forms call it after a write.
		const wrapped = (...a: unknown[]) => {
			const promise = handler(...a) as Promise<unknown> & { refresh?: () => void };
			promise.refresh = () => undefined;
			return promise;
		};
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'query' };
		return wrapped;
	},
	form: (_schema: unknown, handler: (...a: unknown[]) => unknown) => {
		// SvelteKit hands the handler `(data, issue)`. Without the second argument
		// any `issue.field(...)` call throws a TypeError that masks the assertion
		// under test.
		const wrapped = (data: unknown) => handler(data, makeIssue());
		const fn = wrapped as unknown as Record<string, unknown>;
		fn.__ = { type: 'form' };
		fn.for = () => fn;
		return wrapped;
	},
	command: (handler: (...a: unknown[]) => unknown) => {
		(handler as unknown as Record<string, unknown>).__ = { type: 'command' };
		return handler;
	}
}));

const users = (await import('./users.remote')) as unknown as Record<
	string,
	((...args: unknown[]) => Promise<unknown>) & { refresh?: () => void }
>;

beforeEach(() => {
	vi.clearAllMocks();
	requireStaff.mockRejectedValue(new Error('403: Staff access required'));
	getUserRoles.mockResolvedValue(['member']);
	otherAdminCount = 1;
	currentParams = { id: 'victim-user' };
	for (const fn of Object.values(users)) {
		if (typeof fn === 'function') fn.refresh = () => undefined;
	}
});

// Shaped as the handler receives it, i.e. after the zod schema's
// JSON.parse transform on `roles` — the mocked form() above skips validation.
const VALID_UPDATE = {
	id: 'victim-user',
	name: 'Renamed By Attacker',
	pronouns: '',
	phone: '',
	roles: ['1']
};

const STAFF_ONLY: Array<{ name: string; args?: unknown[] }> = [
	{ name: 'getUser', args: ['victim-user'] },
	{ name: 'getAllRoles' },
	{ name: 'getUserPayments', args: ['victim-user'] },
	{ name: 'getUserCredits', args: ['victim-user'] },
	{ name: 'updateUser', args: [VALID_UPDATE] },
	// The staff user record. Each one reads a different slice of a member's life
	// — bookings, membership, the credit ledger, live sessions — and each is a
	// directly addressable endpoint, so each needs its own first-line guard.
	{ name: 'getUserOverview', args: ['victim-user'] },
	{ name: 'getUserReservations', args: ['victim-user'] },
	{ name: 'getUserMembership', args: ['victim-user'] },
	{ name: 'getUserCreditHistory', args: [{ userId: 'victim-user', page: 1 }] },
	{ name: 'getUserSessions', args: ['victim-user'] }
];

// The target of every one of these is the argument, never `params.id`. Pinned
// per-query rather than once, because each was written separately and a new one
// reaching for `params` is exactly the mistake updateUser originally shipped.
const TARGETED_BY_ARGUMENT: Array<{
	name: string;
	args: unknown[];
	spy: () => ReturnType<typeof vi.fn>;
}> = [
	{ name: 'getUserOverview', args: ['victim-user'], spy: () => getUserOverviewService },
	{ name: 'getUserReservations', args: ['victim-user'], spy: () => listForMember },
	{ name: 'getUserSessions', args: ['victim-user'], spy: () => listActiveSessions },
	{ name: 'getUserPayments', args: ['victim-user'], spy: () => listByUser },
	{ name: 'getUserCredits', args: ['victim-user'], spy: () => getAllBalances }
];

describe('users.remote staff guards', () => {
	for (const { name, args = [] } of STAFF_ONLY) {
		it(`${name} rejects a non-staff caller before touching the database`, async () => {
			await expect(users[name](...args)).rejects.toThrow('Staff access required');
			expect(dbSelect).not.toHaveBeenCalled();
			expect(dbUpdate).not.toHaveBeenCalled();
			expect(dbDelete).not.toHaveBeenCalled();
			expect(dbInsert).not.toHaveBeenCalled();
			expect(dbBatch).not.toHaveBeenCalled();
		});
	}

	for (const { name, args, spy } of TARGETED_BY_ARGUMENT) {
		it(`${name} reads the user named in its argument, not params.id`, async () => {
			requireStaff.mockResolvedValue({ id: 'acting-staff' });
			currentParams = { id: 'someone-else' };
			await users[name](...args);
			expect(spy()).toHaveBeenCalledWith('victim-user', ...[]);
		});
	}

	it('getUserCreditHistory scopes the ledger to the requested member', async () => {
		// The ledger is global; without the userId filter this card would show
		// every member's transactions on one member's page.
		requireStaff.mockResolvedValue({ id: 'acting-staff' });
		currentParams = { id: 'someone-else' };
		await users.getUserCreditHistory({ userId: 'victim-user', page: 2 });
		expect(listTransactions).toHaveBeenCalledWith(
			{ userId: 'victim-user' },
			{ page: 2, pageSize: 10 }
		);
	});

	it('getUserPayments does not leak payment history to a non-staff caller', async () => {
		await expect(users.getUserPayments('victim-user')).rejects.toThrow('Staff access required');
		expect(listByUser).not.toHaveBeenCalled();
	});

	it('getUserCredits does not leak credit balances to a non-staff caller', async () => {
		await expect(users.getUserCredits('victim-user')).rejects.toThrow('Staff access required');
		expect(getAllBalances).not.toHaveBeenCalled();
	});

	it('updateUser cannot be used to grant a non-staff caller the admin role', async () => {
		// The escalation shape: point params.id at yourself via the pathname
		// header and post the admin role id.
		currentParams = { id: 'attacker' };
		await expect(
			users.updateUser({
				id: 'attacker',
				name: 'Attacker',
				pronouns: '',
				phone: '',
				roles: ['1']
			})
		).rejects.toThrow('Staff access required');
		expect(dbBatch).not.toHaveBeenCalled();
		expect(dbDelete).not.toHaveBeenCalled();
		expect(dbInsert).not.toHaveBeenCalled();
	});

	it('updateUser ignores params.id and edits the user named in the payload', async () => {
		// A stale/forged pathname header must not redirect the write.
		requireStaff.mockResolvedValue({ id: 'acting-staff' });
		currentParams = { id: 'some-other-user' };
		await users.updateUser({ ...VALID_UPDATE, id: 'victim-user', roles: ['3'] });
		expect(dbBatch).toHaveBeenCalled();
		expect(dbUpdate).toHaveBeenCalled();
	});
});

// SvelteKit's error() throws an HttpError ({ status, body }), not an Error, so
// toThrow(string) can't read a .message off it.
async function expectHttpError(promise: Promise<unknown>, status: number, contains: string) {
	const thrown = await promise.then(
		() => null,
		(e) => e as { status?: number; body?: { message?: string } }
	);
	expect(thrown).not.toBeNull();
	expect(thrown?.status).toBe(status);
	expect(thrown?.body?.message).toContain(contains);
}

describe('users.remote lockout guards', () => {
	beforeEach(() => {
		requireStaff.mockResolvedValue({ id: 'acting-staff' });
	});

	it('refuses to let a staff member drop their own staff access', async () => {
		getUserRoles.mockResolvedValue(['staff']);
		await expectHttpError(
			// role 3 = member only
			users.updateUser({ ...VALID_UPDATE, id: 'acting-staff', roles: ['3'] }),
			400,
			'cannot remove your own staff access'
		);
		expect(dbBatch).not.toHaveBeenCalled();
	});

	it('lets a staff member keep their access while changing other roles', async () => {
		getUserRoles.mockResolvedValue(['staff']);
		await users.updateUser({ ...VALID_UPDATE, id: 'acting-staff', roles: ['2', '3'] });
		expect(dbBatch).toHaveBeenCalled();
	});

	it('refuses to demote the last remaining admin', async () => {
		getUserRoles.mockResolvedValue(['admin']);
		otherAdminCount = 0;
		await expectHttpError(
			users.updateUser({ ...VALID_UPDATE, id: 'victim-user', roles: ['3'] }),
			409,
			'last admin'
		);
		expect(dbBatch).not.toHaveBeenCalled();
	});

	it('allows demoting an admin while another admin remains', async () => {
		getUserRoles.mockResolvedValue(['admin']);
		otherAdminCount = 1;
		await users.updateUser({ ...VALID_UPDATE, id: 'victim-user', roles: ['3'] });
		expect(dbBatch).toHaveBeenCalled();
	});
});

describe('users.remote purge error mapping', () => {
	beforeEach(() => {
		requireStaff.mockResolvedValue({ id: 'acting-staff' });
	});

	/**
	 * purgeUser's service refuses to delete a member who still has published
	 * community listings, because event.createdByUserId cascades and the purge
	 * would quietly take those shows off the public calendar. The service throws
	 * a dedicated error with a staff-readable message; the remote handler mapped
	 * its four siblings and missed this one, so the message never reached the
	 * staffer — they got an opaque 500 instead.
	 */
	it('maps UserHasPublishedListingsError to 409 rather than letting it 500', async () => {
		purgeUserService.mockRejectedValueOnce(
			new UserHasPublishedListingsError('This member has community listings on the public calendar')
		);

		await expectHttpError(users.purgeUser({ id: 'victim-user' }), 409, 'community listings');
	});

	it('still maps the sibling purge errors it already handled', async () => {
		purgeUserService.mockRejectedValueOnce(new UserHasOwnedBandsError('still owns bands'));
		await expectHttpError(users.purgeUser({ id: 'victim-user' }), 409, 'still owns bands');
	});
});

describe('adjustCredits surfaces staff mistakes on the amount field', () => {
	const VALID = {
		userId: 'member-1',
		creditType: 'free_hours' as const,
		description: 'Goodwill adjustment'
	};

	beforeEach(() => {
		requireStaff.mockResolvedValue({ id: 'acting-staff' });
		getBalance.mockResolvedValue(200);
		deductCredits.mockResolvedValue(undefined);
	});

	/**
	 * This used to `throw error(409)` (while mapDomainError said 422 for the same
	 * class). Both were wrong: a staffer typing a number larger than the balance
	 * is a form-field mistake, and a thrown status tears down the modal through
	 * the error boundary, discarding the description they already typed.
	 */
	it('rejects deducting more than the balance without touching the service', async () => {
		await expectFieldIssue(
			() => users.adjustCredits({ ...VALID, amount: '-300' }),
			'amount',
			'balance is 200'
		);
		expect(deductCredits).not.toHaveBeenCalled();
	});

	it('names the credit type in words, not as the raw enum', async () => {
		await expectFieldIssue(
			() => users.adjustCredits({ ...VALID, amount: '-300' }),
			'amount',
			'Free hours'
		);
	});

	it('rejects a non-numeric amount', async () => {
		await expectFieldIssue(
			() => users.adjustCredits({ ...VALID, amount: 'abc' }),
			'amount',
			'Enter a number'
		);
		expect(deductCredits).not.toHaveBeenCalled();
	});

	it('rejects a zero amount', async () => {
		await expectFieldIssue(
			() => users.adjustCredits({ ...VALID, amount: '0' }),
			'amount',
			'above or below zero'
		);
		expect(addCredits).not.toHaveBeenCalled();
		expect(deductCredits).not.toHaveBeenCalled();
	});

	it('allows a deduction within the balance', async () => {
		await users.adjustCredits({ ...VALID, amount: '-150' });
		expect(deductCredits).toHaveBeenCalled();
	});

	it('allows an addition without consulting the balance', async () => {
		await users.adjustCredits({ ...VALID, amount: '50' });
		expect(addCredits).toHaveBeenCalled();
		expect(getBalance).not.toHaveBeenCalled();
	});

	// The pre-check is a nicety, not the guard. If someone spends between the
	// read and the write, the write still refuses, and that has to reach the
	// staffer as the same field message rather than a 500.
	it('turns a lost race in deductCredits into the same field issue', async () => {
		getBalance.mockResolvedValueOnce(200).mockResolvedValueOnce(10);
		deductCredits.mockRejectedValueOnce(new InsufficientCreditsError('raced'));

		await expectFieldIssue(
			() => users.adjustCredits({ ...VALID, amount: '-150' }),
			'amount',
			'balance is 10'
		);
	});
});
