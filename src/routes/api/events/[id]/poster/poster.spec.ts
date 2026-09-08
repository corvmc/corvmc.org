import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUploadFile = vi.fn().mockResolvedValue('events/posters/evt-1.jpg');
const mockDeleteObject = vi.fn().mockResolvedValue(undefined);
const mockGetById = vi.fn();

// Keep the real validateUpload so the endpoint exercises real validation.
vi.mock('$lib/server/storage', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/storage')>('$lib/server/storage');
	return {
		...actual,
		uploadFile: (...args: unknown[]) => mockUploadFile(...args),
		deleteObject: (...args: unknown[]) => mockDeleteObject(...args)
	};
});

vi.mock('$lib/server/authorization', () => ({
	hasAnyRole: vi.fn().mockResolvedValue(true)
}));

const mockReplaceSlot = vi.fn().mockResolvedValue({ mediaId: 'm1', attachmentId: 'a1' });
const mockDetachSlot = vi.fn();
vi.mock('$lib/server/media/media-service', () => ({
	replaceSlot: (...args: unknown[]) => mockReplaceSlot(...args),
	detachSlot: (...args: unknown[]) => mockDetachSlot(...args)
}));

vi.mock('$lib/server/event/event-service', () => ({
	getById: (...args: unknown[]) => mockGetById(...args)
}));

// db.update().set().where() chain — only reached on the happy path.
const whereSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/db', () => ({
	db: {
		update: () => ({ set: () => ({ where: whereSpy }) })
	}
}));

vi.mock('$lib/server/db/schema/event', () => ({ eventListing: {} }));

beforeEach(() => {
	vi.clearAllMocks();
	mockGetById.mockResolvedValue({
		id: 'evt-1',
		status: 'published',
		posterKey: 'events/posters/evt-1.jpg'
	});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(file: File | null) {
	const fd = new FormData();
	if (file) fd.append('poster', file);
	return {
		params: { id: 'evt-1' },
		locals: { user: { id: 'user-1' } },
		request: new Request('http://localhost/api/events/evt-1/poster', {
			method: 'POST',
			body: fd
		})
	} as any;
}

// ASCII string of `size` bytes — its byte length equals its length, so the
// resulting File reports `size` exactly (validateUpload reads File.size).
function bytes(size: number): string {
	return 'a'.repeat(size);
}

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

// The import stays dynamic so it resolves after the `vi.mock` calls above, and
// sits at module scope so the cold Vite transform of the whole module graph is
// paid once, during file evaluation — not inside a test or hook, where it would
// race the 5s test / 10s hook timeout on a cold `node_modules/.vite`.
const { POST } = await import('./+server');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/events/[id]/poster', () => {
	it('rejects an oversized file with 400 and leaves the existing poster untouched', async () => {
		const big = new File([bytes(11 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });

		await expect(POST(req(big))).rejects.toMatchObject({ status: 400 });

		// Validation must run before any mutation — old poster not deleted, nothing uploaded.
		expect(mockDeleteObject).not.toHaveBeenCalled();
		expect(mockUploadFile).not.toHaveBeenCalled();
	});

	it('rejects a disallowed file type with 400 and does not delete or upload', async () => {
		const pdf = new File([bytes(1024)], 'doc.pdf', { type: 'application/pdf' });

		await expect(POST(req(pdf))).rejects.toMatchObject({ status: 400 });

		expect(mockDeleteObject).not.toHaveBeenCalled();
		expect(mockUploadFile).not.toHaveBeenCalled();
	});

	it('uploads a valid file, replacing the old poster', async () => {
		const ok = new File([bytes(1024)], 'poster.png', { type: 'image/png' });

		const res = await POST(req(ok));

		expect(res.status).toBe(200);
		// Replacing a poster records the new object and detaches the old one; the
		// sweep reclaims it. Deleting inline would take the image from every other
		// occurrence of a recurring series.
		expect(mockReplaceSlot).toHaveBeenCalledWith(
			expect.objectContaining({
				attachableType: 'event_listing',
				attachableId: 'evt-1',
				slot: 'poster'
			})
		);
		expect(mockDeleteObject).not.toHaveBeenCalled();
		expect(mockUploadFile).toHaveBeenCalledOnce();
		expect(whereSpy).toHaveBeenCalled();
	});
});
