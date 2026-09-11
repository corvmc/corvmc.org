import { account, user } from '../../src/lib/server/db/schema/authentication';
import { holdRoom } from './room';
import { modelHasRole } from '../../src/lib/server/db/schema/authorization';
import { creditTransaction } from '../../src/lib/server/db/schema/finance';
import { group, groupMember } from '../../src/lib/server/db/schema/group';
import { inventoryItem, inventoryLoan } from '../../src/lib/server/db/schema/inventory';
import { notification, notificationPreference } from '../../src/lib/server/db/schema/notification';
import { reservation } from '../../src/lib/server/db/schema/reservation';
import { suggestion, suggestionVote } from '../../src/lib/server/db/schema/suggestion';
import { ticket } from '../../src/lib/server/db/schema/ticket';
import { insertBandWithOwner } from './bands';
import { batchInsert, db } from './db';
import { scryptHash } from './hash';
import { pendingEntries, pendingSites, pendingTags } from './pending';
import { HOURLY_RATE_CENTS, type SeedEvent, type SeedRole, type SeedUser } from './types';
import { ptDate } from './util';
import { randomUUID } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Personas defined by a goal, not by one screen: the rows are whatever a person
 * pursuing that goal would have accumulated. Ordinary use is a spread rather
 * than a state, so no state fixture reached it (#864) — see
 * `docs/development/local-dev-quickstart.md#demo-logins`. Out of `allUsers`,
 * which `seedUserRoles` indexes, and free of `random()`.
 */
export const USAGE_PERSONAS = [
	{
		id: 'seed-use-regular',
		email: 'regular@corvallismusic.org',
		name: 'Dez Halloran',
		memberNumber: 60,
		/** "I book the room most weeks and I want it to be no trouble." */
		job: 'books the room weekly — a dashboard with everything on it',
		roles: ['member', 'sustaining'] as const
	},
	{
		id: 'seed-use-frontperson',
		email: 'frontperson@corvallismusic.org',
		name: 'Odile Marchetti',
		memberNumber: 61,
		/** "My band gigs and sells music, and this site is our storefront." */
		job: 'runs a premium band — owner of Saltmarsh Radio, no staff role',
		roles: ['member'] as const
	},
	{
		id: 'seed-use-bandmate',
		email: 'bandmate@corvallismusic.org',
		name: 'Tobias Nwachukwu',
		memberNumber: 62,
		/** "I am in the band. I do not run it." */
		job: 'plays in that band without owning it — the owner-gate falsifier',
		roles: ['member'] as const
	},
	{
		id: 'seed-use-restricted',
		email: 'restricted@corvallismusic.org',
		name: 'Cassidy Pike',
		memberNumber: 63,
		/** "I was reported, and I am on probation." */
		job: 'messaging restricted by an upheld report',
		roles: ['member'] as const
	},
	{
		id: 'seed-use-treasurer',
		email: 'treasurer@corvallismusic.org',
		name: 'Beatriz Okonkwo',
		memberNumber: 64,
		/** "I reconcile what came in." */
		job: 'treasurer — /staff/payments, but not /staff/settings',
		roles: ['member', 'treasurer'] as const
	},
	{
		id: 'seed-use-techcoord',
		email: 'techcoord@corvallismusic.org',
		name: 'Yusuf Lindqvist',
		memberNumber: 65,
		/** "I keep the site and the door locks working." */
		job: 'technology coordinator — settings and locks, not the flag queue',
		roles: ['member', 'technology_coordinator'] as const
	},
	{
		id: 'seed-use-moderator',
		email: 'moderator@corvallismusic.org',
		name: 'Harriet Osei',
		memberNumber: 66,
		/** "I clear the flag queue." */
		job: 'site moderator — flags and standing, not the money',
		roles: ['member', 'site_moderator'] as const
	},
	{
		id: 'seed-use-shiftlead',
		email: 'shiftlead@corvallismusic.org',
		name: 'Callum Renard',
		memberNumber: 67,
		/** "I fill Saturday's shifts." */
		job: 'volunteer coordinator — the hour queue, not the role picker',
		roles: ['member', 'volunteer_coordinator'] as const
	}
] as const;

export type UsagePersona = (typeof USAGE_PERSONAS)[number];

/** The band `frontperson@` owns and `bandmate@` plays in. */
const BAND = {
	name: 'Saltmarsh Radio',
	slug: 'saltmarsh-radio'
};

const ago = (days: number) => new Date(Date.now() - days * 86400000);

/**
 * Phase one: the accounts, their roles, and the band.
 *
 * Runs straight after `seedBands` because the band has to reach `pendingSites`
 * and `pendingEntries` before the seeders that drain them. It is appended to
 * `bands` rather than spliced in, so no existing band's random draw moves — and
 * the three seeders that slice that array take it by name instead.
 */
export async function seedUsagePersonas(roles: SeedRole[]) {
	console.log('Seeding usage personas...');
	const roleId = (name: string) => roles.find((r) => r.name === name)?.id;
	const memberRole = roleId('member');
	if (!memberRole) return null;

	const seeded = new Map<string, SeedUser>();

	for (const p of USAGE_PERSONAS) {
		const createdAt = ago(280);
		await db.insert(user).values({
			id: p.id,
			name: p.name,
			email: p.email,
			emailVerified: true,
			memberNumber: p.memberNumber,
			pronouns: 'they/them',
			createdAt,
			updatedAt: ago(1)
		});
		// Hashed per persona rather than once and reused, so every row carries its
		// own salt like a real signup would.
		await db.insert(account).values({
			id: `${p.id}-credential`,
			accountId: p.id,
			providerId: 'credential',
			userId: p.id,
			password: await scryptHash('password'),
			createdAt,
			updatedAt: createdAt
		});
		for (const name of p.roles) {
			const id = roleId(name);
			if (id) await db.insert(modelHasRole).values({ roleId: id, userId: p.id });
		}
		seeded.set(p.id, { id: p.id, name: p.name, email: p.email });
	}

	const frontperson = seeded.get('seed-use-frontperson')!;
	const bandmate = seeded.get('seed-use-bandmate')!;
	const regular = seeded.get('seed-use-regular')!;

	const band = await insertBandWithOwner(
		{
			name: BAND.name,
			slug: BAND.slug,
			bio: `${BAND.name} is a four-piece from Corvallis playing dub-inflected post-punk. They have been booking the practice room since 2022 and put a record out most years.`
		},
		frontperson.id,
		'vocals'
	);

	// Premium, because the surfaces this persona exists for — the page editor,
	// payouts, music upload — are all premium. No custom domain: two bands
	// already carry the active and pending states, and a third adds nothing.
	pendingSites.set(band.id, {
		tier: 'premium',
		subscription: {
			startedAt: ago(240).toISOString(),
			stripeSubscriptionId: 'sub_seed_saltmarsh',
			billingInterval: 'monthly',
			currentPeriodEnd: new Date(Date.now() + 12 * 86400000).toISOString(),
			cancelAtPeriodEnd: false
		}
	});
	pendingEntries.set(band.id, {
		tagline: 'Dub-inflected post-punk quartet',
		hometown: 'Corvallis, OR',
		foundedYear: '2022',
		lookingFor: null,
		visibility: 'public',
		contact: { email: 'booking+saltmarsh-radio@example.com' },
		links: [
			{
				label: 'Spotify',
				url: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb',
				embed: true
			}
		]
	});
	for (const value of ['post-punk', 'dub']) {
		pendingTags.push({ subjectId: band.id, kind: 'genre', value });
	}

	// The falsifier for every owner-only gate on the band panel: an active member
	// who is not the owner and holds no staff role, so a check that passes for
	// the wrong reason has something that fails.
	await db.insert(groupMember).values({
		groupId: band.id,
		userId: bandmate.id,
		role: 'member',
		position: 'bass',
		status: 'active',
		invitedById: frontperson.id
	});

	// A second band invites the bandmate in, so the accept/decline pair on
	// /member/bands has a row that belongs to somebody who can sign in.
	const [pendingBand] = await db
		.select({ id: group.id })
		.from(group)
		.where(and(eq(group.kind, 'band'), isNull(group.deletedAt)))
		.limit(1);
	if (pendingBand) {
		await db.insert(groupMember).values({
			groupId: pendingBand.id,
			userId: bandmate.id,
			role: 'member',
			position: 'bass',
			status: 'pending',
			invitedById: frontperson.id
		});
	}

	// The regular's own directory profile: the matching card on somebody else's
	// dashboard needs a subject as much as this persona needs a profile page.
	pendingEntries.set(regular.id, {
		bio: 'Books Tuesday evenings. Plays drums, mostly for other people’s projects.',
		tagline: 'Drummer for hire',
		hometown: 'Corvallis, OR',
		lookingFor: 'band',
		availableForHire: true,
		openToCollaboration: true,
		visibility: 'public',
		contact: { email: 'regular@corvallismusic.org' }
	});
	pendingTags.push({ subjectId: regular.id, kind: 'instrument', value: 'drums' });
	pendingTags.push({ subjectId: regular.id, kind: 'genre', value: 'post-punk' });

	return { personas: seeded, band };
}

/**
 * Phase two: what `regular@` has accumulated.
 *
 * Split from phase one because it needs rows that do not exist yet when the
 * accounts are created — events to hold a ticket, an inventory item to lend.
 * A dashboard card is not the reason any of these exist; they are what a member
 * who books most weeks would have, and the cards follow from that.
 */
export async function seedUsagePersonaLife(
	personas: Map<string, SeedUser>,
	events: SeedEvent[],
	adminUser: SeedUser
) {
	console.log('Seeding usage persona activity...');
	const regular = personas.get('seed-use-regular');
	if (!regular) return { reservations: 0, tickets: 0, loans: 0 };

	// --- the subscription that pays for the credits --------------------------
	const allocated = 12;
	const used = 5;
	await db
		.update(user)
		.set({
			stripeId: 'cus_seed_regular',
			creditFreeHours: allocated - used,
			creditEquipment: 2,
			subscription: {
				startedAt: ago(280).toISOString(),
				stripeSubscriptionId: 'sub_seed_regular',
				hoursPerReset: allocated,
				creditsResetAt: new Date(Date.now() + 9 * 86400000).toISOString(),
				coveringFees: true,
				cancelAtPeriodEnd: false
			}
		})
		.where(eq(user.id, regular.id));

	// `getUsageSinceLastAllocation` sums everything dated after the newest
	// allocation, so these have to straddle or the balance reads as untouched.
	await batchInsert(creditTransaction, [
		{
			userId: regular.id,
			creditType: 'free_hours' as const,
			amount: allocated,
			balanceAfter: allocated,
			source: 'monthly_allocation' as const,
			description: 'Monthly free hours allocation',
			metadata: {},
			createdAt: ago(21)
		},
		{
			userId: regular.id,
			creditType: 'free_hours' as const,
			amount: -used,
			balanceAfter: allocated - used,
			source: 'reservation' as const,
			description: 'Applied to reservation',
			metadata: {},
			createdAt: ago(7)
		}
	]);

	// --- the bookings --------------------------------------------------------
	// Tuesday evenings, which is the whole persona: one behind, one ahead, and
	// one today so the dashboard's "this week" list is never empty.
	// Tuesday evenings are this persona's whole identity, so these take the room
	// rather than asking for it; `findRoomConflicts` reports if that collided.
	const tuesday = Object.fromEntries(
		[-7, 0, 7].map((d) => [d, holdRoom(ptDate(d, 18), ptDate(d, 20), 'regular')])
	);

	const reservations = await batchInsert(
		reservation,
		[
			{
				bookerType: 'user' as const,
				bookerId: regular.id,
				createdByUserId: regular.id,
				status: 'completed' as const,
				...tuesday[-7],
				notes: 'Drum practice',
				creditsUsed: 4,
				cashDueCents: 0,
				paidAt: null
			},
			{
				bookerType: 'user' as const,
				bookerId: regular.id,
				createdByUserId: regular.id,
				status: 'confirmed' as const,
				...tuesday[0],
				notes: 'Drum practice',
				creditsUsed: 1,
				cashDueCents: Math.round(1.5 * HOURLY_RATE_CENTS),
				lockCode: '4417',
				lockAccessId: '620014',
				lockSyncedAt: ago(0)
			},
			{
				bookerType: 'user' as const,
				bookerId: regular.id,
				createdByUserId: regular.id,
				status: 'scheduled' as const,
				...tuesday[7],
				notes: 'Drum practice',
				creditsUsed: null,
				cashDueCents: 2 * HOURLY_RATE_CENTS
			}
		],
		8
	);

	// --- a ticket to something coming up, and a stub from one that happened ---
	const upcoming = events.find((e) => e.startsAt > new Date() && e.status === 'published');
	const past = events.find((e) => e.startsAt < new Date() && e.status === 'published');
	const ticketRows = [];
	if (upcoming) {
		ticketRows.push({
			eventId: upcoming.id,
			purchaseId: 'seed-purchase-regular-upcoming',
			userId: regular.id,
			attendeeName: regular.name,
			attendeeEmail: regular.email,
			code: 'SEED-REG-UP',
			status: 'valid' as const,
			unitPriceCents: 1500,
			contributionCents: 1500,
			actsCents: 1050,
			collectiveCents: 450,
			createdAt: ago(4)
		});
	}
	if (past) {
		ticketRows.push({
			eventId: past.id,
			purchaseId: 'seed-purchase-regular-past',
			userId: regular.id,
			attendeeName: regular.name,
			attendeeEmail: regular.email,
			code: 'SEED-REG-PAST',
			status: 'checked_in' as const,
			unitPriceCents: 1000,
			contributionCents: 1000,
			actsCents: 700,
			collectiveCents: 300,
			checkedInAt: past.startsAt,
			checkedInByUserId: adminUser.id,
			createdAt: ago(40)
		});
	}
	// 17 bound parameters a row × 5 = 85, under D1's 100.
	if (ticketRows.length) await batchInsert(ticket, ticketRows, 5);

	// --- something borrowed, something given back ----------------------------
	const items = await db
		.select({ id: inventoryItem.id })
		.from(inventoryItem)
		.where(eq(inventoryItem.isLoanable, true))
		.limit(2);
	const loans = items.length
		? await batchInsert(
				inventoryLoan,
				[
					{
						id: randomUUID(),
						itemId: items[0].id,
						userId: regular.id,
						quantity: 1,
						requestedPickupDate: ago(9),
						estimatedReturnDate: ago(2),
						checkedOutAt: ago(9),
						dueDate: ago(2),
						status: 'checked_out' as const,
						memberNotes: 'For the Tuesday sessions.'
					},
					{
						id: randomUUID(),
						itemId: items[items.length - 1].id,
						userId: regular.id,
						quantity: 1,
						requestedPickupDate: ago(60),
						estimatedReturnDate: ago(50),
						checkedOutAt: ago(60),
						returnedAt: ago(51),
						dueDate: ago(50),
						status: 'returned' as const
					}
				],
				5
			)
		: [];

	// --- what they think we should fix ---------------------------------------
	const suggestionId = randomUUID();
	await db.insert(suggestion).values({
		id: suggestionId,
		authorUserId: regular.id,
		title: 'A second kick pedal that lives in the room',
		body: 'Carrying one in every week is the only annoying part of booking. Happy to chip in.',
		category: 'gear_equipment',
		status: 'planned',
		visibility: 'visible',
		responseBody: 'Good idea — it is on the next equipment order.',
		responseByUserId: adminUser.id,
		responseAt: ago(3),
		createdAt: ago(12),
		updatedAt: ago(3)
	});
	await db.insert(suggestionVote).values({
		id: randomUUID(),
		suggestionId,
		userId: regular.id,
		createdAt: ago(12)
	});

	// --- the bell ------------------------------------------------------------
	await batchInsert(
		notification,
		[
			{
				id: randomUUID(),
				userId: regular.id,
				type: 'reservation_reminder',
				title: 'Your practice room booking is tomorrow',
				body: 'Tuesday, 6:00–8:00 PM. Your door code is in the reservation.',
				href: '/member/reservations',
				readAt: null,
				createdAt: ago(1)
			},
			{
				id: randomUUID(),
				userId: regular.id,
				type: 'ticket_confirmation',
				title: 'Your ticket is confirmed',
				href: '/member/tickets',
				readAt: ago(4),
				createdAt: ago(4)
			}
		],
		7
	);
	await batchInsert(
		notificationPreference,
		[
			{
				id: randomUUID(),
				userId: regular.id,
				notificationType: 'reservation_reminder',
				emailEnabled: true,
				inAppEnabled: true
			},
			{
				id: randomUUID(),
				userId: regular.id,
				notificationType: 'ticket_confirmation',
				emailEnabled: false,
				inAppEnabled: true
			}
		],
		7
	);

	return {
		reservations: reservations.length,
		tickets: ticketRows.length,
		loans: loans.length
	};
}
