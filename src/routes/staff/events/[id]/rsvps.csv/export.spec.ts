import { describe, it, expect, vi, beforeEach } from 'vitest';

// The RSVP CSV is a `+server.ts`, so its guard is not the remote boundary: it
// must refuse before reading a single row.

let allowed = true;
vi.mock('$lib/server/event/listing-guard', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		requireListingWriter: vi.fn(async () => {
			if (!allowed) error(403, 'Not permitted');
			return { id: 'staff-1' };
		})
	};
});
let evt: { id: string; title: string } | null = { id: 'e1', title: 'Spring Mixing Workshop!' };
vi.mock('$lib/server/event/event-service', () => ({ getById: vi.fn(async () => evt) }));
const listRsvpsForEvent = vi.fn(async () => [
	{
		id: 'r1',
		userId: 'u1',
		name: 'Ada',
		email: 'ada@example.com',
		createdAt: new Date('2026-11-01T18:30:00Z')
	},
	{ id: 'r2', userId: 'u2', name: '=HYPERLINK()', email: 'x@example.com', createdAt: new Date(0) }
]);
vi.mock('$lib/server/event/rsvp-service', () => ({
	listRsvpsForEvent: (...a: unknown[]) => listRsvpsForEvent(...(a as []))
}));

const { GET } = await import('./+server');

const call = () => GET({ params: { id: 'e1' } } as never) as Promise<Response>;

beforeEach(() => {
	allowed = true;
	evt = { id: 'e1', title: 'Spring Mixing Workshop!' };
	listRsvpsForEvent.mockClear();
});

describe('GET rsvps.csv', () => {
	it('refuses a caller the listing guard refuses, before reading rows', async () => {
		allowed = false;
		await expect(call()).rejects.toMatchObject({ status: 403 });
		expect(listRsvpsForEvent).not.toHaveBeenCalled();
	});

	it('404s an unknown event', async () => {
		evt = null;
		await expect(call()).rejects.toMatchObject({ status: 404 });
	});

	it('downloads name, email and when, with formulas escaped', async () => {
		const res = await call();
		expect(res.headers.get('content-disposition')).toBe(
			'attachment; filename="rsvps_spring-mixing-workshop.csv"'
		);
		const body = await res.text();
		expect(body).toContain('name,email,rsvped_at');
		expect(body).toContain('Ada,ada@example.com,2026-11-01T18:30:00.000Z');
		expect(body).not.toMatch(/^=HYPERLINK/m);
	});
});
