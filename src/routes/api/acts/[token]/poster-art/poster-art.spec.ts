import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The token is the whole authorization: it names the entry, and the request id
 * in the body is only which of that entry's asks the file answers.
 */

const resolveContactSheetToken = vi.fn();
vi.mock('$lib/server/directory/contact-sheet-service', () => ({
	resolveContactSheetToken: (t: string) => resolveContactSheetToken(t)
}));

const deliverPosterArt = vi.fn();
class PosterRequestNotFoundError extends Error {
	readonly httpStatus = 404;
}
vi.mock('$lib/server/production/artifact-request-service', () => ({
	deliverPosterArt: (input: unknown) => deliverPosterArt(input),
	PosterRequestNotFoundError
}));

const { POST } = await import('./+server');

function post(token: string, fields: Record<string, string | File>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	const request = new Request('http://x/api', { method: 'POST', body });
	return POST({ params: { token }, request } as unknown as Parameters<typeof POST>[0]);
}

const art = () => new File([new Uint8Array(8)], 'art.png', { type: 'image/png' });

beforeEach(() => {
	vi.clearAllMocks();
});

describe('POST /api/acts/[token]/poster-art', () => {
	it('refuses a dead token before reading anything', async () => {
		resolveContactSheetToken.mockResolvedValue(null);
		await expect(post('bad', { requestId: 'req-1', file: art() })).rejects.toMatchObject({
			status: 404
		});
		expect(deliverPosterArt).not.toHaveBeenCalled();
	});

	it("delivers against the token's entry, whatever the body says", async () => {
		resolveContactSheetToken.mockResolvedValue({ entryId: 'entry-artist' });
		const res = await post('tok', { requestId: 'req-1', entryId: 'someone-else', file: art() });

		expect(res.status).toBe(200);
		expect(deliverPosterArt).toHaveBeenCalledWith(
			expect.objectContaining({ entryId: 'entry-artist', requestId: 'req-1' })
		);
	});

	it('refuses a file that is not a JPEG or PNG', async () => {
		resolveContactSheetToken.mockResolvedValue({ entryId: 'entry-artist' });
		const pdf = new File([new Uint8Array(8)], 'a.pdf', { type: 'application/pdf' });
		await expect(post('tok', { requestId: 'req-1', file: pdf })).rejects.toMatchObject({
			status: 400
		});
		expect(deliverPosterArt).not.toHaveBeenCalled();
	});

	it('answers a closed request as 404', async () => {
		resolveContactSheetToken.mockResolvedValue({ entryId: 'entry-artist' });
		deliverPosterArt.mockRejectedValue(new PosterRequestNotFoundError('closed'));
		await expect(post('tok', { requestId: 'req-1', file: art() })).rejects.toMatchObject({
			status: 404
		});
	});
});
