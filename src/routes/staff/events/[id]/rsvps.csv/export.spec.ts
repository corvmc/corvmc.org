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
const person = (id: string, name: string, email: string, rsvpedAt: Date) => ({
	personId: id,
	member: { type: 'member' as const, id, title: name, subtitle: email },
	email,
	memberStatus: 'member' as const,
	rsvpedAt
});
const listRsvpRoster = vi.fn(async () => [
	person('u1', 'Ada', 'ada@example.com', new Date('2026-11-01T18:30:00Z')),
	person('u2', '=HYPERLINK()', 'x@example.com', new Date(0))
]);
vi.mock('$lib/server/event/rsvp-service', () => ({
	listRsvpRoster: (...a: unknown[]) => listRsvpRoster(...(a as []))
}));

const { GET } = await import('./+server');

const call = () => GET({ params: { id: 'e1' } } as never) as Promise<Response>;

beforeEach(() => {
	allowed = true;
	evt = { id: 'e1', title: 'Spring Mixing Workshop!' };
	listRsvpRoster.mockClear();
});

describe('GET rsvps.csv', () => {
	it('refuses a caller the listing guard refuses, before reading rows', async () => {
		allowed = false;
		await expect(call()).rejects.toMatchObject({ status: 403 });
		expect(listRsvpRoster).not.toHaveBeenCalled();
	});

	it('404s an unknown event', async () => {
		evt = null;
		await expect(call()).rejects.toMatchObject({ status: 404 });
	});

	it('downloads name, email, member status and when, with formulas escaped', async () => {
		const res = await call();
		expect(res.headers.get('content-disposition')).toBe(
			'attachment; filename="rsvps_spring-mixing-workshop.csv"'
		);
		const body = await res.text();
		expect(body).toContain('name,email,member_status,rsvped_at');
		expect(body).toContain('Ada,ada@example.com,Member,2026-11-01T18:30:00.000Z');
		expect(body).not.toMatch(/^=HYPERLINK/m);
	});
});
