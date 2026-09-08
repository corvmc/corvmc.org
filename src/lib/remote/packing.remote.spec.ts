import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

/**
 * Guard tests for the packing-list remote functions.
 *
 * These pin the shape the whole feature's safety rests on: the member-facing
 * writes take no owner and no assignee, so the guard's user is the only thing
 * that can reach the service. Spec: docs/specs/shipped/packing-list-spec.md
 */

class FakeAlreadyClaimed extends Error {
	readonly httpStatus = 422;
}

const serviceMock = {
	getPackingList: vi.fn(async () => ({ id: 'list-1', items: [], itemCount: 0 })),
	saveOwnItems: vi.fn(async () => undefined),
	saveItemsFor: vi.fn(async () => undefined),
	savePackingSettings: vi.fn(async () => undefined),
	claimItem: vi.fn(async () => undefined),
	releaseItem: vi.fn(async () => undefined),
	assignItem: vi.fn(async () => undefined),
	setPacked: vi.fn(async () => undefined),
	resetPacked: vi.fn(async () => ({ cleared: 3 })),
	promoteOwnItems: vi.fn(async () => ({ promoted: 1, added: 1 })),
	PackingAlreadyClaimedError: FakeAlreadyClaimed
};
vi.mock('$lib/server/band/packing-service', () => serviceMock);

const testUser = mockUser({ id: 'user-member', name: 'Sam' });
const band = { id: 'band-1', name: 'The Voltage Thieves', slug: 'the-voltage-thieves' };

/**
 * The guard, recorded rather than reimplemented. Each test asserts the *minimum
 * role asked for*, which is the thing a later edit could silently loosen.
 */
const requireGroupRole = vi.fn(async () => ({ user: testUser, group: band, role: 'member' }));
vi.mock('$lib/server/group/group-context', () => ({
	get requireGroupRole() {
		return requireGroupRole;
	}
}));

vi.mock('$lib/server/band/band-service', () => ({ getMembers: vi.fn(async () => []) }));
vi.mock('$lib/server/errors', () => ({
	mapDomainError: (err: unknown) => {
		throw err;
	}
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: testUser },
		params: { slug: 'the-voltage-thieves' },
		request: { headers: new Headers() }
	}),
	// SvelteKit validates that every export of a .remote.ts file is a remote
	// function, so the stubs carry the same marker the real ones do.
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'form' };
		(handler as any).for = () => handler;
		return handler;
	},
	// A real query call returns a thenable carrying `.refresh()`, and every write
	// below refreshes the page query — so the stub has to hand back the same
	// shape rather than the handler's bare result.
	query: (...args: unknown[]) => {
		const fn = (typeof args[0] === 'function' ? args[0] : args[1]) as (...a: unknown[]) => unknown;
		const handler = (...a: unknown[]) => {
			const p = Promise.resolve(fn(...a)) as Promise<unknown> & { refresh: () => Promise<void> };
			p.refresh = async () => undefined;
			return p;
		};
		(handler as any).__ = { type: 'query' };
		return handler;
	}
}));

beforeEach(() => {
	vi.clearAllMocks();
	requireGroupRole.mockResolvedValue({ user: testUser, group: band, role: 'member' });
});

// Dynamic so it resolves after the mocks, at module scope so the cold transform
// is paid during file evaluation rather than inside a test's 5s budget.
const mod = await import('./packing.remote');
const call = (fn: unknown, data: unknown) => (fn as (d: unknown) => Promise<any>)(data);

describe('savePackingItems', () => {
	it('writes the guard user as the owner, with no owner in the payload', async () => {
		await call(mod.savePackingItems, {
			bandId: 'band-1',
			items: JSON.stringify([{ category: 'backline', label: 'Bass rig' }])
		});

		expect(serviceMock.saveOwnItems).toHaveBeenCalledWith('band-1', 'user-member', [
			{ category: 'backline', label: 'Bass rig' }
		]);
	});

	it('is guarded at member, not admin — a member owns their own crate', async () => {
		await call(mod.savePackingItems, { bandId: 'band-1', items: '[]' });
		expect(requireGroupRole).toHaveBeenCalledWith({ id: 'band-1' }, 'member');
	});

	it('answers malformed JSON without touching the service', async () => {
		const result = await call(mod.savePackingItems, { bandId: 'band-1', items: 'not json' });
		expect(result).toMatchObject({ success: false });
		expect(serviceMock.saveOwnItems).not.toHaveBeenCalled();
	});
});

