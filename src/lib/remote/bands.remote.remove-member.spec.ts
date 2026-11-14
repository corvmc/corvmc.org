import { describe, it, expect, vi, beforeEach } from 'vitest';

// Staff removing someone from a band is audited (#2891): one row after the
// delete, carrying the names the deleted member row no longer can.

const requireCapability = vi.fn(async (_cap: string) => ({ id: 'staff-1' }));
vi.mock('#lib/server/authorization.js', () => ({
	requireCapability: (cap: string) => requireCapability(cap),
	requireUser: vi.fn(async () => ({ id: 'staff-1' }))
}));

const recordAuditEntry = vi.fn(async (_entry: unknown) => undefined);
vi.mock('#lib/server/audit/audit-service.js', () => ({ recordAuditEntry }));

class CannotRemoveOwnerError extends Error {}
const removeMember = vi.fn(async (_id: string) => undefined);
vi.mock('#lib/server/band/band-service.js', () => ({
	removeMember: (id: string) => removeMember(id),
	// `mapDomainError` builds its `instanceof` ladder from this module's exports.
	BandMemberExistsError: class BandMemberExistsError extends Error {},
	CannotRemoveOwnerError,
	OwnerCannotLeaveError: class OwnerCannotLeaveError extends Error {},
	BandNotFoundError: class BandNotFoundError extends Error {},
	BandTierManagedByStripeError: class BandTierManagedByStripeError extends Error {}
}));
vi.mock('#lib/server/group/group-invite-service.js', () => ({}));

let selectResult: unknown[] = [];
function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve(selectResult);
			return () => proxy;
		}
	});
	return proxy;
}
vi.mock('#lib/server/db/index.js', () => ({ db: { select: () => chainable() } }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: {}, request: { headers: new Headers() } }),
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'form' };
		(handler as any).for = () => handler;
		return handler;
	},
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (...a: any[]) => any;
		(handler as any).__ = { type: 'query' };
		return handler;
	},
	command: (handler: unknown) => handler
}));

const { removeBandMember } = (await import('./bands.remote')) as any;

beforeEach(() => {
	vi.clearAllMocks();
	selectResult = [
		{ bandId: 'band-1', bandName: 'Sour Cherry', userId: 'user-9', memberName: 'Jo Lark' }
	];
});

describe('removeBandMember', () => {
	it('records the removal after the member row is deleted', async () => {
		await removeBandMember({ memberId: 'member-9' });

		expect(recordAuditEntry).toHaveBeenCalledWith({
			action: 'band.member_removed',
			subject: { type: 'band', id: 'band-1', label: 'Sour Cherry' },
			details: { memberId: 'member-9', userId: 'user-9', memberName: 'Jo Lark' }
		});
		expect(recordAuditEntry.mock.invocationCallOrder[0]).toBeGreaterThan(
			removeMember.mock.invocationCallOrder[0]
		);
	});

	it('writes no row when the removal is refused', async () => {
		removeMember.mockRejectedValueOnce(new CannotRemoveOwnerError('owner'));

		await expect(removeBandMember({ memberId: 'member-9' })).rejects.toBeDefined();
		expect(recordAuditEntry).not.toHaveBeenCalled();
	});
});
