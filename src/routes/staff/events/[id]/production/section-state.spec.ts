import { describe, expect, it } from 'vitest';
import {
	deliverablesState,
	doorState,
	payoutsState,
	requestsState,
	runningOrderState,
	tabBadges
} from './section-state';

type Loaded = Parameters<typeof tabBadges>[0];
type Settlement = NonNullable<Loaded['settlement']>;
type RunOfShow = NonNullable<Loaded['runOfShow']>;
type Request = Loaded['artifactRequests'][number];

const request = (over: Partial<Request>) =>
	({ fulfilled: false, overdue: false, ...over }) as Request;

const settlement = (over: Partial<Settlement>) =>
	({
		acts: [{}, {}],
		unpaidActCount: 0,
		door: null,
		doorCounts: null,
		expenses: [],
		netCents: 0,
		...over
	}) as Settlement;

const ros = (over: Partial<RunOfShow>) =>
	({ firstSetAt: new Date(), slots: [{}], unslotted: [], warnings: [], ...over }) as RunOfShow;

function loaded(over: Partial<Loaded>): Loaded {
	return {
		production: { id: 'p' },
		deliverables: [],
		artifactRequests: [],
		riders: [],
		runOfShow: null,
		settlement: null,
		...over
	} as unknown as Loaded;
}

describe('console section state', () => {
	it('gives no deliverables state when every one is cancelled', () => {
		expect(deliverablesState([{ state: 'cancelled' }] as Loaded['deliverables'])).toBeUndefined();
		expect(deliverablesState([{ state: 'open' }] as Loaded['deliverables'])).toBeDefined();
	});

	it('tells an overdue request from a waiting one, and both from all in', () => {
		const states = new Set([
			requestsState([request({ overdue: true })]),
			requestsState([request({})]),
			requestsState([request({ fulfilled: true })]),
			requestsState([])
		]);
		expect(states.size).toBe(4);
	});

	it('tells a part-paid bill from a settled one', () => {
		expect(payoutsState(settlement({ unpaidActCount: 1 }))).not.toBe(payoutsState(settlement({})));
	});
});

describe('console tab badges', () => {
	it('says nothing on a tab whose sections have nothing in them', () => {
		expect(tabBadges(loaded({}))).toEqual({
			overview: undefined,
			advance: undefined,
			runOfShow: undefined,
			settlement: undefined
		});
	});

	it('repeats the heading of the section that needs work', () => {
		const requests = [request({ overdue: true })];
		const running = ros({ firstSetAt: null });
		const badges = tabBadges(loaded({ artifactRequests: requests, runOfShow: running }));
		expect(badges.advance).toBe(requestsState(requests));
		expect(badges.runOfShow).toBe(runningOrderState(running));
	});

	it('marks an unopened production and an unpaid bill', () => {
		expect(tabBadges(loaded({ production: null })).overview).toBeDefined();
		const door = { cashCents: 0 } as Settlement['door'];
		expect(
			tabBadges(loaded({ settlement: settlement({ unpaidActCount: 1, door }) })).settlement
		).toBeDefined();
	});
});

describe('door counts (#2722)', () => {
	const counted = (check: 'single' | 'agreed' | 'mismatch') =>
		settlement({
			door: { cashCents: 500_00 } as Settlement['door'],
			doorCounts: { check } as Settlement['doorCounts']
		});

	it('tells one count, two that agree and two that differ apart', () => {
		const states = new Set([
			doorState(settlement({})),
			doorState(counted('single')),
			doorState(counted('agreed')),
			doorState(counted('mismatch'))
		]);
		expect(states.size).toBe(4);
	});

	it('badges the settlement tab until a second count agrees', () => {
		const badge = (s: Settlement) => tabBadges(loaded({ settlement: s })).settlement;
		expect(badge(counted('mismatch'))).toBe(doorState(counted('mismatch')));
		expect(badge(counted('single'))).toBeDefined();
		expect(badge(counted('single'))).not.toBe(badge(counted('agreed')));
	});
});
