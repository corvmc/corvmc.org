import { describe, it, expect, vi, beforeEach } from 'vitest';
import { error } from '@sveltejs/kit';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
//
// The service read, the guard and the bucket. Everything this handler does is
// order and headers, so all three are stubs and the assertions are about which
// ran, with what, and in what sequence.

type DownloadRow = {
	id: string;
	groupId: string;
	key: string;
	filename: string;
	contentType: string;
	sizeBytes: number;
};

let downloadRow: DownloadRow | null = null;

const getForDownload = vi.fn(async (_id: string) => downloadRow);
vi.mock('$lib/server/group/file-service', () => ({
	getForDownload: (id: string) => getForDownload(id)
}));

type GroupRef = { id: string } | { slug: string };
const requireGroupRole = vi.fn(
	async (_ref: GroupRef, _minRole: string, _opts?: { allowStaff?: boolean }) => ({})
);
vi.mock('$lib/server/group/group-context', () => ({
	requireGroupRole: (ref: GroupRef, minRole: string, opts?: { allowStaff?: boolean }) =>
		requireGroupRole(ref, minRole, opts)
}));

/** A stand-in for an `R2ObjectBody`. `arrayBuffer` is present so its absence can be asserted. */
const body = new ReadableStream();
const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
let storedObject: unknown = { body, size: 2048, arrayBuffer };

const getPrivateObject = vi.fn(async (_key: string) => storedObject);
vi.mock('$lib/server/private-storage', () => ({
	getPrivateObject: (key: string) => getPrivateObject(key)
}));

const { GET } = await import('./+server');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function row(over: Partial<DownloadRow> = {}): DownloadRow {
	return {
		id: 'file-1',
		groupId: 'group-1',
		key: 'groups/group-1/documents/file-1.pdf',
		filename: 'minutes.pdf',
		contentType: 'application/pdf',
		sizeBytes: 2048,
		...over
	};
}

function get(id = 'file-1') {
	return GET({ params: { id } } as never);
}

beforeEach(() => {
	vi.clearAllMocks();
	downloadRow = row();
	storedObject = { body, size: 2048, arrayBuffer };
	requireGroupRole.mockImplementation(async () => ({}));
});

// ---------------------------------------------------------------------------

describe('GET /api/files/[id]', () => {
	/**
	 * The assertion this whole route exists to make true. The group it authorizes
	 * against comes from the stored row, and there is nothing in the request that
	 * could name a different one — this is the test that fails the day somebody
	 * threads a `?groupId=` through for convenience.
	 */
	it('authorizes against the group on the row, and nothing from the request', async () => {
		downloadRow = row({ groupId: 'group-1' });

		await get('file-1');

		expect(requireGroupRole).toHaveBeenCalledWith({ id: 'group-1' }, 'member', {
			allowStaff: true
		});
	});

	it("cannot be reached by knowing another group's file id", async () => {
		// The row resolves; the guard is asked about *its* group and refuses.
		downloadRow = row({ groupId: 'group-b' });
		requireGroupRole.mockImplementation(async () => error(403, 'Forbidden'));

		await expect(get('file-1')).rejects.toMatchObject({ status: 403 });
		expect(requireGroupRole).toHaveBeenCalledWith({ id: 'group-b' }, 'member', {
			allowStaff: true
		});
	});

	it('never reads the object for a caller the guard refuses', async () => {
		requireGroupRole.mockImplementation(async () => error(403, 'Forbidden'));

		await expect(get()).rejects.toMatchObject({ status: 403 });
		expect(getPrivateObject).not.toHaveBeenCalled();
	});

	it('passes an unauthenticated caller the guard 401 through', async () => {
		requireGroupRole.mockImplementation(async () => error(401, 'Unauthorized'));

		await expect(get()).rejects.toMatchObject({ status: 401 });
	});

	/**
	 * Before the guard, deliberately. Running the guard first would let an
	 * outsider tell "no such file" from "not your file" by the status code.
	 */
	it('404s a removed document without asking the guard anything', async () => {
		downloadRow = null;

		await expect(get()).rejects.toMatchObject({ status: 404 });
		expect(requireGroupRole).not.toHaveBeenCalled();
	});

	it('404s a live row whose object is gone', async () => {
		// A put that failed after the insert, or the sweep mid-flight. Ordinary,
		// not a fault — a 500 here would page somebody for a deleted file.
		storedObject = null;

		await expect(get()).rejects.toMatchObject({ status: 404 });
	});

	// ---- the response ------------------------------------------------------

	it('streams the object rather than buffering it', async () => {
		const response = await get();

		// 25MB into a 128MB isolate, times concurrency, is the failure this avoids.
		expect(response.body).toBe(body);
		expect(arrayBuffer).not.toHaveBeenCalled();
	});

	it('is uncacheable at the edge and varies on the cookie', async () => {
		const response = await get();

		// Without both, Cloudflare can serve one member's authorized response to
		// the next requester — which would make this a public bucket with steps.
		expect(response.headers.get('Cache-Control')).toBe('private, no-store');
		expect(response.headers.get('Vary')).toBe('Cookie');
	});

	it('forces a download and forbids sniffing', async () => {
		const response = await get();

		expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="minutes.pdf"');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
	});

	it('serves an HTML upload as an attachment, not as a page', async () => {
		// `File.type` is browser-supplied and the type list is the only filter, so
		// the stored-XSS case is worth pinning even though the upload path refuses
		// text/html today.
		downloadRow = row({ contentType: 'text/html', filename: 'evil.html' });

		const response = await get();

		expect(response.headers.get('Content-Disposition')).toMatch(/^attachment;/);
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
	});

	it('takes the content type from the row, not from R2', async () => {
		downloadRow = row({ contentType: 'text/csv' });

		const response = await get();

		expect(response.headers.get('Content-Type')).toBe('text/csv');
	});

	/**
	 * The header is built from a column, so it is sanitized again on the way out.
	 * A row poisoned by a migration or a hand edit is exactly what that second
	 * pass is for.
	 */
	it('carries no CR or LF out of a poisoned filename', async () => {
		downloadRow = row({ filename: 'bad\r\nSet-Cookie: x=1.pdf' });

		const response = await get();

		expect(response.headers.get('Content-Disposition')).not.toMatch(/[\r\n]/);
		expect(response.headers.get('Content-Disposition')).toBe(
			'attachment; filename="badSet-Cookie: x=1.pdf"'
		);
	});
});
