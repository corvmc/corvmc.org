import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reading a renewal document back: the guard runs first, the bytes come from
// the private bucket, and the object key never reaches the browser.

let held = new Set<string>();
const requireCapability = vi.fn(async (cap: string) => {
	if (!held.has(cap)) throw Object.assign(new Error(`403: ${cap}`), { status: 403 });
	return { id: 'staff-1' };
});
vi.mock('$lib/server/authorization', () => ({
	requireCapability: (cap: string) => requireCapability(cap)
}));

const getRenewalDocument = vi.fn(async (_id: string) => null as unknown);
vi.mock('$lib/server/renewal/renewal-service', () => ({
	getRenewalDocument: (id: string) => getRenewalDocument(id)
}));

const body = new ReadableStream();
const getPrivateObject = vi.fn(async (_key: string) => ({ body }) as unknown);
vi.mock('$lib/server/private-storage', () => ({
	getPrivateObject: (key: string) => getPrivateObject(key)
}));

const { GET } = await import('./documents/[id=uuid]/+server');

beforeEach(() => {
	vi.clearAllMocks();
	held = new Set();
});

describe('GET /api/renewals/documents/[id]', () => {
	it('refuses a caller without renewal.read before looking anything up', async () => {
		await expect(GET({ params: { id: 'att-1' } } as never)).rejects.toThrow('403');
		expect(getRenewalDocument).not.toHaveBeenCalled();
		expect(getPrivateObject).not.toHaveBeenCalled();
	});

	it('404s an attachment that is not a renewal document', async () => {
		held = new Set(['renewal.read']);
		await expect(GET({ params: { id: 'att-1' } } as never)).rejects.toMatchObject({
			status: 404
		});
	});

	it('streams the private object as a download that is never cached', async () => {
		held = new Set(['renewal.read']);
		getRenewalDocument.mockResolvedValueOnce({
			key: 'renewals/r1/abc.pdf',
			contentType: 'application/pdf',
			filename: 'cert.pdf'
		});
		const res = await GET({ params: { id: 'att-1' } } as never);
		expect(getPrivateObject).toHaveBeenCalledWith('renewals/r1/abc.pdf');
		expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="cert.pdf"');
		expect(res.headers.get('Cache-Control')).toBe('private, no-store');
	});
});
