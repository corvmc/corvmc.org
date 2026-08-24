import { describe, it, expect, vi, beforeEach } from 'vitest';

// Remote functions are directly addressable endpoints: SvelteKit dispatches a
// remote call before any route load runs, so these are only as guarded as their
// own first line. There is no +layout.server.ts under /member or /staff to fall
// back on.
//
// These pin that every community-listing endpoint rejects the wrong caller
// *before touching the database*, and that a signed-in member cannot reach into
// someone else's listing or the staff review queue.

let currentUser: { id: string; name: string; email: string } | null = null;
let isStaff = false;

vi.mock('$lib/server/authorization', () => ({
	requireStaff: async () => {
		if (!currentUser) throw new Error('401: Not authenticated');
		if (!isStaff) throw new Error('403: Staff access required');
		return currentUser;
	},
	requireUser: () => {
		if (!currentUser) throw new Error('401: Not authenticated');
		return currentUser;
	},
	listStaffUsers: async () => []
}));

// Any service call on a rejected request is a failure — the guard has to run
// first, so these spies must stay clean.
const svc = {
	listCommunityEventsForUser: vi.fn(async () => []),
	listRejectedForUser: vi.fn(async () => []),
	listPendingSubmissions: vi.fn(async () => ({ rows: [], pagination: {} })),
	countPendingSubmissions: vi.fn(async () => 0),
	checkForDuplicate: vi.fn(async () => null),
	createCommunityEvent: vi.fn(async () => ({ id: 'evt-1' })),
	updateCommunityEvent: vi.fn(async () => ({ id: 'evt-1' })),
	publishCommunityEvent: vi.fn(async () => ({ status: 'published' })),
	unpublishCommunityEvent: vi.fn(async () => undefined),
	withdrawCommunityEvent: vi.fn(async () => undefined),
	deleteCommunityEventDraft: vi.fn(async () => undefined),
	approveSubmission: vi.fn(async () => undefined),
	rejectSubmission: vi.fn(async () => undefined)
};
vi.mock('$lib/server/event/community-event-service', () => svc);

// Standing moved out of the domain services into one shared one. It stays a
// spy here for the same reason the others are: a guard that runs late would
// show up as a service call on a rejected request.
const standingSvc = {
	getStanding: vi.fn(async () => ({
		status: 'none' as const,
		reason: null,
		triggeringFlagId: null,
		updatedAt: null
	}))
};
vi.mock('$lib/server/moderation/standing-service', () => standingSvc);

const getById = vi.fn(async () => null as unknown);
const getEventLineup = vi.fn(async () => []);
vi.mock('$lib/server/event/event-service', () => ({
	getById: (...a: unknown[]) => getById(...(a as [])),
	getEventLineup: (...a: unknown[]) => getEventLineup(...(a as []))
}));

const searchBandsByName = vi.fn(async () => []);
vi.mock('$lib/server/band/band-service', () => ({
	searchBandsByName: (...a: unknown[]) => searchBandsByName(...(a as []))
}));

vi.mock('$lib/server/errors', () => ({
	mapDomainError: (e: unknown) => {
		throw e;
	}
}));
vi.mock('$lib/server/storage', () => ({
	resolveImageUrl: () => null,
	validateUpload: () => null
}));
vi.mock('$lib/server/reservation/timezone', () => ({
	buildDateInTz: () => new Date('2026-09-01T20:00:00Z'),
	buildTimeRangeInTz: () => ({
		startsAt: new Date('2026-09-01T20:00:00Z'),
		endsAt: new Date('2026-09-01T23:00:00Z')
	})
}));
vi.mock('$lib/remote/layout.remote', () => ({
	getStaffLayout: () => ({ refresh: () => undefined })
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: currentUser },
		params: {},
		url: new URL('http://localhost/'),
		request: { headers: new Headers() }
	}),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => Promise<unknown>;
		const wrapped = (...a: unknown[]) => {
			const promise = handler(...a) as Promise<unknown> & { refresh?: () => void };
			promise.refresh = () => undefined;
			return promise;
		};
		// SvelteKit validates every export of a .remote.ts at import time, so the
		// stubs have to carry the same marker the real helpers attach.
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'query' };
		return wrapped;
	},
	form: (_schema: unknown, handler: (...a: unknown[]) => unknown) => {
		const fn = handler as unknown as Record<string, unknown>;
		fn.__ = { type: 'form' };
		fn.for = () => fn;
		return handler;
	},
	command: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		(handler as unknown as Record<string, unknown>).__ = { type: 'command' };
		return handler;
	}
}));

