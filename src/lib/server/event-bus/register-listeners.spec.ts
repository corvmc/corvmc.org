import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const registeredHandlers: Record<string, Array<(...args: any[]) => any>> = {};

vi.mock('./event-bus', () => ({
	domainEvents: {
		on: (event: string, handler: (...args: any[]) => any) => {
			if (!registeredHandlers[event]) registeredHandlers[event] = [];
			registeredHandlers[event].push(handler);
		}
	}
}));

const mockHandleReservationCheckout = vi.fn();
vi.mock('$lib/server/reservation/checkout-listener', () => ({
	handleReservationCheckout: (...args: unknown[]) => mockHandleReservationCheckout(...args)
}));

const mockHandleTicketCheckout = vi.fn();
vi.mock('$lib/server/ticket/checkout-listener', () => ({
	handleTicketCheckout: (...args: unknown[]) => mockHandleTicketCheckout(...args)
}));

const mockHandleBandPremiumCheckout = vi.fn();
vi.mock('$lib/server/band/band-checkout-listener', () => ({
	handleBandPremiumCheckout: (...args: unknown[]) => mockHandleBandPremiumCheckout(...args)
}));

const mockRegisterAllNotificationListeners = vi.fn();
vi.mock('$lib/server/notification/notification-listeners', () => ({
	registerAllNotificationListeners: (...args: unknown[]) =>
		mockRegisterAllNotificationListeners(...args)
}));

// The inbox + waitlist listeners dynamically import these modules during
// registration. Mock them so registration settles without loading the real
// (heavy, db-backed) implementations, which otherwise causes
// vi.dynamicImportSettled() to time out.
const mockDispatch = vi.fn();
vi.mock('$lib/server/notification/dispatcher', () => ({
	dispatch: (...args: unknown[]) => mockDispatch(...args)
}));

const mockListStaffUsers = vi.fn().mockResolvedValue([]);
vi.mock('$lib/server/authorization', () => ({
	listUsersWithCapability: (...args: unknown[]) => mockListStaffUsers(...args)
}));

const mockPromoteNextWaitlisted = vi.fn();
vi.mock('$lib/server/reservation/waitlist-service', () => ({
	promoteNextWaitlisted: (...args: unknown[]) => mockPromoteNextWaitlisted(...args)
}));

// The waitlist listener reads the cancelled reservation's time range back out of
// the database. One row, whatever it is asked for.
const cancelledRow = {
	startsAt: new Date('2026-05-21T17:00:00Z'),
	endsAt: new Date('2026-05-21T18:00:00Z')
};
vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: () => ({ where: () => ({ limit: () => Promise.resolve([cancelledRow]) }) })
		})
	}
}));
vi.mock('$lib/server/db/schema/reservation', () => ({ reservation: {} }));

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(registeredHandlers)) {
		delete registeredHandlers[key];
	}
	vi.resetModules();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Pay the module graph's transform cost once, outside any test's 5s budget.
 *
 * Every test here imports `./register-listeners` inside itself — it has to,
 * because `vi.resetModules()` runs between them and registration is a top-level
 * side effect. That makes the FIRST test the one that pays for compiling the
 * whole listener tree, and on a cold `.vite` in a wide run that alone exceeded
 * the timeout. The failure reads as a broken listener registration; it is
 * nothing of the sort.
 */
beforeAll(async () => {
	await import('./register-listeners');
	vi.resetModules();
}, 60_000);

