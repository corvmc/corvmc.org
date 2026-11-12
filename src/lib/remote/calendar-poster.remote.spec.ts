import { describe, it, expect, vi, beforeEach } from 'vitest';

// The calendar poster is staff marketing material: only `marketing.read` may
// render it, and a refused caller never reaches the renderer.

const { auth, renderMonthPoster } = vi.hoisted(() => ({
	auth: { held: [] as string[] },
	renderMonthPoster: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
}));
vi.mock('#lib/server/authorization.js', async () =>
	(await import('#lib/server/testing/mock-remote-guards.js')).guardsFor(() => auth.held)
);
vi.mock('$app/server', async () =>
	(await import('#lib/server/testing/mock-remote-guards.js')).appServerMock()
);
vi.mock('#lib/server/poster/calendar-service.js', () => ({ renderMonthPoster }));

const { getCalendarPoster } = await import('./calendar-poster.remote');
const call = getCalendarPoster as unknown as (
	month: string
) => Promise<{ month: string; png: string }>;

beforeEach(() => {
	auth.held = [];
	renderMonthPoster.mockClear();
});

describe('getCalendarPoster', () => {
	it('refuses a caller without marketing.read', async () => {
		await expect(call('2026-11')).rejects.toMatchObject({ status: 403 });
		expect(renderMonthPoster).not.toHaveBeenCalled();
	});

	it("renders the month's poster as a PNG data URL", async () => {
		auth.held = ['marketing.read'];
		const out = await call('2026-11');
		expect(renderMonthPoster).toHaveBeenCalledWith('2026-11');
		expect(out).toEqual({ month: '2026-11', png: expect.stringMatching(/^data:image\/png;/) });
	});
});
