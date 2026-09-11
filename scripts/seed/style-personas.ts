import { account, user } from '../../src/lib/server/db/schema/authentication';
import { claimRoomNear, holdRoom } from './room';
import { modelHasRole } from '../../src/lib/server/db/schema/authorization';
import { eventListing } from '../../src/lib/server/db/schema/event';
import { creditTransaction } from '../../src/lib/server/db/schema/finance';
import { groupInvite } from '../../src/lib/server/db/schema/group-invite';
import { inventoryItem, inventoryLoan } from '../../src/lib/server/db/schema/inventory';
import { notification, notificationPreference } from '../../src/lib/server/db/schema/notification';
import { reservation } from '../../src/lib/server/db/schema/reservation';
import { ticket } from '../../src/lib/server/db/schema/ticket';
import { insertBandWithOwner } from './bands';
import { batchInsert, db } from './db';
import { scryptHash } from './hash';
import { pendingEntries, pendingSites, pendingTags } from './pending';
import { HOURLY_RATE_CENTS, type SeedEvent, type SeedRole, type SeedUser } from './types';
import { ptDate } from './util';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

/**
 * Personas that differ in **how** somebody uses the software rather than in what
 * they want — the third axis after state fixtures and `usage-personas.ts`.
 * Device, input method and assistive technology are runtime properties no seed
 * can hold; what it can hold is the residue a style leaves in the database, and
 * these four are what this schema expresses. The quickstart's demo-logins
 * section says which styles belong to Playwright instead.
 */
export const STYLE_PERSONAS = [
	{
		id: 'seed-sty-halffinished',
		email: 'halffinished@corvallismusic.org',
		name: 'Wes Adeyemi',
		memberNumber: 50,
		/** "I start things and mean to come back to them." */
		style: 'finishes nothing — every half-done state at once'
	},
	{
		id: 'seed-sty-poweruser',
		email: 'poweruser@corvallismusic.org',
		name: 'Nkechi Barrow',
		memberNumber: 51,
		/** "I am here constantly and I know where everything is." */
		style: 'two years of volume — every list, pager and total meets a real n'
	},
	{
		id: 'seed-sty-returning',
		email: 'returning@corvallismusic.org',
		name: 'Solomon Ferreira',
		memberNumber: 52,
		/** "I was around in 2024. What happened to everything?" */
		style: 'dormant two years — nothing recent, and a backlog that is all old'
	},
	{
		id: 'seed-sty-lockeddown',
		email: 'lockeddown@corvallismusic.org',
		name: 'Marta Kovač',
		memberNumber: 53,
		/** "I want to be here without being findable." */
		style: 'opted out of everything — hidden, no DMs, no notifications'
	}
] as const;

/** The band `halffinished@` created and never came back to. */
const BARE_BAND = { name: 'Second Thoughts', slug: 'second-thoughts' };

const ago = (days: number) => new Date(Date.now() - days * 86400000);

/**
 * Phase one: accounts, listing rows, and the band nobody finished.
 *
 * Runs beside `seedUsagePersonas` for the same reason — `pendingEntries` and
 * `pendingSites` are drained a few lines later, and a directory entry written
 * after that point does not exist.
 */
