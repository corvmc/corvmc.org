import { describe, it, expect, vi, beforeEach } from 'vitest';

// The print poster is a listing write, as the template flyer is: a caller the
// listing guard refuses never reaches the renderer, and neither does a call
// with no event id.

const { guard, renderEventPoster } = vi.hoisted(() => ({
	guard: { admit: false },
	renderEventPoster: vi.fn(async () => ({
		pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
		title: 'Harvest Show!'
	}))
}));
vi.mock('#lib/server/event/listing-guard.js', () => ({
	requireListingWriter: vi.fn(async () => {
		if (!guard.admit) throw Object.assign(new Error('Not permitted'), { status: 403 });
		return { id: 'usr-1' };
	})
}));
vi.mock('$app/server', async () => ({
	...(await import('#lib/server/testing/mock-remote-guards.js')).appServerMock(),
	command: (
		schema: { parseAsync: (a: unknown) => Promise<unknown> },
		handler: (a: unknown) => unknown
	) =>
		Object.assign(async (a: unknown) => handler(await schema.parseAsync(a)), {
			__: { type: 'command' }
		})
}));
vi.mock('#lib/server/poster/event-letter-service.js', () => ({ renderEventPoster }));

const { printEventPoster } = await import('./event-poster.remote');
const { requireListingWriter } = await import('#lib/server/event/listing-guard.js');
const call = printEventPoster as unknown as (arg: unknown) => Promise<Record<string, string>>;

beforeEach(() => {
	guard.admit = false;
	renderEventPoster.mockClear();
});

describe('printEventPoster', () => {
	it('refuses a caller the listing guard refuses', async () => {
		await expect(call({ eventId: 'evt-1' })).rejects.toMatchObject({ status: 403 });
		expect(requireListingWriter).toHaveBeenCalledWith('evt-1');
		expect(renderEventPoster).not.toHaveBeenCalled();
	});

	it('returns the PDF and a file name from the title', async () => {
		guard.admit = true;
		expect(await call({ eventId: 'evt-1' })).toEqual({
			file: expect.stringMatching(/^data:application\/pdf;base64,/),
			filename: 'harvest-show-poster-letter.pdf'
		});
		expect(renderEventPoster).toHaveBeenCalledWith('evt-1');
	});

	it.each([{}, { eventId: '' }, { eventId: 7 }])('rejects %o before rendering', async (arg) => {
		guard.admit = true;
		await expect(call(arg)).rejects.toBeDefined();
		expect(renderEventPoster).not.toHaveBeenCalled();
	});
});
