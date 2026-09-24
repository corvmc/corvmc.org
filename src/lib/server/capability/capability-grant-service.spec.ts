import { describe, it, expect, vi, beforeEach } from 'vitest';

let selectResults: unknown[][] = [];
const updates: unknown[] = [];

function chainable(onSet?: (v: unknown) => void) {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(selectResults.shift() ?? []);
			}
			if (prop === 'set' && onSet) {
				return (v: unknown) => {
					onSet(v);
					return proxy;
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chainable()),
		update: vi.fn(() => chainable((v) => updates.push(v)))
	}
}));

const recordAuditEntry = vi.fn();
vi.mock('$lib/server/audit/audit-service', () => ({ recordAuditEntry }));
let editorHolds = true;
vi.mock('$lib/server/authorization', () => ({ positionsGrant: vi.fn(async () => editorHolds) }));
const editor = { editorId: 'staff-1' };

const {
	validateGrants,
	setRoleCapabilityGrants,
	setCommitteeCapabilityGrants,
	UngrantableCapabilityError,
	GrantCarrierNotFoundError,
	GrantBeyondEditorError
} = await import('./capability-grant-service');

beforeEach(() => {
	vi.clearAllMocks();
	selectResults = [];
	updates.length = 0;
	editorHolds = true;
});

describe('validateGrants', () => {
	it('refuses a capability outside the allowlist', () => {
		expect(() => validateGrants(['finance.refund'], 'committee')).toThrow(
			UngrantableCapabilityError
		);
		expect(() => validateGrants(['user.ban'], 'role')).toThrow(UngrantableCapabilityError);
	});

	it('refuses an allowlisted capability the carrier may not hold', () => {
		expect(() => validateGrants(['sponsor.manage'], 'role')).toThrow(UngrantableCapabilityError);
		expect(() => validateGrants(['event.uploadRecap'], 'committee')).toThrow(
			UngrantableCapabilityError
		);
	});

	it('refuses a string that is not a capability at all', () => {
		expect(() => validateGrants(['toString'], 'role')).toThrow(UngrantableCapabilityError);
	});

	it('de-duplicates and sorts what it accepts, and accepts an empty list', () => {
		expect(validateGrants(['sponsor.manage', 'grant.read', 'sponsor.manage'], 'committee')).toEqual(
			['grant.read', 'sponsor.manage']
		);
		expect(validateGrants([], 'role')).toEqual([]);
	});
});

describe('setRoleCapabilityGrants', () => {
	it('writes the list and audits what changed', async () => {
		selectResults = [[{ name: 'Photos or Video', grants: [] }]];
		const change = await setRoleCapabilityGrants('role-1', ['event.uploadRecap'], editor);

		expect(change).toEqual({ added: ['event.uploadRecap'], removed: [] });
		expect(updates[0]).toMatchObject({ capabilityGrants: ['event.uploadRecap'] });
		expect(recordAuditEntry).toHaveBeenCalledWith({
			action: 'capability.grants_changed',
			subject: { type: 'role', id: 'role-1', label: 'Photos or Video' },
			details: { added: ['event.uploadRecap'], removed: [] }
		});
	});

	it('does not audit a save that changed nothing', async () => {
		selectResults = [[{ name: 'Door', grants: ['event.uploadRecap'] }]];
		await setRoleCapabilityGrants('role-1', ['event.uploadRecap'], editor);
		expect(recordAuditEntry).not.toHaveBeenCalled();
	});

	it('refuses before reading anything when a capability is off the list', async () => {
		await expect(setRoleCapabilityGrants('role-1', ['user.purge'], editor)).rejects.toBeInstanceOf(
			UngrantableCapabilityError
		);
		expect(updates).toHaveLength(0);
	});

	it('refuses to add a capability the editor does not hold, writing nothing', async () => {
		editorHolds = false;
		selectResults = [[{ name: 'Door', grants: [] }]];
		await expect(
			setRoleCapabilityGrants('role-1', ['event.uploadRecap'], editor)
		).rejects.toBeInstanceOf(GrantBeyondEditorError);
		expect(updates).toHaveLength(0);
	});

	it('lets an editor remove a grant they do not hold', async () => {
		editorHolds = false;
		selectResults = [[{ name: 'Door', grants: ['event.uploadRecap'] }]];
		await expect(setRoleCapabilityGrants('role-1', [], editor)).resolves.toEqual({
			added: [],
			removed: ['event.uploadRecap']
		});
	});

	it('404s for a missing role', async () => {
		selectResults = [[]];
		await expect(setRoleCapabilityGrants('nope', [], editor)).rejects.toBeInstanceOf(
			GrantCarrierNotFoundError
		);
	});
});

describe('setCommitteeCapabilityGrants', () => {
	it('writes the list and audits removals as well as additions', async () => {
		selectResults = [[{ name: 'Development', kind: 'committee', grants: ['grant.read'] }]];
		const change = await setCommitteeCapabilityGrants('dev', ['sponsor.manage']);

		expect(change).toEqual({ added: ['sponsor.manage'], removed: ['grant.read'] });
		expect(recordAuditEntry).toHaveBeenCalledWith(
			expect.objectContaining({ subject: { type: 'group', id: 'dev', label: 'Development' } })
		);
	});

	it('404s for a band or a club, which carry no grants', async () => {
		selectResults = [[{ name: 'The Band', kind: 'band', grants: [] }]];
		await expect(setCommitteeCapabilityGrants('b-1', ['sponsor.read'])).rejects.toBeInstanceOf(
			GrantCarrierNotFoundError
		);
		expect(updates).toHaveLength(0);
	});
});
