import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inArray } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockTicket = {
	id: 'ticket-1',
	eventId: 'event-1',
	purchaseId: 'purchase-1',
	userId: 'user-1',
	attendeeName: 'Alice',
	attendeeEmail: 'alice@example.com',
	code: 'ABCD1234',
	status: 'pending',
	checkedInAt: null,
	checkedInByUserId: null,
	createdAt: new Date(),
	updatedAt: new Date()
};

let selectResult: unknown[] = [];
let selectResultQueue: unknown[][] = [];
let updateResult: unknown = { rowCount: 1 };
let insertResult: unknown[] = [{ ...mockTicket }];
let lastUpdateSet: Record<string, unknown> | null = null;
/** Rows handed to db.insert().values(...) by the call under test. */
let lastInsertValues: Record<string, unknown>[] = [];

function chainable(result?: unknown[]) {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => {
					if (result !== undefined) return resolve(result);
					if (selectResultQueue.length > 0) return resolve(selectResultQueue.shift()!);
					return resolve(selectResult);
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

const mockDb = {
	select: vi.fn(() => chainable()),
	insert: vi.fn(() => ({
		values: vi.fn((rows: Record<string, unknown>[]) => {
			lastInsertValues = rows;
			return { returning: vi.fn(() => Promise.resolve(insertResult)) };
		})
	})),
	update: vi.fn(() => ({
		set: vi.fn((vals: Record<string, unknown>) => {
			lastUpdateSet = vals;
			return {
				where: vi.fn(() => {
					const whereResult = Promise.resolve(updateResult);
					(whereResult as any).returning = vi.fn(() =>
						Promise.resolve(
							typeof (updateResult as any).rowCount === 'number'
								? Array.from({ length: (updateResult as any).rowCount }, (_, i) => ({
										id: `id-${i}`
									}))
								: updateResult
						)
					);
					return whereResult;
				})
			};
		})
	}))
};

vi.mock('$lib/server/db', () => ({
	db: mockDb
}));

vi.mock('$lib/server/db/schema/ticket', () => ({
	ticket: {
		id: 'id',
		eventId: 'event_id',
		purchaseId: 'purchase_id',
		userId: 'user_id',
		attendeeName: 'attendee_name',
		attendeeEmail: 'attendee_email',
		code: 'code',
		status: 'status',
		checkedInAt: 'checked_in_at',
		checkedInByUserId: 'checked_in_by_user_id',
		createdAt: 'created_at',
		updatedAt: 'updated_at'
	}
}));

vi.mock('$lib/server/db/schema/event', () => ({
	event: {
		id: 'id',
		ticketQuantity: 'ticket_quantity',
		title: 'title',
		startsAt: 'starts_at',
		endsAt: 'ends_at'
	}
}));

vi.mock('$lib/server/db/schema/authentication', () => ({
	user: { id: 'id', name: 'name' }
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn((...args: unknown[]) => ['eq', ...args]),
	and: vi.fn((...args: unknown[]) => ['and', ...args]),
	inArray: vi.fn((...args: unknown[]) => ['inArray', ...args]),
	lt: vi.fn((...args: unknown[]) => ['lt', ...args]),
	sql: vi.fn(),
	asc: vi.fn((col: unknown) => ['asc', col]),
	desc: vi.fn((col: unknown) => ['desc', col])
}));

const {
	generateCodeString,
	createTickets,
	fulfillPurchase,
	cancelPurchase,
	cancelStalePendingTickets,
	cancelTicket,
	checkIn,
	getTicketsSold,
	getTicketsRemaining,
	getTicketsByPurchase,
	getEventTickets,
	getUserTickets
} = await import('./ticket-service');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
	selectResult = [];
	selectResultQueue = [];
	updateResult = { rowCount: 1 };
	insertResult = [{ ...mockTicket }];
	lastInsertValues = [];
});

