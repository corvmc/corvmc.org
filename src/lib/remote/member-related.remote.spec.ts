import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * The member cards' remotes (#2630 phase 4) guard on their own: a group's
 * roster, never a staff capability, and an event only once it is public.
 */

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: { id: 'ada' } }, url: new URL('http://x/') }),
	query: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
		Object.assign(async (raw: unknown) => handler(schema.parse(raw)), { __: { type: 'query' } })
}));
vi.mock('#lib/server/db/index.js', () => ({ db: {} }));

let signedIn = true;
vi.mock('#lib/server/authorization.js', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		requireUser: () => {
			if (!signedIn) error(401, 'Sign in');
			return { id: 'ada' };
		},
		// A staff viewer passes every capability; the guards must not ask.
		can: async () => true,
		userHasCapability: async () => true,
		isElevated: async () => true
	};
});

// Ada sits on the booking committee only; "band" is a band she plays in.
const groups: Record<string, { id: string; kind: string }> = {
	booking: { id: 'booking', kind: 'committee' },
	other: { id: 'other', kind: 'committee' },
	band: { id: 'band', kind: 'band' }
};
vi.mock('#lib/server/band/band-service.js', () => ({
	getBySlug: async () => null,
	getByIdActive: async (id: string) => groups[id] ?? null,
	getUserRole: async (groupId: string) => (['booking', 'band'].includes(groupId) ? 'member' : null)
}));

const memberRelatedTasks = vi.hoisted(() => vi.fn());
const memberRelatedShifts = vi.hoisted(() => vi.fn());
const isPublicListing = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/task/member-related.js', () => ({
	memberRelatedTasks,
	memberRelatedShifts,
	isPublicListing
}));

const { getMemberRelatedTasks, getMemberRelatedShifts } =
	(await import('./member-related.remote')) as unknown as Record<
		'getMemberRelatedTasks' | 'getMemberRelatedShifts',
		(raw: unknown) => Promise<unknown>
	>;

const remotes = { getMemberRelatedTasks, getMemberRelatedShifts };

beforeEach(() => {
	signedIn = true;
	memberRelatedTasks.mockReset().mockResolvedValue({ groups: [], mine: [] });
	memberRelatedShifts.mockReset().mockResolvedValue([]);
	isPublicListing.mockReset().mockImplementation(async (id: string) => id === 'fri');
});

describe.each(Object.entries(remotes))('%s', (_, remote) => {
	const read = () => [...memberRelatedTasks.mock.calls, ...memberRelatedShifts.mock.calls];

	it("reads a group's cards for its own roster member, as that member", async () => {
		await remote({ type: 'group', id: 'booking' });
		expect(read()).toHaveLength(1);
		expect(read()[0][1]).toBe('ada');
	});

	it('refuses a member of another group, even one who holds staff capabilities', async () => {
		await expect(remote({ type: 'group', id: 'other' })).rejects.toMatchObject({ status: 403 });
		expect(read()).toHaveLength(0);
	});

	it('refuses a band, which has its own panel', async () => {
		await expect(remote({ type: 'group', id: 'band' })).rejects.toMatchObject({ status: 404 });
		expect(read()).toHaveLength(0);
	});

	it('refuses a signed-out viewer', async () => {
		signedIn = false;
		for (const s of [
			{ type: 'group', id: 'booking' },
			{ type: 'event', id: 'fri' }
		]) {
			await expect(remote(s)).rejects.toMatchObject({ status: 401 });
		}
		expect(read()).toHaveLength(0);
	});

	it("reads a public event's cards, and refuses one that is not public", async () => {
		await remote({ type: 'event', id: 'fri' });
		expect(read()).toHaveLength(1);
		await expect(remote({ type: 'event', id: 'draft' })).rejects.toMatchObject({ status: 404 });
		expect(read()).toHaveLength(1);
	});

	it('refuses a record type the member side does not show', async () => {
		await expect(remote({ type: 'project', id: 'p1' })).rejects.toThrow();
		expect(read()).toHaveLength(0);
	});
});