describe('registerListeners', () => {
	it('registers checkout.completed listeners for reservation, ticket, band premium and music fulfillment', async () => {
		const { registerListeners } = await import('./register-listeners');
		registerListeners();

		// Allow async registration to resolve
		await vi.dynamicImportSettled();

		expect(registeredHandlers['checkout.completed']).toBeDefined();
		// One per purchasable. Each handler opens with a metadata guard and returns
		// immediately when the session is not its own, so the count is the whole
		// contract — a listener that failed to register would simply never fulfil,
		// silently.
		expect(registeredHandlers['checkout.completed'].length).toBe(4);
	});

	it('invokes handleReservationCheckout with stripe session', async () => {
		const { registerListeners } = await import('./register-listeners');
		registerListeners();
		await vi.dynamicImportSettled();

		const mockSession = { id: 'cs_test', metadata: {} };
		const eventData = { stripeSession: mockSession, sessionId: 'cs_test', metadata: {} };

		await registeredHandlers['checkout.completed'][0]({
			name: 'checkout.completed',
			data: eventData
		});

		expect(mockHandleReservationCheckout).toHaveBeenCalledWith(mockSession);
	});

	it('invokes handleTicketCheckout with stripe session', async () => {
		const { registerListeners } = await import('./register-listeners');
		registerListeners();
		await vi.dynamicImportSettled();

		const mockSession = { id: 'cs_test2', metadata: { type: 'ticket' } };
		const eventData = { stripeSession: mockSession, sessionId: 'cs_test2', metadata: {} };

		await registeredHandlers['checkout.completed'][1]({
			name: 'checkout.completed',
			data: eventData
		});

		expect(mockHandleTicketCheckout).toHaveBeenCalledWith(mockSession);
	});

	it('invokes handleBandPremiumCheckout with stripe session', async () => {
		const { registerListeners } = await import('./register-listeners');
		registerListeners();
		await vi.dynamicImportSettled();

		const mockSession = { id: 'cs_test3', metadata: { subscription_type: 'band_premium' } };
		const eventData = { stripeSession: mockSession, sessionId: 'cs_test3', metadata: {} };

		await registeredHandlers['checkout.completed'][2]({
			name: 'checkout.completed',
			data: eventData
		});

		expect(mockHandleBandPremiumCheckout).toHaveBeenCalledWith(mockSession);
	});

	it('calls registerAllNotificationListeners', async () => {
		const { registerListeners } = await import('./register-listeners');
		registerListeners();
		await vi.dynamicImportSettled();

		expect(mockRegisterAllNotificationListeners).toHaveBeenCalled();
	});
});

describe('inbox.message_received — staff fan-out', () => {
	// This listener notifies *every* staff member and puts `event.preview` — the
	// first 200 characters of the message — in the notification body. Every
	// channel it fires for is the org's own correspondence, except one.
	//
	// Without the channel check, the opening words of every private member↔member
	// message would land in every staff member's notification bell. That is the
	// single worst way this feature could leak, and it is a one-line guard, which
	// is exactly why it needs a test sitting on it.
	async function fire(event: Record<string, unknown>) {
		const { registerListeners } = await import('./register-listeners');
		registerListeners();
		await vi.dynamicImportSettled();
		await registeredHandlers['inbox.message_received'][0]({
			name: 'inbox.message_received',
			data: event
		});
	}

	const message = (channel: string) => ({
		threadId: 'thread-1',
		messageId: 'msg-1',
		channel,
		contactName: 'Robin',
		preview: 'the private words of a member'
	});

	beforeEach(() => {
		mockListStaffUsers.mockResolvedValue([{ id: 'staff-1', email: 'sam@corvmc.org' }]);
	});

	it('tells staff about a contact-form message', async () => {
		await fire(message('web'));
		expect(mockDispatch).toHaveBeenCalled();
	});

	it('tells nobody about a direct message', async () => {
		await fire(message('direct'));
		expect(mockDispatch).not.toHaveBeenCalled();
	});

	it('does not even look up the staff list for a direct message', async () => {
		// Returning early *before* the capability lookup, not filtering afterwards.
		await fire(message('direct'));
		expect(mockListStaffUsers).not.toHaveBeenCalled();
	});
});

describe('reservation.cancelled — waitlist promotion', () => {
	// The expiry path in `waitlist-service` cancels its row and promotes the next
	// member in the same loop, so that it can return the count. It emits
	// `reservation.cancelled` all the same, because the row *was* cancelled and
	// other listeners need to hear it — so this one has to recognise the
	// cancellation it already handled and stay out of the way. Promoting again
	// would skip past the member just notified (they now carry
	// `waitlistNotifiedAt`) and offer the same slot to the one behind them.
	async function fire(event: Record<string, unknown>) {
		const { registerListeners } = await import('./register-listeners');
		registerListeners();
		await vi.dynamicImportSettled();
		await registeredHandlers['reservation.cancelled'][0]({
			name: 'reservation.cancelled',
			data: event
		});
	}

	const cancellation = { reservationId: 'res-1', userId: 'user-1', cancelledBy: 'member' };

	it('promotes the next member when a booking is cancelled', async () => {
		await fire(cancellation);

		expect(mockPromoteNextWaitlisted).toHaveBeenCalledWith(
			cancelledRow.startsAt,
			cancelledRow.endsAt
		);
	});

	it('promotes nobody when the waitlist expiry already did', async () => {
		await fire({ ...cancellation, cancelledBy: 'system', cause: 'waitlist_expired' });

		expect(mockPromoteNextWaitlisted).not.toHaveBeenCalled();
	});
});