describe('generateCodeString', () => {
	it('returns an 8-character string', () => {
		const code = generateCodeString();
		expect(code).toHaveLength(8);
	});

	it('excludes ambiguous characters', () => {
		const ambiguous = ['0', 'O', 'I', 'L', '1'];
		// Generate many codes and check none contain ambiguous chars
		for (let i = 0; i < 100; i++) {
			const code = generateCodeString();
			for (const char of ambiguous) {
				expect(code).not.toContain(char);
			}
		}
	});

	it('uses only uppercase letters and digits', () => {
		for (let i = 0; i < 100; i++) {
			const code = generateCodeString();
			expect(code).toMatch(/^[A-Z2-9]+$/);
		}
	});
});

describe('createTickets', () => {
	it('inserts tickets with correct fields', async () => {
		insertResult = [
			{ ...mockTicket, code: 'CODE0001' },
			{ ...mockTicket, id: 'ticket-2', code: 'CODE0002' }
		];

		const result = await createTickets({
			eventId: 'event-1',
			purchaseId: 'purchase-1',
			quantity: 2,
			userId: 'user-1',
			attendeeName: 'Alice',
			attendeeEmail: 'alice@example.com'
		});

		expect(result).toHaveLength(2);
		expect(mockDb.insert).toHaveBeenCalled();
	});

	it('records what each pass cost and whether the discount was waived', async () => {
		await createTickets({
			eventId: 'event-1',
			purchaseId: 'purchase-1',
			quantity: 2,
			attendeeName: 'Alice',
			attendeeEmail: 'alice@example.com',
			unitPriceCents: 750,
			discountWaived: true
		});

		expect(lastInsertValues).toHaveLength(2);
		for (const row of lastInsertValues) {
			expect(row).toMatchObject({ unitPriceCents: 750, discountWaived: true });
		}
	});

	it('records the order contribution on one ticket, not on every ticket', async () => {
		// The gift belongs to the purchase. Copying it onto each pass would
		// multiply it by the quantity for anyone summing a purchase.
		await createTickets({
			eventId: 'event-1',
			purchaseId: 'purchase-1',
			quantity: 3,
			attendeeName: 'Alice',
			attendeeEmail: 'alice@example.com',
			unitPriceCents: 1500,
			contributionCents: 1000
		});

		expect(lastInsertValues.map((r) => r.contributionCents)).toEqual([1000, 0, 0]);
	});

	it('defaults the money fields to zero for comps and free claims', async () => {
		await createTickets({
			eventId: 'event-1',
			purchaseId: 'comp-1',
			quantity: 1,
			attendeeName: 'Alice',
			attendeeEmail: 'alice@example.com',
			status: 'valid'
		});

		expect(lastInsertValues[0]).toMatchObject({
			unitPriceCents: 0,
			contributionCents: 0,
			discountWaived: false
		});
	});

	it('creates tickets with pending status by default', async () => {
		await createTickets({
			eventId: 'event-1',
			purchaseId: 'purchase-1',
			quantity: 1,
			attendeeName: 'Bob',
			attendeeEmail: 'bob@example.com'
		});

		const insertCall = mockDb.insert.mock.results[0].value;
		const valuesCall = insertCall.values;
		const passedValues = valuesCall.mock.calls[0][0];
		expect(passedValues[0].status).toBe('pending');
		expect(passedValues[0].userId).toBeNull();
	});

	it('creates tickets with valid status when specified', async () => {
		await createTickets({
			eventId: 'event-1',
			purchaseId: 'purchase-1',
			quantity: 1,
			attendeeName: 'Carol',
			attendeeEmail: 'carol@example.com',
			status: 'valid'
		});

		const insertCall = mockDb.insert.mock.results[0].value;
		const valuesCall = insertCall.values;
		const passedValues = valuesCall.mock.calls[0][0];
		expect(passedValues[0].status).toBe('valid');
	});
});

