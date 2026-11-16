import { describe, expect, it } from 'vitest';
import { ticketStatuses } from '#lib/server/db/schema/ticket.js';
import { doorListTickets } from './door-list';

describe('doorListTickets', () => {
	const at = new Date('2026-11-01T20:00:00Z');
	const rows = ticketStatuses.map((status) => ({ id: status, status, updatedAt: at }));

	it('carries every status but an unpaid hold, cancelled included (#2797)', () => {
		expect(doorListTickets(rows).map((t) => t.status)).toEqual(
			ticketStatuses.filter((s) => s !== 'pending')
		);
	});

	it('stamps when a cancelled ticket was cancelled, and nothing on the rest', () => {
		const listed = doorListTickets(rows);
		expect(listed.find((t) => t.status === 'cancelled')?.cancelledAt).toEqual(at);
		expect(listed.filter((t) => t.cancelledAt !== null)).toHaveLength(1);
	});
});
