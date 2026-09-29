import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

// Guards run first, and a reviewer's write is scoped to the group the guard
// resolved — never to anything the client says about the choice.

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: { id: 'user-1' } }, url: new URL('http://x/') }),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		return Object.assign(() => ({ refresh: async () => undefined, then: undefined }), {
			__: { type: 'query' },
			run: handler
		});
	},
	form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
		Object.assign(async (raw: unknown) => handler(schema.parse(raw), {}), { __: { type: 'form' } })
}));

const auth = vi.hoisted(() => ({
	requireUser: vi.fn(() => ({ id: 'user-1' })),
	requireCapability: vi.fn(async () => ({ id: 'user-1' })),
	can: vi.fn(async (_cap: string) => false)
}));
vi.mock('$lib/server/authorization', () => auth);

const guard = vi.hoisted(() => ({ requireApplicationReviewer: vi.fn() }));
vi.mock('$lib/server/group/group-context', () => guard);

const svc = vi.hoisted(() => ({
	acceptApplication: vi.fn(async () => undefined),
	declineApplication: vi.fn(async () => undefined),
	markContacted: vi.fn(async () => undefined),
	listCommittees: vi.fn(async () => []),
	listForApplicant: vi.fn(async () => []),
	submitApplication: vi.fn(async () => 'app-1'),
	withdrawApplication: vi.fn(async () => undefined)
}));
vi.mock('$lib/server/group/application-service', () => svc);

const refreshed = vi.hoisted(() => ({ member: vi.fn(), staff: vi.fn(), groups: vi.fn() }));
vi.mock('$lib/remote/groups.remote', () => ({
	getMemberGroup: () => ({ refresh: refreshed.member }),
	getStaffGroupPage: () => ({ refresh: refreshed.staff }),
	getStaffCommittees: () => ({ refresh: refreshed.staff }),
	getStaffCommitteePage: () => ({ refresh: refreshed.staff }),
	getMemberGroups: () => ({ refresh: refreshed.groups })
}));

// Cast: the mocked `form()` returns a plain function, not a `RemoteForm`.
const remote = (await import('./group-applications.remote')) as unknown as Record<
	string,
	(data: unknown) => Promise<unknown>
>;

const denied = () => Object.assign(new Error('Not a reviewer'), { status: 403 });

beforeEach(() => {
	vi.clearAllMocks();
	guard.requireApplicationReviewer.mockResolvedValue({
		user: { id: 'user-1' },
		group: { id: 'grp-guarded', slug: 'jazz-club' },
		role: 'owner'
	});
});

describe.each([
	['markApplicantContacted', () => svc.markContacted],
	['acceptGroupApplication', () => svc.acceptApplication],
	['declineGroupApplication', () => svc.declineApplication]
] as const)('%s', (name, write) => {
	const call = (data: Record<string, unknown>) => remote[name](data);

	it('guards on the slug before writing anything', async () => {
		guard.requireApplicationReviewer.mockRejectedValue(denied());
		await expect(call({ slug: 'jazz-club', choiceId: 'c-1' })).rejects.toMatchObject({
			status: 403
		});
		expect(guard.requireApplicationReviewer).toHaveBeenCalledWith({ slug: 'jazz-club' });
		expect(write()).not.toHaveBeenCalled();
	});

	it('scopes the choice to the group the guard resolved', async () => {
		await call({ slug: 'jazz-club', choiceId: 'c-1' });
		expect(write().mock.calls[0].slice(0, 3)).toEqual(['c-1', 'grp-guarded', 'user-1']);
	});

	it('refreshes only the views this caller may read', async () => {
		await call({ slug: 'jazz-club', choiceId: 'c-1' });
		expect(refreshed.member).toHaveBeenCalled();
		expect(refreshed.staff).not.toHaveBeenCalled();
	});
});

describe('applyToGroups', () => {
	it('requires a signed-in member before submitting', async () => {
		auth.requireUser.mockImplementationOnce(() => {
			throw Object.assign(new Error('Not authenticated'), { status: 401 });
		});
		await expect(remote.applyToGroups({ groupIds: ['g-1'] } as never)).rejects.toMatchObject({
			status: 401
		});
		expect(svc.submitApplication).not.toHaveBeenCalled();
	});

	it('passes only the answers given, and applies as the caller', async () => {
		await remote.applyToGroups({ groupIds: ['g-1'], note: 'Hi', experience: '' } as never);
		expect(svc.submitApplication).toHaveBeenCalledWith('user-1', {
			groupIds: ['g-1'],
			answers: { note: 'Hi' }
		});
	});
});

describe('withdrawGroupApplication', () => {
	it('withdraws as the caller, never as an id the client names', async () => {
		await remote.withdrawGroupApplication({ applicationId: 'app-1' } as never);
		expect(svc.withdrawApplication).toHaveBeenCalledWith('app-1', 'user-1');
	});
});