describe('fulfillPurchase', () => {
	it('returns the updated ticket rows', async () => {
		const fulfilled = [
			{ ...mockTicket, status: 'valid' },
			{ ...mockTicket, id: 'ticket-2', status: 'valid' }
		];
		updateResult = fulfilled;
		const rows = await fulfillPurchase('purchase-1');
		expect(rows).toHaveLength(2);
		expect(rows[0].status).toBe('valid');
	});

	it('returns empty array when no pending tickets exist', async () => {
		updateResult = [];
		const rows = await fulfillPurchase('purchase-nonexistent');
		expect(rows).toHaveLength(0);
	});

	it('writes the payment record id in the same update as the status flip', async () => {
		updateResult = [{ ...mockTicket, status: 'valid' }];
		lastUpdateSet = null;

		await fulfillPurchase('purchase-1', 'pi_abc123');

		expect(lastUpdateSet).toMatchObject({
			status: 'valid',
			stripePaymentRecordId: 'pi_abc123'
		});
	});

	it('leaves the payment record id unset for purchases that never touch Stripe', async () => {
		updateResult = [{ ...mockTicket, status: 'valid' }];
		lastUpdateSet = null;

		await fulfillPurchase('comp-1');

		expect(lastUpdateSet).toMatchObject({ status: 'valid' });
		expect(lastUpdateSet).not.toHaveProperty('stripePaymentRecordId');
	});
});

describe('cancelPurchase', () => {
	it('returns the number of cancelled tickets', async () => {
		updateResult = { rowCount: 2 };
		const count = await cancelPurchase('purchase-1');
		expect(count).toBe(2);
	});
});

describe('cancelStalePendingTickets', () => {
	it('cancels only pending tickets older than the cutoff', async () => {
		updateResult = { rowCount: 3 };

		const count = await cancelStalePendingTickets(24);
		expect(count).toBe(3);

		// Filter must target pending status with a created-at cutoff ~24h back.
		const { eq, lt } = await import('drizzle-orm');
		expect(vi.mocked(eq)).toHaveBeenCalledWith('status', 'pending');
		const [col, cutoff] = vi.mocked(lt).mock.calls[0];
		expect(col).toBe('created_at');
		const expectedCutoff = Date.now() - 24 * 60 * 60 * 1000;
		expect(Math.abs((cutoff as Date).getTime() - expectedCutoff)).toBeLessThan(5000);
	});
});

describe('checkIn', () => {
	it('throws when ticket not found', async () => {
		selectResult = [];
		await expect(checkIn('nonexistent', 'staff-1')).rejects.toThrow('Ticket not found');
	});

	it('throws when ticket is not valid', async () => {
		selectResult = [{ status: 'pending' }];
		await expect(checkIn('ticket-1', 'staff-1')).rejects.toThrow(
			'Cannot check in ticket with status "pending"'
		);
	});

	it('throws when ticket is already checked in', async () => {
		selectResult = [{ status: 'checked_in' }];
		await expect(checkIn('ticket-1', 'staff-1')).rejects.toThrow(
			'Cannot check in ticket with status "checked_in"'
		);
	});

	it('throws when ticket is cancelled', async () => {
		selectResult = [{ status: 'cancelled' }];
		await expect(checkIn('ticket-1', 'staff-1')).rejects.toThrow(
			'Cannot check in ticket with status "cancelled"'
		);
	});

	it('updates the ticket when valid', async () => {
		selectResult = [{ status: 'valid' }];
		await checkIn('ticket-1', 'staff-1');
		expect(mockDb.update).toHaveBeenCalled();
	});
});

describe('getTicketsSold', () => {
	it('returns the count from the query', async () => {
		selectResult = [{ count: 5 }];
		const count = await getTicketsSold('event-1');
		expect(count).toBe(5);
	});

	it('returns 0 when no results', async () => {
		selectResult = [{ count: 0 }];
		const count = await getTicketsSold('event-1');
		expect(count).toBe(0);
	});
});

