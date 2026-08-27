import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';
import { error } from '@sveltejs/kit';
import { isStaff } from '$lib/server/authorization';

// Regression: staff confirming/pricing a reservation on a member's behalf must key
// free hours to the reservation OWNER, never the acting staff user. The staff
// confirm UI previously routed through the member self-pay flow, which keyed both
// the pricing display and the credit deduction to `currentUser.id` (the staff
// member). Both `confirmReservation` (deduction) and `getReservationPricing`
// (display) must use `reservation.createdByUserId`.

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

vi.mock('$lib/server/db', () => ({
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

vi.mock('$lib/server/authorization', async () => {
	const isStaffMock = vi.fn(async () => true);
	return {
		requireUser: () => staffUser,
		requireStaff: vi.fn(async () => undefined),
		isStaff: isStaffMock,
		// Mirrors the real helper: owner short-circuits, otherwise defer to
		// isStaff so the staff/member cases below still drive this the same way
		// they drive every other authorisation check in this file.
		requireStaffOrOwner: vi.fn(async (userId?: string, ownerUserId?: string) => {
			if (!userId) throw error(401, 'Not authenticated');
			if (userId === ownerUserId) return 'owner';
			if (await isStaffMock()) return 'staff';
			throw error(403, 'Not authorized');
		}),
		primaryRoleFor: vi.fn()
	};
});

vi.mock('$lib/server/reservation/config', () => ({
	getReservationConfig: vi.fn(async () => ({ hourlyRateCents: 1500 }))
}));

// Owner has no free hours; the acting staff user has a big balance. If pricing keyed
// to the wrong user, the staff balance would leak credits onto the member's booking.
const getBalance = vi.fn(async (userId: string) => (userId === ownerId ? 0 : 100));
vi.mock('$lib/server/finance/credit-service', () => ({ getBalance }));

const commitReservationCredits = vi.fn(async (params: { userId: string; totalCents: number }) => ({
	creditUnits: 0,
	creditDiscountCents: 0,
	remainingCents: params.totalCents,
	alreadyCommitted: false
}));
vi.mock('$lib/server/reservation/reservation-credit-service', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('$lib/server/reservation/reservation-credit-service')>();
	return {
		// Keep the real pricing math so the pricing test reflects production behavior.
		computeReservationCredit: actual.computeReservationCredit,
		commitReservationCredits,
		reverseReservationCredits: vi.fn()
	};
});

const confirm = vi.fn(async () => undefined);
vi.mock('$lib/server/reservation/reservation-service', () => ({
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

vi.mock('$lib/server/feature-flags', () => ({ requireFeature: vi.fn(async () => undefined) }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: staffUser },
		url: new URL('http://localhost/staff/reservations'),
		request: { headers: new Headers() }
	}),
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

const { confirmReservation, getReservationPricing } =
	(await import('$lib/remote/reservations.remote')) as any;

beforeEach(() => {
	// requireStaffOrOwner short-circuits on ownership without consulting isStaff,
	// so a `mockResolvedValueOnce(false)` queued by an owner-path test is never
	// consumed and would otherwise leak into the next test's staff case. Reset to
	// the suite default rather than letting one-shots accumulate.
	vi.mocked(isStaff).mockReset();
	vi.mocked(isStaff).mockResolvedValue(true);
	commitReservationCredits.mockClear();
	confirm.mockClear();
	getBalance.mockClear();
	selectResults.length = 0;
	updateSets.length = 0;
});

describe('staff confirm commits the owner credits, not the staff member', () => {
	it('passes the reservation owner id to commitReservationCredits', async () => {
		selectResults.push(
			[
				{
					id: 'res-1',
					createdByUserId: ownerId,
					startsAt: new Date('2026-06-15T17:00:00Z'),
					endsAt: new Date('2026-06-15T18:00:00Z'),
					status: 'scheduled'
				}
			],
			[{ email: 'member@example.com', name: 'Test Member' }]
		);

		// The `form` mock exposes the raw handler, so call it with parsed data.
		await confirmReservation({ id: 'res-1' }, undefined);

		expect(commitReservationCredits).toHaveBeenCalledTimes(1);
		const arg = commitReservationCredits.mock.calls[0][0];
		expect(arg.userId).toBe(ownerId);
		expect(arg.userId).not.toBe(staffUser.id);
	});
});

describe('confirmation window gating', () => {
	const DAY = 24 * 60 * 60 * 1000;
	// currentUser is staffUser; making them the OWNER lets us test the member path.
	function scheduledRow(startsAt: Date) {
		return {
			id: 'res-w',
			createdByUserId: staffUser.id,
			startsAt,
			endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
			status: 'scheduled'
		};
	}

	it('blocks a member confirming more than 3 days out', async () => {
		vi.mocked(isStaff).mockResolvedValueOnce(false);
		selectResults.push([scheduledRow(new Date(Date.now() + 10 * DAY))]);

		await expect(confirmReservation({ id: 'res-w' }, undefined)).rejects.toMatchObject({
			status: 400
		});
		expect(commitReservationCredits).not.toHaveBeenCalled();
	});

	it('allows a member confirming within 3 days', async () => {
		vi.mocked(isStaff).mockResolvedValueOnce(false);
		selectResults.push(
			[scheduledRow(new Date(Date.now() + 2 * DAY))],
			[{ email: 'member@example.com', name: 'Test Member' }]
		);

		await confirmReservation({ id: 'res-w' }, undefined);
		expect(commitReservationCredits).toHaveBeenCalledTimes(1);
	});

	it('lets staff confirm outside the window', async () => {
		// isStaff defaults to true in this suite.
		selectResults.push(
			[{ ...scheduledRow(new Date(Date.now() + 10 * DAY)), createdByUserId: ownerId }],
			[{ email: 'member@example.com', name: 'Test Member' }]
		);

		await confirmReservation({ id: 'res-w' }, undefined);
		expect(commitReservationCredits).toHaveBeenCalledTimes(1);
	});
});

describe('staff comp choice on confirm', () => {
	function scheduledRow() {
		return {
			id: 'res-c',
			createdByUserId: ownerId,
			startsAt: new Date('2026-06-15T17:00:00Z'),
			endsAt: new Date('2026-06-15T18:00:00Z'),
			status: 'scheduled'
		};
	}

	it('comp=on waives payment without committing the owner credits', async () => {
		selectResults.push([scheduledRow()]);

		await confirmReservation({ id: 'res-c', comp: 'on' }, undefined);

		expect(commitReservationCredits).not.toHaveBeenCalled();
		expect(confirm).toHaveBeenCalledWith('res-c');
		expect(updateSets).toContainEqual(expect.objectContaining({ cashDueCents: 0 }));
	});

	it('rejects comp from a non-staff owner', async () => {
		vi.mocked(isStaff).mockResolvedValueOnce(false);
		// Owned by the acting (non-staff) user, within the confirmation window.
		selectResults.push([
			{ ...scheduledRow(), createdByUserId: staffUser.id, startsAt: new Date(Date.now() + 60_000) }
		]);

		await expect(confirmReservation({ id: 'res-c', comp: 'on' }, undefined)).rejects.toMatchObject({
			status: 403
		});
		expect(confirm).not.toHaveBeenCalled();
		expect(commitReservationCredits).not.toHaveBeenCalled();
	});
});

describe('getReservationPricing keys free hours to the reservation owner', () => {
	it('shows no free hours for a non-sustaining owner even when the staff user has a balance', async () => {
		selectResults.push(
			[{ createdByUserId: ownerId }], // reservation lookup
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
