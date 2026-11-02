import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * Every write that adds an audit row on a page with a History card (#2191)
 * must leave that card current. Kit re-runs every query after a form only when
 * the handler refreshed none by name, so a handler either refreshes nothing or
 * names the card's query too; refreshing the page query alone strands it.
 */

const refreshed: [unknown, unknown][] = [];
vi.mock('$app/server', () => {
	const mark = <F>(fn: F, type: string) => Object.assign(fn as object, { __: { type } }) as F;
	return {
		getRequestEvent: () => ({ locals: { user: { id: 'staff-1' } }, url: new URL('http://x/') }),
		query: () => {
			const q = (arg: unknown) => ({
				refresh: () => {
					refreshed.push([q, arg]);
					return Promise.resolve();
				}
			});
			return mark(q, 'query');
		},
		form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw), {}), 'form'),
		command: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw)), 'command'),
		prerender: (handler: unknown) => mark(handler, 'prerender')
	};
});

vi.mock('$lib/server/db', () => ({ db: {}, getRowCount: () => 0 }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

const staff = { id: 'staff-1', name: 'Pat', email: 'pat@example.com' };
vi.mock('$lib/server/authorization', async (orig) => ({
	...(await orig<object>()),
	requireUser: async () => staff,
	requireCapability: async () => staff,
	can: async () => true
}));
vi.mock('$lib/server/event/listing-guard', async (orig) => ({
	...(await orig<object>()),
	requireListingWriter: async () => staff,
	requireListingReader: async () => staff
}));

vi.mock('$lib/server/capability/capability-grant-service', async (orig) => ({
	...(await orig<object>()),
	setRoleCapabilityGrants: vi.fn(),
	setCommitteeCapabilityGrants: vi.fn()
}));
vi.mock('$lib/server/band/band-service', async (orig) => ({
	...(await orig<object>()),
	deactivate: vi.fn(),
	reactivate: vi.fn()
}));
vi.mock('$lib/server/group/group-service', async (orig) => ({
	...(await orig<object>()),
	setChairRole: vi.fn()
}));
vi.mock('$lib/server/group/roster-import-service', async (orig) => ({
	...(await orig<object>()),
	importRoster: vi.fn(async () => ({}))
}));
vi.mock('$lib/server/event/event-service', async (orig) => ({
	...(await orig<object>()),
	publish: vi.fn(async () => ({ published: true, warnings: [] })),
	update: vi.fn()
}));

type Remote = Record<string, (raw: unknown) => Promise<unknown>>;
const volunteer = (await import('./volunteer.remote')) as unknown as Remote;
const bands = (await import('./bands.remote')) as unknown as Remote;
const groups = (await import('./groups.remote')) as unknown as Remote;
const events = (await import('./events.remote')) as unknown as Remote;

beforeEach(() => {
	refreshed.length = 0;
});

/** Kit's refresh-everything, or the card's query by name. */
function leavesHistoryCurrent(history: unknown, id: string) {
	const named = refreshed.some(([q, arg]) => q === history && (arg as { id?: string })?.id === id);
	expect(refreshed.length === 0 || named).toBe(true);
	refreshed.length = 0;
}

describe('audited writes keep their History card current', () => {
	it('a volunteer role’s grants', async () => {
		await volunteer.setVolunteerRoleGrants({ roleId: 'role-1', capabilities: [] });
		expect(refreshed).toContainEqual([volunteer.getVolunteerRoleHistory, { id: 'role-1' }]);
	});

	it('a band’s deactivation and reactivation', async () => {
		await bands.deactivateBand({ id: 'band-1' });
		leavesHistoryCurrent(bands.getBandHistory, 'band-1');
		await bands.reactivateBand({ id: 'band-1' });
		leavesHistoryCurrent(bands.getBandHistory, 'band-1');
	});

	it('a committee’s grants, chairs and roster import', async () => {
		await groups.setCommitteeGrants({ groupId: 'g-1', capabilities: [] });
		leavesHistoryCurrent(groups.getGroupHistory, 'g-1');
		await groups.setStaffGroupRole({ groupId: 'g-1', userId: 'u-1', role: 'admin' });
		leavesHistoryCurrent(groups.getGroupHistory, 'g-1');
		await groups.importStaffGroupRoster({ groupId: 'g-1', emails: 'a@example.com' });
		leavesHistoryCurrent(groups.getGroupHistory, 'g-1');
	});

	it('an event published over warnings, or edited while cancelled', async () => {
		await events.publishEvent({ id: 'ev-1', reason: 'Going ahead' });
		leavesHistoryCurrent(events.getEventHistory, 'ev-1');
		await events.updateEvent({ eventId: 'ev-1', title: 'New title' });
		leavesHistoryCurrent(events.getEventHistory, 'ev-1');
	});
});
