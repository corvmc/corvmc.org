import { eventListing } from '../../src/lib/server/db/schema/event';
import { recurringSeries } from '../../src/lib/server/db/schema/recurring';
import { reservation } from '../../src/lib/server/db/schema/reservation';
import { buildSeedRRule as seedRRule } from '../seed-rrule';
import { db } from './db';
import { EVENT_TAGS_POOL, EVENT_TITLES } from './pools';
import { type SeedEvent, type SeedUser } from './types';
import { pick, pickN, ptDate, random, randomInt } from './util';
import { sql } from 'drizzle-orm';

export async function seedEvents(users: SeedUser[]): Promise<SeedEvent[]> {
	console.log('Seeding events...');
	const rows: SeedEvent[] = [];
	const staffUsers = users.slice(0, 6);

	async function createEventReservation(
		eventId: string,
		day: number,
		eventStartHour: number,
		eventEndHour: number,
		createdByUserId: string,
		reservationStatus: (typeof reservation.$inferSelect)['status']
	): Promise<string> {
		const startsAt = ptDate(day, eventStartHour, -30);
		const endsAt = ptDate(day, eventEndHour, 30);
		const [r] = await db
			.insert(reservation)
			.values({
				bookerType: 'event_listing',
				// The real polymorphic pointer, as event-service writes it. A literal
				// 'event_listing' here left every seeded hold unattached to its show.
				bookerId: eventId,
				createdByUserId,
				status: reservationStatus,
				startsAt,
				endsAt,
				notes: 'Event space reservation',
				cancellationReason: reservationStatus === 'cancelled' ? 'Event cancelled' : null
			})
			.returning();
		return r.id;
	}

	for (let i = 0; i < 6; i++) {
		const day = -randomInt(3, 30);
		const hour = randomInt(18, 20);
		const duration = pick([2, 3]);
		const tags = pickN(EVENT_TAGS_POOL, randomInt(1, 3)).join(', ');
		const startsAt = ptDate(day, hour);
		const endsAt = ptDate(day, hour + duration);
		const publishedAt = new Date(startsAt.getTime() - randomInt(7, 21) * 86400000);
		const creator = pick(staffUsers);

		// The id is minted up front so the hold can point at the event, the same
		// ordering event-service.create() uses.
		const eventId = crypto.randomUUID();
		let reservationId: string | undefined;
		if (random() < 0.75) {
			reservationId = await createEventReservation(
				eventId,
				day,
				hour,
				hour + duration,
				creator.id,
				'completed'
			);
		}

		const [e] = await db
			.insert(eventListing)
			.values({
				id: eventId,
				title: pick(EVENT_TITLES),
				description: 'Join us for an evening of live music and community.',
				startsAt,
				endsAt,
				doorsAt: ptDate(day, hour - 0.5),
				status: 'published',
				publishedAt,
				tags,
				reservationId,
				createdByUserId: creator.id
			})
			.returning();
		rows.push(e);
	}

	// Future events, one per ticketing shape: 3 paid ticketed across the three
	// sliding-scale settings, 2 free-ticketed, 1 sold off-site with a price,
	// 1 door price, 1 genuinely free.
	//
	// The three paid shapes are the point of the scale and all three have to be
	// reachable locally: a scale open all the way to free, a scale with a floor
	// under it, and a floor equal to the suggested price — which is a fixed
	// price, and is what every show looked like before the scale existed.
	const futureConfigs: {
		ticketingEnabled: boolean;
		ticketPrice: number | null;
		ticketPriceFloorCents?: number;
		ticketQuantity: number | null;
		externalTicketUrl?: string;
	}[] = [
		{ ticketingEnabled: true, ticketPrice: 1500, ticketPriceFloorCents: 0, ticketQuantity: 50 },
		{ ticketingEnabled: true, ticketPrice: 2000, ticketPriceFloorCents: 500, ticketQuantity: 30 },
		{ ticketingEnabled: true, ticketPrice: 1500, ticketPriceFloorCents: 1500, ticketQuantity: 60 },
		{ ticketingEnabled: true, ticketPrice: null, ticketQuantity: 40 },
		{ ticketingEnabled: true, ticketPrice: null, ticketQuantity: null },
		{
			ticketingEnabled: false,
			ticketPrice: 1800,
			ticketQuantity: null,
			externalTicketUrl: 'https://eventbrite.com/e/424242'
		},
		{ ticketingEnabled: false, ticketPrice: 1000, ticketQuantity: null },
		{ ticketingEnabled: false, ticketPrice: null, ticketQuantity: null }
	];

	for (let i = 0; i < futureConfigs.length; i++) {
		const day = randomInt(3, 28);
		const hour = randomInt(18, 20);
		const duration = pick([2, 3]);
		const tags = pickN(EVENT_TAGS_POOL, randomInt(1, 3)).join(', ');
		const startsAt = ptDate(day, hour);
		const endsAt = ptDate(day, hour + duration);
		const creator = pick(staffUsers);
		const config = futureConfigs[i];

		const eventId = crypto.randomUUID();
		let reservationId: string | undefined;
		if (random() < 0.75) {
			reservationId = await createEventReservation(
				eventId,
				day,
				hour,
				hour + duration,
				creator.id,
				'confirmed'
			);
		}

		const [e] = await db
			.insert(eventListing)
			.values({
				id: eventId,
				title: pick(EVENT_TITLES),
				description: config.externalTicketUrl
					? 'Tickets for this one are sold through our partner venue.'
					: config.ticketingEnabled && !config.ticketPrice
						? 'A free community event — grab a ticket to reserve your spot!'
						: 'An evening of live performances at the Collective.',
				startsAt,
				endsAt,
				doorsAt: ptDate(day, hour - 0.5),
				status: 'published',
				publishedAt: new Date(),
				tags,
				reservationId,
				ticketingEnabled: config.ticketingEnabled,
				ticketPrice: config.ticketPrice,
				ticketPriceFloorCents: config.ticketPriceFloorCents ?? 0,
				ticketQuantity: config.ticketQuantity,
				externalTicketUrl: config.externalTicketUrl ?? null,
				createdByUserId: creator.id
			})
			.returning();
		rows.push(e);
	}

	for (let i = 0; i < 2; i++) {
		const day = randomInt(14, 45);
		const hour = randomInt(18, 20);
		const creator = pick(staffUsers);

		const eventId = crypto.randomUUID();
		let reservationId: string | undefined;
		if (random() < 0.75) {
			reservationId = await createEventReservation(
				eventId,
				day,
				hour,
				hour + 3,
				creator.id,
				'scheduled'
			);
		}

		const [e] = await db
			.insert(eventListing)
			.values({
				id: eventId,
				title: pick(EVENT_TITLES),
				description: 'Details TBD',
				startsAt: ptDate(day, hour),
				endsAt: ptDate(day, hour + 3),
				status: 'draft',
				tags: pick(EVENT_TAGS_POOL),
				reservationId,
				createdByUserId: creator.id
			})
			.returning();
		rows.push(e);
	}

	const cancelledCreator = pick(staffUsers);
	const cancelledEventId = crypto.randomUUID();
	const cancelledResId = await createEventReservation(
		cancelledEventId,
		7,
		14,
		20,
		cancelledCreator.id,
		'cancelled'
	);
	const [cancelled] = await db
		.insert(eventListing)
		.values({
			id: cancelledEventId,
			title: 'Cancelled: Outdoor Festival',
			description: 'Unfortunately cancelled due to weather.',
			startsAt: ptDate(7, 14),
			endsAt: ptDate(7, 20),
			status: 'cancelled',
			tags: 'community, all ages',
			reservationId: cancelledResId,
			createdByUserId: cancelledCreator.id
		})
		.returning();
	rows.push(cancelled);

	const [cancelledNoRes] = await db
		.insert(eventListing)
		.values({
			title: 'Cancelled: Benefit Concert',
			description: 'Cancelled — performer unavailable.',
			startsAt: ptDate(14, 19),
			endsAt: ptDate(14, 22),
			status: 'cancelled',
			tags: 'ticketed, community',
			createdByUserId: pick(staffUsers).id
		})
		.returning();
	rows.push(cancelledNoRes);

	// A published CMC event that is deliberately not a show. It belongs on the
	// public calendar — a work party nobody is told about is a work party nobody
	// comes to — but not in the homepage posters or "show tonight", which are the
	// three surfaces `kind` exists to keep honest. Rendering it locally is the
	// only way that distinction is visible before production.
	const [workParty] = await db
		.insert(eventListing)
		.values({
			title: 'Work party: practice room deep clean',
			description:
				'Bring gloves. We are pulling everything out of the back room, cleaning behind it, and putting it back better than we found it.',
			startsAt: ptDate(9, 10),
			endsAt: ptDate(9, 14),
			status: 'published',
			publishedAt: new Date(),
			kind: 'work_party',
			tags: 'volunteer, all ages',
			createdByUserId: pick(staffUsers).id
		})
		.returning();
	rows.push(workParty);

	// Recurring CMC event: a weekly open mic. Prototype is a published past
	// occurrence; future occurrences are materialized as drafts (as the
	// generation job would produce), each with its own space reservation.
	{
		const creator = pick(staffUsers);
		const protoDay = -7;
		const hour = 19;
		const duration = 3;
		const protoStart = ptDate(protoDay, hour);

		const protoEventId = crypto.randomUUID();
		const protoResId = await createEventReservation(
			protoEventId,
			protoDay,
			hour,
			hour + duration,
			creator.id,
			'completed'
		);

		const [proto] = await db
			.insert(eventListing)
			.values({
				id: protoEventId,
				title: 'Weekly Open Mic',
				description: 'Sign up at the door — all skill levels welcome.',
				startsAt: protoStart,
				endsAt: ptDate(protoDay, hour + duration),
				doorsAt: ptDate(protoDay, hour - 0.5),
				status: 'published',
				publishedAt: new Date(protoStart.getTime() - 14 * 86400000),
				tags: 'open mic, all ages, community',
				reservationId: protoResId,
				createdByUserId: creator.id
			})
			.returning();
		rows.push(proto);

		const rrule = seedRRule(protoStart, 'weekly');
		const [series] = await db
			.insert(recurringSeries)
			.values({
				prototypeType: 'event_listing',
				prototypeId: proto.id,
				rrule,
				createdBy: creator.id
			})
			.returning();

		await db.run(
			sql`UPDATE event_listing SET recurring_series_id = ${series.id} WHERE id = ${proto.id}`
		);

		for (let w = 1; w <= 2; w++) {
			const instDay = protoDay + w * 7;
			const instEventId = crypto.randomUUID();
			const instResId = await createEventReservation(
				instEventId,
				instDay,
				hour,
				hour + duration,
				creator.id,
				'scheduled'
			);
			const [inst] = await db
				.insert(eventListing)
				.values({
					id: instEventId,
					title: proto.title,
					description: proto.description,
					startsAt: ptDate(instDay, hour),
					endsAt: ptDate(instDay, hour + duration),
					doorsAt: ptDate(instDay, hour - 0.5),
					status: 'draft',
					tags: proto.tags,
					reservationId: instResId,
					recurringSeriesId: series.id,
					createdByUserId: creator.id
				})
				.returning();
			rows.push(inst);
		}
	}

	// Stamp the back-link every event reservation needs.
	//
	// The app books the room *after* the event exists, so `bookerId` is the event
	// id (`event-service.ts`, `generation-job.ts`). This seed has to go the other
	// way round — `event.reservationId` is set at insert — so the reservation is
	// written first and its booker id is filled in here, once every event exists.
	// Without this pass every seeded event booking has a dangling booker, and the
	// staff reservations list reports the whole lot as "Unknown event".
	await db.run(sql`
		update reservation
		set booker_id = (select id from event_listing where event_listing.reservation_id = reservation.id)
		where booker_type = 'event_listing'
			and exists (select 1 from event_listing where event_listing.reservation_id = reservation.id)
	`);

	return rows;
}
