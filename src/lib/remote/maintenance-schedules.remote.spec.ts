import { describe, it, expect, vi, beforeEach } from 'vitest';

// #1423: recurring work and work orders link to one inventory unit. The picker's
// search is guarded like the forms it serves, since a volunteer coordinator
// holds `volunteer.manageShifts` but not `inventory.read`.

let allowed = true;
const requireCapability = vi.fn(async (cap: string) => {
	if (!allowed) throw new Error(`403: ${cap}`);
	return { id: 'staff-1' };
});
vi.mock('$lib/server/authorization', () => ({ requireCapability }));

const createService = vi.fn(async () => ({ id: 'ms-1' }));
vi.mock('$lib/server/volunteer/maintenance-schedule-service', () => ({
	createMaintenanceSchedule: createService,
	listMaintenanceSchedules: vi.fn(async () => []),
	retireMaintenanceSchedule: vi.fn()
}));

const searchAssetOptions = vi.fn(async () => [{ id: 'as-1', name: 'PA speaker', detail: null }]);
vi.mock('$lib/server/inventory/asset-service', () => ({ searchAssetOptions }));

vi.mock('$lib/server/volunteer/volunteer-role-service', () => ({ listVolunteerRoles: vi.fn() }));
vi.mock('$lib/server/project/project-service', () => ({ listProjects: vi.fn() }));
vi.mock('./volunteer.remote', () => ({
	getVolunteerWorklist: () => ({ refresh: async () => undefined })
}));

vi.mock('$app/server', () => {
	// The last argument is the handler, called directly; `__` is what SvelteKit
	// checks to accept the export as a remote function.
	const tag = (args: unknown[], type: string) => {
		const handler = args[args.length - 1] as ((...a: unknown[]) => unknown) &
			Record<string, unknown>;
		// A query call is lazy, like the real one: `.refresh()` must not run it.
		const call = (...a: unknown[]) =>
			type === 'query'
				? {
						then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
							Promise.resolve()
								.then(() => handler(...a))
								.then(res, rej),
						refresh: async () => undefined
					}
				: handler(...a);
		return Object.assign(call, { __: { type } });
	};
	return {
		query: (...a: unknown[]) => tag(a, 'query'),
		form: (...a: unknown[]) => tag(a, 'form'),
		command: (...a: unknown[]) => tag(a, 'command')
	};
});

const remote = await import('./maintenance-schedules.remote');
// The mock above makes a form a plain function; its declared type has no call signature.
const createRecurringWork = remote.createRecurringWork as unknown as (
	d: unknown
) => Promise<unknown>;

beforeEach(() => {
	allowed = true;
	vi.clearAllMocks();
});

describe('searchWorkAssets', () => {
	it('refuses a caller who cannot manage shifts, before searching', async () => {
		allowed = false;
		await expect(remote.searchWorkAssets('pa')).rejects.toThrow(/403/);
		expect(requireCapability).toHaveBeenCalledWith('volunteer.manageShifts');
		expect(searchAssetOptions).not.toHaveBeenCalled();
	});

	it('returns the matching units', async () => {
		expect(await remote.searchWorkAssets('pa')).toEqual([
			{ id: 'as-1', name: 'PA speaker', detail: null }
		]);
	});
});

describe('createRecurringWork', () => {
	const base = {
		name: 'Quarterly PA check',
		volunteerRoleId: 'role-1',
		intervalDays: '91',
		firstDueOn: '2026-10-01'
	};

	it('passes the picked asset to the schedule', async () => {
		await createRecurringWork({ ...base, assetId: 'as-1' });
		expect(createService).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'as-1' }));
	});

	it('passes no asset when the picker was left empty', async () => {
		await createRecurringWork({ ...base, assetId: '' });
		expect(createService).toHaveBeenCalledWith(expect.objectContaining({ assetId: null }));
	});
});
