import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSetUserAvatar = vi.fn().mockResolvedValue('users/avatars/user-1.png');
const mockClearUserAvatar = vi.fn().mockResolvedValue(undefined);

vi.mock('$lib/server/directory/profile-service', () => ({
	setUserAvatar: (...args: unknown[]) => mockSetUserAvatar(...args),
	clearUserAvatar: (...args: unknown[]) => mockClearUserAvatar(...args)
}));

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(file: File | null) {
	const fd = new FormData();
	if (file) fd.append('file', file);
	return {
		locals: { user: { id: 'user-1' } },
		request: new Request('http://localhost/api/member/avatar', { method: 'POST', body: fd })
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

// Dynamic so it resolves after the `vi.mock` above, at module scope so the cold
// Vite transform of the module graph is paid during file evaluation rather than
// inside a test, where it would race the 5s timeout.
const { POST } = await import('./+server');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/member/avatar', () => {
	// A member uploading a .psd got a 500 and an "Internal Error" toast, and the
	// rejection was logged to Sentry as a server fault (JAVASCRIPT-SVELTEKIT-2E).
	it('rejects a disallowed file type with 400 and the reason, without uploading', async () => {
		const psd = new File([bytes(1024)], 'art.psd', { type: 'application/x-photoshop' });

		await expect(POST(req(psd))).rejects.toMatchObject({
			status: 400,
			body: { message: expect.stringContaining('application/x-photoshop') }
		});

		expect(mockSetUserAvatar).not.toHaveBeenCalled();
	});

	it('rejects an oversized file with 400 without uploading', async () => {
		const big = new File([bytes(11 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });

		await expect(POST(req(big))).rejects.toMatchObject({ status: 400 });

		expect(mockSetUserAvatar).not.toHaveBeenCalled();
	});

	it('rejects a missing file with 400', async () => {
		await expect(POST(req(null))).rejects.toMatchObject({ status: 400 });

		expect(mockSetUserAvatar).not.toHaveBeenCalled();
	});

	it('uploads a valid image and returns its key', async () => {
		const ok = new File([bytes(1024)], 'me.png', { type: 'image/png' });

		const res = await POST(req(ok));

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			success: true,
			avatarKey: 'users/avatars/user-1.png'
		});
		expect(mockSetUserAvatar).toHaveBeenCalledWith('user-1', expect.anything(), 'image/png');
	});
});
