import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A scheduled work order is an ordinary shift, and completes by the clock
 * rather than through `resolveWorkOrder` — so the reports it answered have to
 * close from the shift-completed event, or they read "In a work order" forever.
 */

const handlers: Record<string, ((arg: { data: unknown }) => Promise<void>)[]> = {};
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: {
		on: (name: string, handler: (arg: { data: unknown }) => Promise<void>) => {
			(handlers[name] ??= []).push(handler);
		}
	}
}));

const resolveFlagsOnCompletion = vi.fn().mockResolvedValue([]);
vi.mock('./work-request-service', () => ({ resolveFlagsOnCompletion }));

const { registerWorkRequestListeners, SCHEDULED_WORK_CLOSE_NOTE } =
	await import('./work-request-listener');

const completed = {
	signupId: 'sg-1',
	shiftId: 'wo-1',
	userId: 'vol-1',
	userName: 'Sam',
	userEmail: 'sam@test.com',
	roleName: 'Repairs',
	title: null,
	eventTitle: null,
	startsAt: '2026-09-20T17:00:00.000Z',
	endsAt: '2026-09-20T19:00:00.000Z'
};

const fire = (data: unknown) =>
	Promise.all((handlers['volunteer.shift_completed'] ?? []).map((h) => h({ data })));

beforeEach(() => {
	vi.clearAllMocks();
	for (const k of Object.keys(handlers)) delete handlers[k];
	registerWorkRequestListeners();
});

describe('volunteer.shift_completed', () => {
	it('asks to close the reports, which only happens when the work order is flagged', async () => {
		await fire(completed);

		expect(resolveFlagsOnCompletion).toHaveBeenCalledWith(
			'wo-1',
			'vol-1',
			SCHEDULED_WORK_CLOSE_NOTE
		);
	});

	it('does not reject the emit when closing fails', async () => {
		resolveFlagsOnCompletion.mockRejectedValueOnce(new Error('d1 down'));
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(fire(completed)).resolves.toBeDefined();
		expect(err).toHaveBeenCalled();
	});
});
