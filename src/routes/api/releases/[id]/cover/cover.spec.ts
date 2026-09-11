import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The slot had three readers and a deleter and no writer, so a release could
 * never get a cover (#1072). These pin the two things that make the writer
 * safe: the band is resolved from the release, and a bad upload cannot wipe
 * the cover already there.
 */

const mockUploadFile = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/storage', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/storage')>('$lib/server/storage');
	return { ...actual, uploadFile: (...a: unknown[]) => mockUploadFile(...a) };
});

const mockReplaceSlot = vi.fn().mockResolvedValue({ mediaId: 'm1', attachmentId: 'a1' });
const mockDetachSlot = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/media/media-service', () => ({
	replaceSlot: (...a: unknown[]) => mockReplaceSlot(...a),
	detachSlot: (...a: unknown[]) => mockDetachSlot(...a)
}));

const mockRequireGroupRole = vi.fn().mockResolvedValue({ group: { id: 'band-1' } });
vi.mock('$lib/server/group/group-context', () => ({
	requireGroupRole: (...a: unknown[]) => mockRequireGroupRole(...a)
}));

const mockGetReleaseById = vi.fn();
vi.mock('$lib/server/audio/audio-service', () => ({
	getReleaseById: (...a: unknown[]) => mockGetReleaseById(...a)
}));

const { POST, DELETE } = await import('./+server');

const locals = { user: { id: 'u-1' } } as never;
const png = () => new File([new Uint8Array([1, 2, 3])], 'art.png', { type: 'image/png' });

function request(file?: File) {
	const body = new FormData();
	if (file) body.append('cover', file);
	return { formData: async () => body } as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetReleaseById.mockResolvedValue({ id: 'rel-1', groupId: 'band-1' });
	mockRequireGroupRole.mockResolvedValue({ group: { id: 'band-1' } });
});

describe('release cover upload', () => {
	it('writes the cover slot for an admin of the release’s own band', async () => {
		const res = await POST({ params: { id: 'rel-1' }, request: request(png()), locals } as never);

		expect(await res.json()).toMatchObject({ key: expect.stringContaining('releases/covers') });
		expect(mockReplaceSlot).toHaveBeenCalledWith(
			expect.objectContaining({ attachableType: 'audio_release', slot: 'cover' })
		);
	});

	it('resolves the band from the release, never from the caller', async () => {
		await POST({ params: { id: 'rel-1' }, request: request(png()), locals } as never);

		// `groupId` came off the release row, which is what stops a caller
		// naming someone else's band.
		expect(mockRequireGroupRole).toHaveBeenCalledWith(
			{ id: 'band-1' },
			'admin',
			expect.objectContaining({ allowStaff: true })
		);
	});

	it('401s an anonymous caller before reading the release', async () => {
		await expect(
			POST({ params: { id: 'rel-1' }, request: request(png()), locals: {} } as never)
		).rejects.toMatchObject({ status: 401 });
		expect(mockGetReleaseById).not.toHaveBeenCalled();
	});

	it('404s a release that does not exist', async () => {
		mockGetReleaseById.mockResolvedValue(undefined);

		await expect(
			POST({ params: { id: 'nope' }, request: request(png()), locals } as never)
		).rejects.toMatchObject({ status: 404 });
	});

	it('refuses an empty submit without touching the existing cover', async () => {
		await expect(
			POST({ params: { id: 'rel-1' }, request: request(), locals } as never)
		).rejects.toMatchObject({ status: 400 });
		expect(mockUploadFile).not.toHaveBeenCalled();
		expect(mockReplaceSlot).not.toHaveBeenCalled();
	});

	it('validates before writing, so a bad file cannot wipe the cover', async () => {
		const bad = new File([new Uint8Array([1])], 'virus.exe', { type: 'application/x-msdownload' });

		await expect(
			POST({ params: { id: 'rel-1' }, request: request(bad), locals } as never)
		).rejects.toMatchObject({ status: 400 });
		expect(mockUploadFile).not.toHaveBeenCalled();
		expect(mockReplaceSlot).not.toHaveBeenCalled();
	});

	it('detaches the slot on DELETE', async () => {
		await DELETE({ params: { id: 'rel-1' }, locals } as never);

		expect(mockDetachSlot).toHaveBeenCalledWith('audio_release', 'rel-1', 'cover');
	});
});
