import { describe, it, expect, vi, beforeEach } from 'vitest';
import { error } from '@sveltejs/kit';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
//
// The service read, the guard and the private bucket. Everything this handler
// does is order and headers, so all three are stubs and the assertions are
// about which ran, with what, and in what sequence.

type Listing = { id: string; posterKey: string | null; status: string };

const WITHHELD = 'events/posters/withheld/evt-1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg';

let listing: Listing | null = null;

const getById = vi.fn(async (_id: string) => listing);
vi.mock('$lib/server/event/event-service', () => ({
	getById: (id: string) => getById(id)
}));

const requireCapability = vi.fn(async (_cap: string) => ({ id: 'staff-1' }));
vi.mock('$lib/server/authorization', () => ({
	requireCapability: (cap: string) => requireCapability(cap)
}));

/** A stand-in for an `R2ObjectBody`. `arrayBuffer` is present so its absence can be asserted. */
const body = new ReadableStream();
const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
let storedObject: unknown = { body, size: 4096, arrayBuffer };

const getPrivateObject = vi.fn(async (_key: string) => storedObject);
vi.mock('$lib/server/private-storage', () => ({
	getPrivateObject: (key: string) => getPrivateObject(key)
}));

const { GET } = await import('./+server');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function row(over: Partial<Listing> = {}): Listing {
	return { id: 'evt-1', posterKey: WITHHELD, status: 'draft', ...over };
}

function get(id = 'evt-1') {
	return GET({ params: { id } } as never);
}

beforeEach(() => {
	vi.clearAllMocks();
	listing = row();
	storedObject = { body, size: 4096, arrayBuffer };
	requireCapability.mockImplementation(async () => ({ id: 'staff-1' }));
});

// ---------------------------------------------------------------------------

describe('GET /api/events/[id]/withheld-poster', () => {
	/**
	 * The capability the flag queue already guards with. It takes no resource, so
	 * this is deliberately not per-listing: any holder can view any withheld
	 * poster. This is the test that fails the day somebody swaps it for a weaker
	 * one, or drops the guard for a "staff-only page anyway".
	 */
	it('lets in a moderation reviewer, and asks for exactly that capability', async () => {
		const response = await get();

		expect(requireCapability).toHaveBeenCalledWith('moderation.reviewFlags');
		expect(response.status).toBe(200);
	});

	it('refuses a caller without the capability', async () => {
		requireCapability.mockImplementation(async () => error(403, 'Not permitted'));

		await expect(get()).rejects.toMatchObject({ status: 403 });
		expect(getPrivateObject).not.toHaveBeenCalled();
	});

	it('passes an unauthenticated caller the guard 401 through', async () => {
		requireCapability.mockImplementation(async () => error(401, 'Not authenticated'));

		await expect(get()).rejects.toMatchObject({ status: 401 });
	});

	/**
	 * The key comes from the row and there is nothing in the request that could
	 * name a different one. A `?key=` here would be a read primitive over the
	 * whole private bucket, which also holds group documents and invoices.
	 */
	it('reads the key off the stored row, never off the request', async () => {
		listing = row({ posterKey: WITHHELD });

		await get('evt-1');

		expect(getPrivateObject).toHaveBeenCalledWith(WITHHELD);
	});

	/**
	 * Before the guard, deliberately, matching `api/files/[id=uuid]`. A listing
	 * that was never taken down must be indistinguishable from one that does not
	 * exist to a caller who has not been authorized for anything yet.
	 */
	it('404s a listing that was never taken down without asking the guard', async () => {
		listing = row({ posterKey: 'events/posters/evt-1.jpg' });

		await expect(get()).rejects.toMatchObject({ status: 404 });
		expect(requireCapability).not.toHaveBeenCalled();
	});

	it('404s an event that does not exist without asking the guard', async () => {
		listing = null;

		await expect(get()).rejects.toMatchObject({ status: 404 });
		expect(requireCapability).not.toHaveBeenCalled();
	});

	it('404s a listing with no poster at all', async () => {
		listing = row({ posterKey: null });

		await expect(get()).rejects.toMatchObject({ status: 404 });
	});

	it('404s a live row whose object is gone', async () => {
		// A copy that failed after the re-point, or the sweep mid-flight.
		// Ordinary, not a fault — a 500 here would page somebody for nothing.
		storedObject = null;

		await expect(get()).rejects.toMatchObject({ status: 404 });
	});

	// ---- the response ------------------------------------------------------

	it('streams the object rather than buffering it', async () => {
		const response = await get();

		expect(response.body).toBe(body);
		expect(arrayBuffer).not.toHaveBeenCalled();
	});

	it('is uncacheable at the edge and varies on the cookie', async () => {
		const response = await get();

		// Without both, Cloudflare can serve one reviewer's authorized response to
		// the next requester — putting the bytes back in public circulation.
		expect(response.headers.get('Cache-Control')).toBe('private, no-store');
		expect(response.headers.get('Vary')).toBe('Cookie');
	});

	it('types the response from the key extension and forbids sniffing', async () => {
		const response = await get();

		expect(response.headers.get('Content-Type')).toBe('image/jpeg');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
	});

	it('refuses to guess a type it does not recognise', async () => {
		listing = row({ posterKey: 'events/posters/withheld/evt-1-x.bin' });

		const response = await get();

		expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
	});
});