export async function seedStylePersonas(roles: SeedRole[]) {
	console.log('Seeding usage-style personas...');
	const memberRole = roles.find((r) => r.name === 'member')?.id;
	if (!memberRole) return null;

	const seeded = new Map<string, SeedUser>();
	// Each persona's account is as old as the style implies: the returner's
	// dormancy and the power user's backlog are both read off these two dates.
	const ages: Record<string, { created: number; updated: number }> = {
		'seed-sty-halffinished': { created: 40, updated: 26 },
		'seed-sty-poweruser': { created: 760, updated: 0 },
		'seed-sty-returning': { created: 1180, updated: 2 },
		'seed-sty-lockeddown': { created: 300, updated: 5 }
	};

	for (const p of STYLE_PERSONAS) {
		const age = ages[p.id];
		await db.insert(user).values({
			id: p.id,
			name: p.name,
			email: p.email,
			emailVerified: true,
			memberNumber: p.memberNumber,
			pronouns: 'they/them',
			// The one column that is the persona rather than a consequence of it.
			acceptsDirectMessages: p.id !== 'seed-sty-lockeddown',
			phone: p.id === 'seed-sty-poweruser' ? '541-555-0151' : null,
			createdAt: ago(age.created),
			updatedAt: ago(age.updated)
		});
		await db.insert(account).values({
			id: `${p.id}-credential`,
			accountId: p.id,
			providerId: 'credential',
			userId: p.id,
			password: await scryptHash('password'),
			createdAt: ago(age.created),
			updatedAt: ago(age.created)
		});
		await db.insert(modelHasRole).values({ roleId: memberRole, userId: p.id });
		seeded.set(p.id, { id: p.id, name: p.name, email: p.email });
	}

	// Started and abandoned: no tagline, no bio, no tags, no image, so
	// `isProfileComplete` is false on an account that has been here a month and
	// the dashboard's finish-your-profile nudge is reachable by signing in.
	pendingEntries.set('seed-sty-halffinished', { visibility: 'members' });

	pendingEntries.set('seed-sty-poweruser', {
		bio: 'Been booking here since 2024. Ask me where the spare cables live.',
		tagline: 'Around most days',
		hometown: 'Corvallis, OR',
		availableForHire: true,
		openToCollaboration: true,
		visibility: 'public',
		contact: { email: 'poweruser@corvallismusic.org' }
	});
	pendingTags.push({ subjectId: 'seed-sty-poweruser', kind: 'instrument', value: 'guitar' });
	pendingTags.push({ subjectId: 'seed-sty-poweruser', kind: 'genre', value: 'indie' });

	// Filled in years ago and never revised — the profile equivalent of a dead
	// link, which is what a returning member's own page actually looks like.
	pendingEntries.set('seed-sty-returning', {
		bio: 'Plays bass. Mostly around in the summer.',
		tagline: 'Back after a while away',
		hometown: 'Albany, OR',
		visibility: 'members',
		links: [{ label: 'MySpace', url: 'https://myspace.com/example' }]
	});
	pendingTags.push({ subjectId: 'seed-sty-returning', kind: 'instrument', value: 'bass' });

	// Hidden with a full profile behind it. A blank account would prove nothing:
	// the question is whether a filled-in member stays out of the directory, the
	// match card and the press kit when they asked to.
	pendingEntries.set('seed-sty-lockeddown', {
		bio: 'Here for the room, not the rolodex.',
		tagline: 'Keeping to myself',
		hometown: 'Corvallis, OR',
		visibility: 'hidden',
		contact: null
	});
	pendingTags.push({ subjectId: 'seed-sty-lockeddown', kind: 'instrument', value: 'drums' });

	// A band as the create-band modal leaves it: a name and nothing else. One
	// already exists in `seedBands`, owned by an account with no password.
	const bareBand = await insertBandWithOwner(
		{ name: BARE_BAND.name, slug: BARE_BAND.slug },
		'seed-sty-halffinished'
	);
	pendingSites.set(bareBand.id, { tier: 'free' });
	pendingEntries.set(bareBand.id, { visibility: 'members' });

	return { personas: seeded, bareBand };
}

/**
 * Phase two: the history each style leaves behind.
 *
 * Needs events and inventory, so it runs with the other late persona seeder.
 * Volume is the whole point for `poweruser@` — a pager with four rows in it has
 * never been looked at.
 */