const remote = (await import('./community-events.remote')) as unknown as Record<
	string,
	(...args: unknown[]) => Promise<unknown>
>;

const issue = new Proxy(
	{},
	{
		get: (_t, field: string) => (message: string) => {
			throw new Error(`invalid:${field}:${message}`);
		}
	}
);

const LISTING_INPUT = {
	title: 'Basement show',
	eventDate: '2026-09-01',
	eventStartTime: '20:00'
};

function noServiceCalls() {
	for (const [name, spy] of Object.entries({ ...svc, ...standingSvc })) {
		expect(spy, `${name} should not have been called`).not.toHaveBeenCalled();
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	currentUser = null;
	isStaff = false;
	getById.mockResolvedValue(null);
});

describe('anonymous callers', () => {
	const cases: [string, () => Promise<unknown>][] = [
		['getMyListings', () => remote.getMyListings()],
		['getMyListing', () => remote.getMyListing('evt-1')],
		['findDuplicateListing', () => remote.findDuplicateListing('evt-1')],
		['searchBandsForListing', () => remote.searchBandsForListing('wolves')],
		['createListing', () => remote.createListing(LISTING_INPUT, issue)],
		['updateListing', () => remote.updateListing({ ...LISTING_INPUT, eventId: 'evt-1' }, issue)],
		['publishListing', () => remote.publishListing({ eventId: 'evt-1' })],
		['unpublishListing', () => remote.unpublishListing({ eventId: 'evt-1' })],
		['withdrawListing', () => remote.withdrawListing({ eventId: 'evt-1' })],
		['deleteListing', () => remote.deleteListing({ eventId: 'evt-1' })],
		['getPendingSubmissions', () => remote.getPendingSubmissions({})],
		['getPendingSubmissionCount', () => remote.getPendingSubmissionCount()],
		['approveListing', () => remote.approveListing({ eventId: 'evt-1' })],
		['rejectListing', () => remote.rejectListing({ eventId: 'evt-1', notes: 'no' })]
	];

	it.each(cases)('%s rejects before touching the database', async (_name, call) => {
		await expect(call()).rejects.toThrow(/401/);
		noServiceCalls();
		expect(getById).not.toHaveBeenCalled();
	});
});

describe('signed-in members cannot reach the staff surfaces', () => {
	beforeEach(() => {
		currentUser = { id: 'member-1', name: 'Ada', email: 'ada@example.com' };
		isStaff = false;
	});

	const cases: [string, () => Promise<unknown>][] = [
		['getPendingSubmissions', () => remote.getPendingSubmissions({})],
		['getPendingSubmissionCount', () => remote.getPendingSubmissionCount()],
		['approveListing', () => remote.approveListing({ eventId: 'evt-1' })],
		['rejectListing', () => remote.rejectListing({ eventId: 'evt-1', notes: 'no' })]
	];

	it.each(cases)('%s rejects a non-staff member', async (_name, call) => {
		await expect(call()).rejects.toThrow(/403/);
		noServiceCalls();
	});
});

describe('ownership', () => {
	beforeEach(() => {
		currentUser = { id: 'member-1', name: 'Ada', email: 'ada@example.com' };
	});

	it('getMyListing returns null for someone else’s listing rather than its contents', async () => {
		getById.mockResolvedValue({
			id: 'evt-1',
			source: 'community',
			createdByUserId: 'member-2'
		} as never);

		await expect(remote.getMyListing('evt-1')).resolves.toBeNull();
		expect(getEventLineup).not.toHaveBeenCalled();
	});

	it('getMyListing refuses to hand back a band event through the member path', async () => {
		getById.mockResolvedValue({
			id: 'evt-1',
			source: 'band',
			createdByUserId: 'member-1'
		} as never);

		await expect(remote.getMyListing('evt-1')).resolves.toBeNull();
	});

	it('threads the caller’s own id to the service, never a client-supplied one', async () => {
		await remote.publishListing({ eventId: 'evt-1', userId: 'member-2' });

		// The service enforces ownership; what matters here is that the id it is
		// given comes from the session and not from the request body.
		expect(svc.publishCommunityEvent).toHaveBeenCalledWith('evt-1', 'member-1');
	});

	it('findDuplicateListing will not probe someone else’s listing', async () => {
		getById.mockResolvedValue({
			id: 'evt-1',
			source: 'community',
			createdByUserId: 'member-2',
			title: 'Basement show',
			startsAt: new Date()
		} as never);

		await expect(remote.findDuplicateListing('evt-1')).resolves.toBeNull();
		expect(svc.checkForDuplicate).not.toHaveBeenCalled();
	});
});
