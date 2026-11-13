import { describe, it, expect, vi, beforeEach } from 'vitest';

// #2546: the owner of a series or staff change its schedule. The guard runs
// before the service, and the form's club-time fields reach it as instants.

let caller: 'owner' | 'staff' | 'neither' = 'owner';
const requireCapabilityOrOwner = vi.fn(async () => {
	if (caller === 'neither') throw new Error('403');
	return caller;
});
vi.mock('#lib/server/authorization.js', () => ({
	requireCapability: vi.fn(),
	requireCapabilityOrOwner,
	requireUser: () => ({ id: 'user-caller' })
}));

const get = vi.fn(async () => ({ id: 'ser-1', prototypeCreatedByUserId: 'user-owner' }));
vi.mock('#lib/server/reservation/recurring-series-service.js', () => ({
	get,
	getHistory: vi.fn(),
	cancel: vi.fn(),
	listAll: vi.fn()
}));

const reschedule = vi.fn(async () => ({
	seriesId: 'ser-2',
	waitlisted: false,
	removed: [],
	kept: [],
	errors: []
}));
const previewReschedule = vi.fn(async () => ({ sessions: [], kept: [], removed: 0 }));
vi.mock('#lib/server/reservation/recurring-series-reschedule.js', () => ({
	reschedule,
	previewReschedule
}));

vi.mock('$app/server', () => {
	const tag = (args: unknown[], type: string) => {
		const handler = args[args.length - 1] as (...a: unknown[]) => unknown;
		const call = (...a: unknown[]) =>
			type === 'query'
				? {
						then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
							Promise.resolve()
								.then(() => handler(...a))
								.then(res, rej),
						refresh: async () => undefined
					}
				: handler(...a);
		return Object.assign(call, { __: { type } });
	};
	return {
		query: (...a: unknown[]) => tag(a, 'query'),
		form: (...a: unknown[]) => tag(a, 'form'),
		command: (...a: unknown[]) => tag(a, 'command'),
		getRequestEvent: () => ({ locals: { user: { id: 'user-caller' } } })
	};
});

const remote = await import('./recurring.remote');
const rescheduleSeries = remote.rescheduleSeries as unknown as (
	d: unknown,
	issue: unknown
) => Promise<unknown>;
const issue = { until: (m: string) => ({ path: ['until'], message: m }) };

const input = {
	id: 'ser-1',
	date: '2026-11-01',
	startTime: '18:00',
	endTime: '20:00',
	frequency: 'weekly' as const
};

beforeEach(() => {
	caller = 'owner';
	vi.clearAllMocks();
});

describe('rescheduleSeries', () => {
	it('refuses someone who neither owns the series nor manages recurring bookings', async () => {
		caller = 'neither';
		await expect(rescheduleSeries(input, issue)).rejects.toThrow(/403/);
		expect(requireCapabilityOrOwner).toHaveBeenCalledWith(
			'reservation.manageRecurring',
			'user-owner'
		);
		expect(reschedule).not.toHaveBeenCalled();
	});

	it.each(['owner', 'staff'] as const)('passes the %s on as who made the change', async (as) => {
		caller = as;
		await rescheduleSeries(input, issue);
		expect(reschedule).toHaveBeenCalledWith('ser-1', expect.anything(), {
			kind: as,
			userId: 'user-caller'
		});
	});

	it('reads the times as club time, across the fall-back changeover', async () => {
		await rescheduleSeries(input, issue);
		const [, schedule] = reschedule.mock.calls[0] as unknown as [
			string,
			{ startsAt: Date; endsAt: Date; until?: Date }
		];
		// 18:00 PST on fall-back day is 02:00 UTC the next day.
		expect(schedule.startsAt.toISOString()).toBe('2026-11-02T02:00:00.000Z');
		expect(schedule.endsAt.toISOString()).toBe('2026-11-02T04:00:00.000Z');
		expect(schedule.until).toBeUndefined();
	});

	it('refuses an end date on or before the first session, before any write', async () => {
		await expect(rescheduleSeries({ ...input, until: '2026-11-01' }, issue)).rejects.toThrow();
		expect(reschedule).not.toHaveBeenCalled();
	});
});

describe('previewSeriesSchedule', () => {
	it('is guarded like the form', async () => {
		caller = 'neither';
		await expect(remote.previewSeriesSchedule(input)).rejects.toThrow(/403/);
		expect(previewReschedule).not.toHaveBeenCalled();
	});
});
