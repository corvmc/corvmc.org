import { randomUUID } from 'crypto';
import { asc, inArray } from 'drizzle-orm';
import { eventBand } from '../../src/lib/server/db/schema/event';
import { ticket } from '../../src/lib/server/db/schema/ticket';
import { batchInsert, db } from './db';
import { TICKET_CODES_PREFIX } from './pools';

/**
 * Guests per act (#3274), on the first production with a bill of two acts or more.
 *
 * Every state the lineup panel renders: an act with two guests (one checked in),
 * an act with one, an act with a cancelled guest only, and a legacy comp with no
 * act at all, which the panel must not list under any act.
 */
export async function seedActGuests(productions: { eventId: string }[]) {
	console.log('Seeding act guests...');

	const eventIds = [...new Set(productions.map((p) => p.eventId))];
	const credits = eventIds.length
		? await db
				.select({ id: eventBand.id, eventId: eventBand.eventId })
				.from(eventBand)
				.where(inArray(eventBand.eventId, eventIds))
				.orderBy(asc(eventBand.billingOrder))
		: [];

	const byEvent = new Map<string, string[]>();
	for (const c of credits) byEvent.set(c.eventId, [...(byEvent.get(c.eventId) ?? []), c.id]);
	const target = [...byEvent.entries()].find(([, ids]) => ids.length >= 2);
	if (!target) return { guests: 0 };
	const [eventId, [first, second, third]] = target;

	const guest = (
		name: string,
		eventBandId: string | null,
		status: 'valid' | 'checked_in' | 'cancelled'
	) => ({
		eventId,
		eventBandId,
		purchaseId: `comp-${randomUUID()}`,
		attendeeName: name,
		attendeeEmail: `${name.toLowerCase().replace(/\W+/g, '.')}@example.com`,
		code: `${TICKET_CODES_PREFIX}-${randomUUID().slice(0, 8).toUpperCase()}`,
		status,
		unitPriceCents: 0,
		checkedInAt: status === 'checked_in' ? new Date() : null
	});

	const rows = [
		guest('Rowan Ellis', first, 'valid'),
		guest('Mika Tanaka', first, 'checked_in'),
		guest('Dana Whitfield', second, 'valid'),
		// The third act, when there is one, has only a cancelled guest.
		...(third ? [guest('Priya Nair', third, 'cancelled')] : []),
		guest('Old Friend', null, 'valid')
	];
	await batchInsert(ticket, rows);
	return { guests: rows.length };
}