describe('getTicketsRemaining', () => {
	it('returns null for unlimited capacity', async () => {
		// First select: event query returns null ticketQuantity
		selectResultQueue = [[{ ticketQuantity: null }]];
		const remaining = await getTicketsRemaining('event-1');
		expect(remaining).toBeNull();
	});

	it('returns null when event not found', async () => {
		selectResultQueue = [[]];
		const remaining = await getTicketsRemaining('event-nonexistent');
		expect(remaining).toBeNull();
	});

	it('returns remaining count for limited capacity', async () => {
		// First select: event query, second select: sold count
		selectResultQueue = [[{ ticketQuantity: 50 }], [{ count: 12 }]];
		const remaining = await getTicketsRemaining('event-1');
		expect(remaining).toBe(38);
	});

	it('returns 0 when sold out', async () => {
		selectResultQueue = [[{ ticketQuantity: 10 }], [{ count: 10 }]];
		const remaining = await getTicketsRemaining('event-1');
		expect(remaining).toBe(0);
	});

	it('returns 0 when oversold', async () => {
		selectResultQueue = [[{ ticketQuantity: 10 }], [{ count: 12 }]];
		const remaining = await getTicketsRemaining('event-1');
		expect(remaining).toBe(0);
	});
});

describe('cancelTicket', () => {
	it('throws when ticket not found', async () => {
		selectResult = [];
		await expect(cancelTicket('nonexistent')).rejects.toThrow('Ticket not found');
	});

	it('throws when ticket is already cancelled', async () => {
		selectResult = [{ status: 'cancelled' }];
		await expect(cancelTicket('ticket-1')).rejects.toThrow(
			'Cannot cancel ticket with status "cancelled"'
		);
	});

	it('throws when ticket is already checked in', async () => {
		selectResult = [{ status: 'checked_in' }];
		await expect(cancelTicket('ticket-1')).rejects.toThrow(
			'Cannot cancel ticket with status "checked_in"'
		);
	});

	it('cancels a pending ticket', async () => {
		selectResult = [{ status: 'pending' }];
		await cancelTicket('ticket-1');
		expect(mockDb.update).toHaveBeenCalled();
	});

	it('cancels a valid ticket', async () => {
		selectResult = [{ status: 'valid' }];
		await cancelTicket('ticket-1');
		expect(mockDb.update).toHaveBeenCalled();
	});
});

describe('getTicketsByPurchase', () => {
	it('queries tickets by purchase id', async () => {
		selectResult = [mockTicket];
		const result = await getTicketsByPurchase('purchase-1');
		expect(result).toEqual([mockTicket]);
		expect(mockDb.select).toHaveBeenCalled();
	});

	it('returns empty array when no tickets found', async () => {
		selectResult = [];
		const result = await getTicketsByPurchase('purchase-nonexistent');
		expect(result).toEqual([]);
	});
});

describe('getEventTickets', () => {
	it('queries tickets for an event without status filter', async () => {
		selectResult = [mockTicket];
		const result = await getEventTickets('event-1');
		expect(result).toEqual([mockTicket]);
		expect(mockDb.select).toHaveBeenCalled();
	});

	it('queries tickets for an event with status filter', async () => {
		selectResult = [mockTicket];
		const result = await getEventTickets('event-1', ['valid', 'checked_in']);
		expect(result).toEqual([mockTicket]);
		expect(mockDb.select).toHaveBeenCalled();
	});

	it('queries tickets with empty status filter array', async () => {
		selectResult = [mockTicket];
		const result = await getEventTickets('event-1', []);
		expect(result).toEqual([mockTicket]);
	});
});

describe('getUserTickets', () => {
	it('queries tickets for a user', async () => {
		const userTicket = {
			...mockTicket,
			eventTitle: 'Concert',
			eventStartsAt: new Date(),
			eventEndsAt: new Date()
		};
		selectResult = [userTicket];
		const result = await getUserTickets('user-1');
		expect(result).toEqual([userTicket]);
		expect(mockDb.select).toHaveBeenCalled();
	});

	it('returns empty array when user has no tickets', async () => {
		selectResult = [];
		const result = await getUserTickets('user-nonexistent');
		expect(result).toEqual([]);
	});

	it('only returns paid tickets (excludes pending and cancelled)', async () => {
		selectResult = [];
		await getUserTickets('user-1');
		expect(inArray).toHaveBeenCalledWith('status', ['valid', 'checked_in']);
	});
});
