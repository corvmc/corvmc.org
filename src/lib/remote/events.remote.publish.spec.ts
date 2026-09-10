import { describe, it, expect, vi } from 'vitest';

/**
 * Regression: none of these handlers called `mapDomainError`, so a domain rule
 * with a written explanation — "the production is not confirmed yet, there is
 * no description" — left the server as a 500 whose body message was the string
 * "Internal Error", and reached Sentry as a crash. The staffer saw "Error".
 *
 * `DomainError` carries its own `httpStatus`; only `mapDomainError` reads it.
 */

class DomainError extends Error {
	constructor(
		message: string,
		readonly httpStatus: number
	) {
		super(message);
		this.name = this.constructor.name;
	}
}

const publish = vi.fn();
const unpublishWithNotice = vi.fn();
const cancel = vi.fn();
const removeEvent = vi.fn();

vi.mock('$lib/server/event/event-service', () => ({
	create: vi.fn(),
	update: vi.fn(),
	checkRebookNeeded: vi.fn(),
	publish: (...a: unknown[]) => publish(...a),
	publishBlockers: vi.fn(async () => []),
	unpublishWithNotice: (...a: unknown[]) => unpublishWithNotice(...a),
	remove: (...a: unknown[]) => removeEvent(...a),
	getDeletionImpact: vi.fn(),
	cancel: (...a: unknown[]) => cancel(...a),
	getById: vi.fn(async () => null),
	listAll: vi.fn(),
	listStaffCalendar: vi.fn(),
	listEventsNear: vi.fn(),
	listUpcoming: vi.fn(),
	listPast: vi.fn(),
	getEventLineup: vi.fn(),
	getEventLineups: vi.fn(),
	setEventLineup: vi.fn(),
	listMemberUpcomingShows: vi.fn(),
	listMemberPastShows: vi.fn(),
	countMemberPastShows: vi.fn()
}));

vi.mock('$lib/server/errors', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		DomainError,
		mapDomainError: (err: unknown): never => {
			if (err instanceof DomainError) error(err.httpStatus, err.message);
			throw err;
		}
	};
});

vi.mock('$lib/server/authorization', () => ({
	requireCapability: vi.fn(async () => ({ id: 'staff-1' })),
	requireUser: vi.fn(async () => ({ id: 'user-1' }))
}));
vi.mock('$lib/server/reservation/conflict-service', () => ({
	getConflictDetails: vi.fn(),
	getValidationWarnings: vi.fn()
}));
vi.mock('$lib/server/reservation/recurring-series-service', () => ({
	createEventSeries: vi.fn(),
	getByEvent: vi.fn(),
	getEventSeries: vi.fn(),
	cancel: vi.fn()
}));
vi.mock('$lib/server/reservation/rrule-helpers', () => ({
	buildRRule: vi.fn(),
	getOccurrences: vi.fn()
}));
vi.mock('$lib/server/finance/subscription-service', () => ({
	isSustainingMember: vi.fn(async () => false)
}));
vi.mock('$lib/server/finance/product-config-service', () => ({ buildLineItem: vi.fn() }));
vi.mock('$lib/server/finance/payment-service', () => ({ checkout: vi.fn() }));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: vi.fn() }));
vi.mock('$lib/server/feature-flags', () => ({
	isFeatureEnabled: vi.fn(async () => true),
	requireFeature: vi.fn(async () => undefined)
}));
vi.mock('$lib/server/db', () => ({ db: {} }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: { id: 'staff-1' } },
		url: new URL('http://localhost/'),
		request: { headers: new Headers() }
	}),
	query: (...args: unknown[]) => tag(args, 'query'),
	command: (...args: unknown[]) => tag(args, 'command'),
	form: (...args: unknown[]) => tag(args, 'form')
}));

function tag(args: unknown[], type: string) {
	const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as Record<string, unknown>;
	handler.__ = { type };
	handler.for = () => handler;
	handler.refresh = () => Promise.resolve();
	return handler;
}

const events = (await import('./events.remote')) as unknown as Record<
	string,
	((data: unknown, issue?: unknown) => Promise<unknown>) & { refresh?: () => unknown }
>;

async function statusAndMessage(fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (e) {
		const err = e as { status?: number; body?: { message?: string } };
		return { status: err.status, message: err.body?.message };
	}
	throw new Error('expected a rejection');
}

describe('event mutations surface their domain errors', () => {
	it('publishEvent keeps the 422 and the sentence naming what is missing', async () => {
		publish.mockRejectedValueOnce(
			new DomainError(
				'Not ready to announce: the production is not confirmed yet, there is no description.',
				422
			)
		);

		expect(await statusAndMessage(() => events.publishEvent({ id: 'evt-1' }))).toEqual({
			status: 422,
			message:
				'Not ready to announce: the production is not confirmed yet, there is no description.'
		});
	});

	it('publishEvent keeps a 409 state conflict', async () => {
		publish.mockRejectedValueOnce(
			new DomainError('Cannot publish an event with status "cancelled"', 409)
		);

		expect(await statusAndMessage(() => events.publishEvent({ id: 'evt-1' }))).toEqual({
			status: 409,
			message: 'Cannot publish an event with status "cancelled"'
		});
	});

	it('unpublishEvent keeps the ticket refusal', async () => {
		unpublishWithNotice.mockRejectedValueOnce(
			new DomainError('Cannot unpublish: 3 ticket(s) have been sold', 409)
		);

		expect(await statusAndMessage(() => events.unpublishEvent({ id: 'evt-1' }))).toEqual({
			status: 409,
			message: 'Cannot unpublish: 3 ticket(s) have been sold'
		});
	});

	it('cancelEvent keeps its state error', async () => {
		cancel.mockRejectedValueOnce(new DomainError('Event is already cancelled', 409));

		expect(await statusAndMessage(() => events.cancelEvent({ id: 'evt-1' }))).toEqual({
			status: 409,
			message: 'Event is already cancelled'
		});
	});

	/**
	 * `deleteEvent` used to pick its status by matching the word "tickets" in the
	 * message, which made every other domain error a 500.
	 */
	it('deleteEvent answers a missing event with 404, not 500', async () => {
		removeEvent.mockRejectedValueOnce(new DomainError('Event not found', 404));

		expect(await statusAndMessage(() => events.deleteEvent({ id: 'evt-1' }))).toEqual({
			status: 404,
			message: 'Event not found'
		});
	});

	it('deleteEvent still answers the ticket refusal with 409', async () => {
		removeEvent.mockRejectedValueOnce(
			new DomainError('Cannot delete an event with tickets sold', 409)
		);

		expect(await statusAndMessage(() => events.deleteEvent({ id: 'evt-1' }))).toEqual({
			status: 409,
			message: 'Cannot delete an event with tickets sold'
		});
	});
});
