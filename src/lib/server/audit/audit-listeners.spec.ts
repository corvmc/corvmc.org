import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers: Record<string, (arg: { data: unknown }) => Promise<void>> = {};
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: {
		on: (name: string, fn: (arg: { data: unknown }) => Promise<void>) => {
			handlers[name] = fn;
		}
	}
}));

const recordAuditEntry = vi.fn(async (_entry: unknown) => undefined);
vi.mock('./audit-service', () => ({
	recordAuditEntry: (entry: unknown) => recordAuditEntry(entry)
}));

import { registerAuditListeners } from './audit-listeners';

const cancellation = {
	reservationId: 'res-1',
	userId: 'member-1',
	userName: 'Jordan',
	userEmail: 'jordan@example.com',
	date: 'Thu, May 21',
	startTime: '10:00 AM',
	endTime: '11:00 AM',
	cancelledBy: 'staff' as const,
	reason: 'Room flooded'
};

beforeEach(() => {
	recordAuditEntry.mockClear();
	registerAuditListeners();
});

describe('reservation.cancelled', () => {
	it('records a staff cancellation against the member who booked', async () => {
		await handlers['reservation.cancelled']({ data: cancellation });

		expect(recordAuditEntry).toHaveBeenCalledWith({
			action: 'reservation.cancelled_by_staff',
			subject: { type: 'user', id: 'member-1', label: 'Jordan' },
			details: {
				reservationId: 'res-1',
				reason: 'Room flooded',
				date: 'Thu, May 21',
				startTime: '10:00 AM',
				endTime: '11:00 AM'
			}
		});
	});

	it('records a missing reason as null', async () => {
		await handlers['reservation.cancelled']({ data: { ...cancellation, reason: undefined } });

		expect(recordAuditEntry).toHaveBeenCalledWith(
			expect.objectContaining({ details: expect.objectContaining({ reason: null }) })
		);
	});

	it.each(['member', 'owner', 'system'] as const)('ignores a cancellation by %s', async (by) => {
		await handlers['reservation.cancelled']({ data: { ...cancellation, cancelledBy: by } });

		expect(recordAuditEntry).not.toHaveBeenCalled();
	});
});
