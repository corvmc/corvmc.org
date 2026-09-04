import { eventListing } from '../../src/lib/server/db/schema/event';
import { memberStanding } from '../../src/lib/server/db/schema/standing';
import { db } from './db';
import { type SeedUser } from './types';
import { pick, ptDate, randomInt } from './util';

/**
 * Member-authored community listings: off-site shows somebody in the scene
 * knows about.
 *
 * Every state is left reachable without clicking, the same discipline seedInbox
 * uses — a published listing on the guide, a draft only its author can see, and
 * a review-required member with one listing waiting on staff and one returned
 * to them. Without the last two the review queue and the fix-and-resubmit loop
 * are both invisible after a fresh seed.
 */
export const COMMUNITY_VENUES = [
	'The Whiteside Theatre, Corvallis',
	'Bombs Away Cafe, Corvallis',
	"Cloud & Kelly's, Corvallis",
	'Common Fields, Corvallis',
	'Old World Deli, Corvallis',
	"Sam Bond's Garage, Eugene",
	'The Boreal, Eugene'
];

export const COMMUNITY_TITLES = [
	'Basement show: three-band bill',
	'Songwriter round',
	'All-ages punk matinee',
	'Jazz night',
	'Folk showcase',
	'Noise & drone night',
	'Benefit show for the food bank'
];

export async function seedCommunityEvents(members: SeedUser[], staffUser: SeedUser) {
	console.log('Seeding community listings...');
	const rows = [];

	if (members.length < 2) return rows;

	const trusted = members[0];
	const onReview = members[1];

	// Published, from a trusted member — what the gig guide shows.
	for (let i = 0; i < 4; i++) {
		const [e] = await db
			.insert(eventListing)
			.values({
				title: COMMUNITY_TITLES[i % COMMUNITY_TITLES.length],
				description: 'Posted by a member. Not a CMC production.',
				startsAt: ptDate(randomInt(3, 40), randomInt(18, 21)),
				endsAt: null,
				location: pick(COMMUNITY_VENUES),
				source: 'community',
				status: 'published',
				publishedAt: new Date(),
				tags: pick(['all ages', 'punk, all ages', 'jazz', 'folk']),
				// A door price, an off-site link, or free — never CMC checkout.
				ticketPrice: pick([null, 500, 1000, 1500]),
				externalTicketUrl: i === 0 ? 'https://www.eventbrite.com/e/example' : null,
				createdByUserId: trusted.id
			})
			.returning();
		rows.push(e);
	}

	// A draft, so the member-side publish flow is reachable straight away.
	const [draft] = await db
		.insert(eventListing)
		.values({
			title: 'Untitled show (draft)',
			description: 'Half-written — still checking the date.',
			startsAt: ptDate(21, 20),
			endsAt: null,
			location: 'Bombs Away Cafe, Corvallis',
			source: 'community',
			status: 'draft',
			createdByUserId: trusted.id
		})
		.returning();
	rows.push(draft);

	// A member whose trust was revoked after an upheld report: one listing
	// waiting on staff, one returned to them with a reason.
	const [pending] = await db
		.insert(eventListing)
		.values({
			title: 'Warehouse show, address on request',
			description: 'DIY space, BYO.',
			startsAt: ptDate(12, 21),
			endsAt: null,
			location: 'Address given on request, Corvallis',
			source: 'community',
			status: 'pending_review',
			createdByUserId: onReview.id
		})
		.returning();
	rows.push(pending);

	const [rejected] = await db
		.insert(eventListing)
		.values({
			title: 'House party (bring your own)',
			description: 'No details yet.',
			startsAt: ptDate(9, 22),
			endsAt: null,
			location: 'Somewhere in Corvallis',
			source: 'community',
			status: 'rejected',
			reviewNotes: 'We need a real venue and a contact before this goes on the public calendar.',
			createdByUserId: onReview.id
		})
		.returning();
	rows.push(rejected);

	await db.insert(memberStanding).values({
		userId: onReview.id,
		scope: 'community_event',
		status: 'restricted',
		reason: 'A report about an earlier listing was upheld.',
		updatedByUserId: staffUser.id,
		updatedAt: new Date()
	});

	console.log(`  ${rows.length} community listings`);
	return rows;
}
