import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';
import { positionOrder, type Capability, type Position } from '$lib/config';

// ---------------------------------------------------------------------------
// The member-facing handlers in reservations.remote.ts that branch on who the
// caller is, rather than gate on it. Each used to ask `isStaff()` (any
// position); each now names a capability. `can` is simulated against the real
// matrix, so the tables below show exactly who each swap moved.
// ---------------------------------------------------------------------------

const actingUser = mockUser({ id: 'user-1', name: 'Acting', email: 'acting@example.com' });

let selectRows: unknown[] = [];
function chain(): Record<string, unknown> {
	const c: Record<string, unknown> = {
		from: () => c,
		where: () => c,
		innerJoin: () => c,
		orderBy: () => c,
		limit: () => Promise.resolve(selectRows)
	};
	return c;
}
vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chain(),
		update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
		insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 'x' }]) }) })
	}
}));

let heldPositions: Position[] = [];
vi.mock('$lib/server/authorization', async () => {
	const config = await import('$lib/config');
	return {
		can: vi.fn(async (cap: Capability) =>
			heldPositions.some((p) => config.grantsCapability(config.positions[p], cap))
		),
		requireUser: () => actingUser,
		requireCapability: vi.fn(async () => actingUser),
		requireCapabilityOrOwner: vi.fn(),
		topPositionFor: vi.fn()
	};
});

vi.mock('$lib/server/reservation/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/reservation/config')>()),
	getReservationConfig: vi.fn(async () => ({ hourlyRateCents: 1500 }))
}));

// A big balance, so every booking below is fully credit-covered: the case in
// which the confirmation window is the only thing standing in the way.
vi.mock('$lib/server/finance/credit-service', () => ({ getBalance: vi.fn(async () => 100) }));
vi.mock('$lib/server/user/user-service', () => ({ ensureContactPhone: vi.fn(async () => true) }));
vi.mock('$lib/server/feature-flags', () => ({ requireFeature: vi.fn(async () => undefined) }));

const cancel = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('$lib/server/reservation/reservation-service', () => ({
	create: vi.fn(async () => ({ id: 'res-new' })),
	createWaitlisted: vi.fn(),
	confirm: vi.fn(),
	cancel: (...a: unknown[]) => cancel(...a),
	markComplete: vi.fn(),
	markNoShow: vi.fn(),
	recordCashAndComplete: vi.fn(),
	staffCreate: vi.fn(),
	ReservationConflictError: class extends Error {},
	ReservationValidationError: class extends Error {}
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: actingUser },
		params: { id: 'res-1' },
		url: new URL('http://localhost/member/reservations'),
		request: { headers: new Headers() }
	}),
	form: (schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'form' };
		(handler as any).__schema = schema;
		(handler as any).for = () => handler;
		return handler;
	},
	query: (...args: any[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (...a: any[]) => any;
		(handler as any).__ = { type: 'query' };
		return handler;
	},
	command: (...args: any[]) => (typeof args[0] === 'function' ? args[0] : args[1])
}));

const remote = (await import('$lib/remote/reservations.remote')) as any;

// Every combination of the six positions, including none.
const subsets = Array.from({ length: 2 ** positionOrder.length }, (_, mask) =>
	positionOrder.filter((_, i) => mask & (1 << i))
);
const holdsAny = (held: Position[], who: Position[]) => held.some((p) => who.includes(p));

// Years out, so always outside the confirmation window.
const farStart = new Date('2031-06-15T17:00:00Z');
const ownBooking = {
	id: 'res-1',
	createdByUserId: actingUser.id,
	status: 'scheduled',
	bookerType: 'user',
	startsAt: farStart,
	endsAt: new Date(farStart.getTime() + 3600_000)
};

/** Did the confirmation window stop this call? Anything past it counts as "no". */
async function stoppedByWindow(run: () => Promise<unknown>) {
	try {
		const result = (await run()) as { scheduled?: boolean } | undefined;
		return result?.scheduled === true;
	} catch (e) {
		return /Confirmation opens/.test((e as { body?: { message?: string } }).body?.message ?? '');
	}
}

beforeEach(() => {
	heldPositions = [];
	cancel.mockClear();
	selectRows = [ownBooking];
});

describe('getReservationPricing for someone else’s booking', () => {
	const quote = () =>
		remote.getReservationPricing({
			date: '2031-06-15',
			startTime: '17:00',
			endTime: '18:00',
			reservationId: 'res-2'
		});

	beforeEach(() => {
		selectRows = [{ createdByUserId: 'someone-else', subscription: null }];
	});

	it('refuses a volunteer coordinator with 403', async () => {
		heldPositions = ['volunteer_coordinator'];
		await expect(quote()).rejects.toMatchObject({ status: 403 });
	});

	// Before: any position. After: `reservation.read` (admin, staff, treasurer).
	it('admits exactly the reservation.read holders', async () => {
		for (const held of subsets) {
			heldPositions = held;
			const allowed = await quote().then(
				() => true,
				() => false
			);
			expect(allowed, held.join('+') || '(none)').toBe(
				holdsAny(held, ['admin', 'staff', 'treasurer'])
			);
		}
	});
});

describe('cancelReservation', () => {
	const run = () => remote.cancelReservation({ id: 'res-1', reason: 'x' });

	it('passes no override for a treasurer, who cannot manage reservations', async () => {
		heldPositions = ['treasurer'];
		await run();
		expect(cancel.mock.calls[0][3]).toEqual({ staffOverride: false });
	});

	// Before: any position overrode ownership and the start-time cutoff. After:
	// `reservation.manage` (admin, staff).
	it('overrides for exactly the reservation.manage holders', async () => {
		for (const held of subsets) {
			heldPositions = held;
			cancel.mockClear();
			await run();
			expect(cancel.mock.calls[0][3], held.join('+') || '(none)').toEqual({
				staffOverride: holdsAny(held, ['admin', 'staff'])
			});
		}
	});
});

// Before: any position committed their own booking outside the window without a
// charge. After: `reservation.comp` (admin, staff, treasurer); see #1434.
describe.each([
	['payForReservation', () => remote.payForReservation({ id: 'res-1', skipPayment: 'on' })],
	['payReservation', () => remote.payReservation({ coverFees: false })],
	[
		'bookAndPayReservation',
		() =>
			remote.bookAndPayReservation(
				{
					date: '2031-06-15',
					startTime: '17:00',
					endTime: '18:00',
					phone: '5415550100',
					skipPayment: 'on'
				},
				{}
			)
	]
])('%s outside the confirmation window', (_name, run) => {
	it('holds a site moderator to the window', async () => {
		heldPositions = ['site_moderator'];
		expect(await stoppedByWindow(run)).toBe(true);
	});

	it('waives it for exactly the reservation.comp holders', async () => {
		for (const held of subsets) {
			heldPositions = held;
			expect(await stoppedByWindow(run), held.join('+') || '(none)').toBe(
				!holdsAny(held, ['admin', 'staff', 'treasurer'])
			);
		}
	});
});
