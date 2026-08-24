import { describe, it, expect, vi, beforeEach } from 'vitest';

// Remote functions are directly addressable endpoints: SvelteKit dispatches a
// remote call before any route load runs, so these are only as guarded as their
// own first line. Every export here is staff-only — standing is imposed *on* a
// member, never by them — so the guard is the whole access-control story.

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
	}
}));

// Any service call on a rejected request is a failure — the guard has to run
// first, so these spies must stay clean.
const svc = {
	getStandings: vi.fn(async () => ({})),
	setStanding: vi.fn(async () => undefined),
	restoreStanding: vi.fn(async () => undefined)
};
vi.mock('$lib/server/moderation/standing-service', () => svc);

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
	}
}));

// Cast to a plain callable record: svelte-check resolves the real `RemoteForm`
// types, which aren't callable, while at runtime the $app/server mock above has
// made every export a plain function. Same treatment as
// suggestions.remote.spec.ts.
const remote = (await import('./standing.remote')) as unknown as Record<
	string,
	(...args: unknown[]) => Promise<unknown>
>;

function noServiceCalls() {
	for (const [name, spy] of Object.entries(svc)) {
		expect(spy, `${name} should not have been called`).not.toHaveBeenCalled();
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	currentUser = null;
	isStaff = false;
});

const cases: [string, () => Promise<unknown>][] = [
	['getMemberStandings', () => remote.getMemberStandings('user-9')],
	[
		'restoreMemberStanding',
		() => remote.restoreMemberStanding({ userId: 'user-9', scope: 'suggestion' })
	],
	[
		'setMemberStanding',
		() =>
			remote.setMemberStanding({
				userId: 'user-9',
				scope: 'messaging',
				status: 'disabled',
				reason: 'Under 18'
			})
	]
];

describe('anonymous callers', () => {
	it.each(cases)('%s rejects before touching the database', async (_name, call) => {
		await expect(call()).rejects.toThrow(/401/);
		noServiceCalls();
	});
});

describe('signed-in members', () => {
	beforeEach(() => {
		currentUser = { id: 'member-1', name: 'Ada', email: 'ada@example.com' };
	});

	// The one that matters most. If a member could reach these, "restore my own
	// standing" would undo an upheld report — which is the entire point of
	// having imposed it.
	it.each(cases)('%s rejects a non-staff member', async (_name, call) => {
		await expect(call()).rejects.toThrow(/403/);
		noServiceCalls();
	});
});

describe('staff', () => {
	beforeEach(() => {
		currentUser = { id: 'staff-1', name: 'Sam', email: 'sam@example.com' };
		isStaff = true;
	});

	it('restores the named scope and no other', async () => {
		await remote.restoreMemberStanding({ userId: 'user-9', scope: 'suggestion' });
		expect(svc.restoreStanding).toHaveBeenCalledWith({
			userId: 'user-9',
			scope: 'suggestion',
			staffId: 'staff-1'
		});
	});

	// The acting staffer comes from the guard, never from the request body —
	// otherwise the audit trail is whatever the caller typed.
	it('attributes the change to the signed-in staffer', async () => {
		await remote.setMemberStanding({
			userId: 'user-9',
			scope: 'messaging',
			status: 'disabled',
			reason: 'Under 18'
		});
		expect(svc.setStanding).toHaveBeenCalledWith({
			userId: 'user-9',
			scope: 'messaging',
			status: 'disabled',
			reason: 'Under 18',
			staffId: 'staff-1'
		});
	});

	it('normalizes an empty reason to null rather than storing a blank note', async () => {
		await remote.setMemberStanding({
			userId: 'user-9',
			scope: 'messaging',
			status: 'disabled',
			reason: ''
		});
		expect(svc.setStanding).toHaveBeenCalledWith(expect.objectContaining({ reason: null }));
	});
});
