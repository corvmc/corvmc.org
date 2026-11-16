import { eq } from 'drizzle-orm';
import { eventListing } from '../../src/lib/server/db/schema/event';
import { randomUUID } from 'crypto';
import { volunteerRole, volunteerSignup } from '../../src/lib/server/db/schema/volunteer';
import { ticket, ticketSale } from '../../src/lib/server/db/schema/ticket';
import { donation } from '../../src/lib/server/db/schema/donation';
import { financialEntry } from '../../src/lib/server/db/schema/financial';
import { batchInsert, db } from './db';
import { insertTasksWithShifts } from './shifts';

/**
 * Tonight's collective show at the door (#612).
 *
 * `/member/volunteer/door` lists only a collective show starting within a day,
 * so this writes one relative to now, with a tapped sale, a free let-in, a cash
 * sale with its ledger rows (#2800) and a donation. The door shift is on now,
 * confirmed for `doorVolunteerId`, so that login can sell.
 */
export async function seedDoorSales(
	adminUserId: string,
	doorVolunteerId: string
): Promise<{ eventId: string }> {
	console.log('Seeding a show at the door...');

	const startsAt = new Date(Date.now() + 3 * 3600_000);
	const [show] = await db
		.insert(eventListing)
		.values({
			title: 'Door Night: Local Showcase',
			startsAt,
			endsAt: new Date(startsAt.getTime() + 3 * 3600_000),
			status: 'published',
			publishedAt: new Date(),
			source: 'cmc',
			kind: 'show',
			createdByUserId: adminUserId
		})
		.returning({ id: eventListing.id });

	await db.insert(ticketSale).values({
		eventListingId: show.id,
		enabled: true,
		priceCents: 1000,
		priceFloorCents: 0,
		quantity: 80
	});

	const checkedInAt = new Date();
	const door = { eventId: show.id, attendeeName: 'Door sale', attendeeEmail: '' };
	await batchInsert(ticket, [
		{
			...door,
			purchaseId: 'pi_seed_door_1',
			code: 'DOORSEED1',
			status: 'checked_in',
			stripePaymentRecordId: 'pi_seed_door_1',
			unitPriceCents: 1000,
			actsCents: 700,
			collectiveCents: 268,
			checkedInAt,
			checkedInByUserId: adminUserId
		},
		{
			...door,
			purchaseId: 'door-seed-free',
			code: 'DOORSEED2',
			status: 'checked_in',
			unitPriceCents: 0,
			checkedInAt,
			checkedInByUserId: adminUserId
		},
		// Cash, 2 × $10: the split sits on the order's first ticket, as `createTickets` writes it.
		{
			...door,
			purchaseId: 'cash-seed-1',
			code: 'DOORSEED3',
			status: 'checked_in',
			unitPriceCents: 1000,
			actsCents: 1400,
			collectiveCents: 600,
			checkedInAt,
			checkedInByUserId: adminUserId
		},
		{
			...door,
			purchaseId: 'cash-seed-1',
			code: 'DOORSEED4',
			status: 'checked_in',
			unitPriceCents: 1000,
			checkedInAt,
			checkedInByUserId: adminUserId
		}
	]);
	const cashLedger = {
		occurredAt: checkedInAt,
		settlement: 'cash' as const,
		subjectType: 'ticket' as const,
		subjectId: 'cash-seed-1'
	};
	await batchInsert(financialEntry, [
		{
			...cashLedger,
			amountCents: 600,
			kind: 'earned',
			category: 'ticket_sales',
			description: 'Ticket sale, door, cash'
		},
		{
			...cashLedger,
			amountCents: 1400,
			kind: 'pass_through',
			category: 'act_payout',
			settlementGroup: show.id,
			description: 'Door, designated to the acts'
		}
	]);

	// A gift tapped at the same door (#2548).
	await db.insert(donation).values({
		paymentIntentId: 'pi_seed_door_gift',
		eventId: show.id,
		amountCents: 2500,
		status: 'paid',
		takenByUserId: adminUserId,
		paidAt: checkedInAt
	});

	const [role] = await db
		.select({ id: volunteerRole.id })
		.from(volunteerRole)
		.where(eq(volunteerRole.name, 'Door'));
	if (role) {
		const [shift] = await insertTasksWithShifts([
			{
				id: randomUUID(),
				volunteerRoleId: role.id,
				eventId: show.id,
				startsAt: new Date(Date.now() - 30 * 60_000),
				endsAt: new Date(startsAt.getTime() + 3 * 3600_000),
				createdByUserId: adminUserId
			}
		]);
		await db
			.insert(volunteerSignup)
			.values({ shiftId: shift.shiftId, userId: doorVolunteerId, status: 'confirmed' });
	}

	return { eventId: show.id };
}
