import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Which sections a viewer gets is decided by what they hold, section by section. */

let caps: string[] = [];
let seat: string[] = [];

vi.mock('$app/server', () => ({
	query: (_schema: unknown, fn: (args: unknown) => unknown) =>
		Object.assign(fn, { __: { type: 'query' } }),
	getRequestEvent: () => ({ locals: { user: { id: 'u1' } } })
}));

vi.mock('#lib/server/authorization.js', () => ({
	requireUser: () => ({ id: 'u1' }),
	positionsFor: vi.fn(async () => (caps.length ? ['staff'] : [])),
	capabilitySet: () => caps,
	committeeCapabilitiesFor: vi.fn(async () => seat)
}));

const listRoomDays = vi.fn(async () => [{ date: '2026-10-28', reservations: [] }]);
const listUpcomingShows = vi.fn(async () => []);
const listMemberSummary = vi.fn(async () => ({ newThisMonth: 2, recent: [] }));
vi.mock('#lib/server/user/staff-dashboard-service.js', () => ({
	listRoomDays: () => listRoomDays(),
	listUpcomingShows: () => listUpcomingShows(),
	listMemberSummary: () => listMemberSummary()
}));
const listReviewFeed = vi.fn(async () => ({ items: [], hasMore: false }));
vi.mock('#lib/server/review/review-registry.js', () => ({
	listReviewFeed: (...a: unknown[]) => listReviewFeed(...(a as [])),
	countReviewFeed: async () => ({ total: 0, byKind: {} })
}));
const listShortStaffedShifts = vi.fn(async () => []);
vi.mock('#lib/server/volunteer/work-order-service.js', () => ({
	listShortStaffedShifts: () => listShortStaffedShifts()
}));
const listDeadlines = vi.fn(async () => [
	{ module: 'grant', subjectId: 'g1', on: '2026-11-01', title: 'Report' }
]);
vi.mock('#lib/server/development/deadline-service.js', () => ({
	listDevelopmentDeadlinesBetween: () => listDeadlines()
}));

const listMyWork = vi.fn(async () => Array.from({ length: 7 }, (_, i) => ({ id: `t${i}` })));
vi.mock('#lib/server/task/my-work.js', () => ({
	listMyWork: (...a: unknown[]) => listMyWork(...(a as []))
}));

const { getStaffDashboard } = await import('./staff-dashboard.remote');

beforeEach(() => {
	vi.clearAllMocks();
	caps = [];
	seat = [];
});

describe('getStaffDashboard', () => {
	it('gives a committee seat real data for its own areas (#1578)', async () => {
		seat = ['grant.read'];
		const data = await getStaffDashboard({});
		expect(data.deadlines?.rows).toHaveLength(1);
		expect(data.room).toBeNull();
		expect(data.members).toBeNull();
		expect(listRoomDays).not.toHaveBeenCalled();
		expect(listMemberSummary).not.toHaveBeenCalled();
	});

	it('reads the room and the shows for whoever may read reservations and events', async () => {
		caps = ['reservation.read', 'event.read'];
		const data = await getStaffDashboard({});
		expect(data.room).toEqual([{ date: '2026-10-28', reservations: [] }]);
		expect(data.shows).toEqual([]);
		expect(data.deadlines).toBeNull();
		expect(listShortStaffedShifts).not.toHaveBeenCalled();
	});

	it('keeps the members breakdown for user.list', async () => {
		caps = ['user.list'];
		const data = await getStaffDashboard({});
		expect(data.members).toEqual({ newThisMonth: 2, recent: [] });
		expect(data.capabilities).toEqual(['user.list']);
	});

	it('reads the review feed with the viewer’s capabilities, its filter and a clamped limit', async () => {
		caps = ['listing.review'];
		await getStaffDashboard({ kind: 'listing', limit: 50 });
		expect(listReviewFeed).toHaveBeenCalledWith(['listing.review'], { kind: 'listing', limit: 50 });
		await getStaffDashboard({});
		expect(listReviewFeed).toHaveBeenLastCalledWith(['listing.review'], {
			kind: undefined,
			limit: 25
		});
	});

	it('reads the viewer’s own tasks with no task gate, capped with the total (#2989)', async () => {
		caps = ['user.list'];
		const data = await getStaffDashboard({});
		expect(listMyWork).toHaveBeenCalledWith('u1');
		expect(data.myWork?.rows).toHaveLength(5);
		expect(data.myWork?.total).toBe(7);
	});

	it('refuses a caller with neither a position nor a seat', async () => {
		await expect(getStaffDashboard({})).rejects.toMatchObject({ status: 403 });
		expect(listRoomDays).not.toHaveBeenCalled();
	});
});
