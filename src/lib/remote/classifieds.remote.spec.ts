import { describe, it, expect, vi, beforeEach } from 'vitest';

// These remotes are the whole access-control story for classifieds: SvelteKit
// dispatches a remote call before any route load runs.

let currentUser: { id: string; name: string; email: string } | null = null;
let isStaff = false;

vi.mock('$lib/server/authorization', () => ({
	can: async () => isStaff,
	requireCapability: async () => {
		if (!currentUser) throw new Error('401: Not authenticated');
		if (!isStaff) throw new Error('403: Staff access required');
		return currentUser;
	},
	requireUser: () => {
		if (!currentUser) throw new Error('401: Not authenticated');
		return currentUser;
	}
}));

const FUTURE = new Date(Date.now() + 86_400_000);
const livePost = {
	id: 'cp1',
	title: 'Drummer wanted',
	authorUserId: 'author',
	authorName: 'Ada',
	status: 'open',
	visibility: 'visible',
	expiresAt: FUTURE,
	groupId: null,
	groupName: null,
	groupSlug: null,
	tags: []
};

const svc = {
	listBoard: vi.fn(async () => ({ rows: [], pagination: {} })),
	getPost: vi.fn(async () => ({ ...livePost }) as Record<string, unknown>),
	createPost: vi.fn(async () => ({ id: 'cp1', visibility: 'visible' })),
	updatePost: vi.fn(async () => undefined),
	renewPost: vi.fn(async () => undefined),
	closePost: vi.fn(async () => undefined),
	setVisibility: vi.fn(async () => undefined),
	canView: (
		await vi.importActual<typeof import('$lib/server/classified/classified-service')>(
			'$lib/server/classified/classified-service'
		)
	).canView
};
vi.mock('$lib/server/classified/classified-service', () => svc);

const createFlag = vi.fn(async () => ({ id: 'f1' }));
let unresolvedReports = 0;
vi.mock('$lib/server/flag/flag-service', () => ({
	createFlag: (...a: unknown[]) => createFlag(...(a as [])),
	countUnresolvedReportsBy: async () => unresolvedReports,
	FLAG_REASON_MAX: 100,
	FLAG_DESCRIPTION_MAX: 1000
}));

vi.mock('$lib/server/feature-flags', () => ({ isFeatureEnabled: async () => true }));
vi.mock('$lib/server/moderation/standing-service', () => ({
	getStanding: async () => ({ status: 'none' })
}));
vi.mock('$lib/server/band/band-service', () => ({ listForUser: async () => [] }));
vi.mock('$lib/server/directory/directory-service', () => ({
	suggestInstruments: async () => [],
	suggestGenres: async () => []
}));
vi.mock('$lib/server/errors', () => ({
	mapDomainError: (e: unknown) => {
		throw e;
	}
}));

vi.mock('@sveltejs/kit', async (orig) => {
	const actual = (await orig()) as Record<string, unknown>;
	return {
		...actual,
		error: (status: number, message: unknown) => {
			throw new Error(`${status}: ${typeof message === 'string' ? message : ''}`);
		},
		invalid: (...issues: unknown[]) => {
			throw new Error(`invalid: ${JSON.stringify(issues)}`);
		}
	};
});

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
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'query' };
		return wrapped;
	},
	form: (_schema: unknown, handler: (...a: unknown[]) => unknown) => {
		const fn = handler as unknown as Record<string, unknown>;
		fn.__ = { type: 'form' };
		fn.for = () => fn;
		return handler;
	}
}));

const remote = (await import('./classifieds.remote')) as unknown as Record<
	string,
	(...args: unknown[]) => Promise<unknown>
>;

/** A stand-in for kit's issue builder: every field returns its message. */
const issue = new Proxy({}, { get: () => (m: string) => m });

beforeEach(() => {
	currentUser = { id: 'viewer', name: 'Vi', email: 'vi@example.com' };
	isStaff = false;
	unresolvedReports = 0;
	vi.clearAllMocks();
	svc.getPost.mockResolvedValue({ ...livePost });
});

describe('member reads', () => {
	it('refuses a signed-out caller before touching the service', async () => {
		currentUser = null;
		await expect(remote.getClassifiedBoard({})).rejects.toThrow('401');
		expect(svc.listBoard).not.toHaveBeenCalled();
	});

	it('never passes a visibility filter from the member board', async () => {
		await remote.getClassifiedBoard({ visibility: 'hidden' });
		expect(svc.listBoard).toHaveBeenCalledWith(
			expect.not.objectContaining({ visibility: expect.anything() }),
			expect.anything()
		);
	});

	it('answers a hidden post with 404 for anyone but its author and staff', async () => {
		svc.getPost.mockResolvedValue({ ...livePost, visibility: 'hidden' });
		await expect(remote.getClassifiedDetail('cp1')).rejects.toThrow('404');

		currentUser = { id: 'author', name: 'Ada', email: 'ada@example.com' };
		await expect(remote.getClassifiedDetail('cp1')).resolves.toBeTruthy();

		currentUser = { id: 'staffer', name: 'Sam', email: 'sam@example.com' };
		isStaff = true;
		await expect(remote.getClassifiedDetail('cp1')).resolves.toBeTruthy();
	});
});

describe('reporting', () => {
	it('files a classified_post flag for a post on the board', async () => {
		await remote.reportClassified({ postId: 'cp1', reason: 'spam' }, issue);
		expect(createFlag).toHaveBeenCalledWith(
			expect.objectContaining({ entityType: 'classified_post', entityId: 'cp1' })
		);
	});

	it('will not let an author report their own post', async () => {
		currentUser = { id: 'author', name: 'Ada', email: 'ada@example.com' };
		await expect(remote.reportClassified({ postId: 'cp1', reason: 'x' }, issue)).rejects.toThrow(
			'404'
		);
		expect(createFlag).not.toHaveBeenCalled();
	});

	it('stops at the unresolved-report cap', async () => {
		unresolvedReports = 99;
		await expect(remote.reportClassified({ postId: 'cp1', reason: 'x' }, issue)).rejects.toThrow(
			'invalid'
		);
		expect(createFlag).not.toHaveBeenCalled();
	});
});

describe('staff', () => {
	it('refuses a member on every staff remote before the service runs', async () => {
		await expect(remote.getStaffClassifieds({})).rejects.toThrow('403');
		await expect(
			remote.moderateClassified({ postId: 'cp1', visibility: 'hidden', note: 'x' }, issue)
		).rejects.toThrow('403');
		expect(svc.listBoard).not.toHaveBeenCalled();
		expect(svc.setVisibility).not.toHaveBeenCalled();
	});

	it('refuses a takedown without a note, since the note is the way back', async () => {
		isStaff = true;
		await expect(
			remote.moderateClassified({ postId: 'cp1', visibility: 'hidden' }, issue)
		).rejects.toThrow('invalid');
		expect(svc.setVisibility).not.toHaveBeenCalled();
	});
});
