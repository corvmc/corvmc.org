import { describe, it, expect, vi, beforeEach } from 'vitest';

// Remote functions are only as guarded as their own first line. Filing is for
// any signed-in member (the service checks ownership); reading the staff side,
// deciding and reopening are staff-only, and the deciding staffer comes from
// the guard — the self-review rule is worthless if the caller can name them.

let currentUser: { id: string; name: string; email: string } | null = null;
let isStaff = false;

vi.mock('$lib/server/authorization', () => ({
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

vi.mock('$lib/server/rate-limit', () => ({ allowRateLimited: async () => true }));

const svc = {
	getMemberAppeal: vi.fn(async () => null),
	fileAppeal: vi.fn(async () => ({ id: 'a1' })),
	decideAppeal: vi.fn(async () => ({})),
	reopenAppeal: vi.fn(async () => undefined)
};
vi.mock('$lib/server/moderation/appeal-service', () => svc);
vi.mock('./flags.remote', () => ({ getFlagDetail: () => ({ refresh: () => undefined }) }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: currentUser }, params: {} }),
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

const remote = (await import('./appeals.remote')) as unknown as Record<
	string,
	(...args: unknown[]) => Promise<unknown>
>;

const issue = new Proxy({}, { get: () => (msg: string) => msg });

beforeEach(() => {
	vi.clearAllMocks();
	currentUser = null;
	isStaff = false;
});

const staffCases: [string, () => Promise<unknown>][] = [
	[
		'decideAppeal',
		() =>
			remote.decideAppeal({
				flagId: 'f1',
				restoreContent: true,
				restoreStanding: true,
				notes: 'x'
			})
	],
	['reopenAppeal', () => remote.reopenAppeal({ flagId: 'f1' })]
];

describe('anonymous callers', () => {
	it.each([
		...staffCases,
		[
			'fileAppeal',
			() => remote.fileAppeal({ kind: 'suggestion', targetId: 's1', body: 'Unfair' }, issue)
		] as [string, () => Promise<unknown>],
		['getMyAppeal', () => remote.getMyAppeal({ kind: 'suggestion', suggestionId: 's1' })] as [
			string,
			() => Promise<unknown>
		]
	])('%s rejects before touching the service', async (_name, call) => {
		await expect(call()).rejects.toThrow(/401/);
		for (const spy of Object.values(svc)) expect(spy).not.toHaveBeenCalled();
	});
});

describe('members', () => {
	beforeEach(() => {
		currentUser = { id: 'member-1', name: 'Ada', email: 'ada@example.com' };
	});

	it.each(staffCases)('%s rejects a non-staff member', async (_name, call) => {
		await expect(call()).rejects.toThrow(/403/);
		for (const spy of Object.values(svc)) expect(spy).not.toHaveBeenCalled();
	});

	it('files as the signed-in member against what they are looking at', async () => {
		await remote.fileAppeal({ kind: 'standing', targetId: 'messaging', body: 'Unfair' }, issue);
		expect(svc.fileAppeal).toHaveBeenCalledWith({
			userId: 'member-1',
			userName: 'Ada',
			target: { kind: 'standing', scope: 'messaging' },
			body: 'Unfair'
		});
	});
});

describe('staff', () => {
	beforeEach(() => {
		currentUser = { id: 'staff-1', name: 'Sam', email: 'sam@example.com' };
		isStaff = true;
	});

	it('decides as the signed-in staffer, never one named in the request', async () => {
		await remote.decideAppeal({
			flagId: 'f1',
			restoreContent: false,
			restoreStanding: true,
			notes: 'First offense',
			staffId: 'someone-else'
		});
		expect(svc.decideAppeal).toHaveBeenCalledWith(
			expect.objectContaining({ flagId: 'f1', staffId: 'staff-1' })
		);
	});
});
