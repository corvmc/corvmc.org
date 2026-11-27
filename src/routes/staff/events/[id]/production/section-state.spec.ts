import { describe, expect, it } from 'vitest';
import { deliverablesState, requestsState, runningOrderState, stockState } from './section-state';
import type { getStaffEventProduction } from '#lib/remote/events.remote.js';

type Loaded = Awaited<ReturnType<typeof getStaffEventProduction>>;
type RunOfShow = NonNullable<Loaded['runOfShow']>;
type Request = Loaded['artifactRequests'][number];

const request = (over: Partial<Request>) =>
	({ fulfilled: false, overdue: false, ...over }) as Request;

const ros = (over: Partial<RunOfShow>) =>
	({ firstSetAt: new Date(), slots: [{}], unslotted: [], warnings: [], ...over }) as RunOfShow;

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

	it('tells an unmatched request from a short one, and both from in stock and none asked', () => {
		type Check = Loaded['riderStock'];
		const check = (over: Partial<Check>) =>
			({ lines: [{}], unmatchedCount: 0, shortCount: 0, catalog: [], ...over }) as Check;
		const states = new Set([
			stockState(check({ unmatchedCount: 1, shortCount: 1 })),
			stockState(check({ shortCount: 1 })),
			stockState(check({})),
			stockState(check({ lines: [] }))
		]);
		expect(states.size).toBe(4);
	});

	it('tells a missing first set, an empty order, an unplaced act and a full order apart', () => {
		const states = new Set([
			runningOrderState(ros({ firstSetAt: null })),
			runningOrderState(ros({ slots: [] })),
			runningOrderState(ros({ unslotted: [{}] as RunOfShow['unslotted'] })),
			runningOrderState(ros({}))
		]);
		expect(states.size).toBe(4);
	});
});
