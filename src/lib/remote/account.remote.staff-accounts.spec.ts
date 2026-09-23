import { describe, it, expect, vi, beforeEach } from 'vitest';
import { positionOrder, type Position } from '$lib/config';

// ---------------------------------------------------------------------------
// Regression #1395: "staff accounts cannot be self-deleted" asked
// `hasAnyRole(['admin', 'staff'])`, an exact name match, so an account holding
// only a named position (treasurer, site moderator, …) could delete itself and
// was offered the button. The authorization layer is simulated over a role
// table rather than stubbed per helper, so either predicate answers honestly.
// ---------------------------------------------------------------------------

const me = { id: 'user-1', email: 'me@example.com', name: 'Me' };
let heldRoles: string[] = [];

vi.mock('$lib/server/authorization', async () => {
	const config = await import('$lib/config');
	return {
		requireUser: () => me,
		hasAnyRole: vi.fn(async (_id: string, names: string[]) =>
			heldRoles.some((r) => names.includes(r))
		),
		isElevated: vi.fn(async () =>
			heldRoles.some((r) => (config.positionOrder as readonly string[]).includes(r))
		)
	};
});

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => {
			const c: Record<string, unknown> = {
				from: () => c,
				where: () => c,
				then: (resolve: (rows: unknown[]) => unknown) => resolve([{ id: me.id, email: me.email }])
			};
			return c;
		}
	}
}));

const signInEmail = vi.fn(async () => ({}));
vi.mock('$lib/server/auth', () => ({
	auth: { api: { signInEmail: (...a: unknown[]) => signInEmail(...(a as [])), signOut: vi.fn() } }
}));
const deactivateUser = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('$lib/server/user/user-service', () => ({
	deactivateUser: (...a: unknown[]) => deactivateUser(...a)
}));
vi.mock('$lib/server/marketing/audience-service', () => ({
	getSubscriptionsForUser: vi.fn(),
	getOptInAudiencesForUser: vi.fn(),
	addSubscriber: vi.fn(),
	unsubscribe: vi.fn()
}));
vi.mock('$lib/server/marketing/subscriber-service', () => ({}));
vi.mock('$lib/server/errors', () => ({
	mapDomainError: (err: unknown) => {
		throw err;
	}
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: me }, request: { headers: new Headers() } }),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		return Object.assign((...a: unknown[]) => Promise.resolve(handler(...a)), {
			__: { type: 'query' }
		});
	},
	form: (_schema: unknown, handler: (...a: unknown[]) => unknown) =>
		Object.assign((...a: unknown[]) => Promise.resolve(handler(...a)), { __: { type: 'form' } })
}));

const account = (await import('./account.remote')) as unknown as Record<
	string,
	(arg?: unknown) => Promise<unknown>
>;

beforeEach(() => {
	heldRoles = [];
	vi.clearAllMocks();
});

describe('self-deletion and position holders', () => {
	it('refuses a treasurer-only account, deactivating nothing', async () => {
		heldRoles = ['treasurer'];
		await expect(account.deleteAccount({ password: 'pw' })).rejects.toMatchObject({
			status: 403
		});
		expect(deactivateUser).not.toHaveBeenCalled();
	});

	it('still lets a member who holds no position delete their account', async () => {
		heldRoles = ['member'];
		await expect(account.deleteAccount({ password: 'pw' })).resolves.toEqual({ success: true });
		expect(deactivateUser).toHaveBeenCalledWith(me.id, { actor: 'member' });
	});

	// Every combination of positions, plus none: any position at all refuses the
	// self-service path, and the account page is told so it can hide the button.
	it.each(
		Array.from({ length: 2 ** positionOrder.length }, (_, mask) =>
			positionOrder.filter((_, i) => mask & (1 << i))
		).map((held) => [held.join('+') || '(none)', held] as const)
	)('%s: refused iff any position is held', async (_label, held: Position[]) => {
		heldRoles = ['member', ...held];
		const refused = await account.deleteAccount({ password: 'pw' }).then(
			() => false,
			(e: { status: number }) => e.status === 403
		);
		expect(refused).toBe(held.length > 0);
		const page = (await account.getMemberAccount()) as { isStaff: boolean };
		expect(page.isStaff).toBe(held.length > 0);
	});
});
