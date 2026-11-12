import { describe, it, expect, vi, beforeEach } from 'vitest';

// The calendar poster is staff marketing material: only `marketing.read` may
// render it, a refused caller never reaches the renderer, and neither does a
// format outside the three it prints.

const { auth, renderMonthPoster } = vi.hoisted(() => ({
	auth: { held: [] as string[] },
	renderMonthPoster: vi.fn(async (_month: string, format: string) => {
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
		return format === 'social'
			? { file: png, contentType: 'image/png', preview: png }
			: { file: new Uint8Array([0x25, 0x50]), contentType: 'application/pdf', preview: png };
	})
}));
vi.mock('#lib/server/authorization.js', async () =>
	(await import('#lib/server/testing/mock-remote-guards.js')).guardsFor(() => auth.held)
);
// The shared stand-in skips schemas; this one runs it, since the format is the input under test.
vi.mock('$app/server', async () => ({
	...(await import('#lib/server/testing/mock-remote-guards.js')).appServerMock(),
	query: (
		schema: { parseAsync: (a: unknown) => Promise<unknown> },
		handler: (a: unknown) => unknown
	) =>
		Object.assign(async (a: unknown) => handler(await schema.parseAsync(a)), {
			__: { type: 'query' }
		})
}));
vi.mock('#lib/server/poster/calendar-service.js', () => ({ renderMonthPoster }));

const { getCalendarPoster } = await import('./calendar-poster.remote');
const call = getCalendarPoster as unknown as (arg: unknown) => Promise<Record<string, string>>;

beforeEach(() => {
	auth.held = [];
	renderMonthPoster.mockClear();
});

describe('getCalendarPoster', () => {
	it('refuses a caller without marketing.read', async () => {
		await expect(call({ month: '2026-11', format: 'letter' })).rejects.toMatchObject({
			status: 403
		});
		expect(renderMonthPoster).not.toHaveBeenCalled();
	});

	it('returns a print size as a PDF with a PNG preview', async () => {
		auth.held = ['marketing.read'];
		const out = await call({ month: '2026-11', format: 'tabloid' });
		expect(renderMonthPoster).toHaveBeenCalledWith('2026-11', 'tabloid');
		expect(out).toEqual({
			month: '2026-11',
			format: 'tabloid',
			file: expect.stringMatching(/^data:application\/pdf;/),
			extension: 'pdf',
			preview: expect.stringMatching(/^data:image\/png;/)
		});
	});

	it('returns the social size as a PNG', async () => {
		auth.held = ['marketing.read'];
		const out = await call({ month: '2026-11', format: 'social' });
		expect(out).toMatchObject({
			extension: 'png',
			file: expect.stringMatching(/^data:image\/png;/)
		});
	});

	it.each([
		{ month: '2026-11', format: 'a4' },
		{ month: '2026-11' },
		{ month: '2026-13', format: 'letter' }
	])('rejects %o before rendering', async (arg) => {
		auth.held = ['marketing.read'];
		await expect(call(arg)).rejects.toBeDefined();
		expect(renderMonthPoster).not.toHaveBeenCalled();
	});
});
