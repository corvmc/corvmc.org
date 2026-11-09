import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '#lib/server/db/test-factory.js';
import { error } from '@sveltejs/kit';
import { can } from '#lib/server/authorization.js';

// Regression: staff pricing a reservation on a member's behalf must key free
// hours to the reservation OWNER, never the acting staff user.
// `getReservationPricing` must use `reservation.createdByUserId`.

const staffUser = mockUser({ id: 'staff-1', name: 'Staff Person', email: 'staff@example.com' });
const ownerId = 'member-1';

// Sequential `db.select(...).limit(1)` calls resolve from this queue in order.
const selectResults: unknown[][] = [];
function chain() {
	const c: Record<string, unknown> = {
		from: () => c,
		where: () => c,
		innerJoin: () => c,
		limit: () => Promise.resolve(selectResults.shift() ?? [])
	};
	return c;
}

// Payloads passed to `db.update(...).set(...)`, in call order.
const updateSets: Record<string, unknown>[] = [];

vi.mock('#lib/server/db/index.js', () => ({
	db: {
		select: () => chain(),
		update: () => ({
			set: (values: Record<string, unknown>) => {
				updateSets.push(values);
				return { where: () => Promise.resolve() };
			}
		})
	}
}));

vi.mock('#lib/server/authorization.js', async () => {
	const isStaffMock = vi.fn(async () => true);
	return {
		requireUser: () => staffUser,
		requireCapability: vi.fn(async () => undefined),
		// Drives both the pricing view's `can('reservation.read')` and the staff
		// arm of `requireCapabilityOrOwner` below.
		can: isStaffMock,
		// Mirrors the real helper: owner short-circuits, otherwise defer to
		// `can` so the staff/member cases below still drive this the same way
		// they drive every other authorisation check in this file.
		requireCapabilityOrOwner: vi.fn(async (_cap: string, ownerUserId?: string) => {
			// Mirrors the real guard, which now reads the acting user from the
			// request event rather than taking it as a parameter.
			if (staffUser.id === ownerUserId) return 'owner';
			if (await isStaffMock()) return 'staff';
			throw error(403, 'Not authorized');
		}),
		topPositionFor: vi.fn()
	};
});

// `termsFor` and `getBookingTerms` come through real: they are pure, and a
// stubbed rate resolver would let this spec pass while the resolver it is
// standing in for returned something else. Only the config *read* is faked.
vi.mock('#lib/server/reservation/config.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/reservation/config.js')>()),
	getReservationConfig: vi.fn(async () => ({ hourlyRateCents: 1500 }))
}));

// Owner has no free hours; the acting staff user has a big balance. If pricing keyed
// to the wrong user, the staff balance would leak credits onto the member's booking.
const getBalance = vi.fn(async (userId: string) => (userId === ownerId ? 0 : 100));
vi.mock('#lib/server/finance/credit-service.js', () => ({ getBalance }));

const commitReservationCredits = vi.fn(async (params: { userId: string; totalCents: number }) => ({
	creditUnits: 0,
	creditDiscountCents: 0,
	remainingCents: params.totalCents,
	alreadyCommitted: false
}));
vi.mock('#lib/server/reservation/reservation-credit-service.js', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('#lib/server/reservation/reservation-credit-service.js')>();
	return {
		// Keep the real pricing math so the pricing test reflects production behavior.
		computeReservationCredit: actual.computeReservationCredit,
		getFreeHoursWallet: actual.getFreeHoursWallet,
		usableFreeHours: actual.usableFreeHours,
		freeHoursResetAt: actual.freeHoursResetAt,
		commitReservationCredits,
		reverseReservationCredits: vi.fn()
	};
});

const confirm = vi.fn(async () => undefined);
vi.mock('#lib/server/reservation/reservation-service.js', () => ({
	create: vi.fn(),
	createWaitlisted: vi.fn(),
	confirm,
	cancel: vi.fn(),
	markComplete: vi.fn(),
	markNoShow: vi.fn(),
	recordCashAndComplete: vi.fn(),
	staffCreate: vi.fn(),
	ReservationConflictError: class extends Error {}
}));

vi.mock('#lib/server/feature-flags.js', () => ({ requireFeature: vi.fn(async () => undefined) }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: staffUser },
		url: new URL('http://localhost/staff/reservations'),
		request: { headers: new Headers() }
	}),
	command: (_schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'command' };
		return handler;
	},
	form: (schema: unknown, handler: (...args: any[]) => any) => {
		const fn = handler;
		(fn as any).__ = { type: 'form' };
		(fn as any).__schema = schema;
		(fn as any).for = () => fn;
		return fn;
	},
	query: (...args: any[]) => {
		const handler = typeof args[0] === 'function' ? args[0] : args[1];
		const fn = handler as (...a: any[]) => any;
		(fn as any).__ = { type: 'query' };
		return fn;
	}
}));

const { getReservationPricing } = (await import('#lib/remote/reservations.remote.js')) as any;

beforeEach(() => {
	// requireCapabilityOrOwner short-circuits on ownership without consulting `can`,
	// so a `mockResolvedValueOnce(false)` queued by an owner-path test is never
	// consumed and would otherwise leak into the next test's staff case. Reset to
	// the suite default rather than letting one-shots accumulate.
	vi.mocked(can).mockReset();
	vi.mocked(can).mockResolvedValue(true);
	commitReservationCredits.mockClear();
	confirm.mockClear();
	getBalance.mockClear();
	selectResults.length = 0;
	updateSets.length = 0;
});

describe('getReservationPricing keys free hours to the reservation owner', () => {
	it('shows no free hours for a non-sustaining owner even when the staff user has a balance', async () => {
		selectResults.push(
			[{ createdByUserId: ownerId }], // reservation lookup
			[{ subscription: null }], // owner's free-hours wallet → no reset date
			[{ subscription: null }] // owner subscription lookup → not sustaining
		);

		const pricing = await getReservationPricing({
			date: '2026-06-15',
			startTime: '17:00',
			endTime: '18:00',
			reservationId: 'res-1'
		});

		// Balance was read for the owner, not the acting staff user.
		expect(getBalance).toHaveBeenCalledWith(ownerId, 'free_hours');
		expect(pricing.freeHoursBalance).toBe(0);
		expect(pricing.creditsApplicable).toBe(0);
		expect(pricing.isSustainingMember).toBe(false);
		expect(pricing.remainingCents).toBe(pricing.totalCents);
	});
});
