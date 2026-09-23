import { describe, it, expect, vi, beforeEach } from 'vitest';
import { positionOrder, type Capability, type Position } from '$lib/config';

/**
 * Which bucket each slot lands in.
 *
 * A manual and a photo of a dented amp are public and harmless. A receipt is a
 * till slip with card digits, a name and an address, and was served off
 * media.corvmc.org to anyone holding the URL. This pins the split.
 */

const uploadFile = vi.fn(async () => undefined);
vi.mock('$lib/server/storage', () => ({
	uploadFile: (...a: unknown[]) => uploadFile(...(a as []))
}));

const putPrivateObject = vi.fn(
	async (_key: string, _body: ArrayBuffer, _type: string) => undefined
);
vi.mock('$lib/server/private-storage', () => ({
	putPrivateObject: (...a: unknown[]) =>
		putPrivateObject(...(a as Parameters<typeof putPrivateObject>))
}));

const record = vi.fn(async () => ({ id: 'media-1' }));
const attach = vi.fn(async () => undefined);
vi.mock('$lib/server/media/media-service', () => ({
	record: (...a: unknown[]) => record(...(a as [])),
	attach: (...a: unknown[]) => attach(...(a as []))
}));

// Simulated against the real matrix, so the tables below exercise what the
// positions actually grant.
let heldPositions: Position[] = ['staff'];
const requested: string[] = [];
vi.mock('$lib/server/authorization', async () => {
	const { error } = await import('@sveltejs/kit');
	const config = await import('$lib/config');
	const holds = (cap: Capability) =>
		heldPositions.some((p) => config.grantsCapability(config.positions[p], cap));
	return {
		can: async (cap: Capability) => holds(cap),
		requireCapability: async (cap: Capability) => {
			requested.push(cap);
			if (!holds(cap)) throw error(403, 'Not permitted');
			return { id: 'staff-1' };
		}
	};
});

const { POST } = await import('./+server');

// Every combination of the six positions, including none.
const subsets = Array.from({ length: 2 ** positionOrder.length }, (_, mask) =>
	positionOrder.filter((_, i) => mask & (1 << i))
);

function call(slot: string, type = 'image/jpeg') {
	const form = new FormData();
	form.set('file', new File([new Uint8Array([1, 2, 3])], 'thing.jpg', { type }));
	form.set('slot', slot);
	form.set('attachableId', 'acq-1');
	return (POST as unknown as (e: unknown) => Promise<Response>)({
		request: new Request('http://x/', { method: 'POST', body: form }),
		locals: { user: { id: 'user-1' } }
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	heldPositions = ['staff'];
});

describe('inventory media upload', () => {
	it('puts a receipt in the private bucket and never the public one', async () => {
		await call('receipt');

		expect(putPrivateObject).toHaveBeenCalledOnce();
		expect(uploadFile).not.toHaveBeenCalled();
		// The prefix is what the read route checks before reaching for private.
		expect(putPrivateObject.mock.calls[0][0]).toMatch(/^inventory\/receipts\//);
	});

	it('still puts a manual in the public bucket', async () => {
		await call('manual');

		expect(uploadFile).toHaveBeenCalledOnce();
		expect(putPrivateObject).not.toHaveBeenCalled();
	});

	it('records the attachment identically either way', async () => {
		await call('receipt');

		expect(attach).toHaveBeenCalledWith(
			expect.objectContaining({ attachableType: 'acquisition', slot: 'receipt' })
		);
	});

	it('refuses a receipt from a caller without manageAcquisitions', async () => {
		heldPositions = ['site_moderator'];
		await expect(call('receipt')).rejects.toMatchObject({ status: 403 });
		expect(putPrivateObject).not.toHaveBeenCalled();
	});

	it('refuses a manual from a treasurer, who can file receipts but not items', async () => {
		heldPositions = ['treasurer'];
		await expect(call('manual')).rejects.toMatchObject({ status: 403 });
		expect(uploadFile).not.toHaveBeenCalled();
		await call('receipt');
		expect(putPrivateObject).toHaveBeenCalledOnce();
	});

	it('takes damage photos from anyone signed in, position or not', async () => {
		heldPositions = [];
		await call('damage');
		expect(uploadFile).toHaveBeenCalledOnce();
	});

	// Before: any position passed both slots. After: a manual needs
	// `inventory.manageItems` (admin, staff) and a receipt
	// `inventory.manageAcquisitions` (admin, staff, treasurer).
	it("admits exactly the holders of each slot's capability", async () => {
		for (const held of subsets) {
			heldPositions = held;
			const label = held.join('+') || '(none)';
			const allowed = (slot: string) =>
				call(slot).then(
					() => true,
					() => false
				);
			const items = held.some((p) => ['admin', 'staff'].includes(p));
			const acquisitions = items || held.includes('treasurer');
			expect(await allowed('manual'), `${label} manual`).toBe(items);
			expect(await allowed('receipt'), `${label} receipt`).toBe(acquisitions);
		}
	});
});
