import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type Capability, type Position } from '$lib/config';

/** The access dashboard shows and changes who may do what, so every remote is admin-only. */

let currentUser: { id: string } | null = { id: 'u-admin' };
let heldPositions: Position[] = ['admin'];

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

const service = {
	getAccessSummary: vi.fn(async () => ({ admins: 1, staff: 0, positionsHeld: 1, lapsingSoon: 0 })),
	getPersonAccess: vi.fn(async (_id: string) => ({})),
	listCapabilityHolders: vi.fn(async (_cap: string) => ({
		holders: [],
		committees: [],
		roles: []
	})),
	listClearanceHolders: vi.fn(async (_id: string) => []),
	listHoldersOfPosition: vi.fn(async (_p: string) => [])
};
vi.mock('$lib/server/access/access-service', () => service);
const setPositionService = vi.fn(async (_input: unknown) => ({ added: ['staff'], removed: [] }));
vi.mock('$lib/server/access/position-service', () => ({
	setPosition: (input: unknown) => setPositionService(input)
}));
vi.mock('$lib/server/volunteer/volunteer-certification-service', () => ({
	listCertifications: vi.fn(async () => [])
}));
const dbSelect = vi.fn();
vi.mock('$lib/server/db', () => ({ db: { select: dbSelect } }));

vi.mock('$app/server', () => {
	const mark = <T extends object>(fn: T, type: string) => Object.assign(fn, { __: { type } });
	return {
		query: (...args: unknown[]) => {
			const handler = args.pop() as (v: unknown) => unknown;
			const schema = args[0] as { parse: (v: unknown) => unknown } | undefined;
			const call = (v: unknown) =>
				Object.assign(
					Promise.resolve().then(() => handler(schema ? schema.parse(v) : v)),
					{
						refresh: () => undefined
					}
				);
			return mark(call, 'query');
		},
		form: (schema: { parse: (v: unknown) => unknown }, handler: (v: unknown) => unknown) =>
			mark(async (v: unknown) => handler(schema.parse(v)), 'form')
	};
});

const remote = await import('./access.remote');

beforeEach(() => {
	vi.clearAllMocks();
	currentUser = { id: 'u-admin' };
	heldPositions = ['admin'];
});

const reads: [string, () => Promise<unknown>][] = [
	['getAccessPage', () => remote.getAccessPage()],
	['searchAccessPeople', () => remote.searchAccessPeople('ad')],
	['getPersonAccessView', () => remote.getPersonAccessView('u-1')],
	['getAccessHolders', () => remote.getAccessHolders({ kind: 'position', key: 'admin' })],
	[
		'setPosition',
		() =>
			(remote.setPosition as unknown as (v: unknown) => Promise<unknown>)({
				userId: 'u-1',
				position: 'staff',
				change: 'add'
			})
	]
];

describe('access.remote guards', () => {
	for (const [name, call] of reads) {
		it(`${name} refuses a signed-out caller and staff, before any read`, async () => {
			currentUser = null;
			await expect(call()).rejects.toThrow(/401/);
			currentUser = { id: 'u-staff' };
			heldPositions = ['staff', 'volunteer_coordinator'];
			await expect(call()).rejects.toThrow(/user\.setRole/);
			expect(dbSelect).not.toHaveBeenCalled();
			expect(setPositionService).not.toHaveBeenCalled();
			for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
		});
	}

	it('setPosition acts as the signed-in admin, not a caller-supplied actor', async () => {
		await (remote.setPosition as unknown as (v: unknown) => Promise<unknown>)({
			userId: 'u-1',
			position: 'treasurer',
			change: 'remove',
			actorId: 'u-forged'
		});
		expect(setPositionService).toHaveBeenCalledWith({
			actorId: 'u-admin',
			targetId: 'u-1',
			position: 'treasurer',
			held: false
		});
	});

	it('getAccessHolders rejects a capability the matrix does not name', async () => {
		await expect(
			remote.getAccessHolders({ kind: 'capability', key: 'user.everything' as never })
		).rejects.toThrow();
	});
});
