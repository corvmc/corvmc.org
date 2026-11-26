import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What `updateEvent` hands the service: the hold release, and the bill that
 * saves with the listing for band and community listings (#3271). A CMC bill
 * belongs to the production console, so it is never written from here.
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

const update = vi.fn(async () => undefined);
const setEventLineup = vi.fn(async () => undefined);
const getById = vi.fn(async (): Promise<{ source: string } | null> => ({ source: 'band' }));

vi.mock('#lib/server/event/event-service.js', () => ({
	create: vi.fn(),
	update: (...a: unknown[]) => update(...(a as [])),
	checkRebookNeeded: vi.fn(),
	publish: vi.fn(),
	publishBlockers: vi.fn(async () => []),
	unpublishWithNotice: vi.fn(),
	remove: vi.fn(),
	getDeletionImpact: vi.fn(),
	cancel: vi.fn(),
	getById: (...a: unknown[]) => getById(...(a as [])),
	listAll: vi.fn(),
	listStaffCalendar: vi.fn(),
	listEventsNear: vi.fn(),
	listUpcoming: vi.fn(),
	listPast: vi.fn(),
	getEventLineup: vi.fn(),
	getEventLineups: vi.fn(),
	setEventLineup: (...a: unknown[]) => setEventLineup(...(a as [])),
	listMemberUpcomingShows: vi.fn(),
	listMemberPastShows: vi.fn(),
	countMemberPastShows: vi.fn()
}));

vi.mock('#lib/server/errors.js', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		DomainError,
		mapDomainError: (err: unknown): never => {
			if (err instanceof DomainError) error(err.httpStatus, err.message);
			throw err;
		}
	};
});

vi.mock('#lib/server/event/listing-guard.js', () => ({
	requireListingWriter: vi.fn(async () => ({ id: 'staff-1' })),
	requireListingReader: vi.fn(async () => ({ id: 'staff-1' }))
}));
vi.mock('#lib/server/authorization.js', () => ({
	can: vi.fn(async () => true),
	requireCapability: vi.fn(async () => ({ id: 'staff-1' })),
	requireUser: vi.fn(async () => ({ id: 'user-1' }))
}));
vi.mock('#lib/server/reservation/conflict-service.js', () => ({
	getConflictDetails: vi.fn(),
	getValidationWarnings: vi.fn()
}));
vi.mock('#lib/server/reservation/recurring-series-service.js', () => ({
	createEventSeries: vi.fn(),
	getByEvent: vi.fn(),
	getEventSeries: vi.fn(),
	cancel: vi.fn()
}));
vi.mock('#lib/server/reservation/rrule-helpers.js', () => ({
	buildRRule: vi.fn(),
	getOccurrences: vi.fn()
}));
vi.mock('#lib/server/finance/subscription-service.js', () => ({
	isSustainingMember: vi.fn(async () => false)
}));
vi.mock('#lib/server/finance/product-config-service.js', () => ({ buildLineItem: vi.fn() }));
vi.mock('#lib/server/finance/payment-service.js', () => ({ checkout: vi.fn() }));
vi.mock('#lib/server/storage.js', () => ({ resolveImageUrl: vi.fn() }));
vi.mock('#lib/server/feature-flags.js', () => ({
	isFeatureEnabled: vi.fn(async () => true),
	requireFeature: vi.fn(async () => undefined)
}));
vi.mock('#lib/server/db/index.js', () => ({ db: {} }));

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
	(data: unknown, issue?: unknown) => Promise<unknown>
>;

const bill = JSON.stringify([
	{ name: 'Paper Wolves', billingOrder: 0 },
	{ name: 'Second Act', billingOrder: 1 }
]);

beforeEach(() => {
	update.mockClear();
	setEventLineup.mockClear();
	getById.mockClear();
});

describe('updateEvent', () => {
	it.each(['band', 'community'])(
		'applies the bill for a %s listing, as the staff',
		async (source) => {
			getById.mockResolvedValueOnce({ source });

			await events.updateEvent({ eventId: 'evt-1', lineup: bill });

			expect(setEventLineup).toHaveBeenCalledWith(
				'evt-1',
				[
					expect.objectContaining({ name: 'Paper Wolves' }),
					expect.objectContaining({ name: 'Second Act' })
				],
				{ asStaff: false }
			);
		}
	);

	it('ignores the bill for a CMC listing', async () => {
		getById.mockResolvedValueOnce({ source: 'cmc' });

		await events.updateEvent({ eventId: 'evt-1', lineup: bill });

		expect(setEventLineup).not.toHaveBeenCalled();
	});

	it('leaves the bill alone when none is posted or it is malformed', async () => {
		await events.updateEvent({ eventId: 'evt-1' });
		await events.updateEvent({ eventId: 'evt-1', lineup: 'not json' });

		expect(setEventLineup).not.toHaveBeenCalled();
	});

	it('saves the listing before the bill', async () => {
		await events.updateEvent({ eventId: 'evt-1', title: 'Renamed', lineup: bill });

		expect(update.mock.invocationCallOrder[0]).toBeLessThan(
			setEventLineup.mock.invocationCallOrder[0]
		);
	});

	it('passes a hold release to the service as the staffer', async () => {
		await events.updateEvent({ eventId: 'evt-1', releaseHold: true });

		expect(update).toHaveBeenCalledWith(
			'evt-1',
			expect.objectContaining({ releaseHold: { userId: 'staff-1' } }),
			expect.anything()
		);
	});

	it('releases nothing unless asked', async () => {
		await events.updateEvent({ eventId: 'evt-1', title: 'Renamed' });

		const params = (update.mock.calls[0] as unknown[])[1];
		expect(params).not.toHaveProperty('releaseHold');
	});
});
