import { describe, it, expect, vi, beforeEach } from 'vitest';

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

let staff = true;
vi.mock('$lib/server/authorization', () => ({ isStaff: async () => staff }));

const { POST } = await import('./+server');

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
	staff = true;
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

	it('refuses a receipt from a non-staff caller', async () => {
		staff = false;
		await expect(call('receipt')).rejects.toMatchObject({ status: 403 });
		expect(putPrivateObject).not.toHaveBeenCalled();
	});
});
