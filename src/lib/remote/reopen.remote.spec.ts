import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';
import { grantsCapability, positions, type Capability, type Position } from '$lib/config';

/**
 * Leaving a terminal state is an admin's act (#2259): each reopen form names its
 * admin-only capability, which the real position matrix withholds from staff.
 * The guard is faked from that matrix, so this pins both halves at once.
 */

vi.mock('$app/server', () => {
	const mark = <F>(fn: F, type: string) => Object.assign(fn as object, { __: { type } }) as F;
	const stub = () => ({ refresh: async () => undefined });
	return {
		getRequestEvent: () => ({ locals: { user: { id: 'usr-1' } }, url: new URL('http://x/') }),
		query: () => mark(stub, 'query'),
		form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) => {
			const fn = mark(async (raw: unknown) => handler(schema.parse(raw), {}), 'form');
			return Object.assign(fn, { for: () => fn });
		},
		command: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw)), 'command')
	};
});
vi.mock('$lib/server/db', () => ({ db: {}, getRowCount: () => 0 }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

let position: Position = 'staff';
const requireCapability = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/authorization', () => ({
	requireUser: () => ({ id: 'usr-1' }),
	can: async () => true,
	requireCapabilityOrOwner: async () => 'staff',
	requireCapability
}));

const services = vi.hoisted(() => ({
	reopenJob: vi.fn(async () => ({ workOrderId: 'wo-1', projectId: null, assetId: null })),
	reopenOrder: vi.fn(async () => ({})),
	reopenAsset: vi.fn(async () => ({}))
}));
vi.mock('$lib/server/contractor/contractor-job-service', async (original) => ({
	...(await original<object>()),
	reopenJob: services.reopenJob
}));
vi.mock('$lib/server/inventory/order-service', async (original) => ({
	...(await original<object>()),
	reopenOrder: services.reopenOrder
}));
vi.mock('$lib/server/inventory/asset-service', async (original) => ({
	...(await original<object>()),
	reopenAsset: services.reopenAsset
}));

type Submit = (raw: unknown) => Promise<unknown>;
const contractors = (await import('./contractors.remote')) as unknown as Record<string, Submit>;
const inventory = (await import('./inventory.remote')) as unknown as Record<string, Submit>;

const JOB = '00000000-0000-4000-8000-000000000001';
const FORMS = [
	{
		name: 'reopenJobForm',
		submit: (raw: unknown) => contractors.reopenJobForm(raw),
		capability: 'contractor.reopen',
		id: JOB,
		service: services.reopenJob
	},
	{
		name: 'reopenOrderForm',
		submit: (raw: unknown) => inventory.reopenOrderForm(raw),
		capability: 'inventory.reopen',
		id: 'po-1',
		service: services.reopenOrder
	},
	{
		name: 'reopenAssetForm',
		submit: (raw: unknown) => inventory.reopenAssetForm(raw),
		capability: 'inventory.reopen',
		id: 'asset-1',
		service: services.reopenAsset
	}
] as const;

beforeEach(() => {
	vi.clearAllMocks();
	requireCapability.mockImplementation(async (cap: Capability) => {
		if (!grantsCapability(positions[position], cap)) {
			throw Object.assign(new Error('403: Not permitted'), { status: 403 });
		}
		return { id: `${position}-1` };
	});
});

describe.each(FORMS)('$name', ({ submit, capability, id, service }) => {
	it('is refused to staff before the service is reached', async () => {
		position = 'staff';
		await expect(submit({ id, reason: 'Mis-click' })).rejects.toMatchObject({ status: 403 });
		expect(requireCapability).toHaveBeenCalledWith(capability);
		expect(service).not.toHaveBeenCalled();
	});

	it('reaches the service for an admin, with the reason', async () => {
		position = 'admin';
		await submit({ id, reason: 'Mis-click' });
		expect(requireCapability).toHaveBeenCalledWith(capability);
		expect(service).toHaveBeenCalledWith(
			id,
			'Mis-click',
			...(service === services.reopenAsset ? ['admin-1'] : [])
		);
	});

	it('refuses a blank reason', async () => {
		position = 'admin';
		await expect(submit({ id, reason: '   ' })).rejects.toThrow();
		expect(service).not.toHaveBeenCalled();
	});
});
