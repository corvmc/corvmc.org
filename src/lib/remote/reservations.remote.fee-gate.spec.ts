/**
 * The outstanding-fee gate at the remote boundary (#2748, #2859). Every member booking
 * path refuses before writing when the gate says so, whatever the form showed;
 * staff booking on a member's behalf are never refused.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#lib/server/authorization.js', () => ({
	requireUser: vi.fn(() => ({ id: 'user-1', email: 'u@example.com', name: 'U' })),
	requireCapability: vi.fn(async () => ({ id: 'staff-1' })),
	can: vi.fn(async () => false)
}));
vi.mock('#lib/server/instructor/instructor-context.js', () => ({
	requireInstructor: vi.fn(async () => ({ id: 'instr-1', userId: 'user-1', status: 'active' }))
}));
vi.mock('#lib/server/group/group-context.js', () => ({
	requireGroupRole: vi.fn(async () => ({
		user: { id: 'user-1', email: 'u@example.com', name: 'U' },
		group: { id: 'band-1', slug: 'the-velvets' }
	}))
}));

const create = vi.fn(async () => ({ id: 'res-1' }));
const staffCreate = vi.fn(async () => ({ id: 'res-2' }));
vi.mock('#lib/server/reservation/reservation-service.js', () => ({
	create,
	staffCreate,
	createWaitlisted: vi.fn(),
	confirm: vi.fn(),
	cancel: vi.fn()
}));
vi.mock('#lib/server/reservation/conflict-service.js', () => ({
	getConflictDetails: vi.fn(async () => [])
}));
vi.mock('#lib/server/reservation/reservation-credit-service.js', () => ({
	commitReservationCredits: vi.fn(async () => undefined)
}));
vi.mock('#lib/server/reservation/config.js', () => ({
	getReservationConfig: vi.fn(async () => ({ hourlyRateCents: 1500 })),
	termsFor: vi.fn(() => ({ hourlyRateCents: 1500 })),
	getBookingTerms: vi.fn()
}));
vi.mock('#lib/server/user/user-service.js', () => ({
	ensureContactPhone: vi.fn(async () => true)
}));

const { OutstandingFeesError } = await vi.importActual<
	typeof import('#lib/server/reservation/outstanding-fees.js')
>('#lib/server/reservation/outstanding-fees.js');
const fees = [
	{ id: 'a', startsAt: new Date(0), endsAt: new Date(1), amountCents: 3000 },
	{ id: 'b', startsAt: new Date(2), endsAt: new Date(3), amountCents: 1500 }
];
const assertFeeGateAllows = vi.fn();
const getFeeGate = vi.fn(async () => ({ state: 'warn', fees }));
vi.mock('#lib/server/reservation/outstanding-fees.js', () => ({ assertFeeGateAllows, getFeeGate }));

function chainable(): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_t, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve([]);
			return () => proxy;
		}
	});
	return proxy;
}
vi.mock('#lib/server/db/index.js', () => ({ db: { select: () => chainable() } }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: { id: 'user-1', email: 'u@example.com', name: 'U' } },
		url: new URL('https://example.org')
	}),
	query: (...a: unknown[]) => tag(a, 'query'),
	form: (...a: unknown[]) => tag(a, 'form'),
	command: (...a: unknown[]) => tag(a, 'command')
}));

function tag(args: unknown[], type: string) {
	const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
		...a: unknown[]
	) => Promise<unknown>;
	// A query runs only when awaited, so a fire-and-forget `.refresh()` after a
	// write stays a no-op here, as it is for the caller.
	const fn =
		type === 'query'
			? (...a: unknown[]) => ({
					then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
						handler(...a).then(ok, ko),
					refresh: () => Promise.resolve()
				})
			: handler;
	Object.assign(fn, { __: { type }, for: () => fn });
	return fn;
}

const issue = new Proxy({}, { get: () => (m: string) => ({ message: m }) });

type Handler = (d: unknown, i?: unknown) => Promise<unknown>;
const remote = (await import('./reservations.remote')) as unknown as Record<string, Handler>;

const booking = {
	date: '2026-09-15',
	startTime: '16:00',
	endTime: '18:00',
	notes: null,
	phone: '555-0100'
};

beforeEach(() => {
	vi.clearAllMocks();
	assertFeeGateAllows.mockRejectedValue(new OutstandingFeesError(fees));
});

describe('a member the gate refuses', () => {
	it.each([
		['bookAndPayReservation', booking],
		['bookInstructorReservation', booking],
		['bookBandReservation', { ...booking, slug: 'the-velvets' }]
	])('%s refuses a direct call before writing', async (name, data) => {
		await expect(remote[name](data, issue)).rejects.toMatchObject({ status: 403 });
		expect(assertFeeGateAllows).toHaveBeenCalledWith('user-1');
		expect(create).not.toHaveBeenCalled();
	});
});

describe('staff booking on a member’s behalf', () => {
	it('books without consulting the refusal', async () => {
		await remote.createReservation({ ...booking, memberId: 'member-9' }, issue);
		expect(staffCreate).toHaveBeenCalled();
		expect(assertFeeGateAllows).not.toHaveBeenCalled();
	});

	it('reads the gate as a warning', async () => {
		await remote.getMemberFeeGate('member-9');
		expect(getFeeGate).toHaveBeenCalledWith('member-9', { onBehalf: true });
	});
});
