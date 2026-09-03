/**
 * The teaching booking path.
 *
 * Two properties matter and neither is visible in a diff. The row must land with
 * `bookerId` on the **instructor record** rather than the user — that is the
 * invariant `toBookerRef` and `deactivateUser` both rely on — and the recurring
 * branch must carry **no** sustaining-membership gate, which is an absence, and
 * absences are what regress silently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireUser = vi.fn(() => ({ id: 'user-1' }));
const requireInstructor = vi.fn(async () => ({
	id: 'instr-1',
	userId: 'user-1',
	status: 'active'
}));
vi.mock('$lib/server/authorization', () => ({
	requireUser,
	requireCapability: vi.fn(async () => ({ id: 'staff-1' })),
	isStaff: vi.fn(async () => false)
}));
vi.mock('$lib/server/instructor/instructor-context', () => ({ requireInstructor }));

const create = vi.fn(async () => ({ id: 'res-1' }));
const createWaitlisted = vi.fn(async () => ({ id: 'res-2' }));
vi.mock('$lib/server/reservation/reservation-service', () => ({
	create,
	createWaitlisted,
	confirm: vi.fn(),
	cancel: vi.fn()
}));

// The service exports `create`; the remote imports it aliased as `createSeries`.
// The mock has to match the module, not the alias.
const createSeries = vi.fn(async () => ({ id: 'ser-1' }));
vi.mock('$lib/server/reservation/recurring-series-service', () => ({
	create: createSeries,
	cancelAllForUser: vi.fn(),
	getByReservation: vi.fn(async () => null)
}));

// The contact-phone gate lives on `user-service`, and is mocked at that boundary
// so these tests stay about handler wiring rather than a DB read.
const ensureContactPhone = vi.fn(async () => true);
vi.mock('$lib/server/user/user-service', () => ({ ensureContactPhone }));

// Nothing here should reach the database; a chainable stub makes that failure
// loud (an unexpected read returns an empty array) rather than a thrown
// "Database not initialized" from three frames away.
function chainable(): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_t, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve([]);
			return () => proxy;
		}
	});
	return proxy;
}
vi.mock('$lib/server/db', () => ({ db: { select: () => chainable() } }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: { id: 'user-1' } } }),
	query: (...a: unknown[]) => tag(a, 'query'),
	form: (...a: unknown[]) => tag(a, 'form'),
	command: (...a: unknown[]) => tag(a, 'command')
}));

function tag(args: unknown[], type: string) {
	const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as Record<string, unknown>;
	handler.__ = { type };
	handler.for = () => handler;
	return handler;
}

const issue = new Proxy({}, { get: () => (m: string) => ({ message: m }) });

// Imported once at module scope, not inside each test. `reservations.remote.ts`
// pulls in a large module graph, and on a cold Vite cache an in-test
// `await import` of it blows the 5s per-test timeout — which reads as flakiness
// and is not.
const { bookInstructorReservation } = (await import('./reservations.remote')) as unknown as {
	bookInstructorReservation: (d: unknown, i: unknown) => Promise<unknown>;
};

const booking = {
	date: '2026-09-15',
	startTime: '16:00',
	endTime: '16:30',
	notes: null,
	phone: '555-0100'
};

beforeEach(() => vi.clearAllMocks());

describe('bookInstructorReservation', () => {
	it('books against the instructor record, not the user', async () => {
		await bookInstructorReservation(booking, issue);

		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				bookerType: 'instructor',
				// The instructor row's id — what makes the discriminator honest, and
				// what `deactivateUser` cannot match on, which is why it matches on
				// `createdByUserId` instead.
				bookerId: 'instr-1',
				userId: 'user-1'
			})
		);
	});

	it('refuses anyone without an active grant, before writing anything', async () => {
		requireInstructor.mockRejectedValueOnce(new Error('403'));

		await expect(bookInstructorReservation(booking, issue)).rejects.toThrow('403');
		expect(create).not.toHaveBeenCalled();
	});

	it('books a recurring series with no sustaining membership', async () => {
		// The absence is the point. `bookMemberReservation` throws 403 here because
		// recurring rehearsal time is a membership benefit; teaching time is a
		// rental CMC granted directly, so requiring a subscription on top of a
		// staff grant would mean staff granting something the member cannot use.
		// Nothing in this file mocks a subscription, and that is deliberate.
		const result = await bookInstructorReservation({ ...booking, recurring: 'weekly' }, issue);

		expect(createSeries).toHaveBeenCalledWith(
			expect.objectContaining({ prototypeReservationId: 'res-1', frequency: 'weekly' })
		);
		expect(result).toMatchObject({ reservationId: 'res-1' });
	});
});