describe('savePackingItemsFor', () => {
	it('is guarded at admin', async () => {
		await call(mod.savePackingItemsFor, {
			bandId: 'band-1',
			targetUserId: 'user-other',
			items: '[]'
		});
		expect(requireGroupRole).toHaveBeenCalledWith({ id: 'band-1' }, 'admin');
	});

	it('treats an empty target as the band shared crate', async () => {
		await call(mod.savePackingItemsFor, { bandId: 'band-1', targetUserId: '', items: '[]' });
		expect(serviceMock.saveItemsFor).toHaveBeenCalledWith('band-1', null, []);
	});
});

describe('claimPackingItem', () => {
	it('claims for the guard user and passes no assignee', async () => {
		await call(mod.claimPackingItem, { bandId: 'band-1', itemId: 'item-1' });
		expect(serviceMock.claimItem).toHaveBeenCalledWith('band-1', 'user-member', 'item-1');
	});

	it('reports a lost race as a message, not as a thrown 422', async () => {
		serviceMock.claimItem.mockRejectedValueOnce(
			new FakeAlreadyClaimed('Somebody else is already bringing that.')
		);

		const result = await call(mod.claimPackingItem, { bandId: 'band-1', itemId: 'item-1' });

		expect(result).toEqual({
			success: false,
			message: 'Somebody else is already bringing that.'
		});
	});
});

describe('assignPackingItem', () => {
	it('is the admin path, and unassigns on an empty target', async () => {
		await call(mod.assignPackingItem, { bandId: 'band-1', itemId: 'item-1', toUserId: '' });
		expect(requireGroupRole).toHaveBeenCalledWith({ id: 'band-1' }, 'admin');
		expect(serviceMock.assignItem).toHaveBeenCalledWith('band-1', 'user-member', 'item-1', null);
	});
});

describe('setPackingItemPacked', () => {
	it('lets any roster member tick any row', async () => {
		await call(mod.setPackingItemPacked, { bandId: 'band-1', itemId: 'item-1', packed: '1' });
		expect(requireGroupRole).toHaveBeenCalledWith({ id: 'band-1' }, 'member');
		expect(serviceMock.setPacked).toHaveBeenCalledWith('band-1', 'user-member', 'item-1', true);
	});

	it("maps '0' to unticking", async () => {
		await call(mod.setPackingItemPacked, { bandId: 'band-1', itemId: 'item-1', packed: '0' });
		expect(serviceMock.setPacked).toHaveBeenCalledWith('band-1', 'user-member', 'item-1', false);
	});
});

describe('resetPackingList', () => {
	it('is a roster verb, like ticking, and reports what it cleared', async () => {
		const result = await call(mod.resetPackingList, { bandId: 'band-1' });
		expect(requireGroupRole).toHaveBeenCalledWith({ id: 'band-1' }, 'member');
		expect(result).toMatchObject({ success: true, cleared: 3 });
	});
});

describe('promotePackingItems', () => {
	it('promotes for the guard user and passes no owner', async () => {
		await call(mod.promotePackingItems, { bandId: 'band-1', itemIds: 'item-1,item-2' });

		// No owner in the payload and none in the call. The service scopes by
		// `(listId, userId)`, so this is what stops a forged id promoting
		// somebody else's gear onto the rider under their name.
		expect(serviceMock.promoteOwnItems).toHaveBeenCalledWith('band-1', 'user-member', [
			'item-1',
			'item-2'
		]);
	});

	it('is guarded at member — promoting is an own-rows verb', async () => {
		await call(mod.promotePackingItems, { bandId: 'band-1', itemIds: 'item-1' });
		expect(requireGroupRole).toHaveBeenCalledWith({ id: 'band-1' }, 'member');
	});

	it('reports how many elements the rider actually gained', async () => {
		const result = await call(mod.promotePackingItems, { bandId: 'band-1', itemIds: 'item-1' });
		expect(result).toMatchObject({ success: true, added: 1 });
	});
});
