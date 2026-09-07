import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// #669: a staff refund used to write `refundedAt` and nothing else, so the row
// kept its `paidAt` and went on reading as Paid. The one action is now two —
// "Refund and cancel" delegates to the service's cancel path, "Refund only"
// leaves the booking standing — and both stamp `updatedAt`.

const staffUser = mockUser({ id: 'staff-1', name: 'Staff Person', email: 'staff@example.com' });
const ownerId = 'member-1';

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

/** Payloads passed to `db.update(...).set(...)`, in call order. */
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

const requireCapability = vi.fn(async () => undefined);
vi.mock('$lib/server/authorization', () => ({
	requireUser: () => staffUser,
	requireCapability,
	isStaff: vi.fn(async () => true),
	requireCapabilityOrOwner: vi.fn(async () => 'staff'),
	topPositionFor: vi.fn()
}));

const refundPayment = vi.fn(async () => undefined);
vi.mock('$lib/server/finance/payment-service', () => ({
	refund: refundPayment,
	checkout: vi.fn(),
	recordCashPayment: vi.fn()
}));

const reverseReservationCredits = vi.fn(async () => undefined);
vi.mock('$lib/server/reservation/reservation-credit-service', () => ({
	commitReservationCredits: vi.fn(),
	computeReservationCredit: vi.fn(),
	commitCreditsAndSettleIfCovered: vi.fn(),
	reverseReservationCredits
}));

const cancel = vi.fn(async () => undefined);
vi.mock('$lib/server/reservation/reservation-service', () => ({
	staffCreate: vi.fn(),
	create: vi.fn(),
	createWaitlisted: vi.fn(),
	cancel,
	confirm: vi.fn(),
	markComplete: vi.fn(),
	markNoShow: vi.fn(),
	recordCashAndComplete: vi.fn(),
	isFirstReservationSql: vi.fn(),
	priorBookingCount: vi.fn(),
	announceWaitlistConfirmed: vi.fn(),
	announceConfirmed: vi.fn(),
	ReservationConflictError: class extends Error {},
	ReservationValidationError: class extends Error {}
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

const { refundOnlyReservation, refundAndCancelReservation } =
	(await import('$lib/remote/reservations.remote')) as any;

const paidRow = {
	createdByUserId: ownerId,
	status: 'confirmed',
	stripePaymentRecordId: 'pr_123',
	refundedAt: null
};

beforeEach(() => {
	selectResults.length = 0;
	updateSets.length = 0;
	requireCapability.mockClear();
	refundPayment.mockClear();
	reverseReservationCredits.mockClear();
	cancel.mockClear();
});

describe('refundOnlyReservation', () => {
	it('refunds the owner payment, keeps the status, and stamps updatedAt', async () => {
		selectResults.push([paidRow]);

		await refundOnlyReservation({ id: 'res-1' }, undefined);

		expect(refundPayment).toHaveBeenCalledWith({
			userId: ownerId,
			stripePaymentRecordId: 'pr_123'
		});
		expect(updateSets).toHaveLength(1);
		expect(updateSets[0].refundedAt).toBeInstanceOf(Date);
		expect(updateSets[0].updatedAt).toBeInstanceOf(Date);
		// A goodwill refund on a session that ran: the booking stands, and the
		// display reads "refunded" off the column rather than off the status.
		expect(updateSets[0]).not.toHaveProperty('status');
		expect(cancel).not.toHaveBeenCalled();
	});

	it('requires the finance.refund capability', async () => {
		selectResults.push([paidRow]);
		await refundOnlyReservation({ id: 'res-1' }, undefined);
		expect(requireCapability).toHaveBeenCalledWith('finance.refund');
	});

	it('refuses a row that is already refunded', async () => {
		selectResults.push([{ ...paidRow, refundedAt: new Date() }]);

		await expect(refundOnlyReservation({ id: 'res-1' }, undefined)).rejects.toMatchObject({
			status: 400
		});
		expect(refundPayment).not.toHaveBeenCalled();
	});

	it('refuses a row with no payment to refund', async () => {
		selectResults.push([{ ...paidRow, stripePaymentRecordId: null }]);

		await expect(refundOnlyReservation({ id: 'res-1' }, undefined)).rejects.toMatchObject({
			status: 400
		});
		expect(refundPayment).not.toHaveBeenCalled();
	});
});

describe('refundAndCancelReservation', () => {
	it('delegates to the service cancel path rather than writing the row itself', async () => {
		selectResults.push([paidRow]);

		await refundAndCancelReservation({ id: 'res-1' }, undefined);

		expect(cancel).toHaveBeenCalledTimes(1);
		const [id, actorId, , options] = cancel.mock.calls[0];
		expect(id).toBe('res-1');
		expect(actorId).toBe(staffUser.id);
		expect(options).toMatchObject({ staffOverride: true });
		// The refund and the row write both belong to `cancel()`; doing either
		// here as well would refund twice.
		expect(refundPayment).not.toHaveBeenCalled();
		expect(updateSets).toHaveLength(0);
	});

	it('requires the finance.refund capability', async () => {
		selectResults.push([paidRow]);
		await refundAndCancelReservation({ id: 'res-1' }, undefined);
		expect(requireCapability).toHaveBeenCalledWith('finance.refund');
	});

	it('refuses a row that is already refunded', async () => {
		selectResults.push([{ ...paidRow, refundedAt: new Date() }]);

		await expect(refundAndCancelReservation({ id: 'res-1' }, undefined)).rejects.toMatchObject({
			status: 400
		});
		expect(cancel).not.toHaveBeenCalled();
	});
});