export async function seedStylePersonaHistory(
	personas: Map<string, SeedUser>,
	events: SeedEvent[],
	adminUser: SeedUser
) {
	console.log('Seeding usage-style history...');
	if (personas.size === 0) return { reservations: 0, tickets: 0, notifications: 0 };

	const HALF = 'seed-sty-halffinished';
	const POWER = 'seed-sty-poweruser';
	const BACK = 'seed-sty-returning';
	const LOCKED = 'seed-sty-lockeddown';

	const reservationRows: (typeof reservation.$inferInsert)[] = [];
	// Named bookings take the room rather than asking for it — a walkthrough
	// that cannot find the booking it is pointed at is worse than an overlap,
	// and `findRoomConflicts` is what says if one happened anyway (#966).
	const holdFixture = (r: { status?: string; startsAt?: Date; endsAt?: Date }) => {
		if (!r.startsAt || !r.endsAt || r.status === 'cancelled') return;
		const slot = holdRoom(r.startsAt, r.endsAt, 'persona');
		r.startsAt = slot.startsAt;
		r.endsAt = slot.endsAt;
	};
	const ticketRows: (typeof ticket.$inferInsert)[] = [];
	const pushReservation = (r: typeof reservation.$inferInsert) => {
		holdFixture(r as { status?: string; startsAt?: Date; endsAt?: Date });
		reservationRows.push(r);
	};
	const creditRows: (typeof creditTransaction.$inferInsert)[] = [];
	const notificationRows: (typeof notification.$inferInsert)[] = [];

	// --- the abandoner -------------------------------------------------------
	// Booked, never paid, and still in the future: the one reservation state a
	// member can leave sitting there themselves.
	pushReservation({
		bookerType: 'user',
		bookerId: HALF,
		createdByUserId: HALF,
		status: 'scheduled',
		startsAt: ptDate(9, 19),
		endsAt: ptDate(9, 21),
		notes: 'Will confirm the time',
		creditsUsed: null,
		cashDueCents: 2 * HOURLY_RATE_CENTS
	});

	// Written, not published. The seed's other draft listing belongs to a bulk
	// account, so the member-side publish flow had no owner who could sign in.
	await db.insert(eventListing).values({
		title: 'Basement show (working title)',
		description: 'Still chasing the third band.',
		startsAt: ptDate(26, 20),
		endsAt: null,
		location: 'Somewhere in south town',
		source: 'community',
		status: 'draft',
		createdByUserId: HALF
	});

	// --- two years of volume -------------------------------------------------
	// Fortnightly for two years. Enough that every list this member appears on
	// pages, sorts and totals over a real number rather than over four rows.
	let balance = 24;
	for (let week = 104; week >= 2; week -= 2) {
		// Volume, not a particular hour — so these ask for the room rather than
		// taking it, unlike the named bookings above.
		const slot = claimRoomNear(ptDate(-week * 7, 17), 2, 'poweruser');
		if (!slot) continue;
		reservationRows.push({
			bookerType: 'user',
			bookerId: POWER,
			createdByUserId: POWER,
			status: 'completed',
			...slot,
			notes: week % 6 === 0 ? 'Recording session' : null,
			creditsUsed: 4,
			cashDueCents: 0,
			paidAt: null
		});
		balance -= 4;
		if (balance <= 4) balance = 24;
		creditRows.push({
			userId: POWER,
			creditType: 'free_hours',
			amount: -4,
			balanceAfter: balance,
			source: 'reservation',
			description: 'Applied to reservation',
			metadata: {},
			createdAt: ptDate(-week * 7, 17)
		});
	}
	pushReservation({
		bookerType: 'user',
		bookerId: POWER,
		createdByUserId: POWER,
		status: 'confirmed',
		startsAt: ptDate(2, 17),
		endsAt: ptDate(2, 19),
		notes: null,
		creditsUsed: 4,
		cashDueCents: 0
	});

	const pastEvents = events.filter((e) => e.startsAt < new Date() && e.status === 'published');
	pastEvents.slice(0, 12).forEach((event, index) => {
		ticketRows.push({
			eventId: event.id,
			purchaseId: `seed-purchase-power-${index}`,
			userId: POWER,
			attendeeName: 'Nkechi Barrow',
			attendeeEmail: 'poweruser@corvallismusic.org',
			code: `SEED-PWR-${String(index).padStart(2, '0')}`,
			status: 'checked_in',
			unitPriceCents: 1000,
			contributionCents: 1000,
			checkedInAt: event.startsAt,
			checkedInByUserId: adminUser.id,
			createdAt: new Date(event.startsAt.getTime() - 3 * 86400000)
		});
	});

	for (let i = 0; i < 28; i++) {
		notificationRows.push({
			id: randomUUID(),
			userId: POWER,
			type: i % 3 === 0 ? 'ticket_confirmation' : 'reservation_reminder',
			title: i % 3 === 0 ? 'Your ticket is confirmed' : 'Your booking is tomorrow',
			href: i % 3 === 0 ? '/member/tickets' : '/member/reservations',
			// Two unread at the top of a long read history — the shape a heavy
			// user's bell actually has, rather than all-unread or all-read.
			readAt: i < 2 ? null : ago(i * 9),
			createdAt: ago(i * 9)
		});
	}

	// --- the returner --------------------------------------------------------
	// The history stops dead two years ago. Every "recent activity" panel is
	// empty for somebody who is nonetheless not a new member.
	for (const week of [96, 92, 88]) {
		const slot = claimRoomNear(ptDate(-week * 7, 18), 2, 'returning');
		if (!slot) continue;
		reservationRows.push({
			bookerType: 'user',
			bookerId: BACK,
			createdByUserId: BACK,
			status: 'completed',
			...slot,
			notes: null,
			creditsUsed: null,
			cashDueCents: 2 * HOURLY_RATE_CENTS,
			paidAt: slot.startsAt
		});
	}
	for (let i = 0; i < 14; i++) {
		notificationRows.push({
			id: randomUUID(),
			userId: BACK,
			type: 'event_cancellation',
			title: 'A show you had a ticket for was cancelled',
			href: '/member/tickets',
			// Never opened, and all of it older than the dormancy. An unread count
			// that large with nothing recent behind it is its own rendering case.
			readAt: null,
			createdAt: ago(620 + i * 11)
		});
	}
	// An invitation that expired while they were away, so the members page has a
	// row in the one invite state nothing else in the seed produces.
	const [staleBand] = await db
		.select({ id: eventListing.groupId })
		.from(eventListing)
		.where(eq(eventListing.source, 'band'))
		.limit(1);
	if (staleBand?.id) {
		await db.insert(groupInvite).values({
			groupId: staleBand.id,
			email: 'returning@corvallismusic.org',
			role: 'member',
			invitedById: adminUser.id,
			status: 'pending',
			expiresAt: ago(600),
			createdAt: ago(607)
		});
	}

	// --- locked down ---------------------------------------------------------
	// Real activity behind the opt-outs, so a page that renders nothing is
	// rendering the preference rather than an empty account.
	pushReservation({
		bookerType: 'user',
		bookerId: LOCKED,
		createdByUserId: LOCKED,
		status: 'completed',
		startsAt: ptDate(-11, 20),
		endsAt: ptDate(-11, 22),
		notes: null,
		creditsUsed: null,
		cashDueCents: 2 * HOURLY_RATE_CENTS,
		paidAt: ptDate(-11, 20)
	});
	pushReservation({
		bookerType: 'user',
		bookerId: LOCKED,
		createdByUserId: LOCKED,
		status: 'confirmed',
		startsAt: ptDate(4, 20),
		endsAt: ptDate(4, 22),
		notes: null,
		creditsUsed: null,
		cashDueCents: 2 * HOURLY_RATE_CENTS
	});
	await batchInsert(
		notificationPreference,
		[
			'check_in_reminder',
			'reservation_reminder',
			'confirmation_reminder',
			'band_invitation',
			'band_invitation_accepted',
			'recurring_skipped'
		].map((notificationType) => ({
			id: randomUUID(),
			userId: LOCKED,
			notificationType,
			emailEnabled: false,
			inAppEnabled: false
		})),
		7
	);

	// --- writes --------------------------------------------------------------
	// 12 bound parameters a row × 8 = 96, under D1's 100. The count is what
	// drizzle binds, not what is written here: `id` carries a JS default.
	await batchInsert(reservation, reservationRows, 8);
	// 17 × 5 = 85 — `ticket` binds its split columns whether or not they are set.
	if (ticketRows.length) await batchInsert(ticket, ticketRows, 5);
	// 8 × 12 = 96.
	await batchInsert(creditTransaction, creditRows, 12);
	// 7 × 14 = 98.
	await batchInsert(notification, notificationRows, 14);
	await db
		.update(user)
		.set({ creditFreeHours: balance, creditEquipment: 3 })
		.where(eq(user.id, POWER));

	// An equipment request left sitting in the queue, which is the abandoner's
	// mark on a staff surface rather than on their own.
	const [item] = await db
		.select({ id: inventoryItem.id })
		.from(inventoryItem)
		.where(eq(inventoryItem.isLoanable, true))
		.limit(1);
	if (item) {
		await db.insert(inventoryLoan).values({
			id: randomUUID(),
			itemId: item.id,
			userId: HALF,
			quantity: 1,
			requestedPickupDate: ptDate(9, 17),
			status: 'requested',
			memberNotes: 'If it is free that week'
		});
	}

	return {
		reservations: reservationRows.length,
		tickets: ticketRows.length,
		notifications: notificationRows.length
	};
}
