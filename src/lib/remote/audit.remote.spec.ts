import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type Capability, type Position } from '$lib/config';

/** The global log shows every staff action on every account, so its guard is the whole story. */

let currentUser: { id: string } | null = { id: 'u-staff' };
let heldPositions: Position[] = ['staff'];

vi.mock('$lib/server/authorization', async () => {
	const config = await import('$lib/config');
	const holds = (cap: Capability) =>
		heldPositions.some((p) => config.grantsCapability(config.positions[p], cap));
	return {
		requireCapability: async (cap: Capability) => {
			if (!currentUser) throw new Error('401: Not authenticated');
			if (!holds(cap)) throw new Error(`403: Not permitted (${cap})`);
			return currentUser;
		}
	};
});

const listAuditEntries = vi.fn(async (..._args: unknown[]) => ({
	rows: [],
	pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 }
}));
vi.mock('$lib/server/audit/audit-service', () => ({
	listAuditEntries: (...args: unknown[]) => listAuditEntries(...args)
}));

vi.mock('$app/server', () => ({
	query: (schema: { parse: (v: unknown) => unknown }, handler: (v: unknown) => unknown) => {
		const wrapped = async (v: unknown) => handler(schema.parse(v));
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'query' };
		return wrapped;
	}
}));

const { getAuditLog } = await import('./audit.remote');

beforeEach(() => {
	listAuditEntries.mockClear();
	currentUser = { id: 'u-staff' };
	heldPositions = ['staff'];
});

describe('getAuditLog', () => {
	it('rejects a signed-out caller and a member with no position', async () => {
		currentUser = null;
		await expect(getAuditLog({})).rejects.toThrow(/401/);
		currentUser = { id: 'u-1' };
		heldPositions = [];
		await expect(getAuditLog({})).rejects.toThrow(/403/);
		expect(listAuditEntries).not.toHaveBeenCalled();
	});

	it('guards on audit.read, which user.read alone does not grant', async () => {
		heldPositions = ['volunteer_coordinator'];
		await expect(getAuditLog({})).rejects.toThrow(/audit\.read/);
	});

	it('passes the filters through for a holder', async () => {
		heldPositions = ['admin'];
		await getAuditLog({
			action: 'user.purged',
			actor: 'sam',
			from: '2026-09-01',
			to: '2026-09-30',
			page: 2
		});
		expect(listAuditEntries).toHaveBeenCalledWith(
			{ action: 'user.purged', actor: 'sam', from: '2026-09-01', to: '2026-09-30' },
			{ page: 2, pageSize: 50 }
		);
	});

	it('refuses an action the log does not record, and a malformed date', async () => {
		await expect(getAuditLog({ action: 'user.nonsense' as never })).rejects.toThrow();
		await expect(getAuditLog({ from: 'yesterday' })).rejects.toThrow();
	});
});
