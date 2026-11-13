import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { eventListing } from '../../src/lib/server/db/schema/event';
import { group } from '../../src/lib/server/db/schema/group';
import { project, projectCommittee } from '../../src/lib/server/db/schema/project';
import { inboxMessage, inboxThread } from '../../src/lib/server/db/schema/inbox';
import { marketDay, marketVendor } from '../../src/lib/server/db/schema/market';
import type { MarketVendorStatus } from '../../src/lib/config';
import { vendorDetail } from '../../src/lib/server/db/schema/party';
import { batchInsert, db } from './db';
import { seedOrganizations } from './parties';
import type { SeedUser } from './types';

/**
 * One market day CMC hosts, taking applications. docs/development/business-workflows.md §19.
 *
 * A vendor in every status, so each tab of /staff/events/[id]/vendors has rows,
 * plus the awkward ones: no website, two tables with power. Each has the web
 * thread its application opened, and a decided one has the staff reply. A
 * finished market before it carries invite-back records for two of them.
 */
// $25 a table on a sliding scale down to $10 (#1502): one accepted vendor paid, one owes.
const TABLE_FEE_CENTS = 2500;
const FLOOR_CENTS = 1000;
const vendors: {
	business: string;
	contact: string;
	offering: string;
	website: string | null;
	tables: number;
	power: boolean;
	status: MarketVendorStatus;
	table?: string;
	paidCents?: number;
}[] = [
	{
		business: 'Willamette Honey Co.',
		contact: 'June Park',
		offering: 'Raw local honey, beeswax candles and lip balm',
		website: 'https://willamette-honey.example.com',
		tables: 1,
		power: false,
		status: 'accepted',
		table: 'A1',
		paidCents: 1500
	},
	{
		business: 'Second Spin Records',
		contact: 'Theo Ruiz',
		offering: 'Used vinyl, cassettes and turntable repair',
		website: 'https://secondspin.example.com',
		tables: 2,
		power: true,
		status: 'accepted',
		table: 'B2–B3'
	},
	{
		business: 'Marys River Ceramics',
		contact: 'Ada Olsen',
		offering: 'Wheel-thrown mugs, bowls and planters',
		website: null,
		tables: 1,
		power: false,
		status: 'applied'
	},
	{
		business: 'Pedal Lab',
		contact: 'Kai Mendoza',
		offering: 'Handmade guitar effects pedals; live demos with a small amp',
		website: 'https://pedallab.example.com',
		tables: 2,
		power: true,
		status: 'applied'
	},
	{
		business: 'Vape Barn',
		contact: 'Rex Cole',
		offering: 'Vape pens and accessories',
		website: null,
		tables: 1,
		power: false,
		status: 'declined'
	},
	{
		business: 'Sticker Shock',
		contact: 'Mo Lee',
		offering: 'Band stickers and screen-printed patches',
		website: 'https://stickershock.example.com',
		tables: 1,
		power: false,
		status: 'withdrawn'
	}
];

export async function seedMarket(adminUser: SeedUser) {
	const day = 24 * 3600_000;
	const startsAt = new Date(Date.now() + 21 * day);
	startsAt.setUTCHours(17, 0, 0, 0);
	const endsAt = new Date(startsAt.getTime() + 5 * 3600_000);

	// Under the Art and Merchandise Committee's project, so `marketlead@` decides,
	// seats and withdraws from /member/groups (#2834).
	const [owner] = await db
		.select({ id: group.id })
		.from(group)
		.where(eq(group.slug, 'art-and-merchandise-committee'))
		.limit(1);
	const projectId = owner ? randomUUID() : null;
	if (owner && projectId) {
		await db.insert(project).values({
			id: projectId,
			name: 'Fall Makers Market',
			status: 'open',
			createdByUserId: adminUser.id
		});
		await db.insert(projectCommittee).values({ projectId, groupId: owner.id, role: 'owner' });
	}

	const [event] = await db
		.insert(eventListing)
		.values({
			projectId,
			title: 'Fall Makers Market',
			description: 'Local makers, record diggers and gear builders, with live sets all afternoon.',
			startsAt,
			endsAt,
			status: 'published',
			publishedAt: new Date(),
			source: 'cmc',
			kind: 'market',
			createdByUserId: adminUser.id
		})
		.returning({ id: eventListing.id, title: eventListing.title });

	await db.insert(marketDay).values({
		eventId: event.id,
		applicationsCloseAt: new Date(startsAt.getTime() - 7 * day),
		tableCount: 16,
		tableFeeCents: TABLE_FEE_CENTS,
		slidingScale: true,
		slidingScaleFloorCents: FLOOR_CENTS
	});

	// Each vendor is an organization with its person and standing setup (#2622).
	const orgIds = vendors.map(() => randomUUID());
	await seedOrganizations(
		vendors.map((v, i) => ({
			id: orgIds[i],
			name: v.business,
			roles: ['vendor'],
			website: v.website,
			person: { name: v.contact, email: email(v.contact) }
		}))
	);
	await batchInsert(
		vendorDetail,
		vendors.map((v, i) => ({
			organizationId: orgIds[i],
			offering: v.offering,
			tablesNeeded: v.tables,
			needsPower: v.power,
			bringsTent: i === 1
		}))
	);

	const threads = vendors.map((v, i) => ({
		id: randomUUID(),
		organizationId: orgIds[i],
		channel: 'web' as const,
		status: 'open' as const,
		subject: `Vendor application: ${v.business} — ${event.title}`,
		contactName: v.contact,
		contactEmail: email(v.contact),
		preview: v.offering,
		messageCount: v.status === 'accepted' || v.status === 'declined' ? 2 : 1,
		lastMessageAt: new Date(Date.now() - (i + 1) * 3600_000)
	}));
	await batchInsert(inboxThread, threads);

	const messages = vendors.flatMap((v, i) => {
		const inbound = {
			threadId: threads[i].id,
			direction: 'inbound' as const,
			body: `Market: ${event.title}\nBusiness: ${v.business}\nSells: ${v.offering}\nTables: ${v.tables}${v.power ? ', needs power' : ''}`,
			authorName: v.contact
		};
		if (v.status !== 'accepted' && v.status !== 'declined') return [inbound];
		return [
			inbound,
			{
				threadId: threads[i].id,
				direction: 'outbound' as const,
				body:
					v.status === 'accepted'
						? `Hi ${v.business} — you're in. Your table is ${v.table}.`
						: `Hi ${v.business} — thank you for applying. We can't offer you a table this time.`,
				authorName: adminUser.name,
				authorUserId: adminUser.id
			}
		];
	});
	await batchInsert(inboxMessage, messages);

	await batchInsert(
		marketVendor,
		vendors.map((v, i) => ({
			eventId: event.id,
			threadId: threads[i].id,
			organizationId: orgIds[i],
			bringsTent: i === 1,
			businessName: v.business,
			offering: v.offering,
			website: v.website,
			tablesRequested: v.tables,
			needsPower: v.power,
			status: v.status,
			tableLabel: v.table ?? null,
			decidedByUserId: v.status === 'accepted' || v.status === 'declined' ? adminUser.id : null,
			decidedAt: v.status === 'accepted' || v.status === 'declined' ? new Date() : null,
			feeCents: v.status === 'accepted' ? TABLE_FEE_CENTS * v.tables : 0,
			feeFloorCents: v.status === 'accepted' ? FLOOR_CENTS * v.tables : 0,
			paidCents: v.paidCents ?? null,
			paidAt: v.paidCents ? new Date() : null,
			stripePaymentRecordId: v.paidCents ? `pi_seed_market_${i}` : null
		}))
	);

	const past = await seedPastMarket(adminUser, orgIds);
	return { markets: 2, vendors: vendors.length + past };
}

const email = (contact: string) => `${contact.split(' ')[0].toLowerCase()}@example.com`;

/**
 * Last summer's market, done (#1505): two vendors who applied to the fall one
 * have an invite-back record here, one each way, so its applications tab shows
 * both. Matched by organization, which is why these reuse the fall vendors'.
 */
async function seedPastMarket(adminUser: SeedUser, orgIds: string[]): Promise<number> {
	const startsAt = new Date(Date.now() - 70 * 24 * 3600_000);
	startsAt.setUTCHours(17, 0, 0, 0);
	const [event] = await db
		.insert(eventListing)
		.values({
			title: 'Summer Makers Market',
			startsAt,
			endsAt: new Date(startsAt.getTime() + 5 * 3600_000),
			status: 'published',
			publishedAt: new Date(startsAt.getTime() - 30 * 24 * 3600_000),
			source: 'cmc',
			kind: 'market',
			createdByUserId: adminUser.id
		})
		.returning({ id: eventListing.id, title: eventListing.title });
	await db.insert(marketDay).values({ eventId: event.id, tableCount: 12 });

	const past = [
		{
			org: orgIds[2],
			v: vendors[2],
			status: 'accepted',
			table: 'A2',
			arrived: true,
			invite: true,
			note: 'Sold out of mugs by two. Give them a corner.'
		},
		{
			org: orgIds[3],
			v: vendors[3],
			status: 'no_show',
			table: 'C1',
			arrived: false,
			invite: false,
			note: 'Never arrived and never called.'
		},
		{
			org: orgIds[0],
			v: vendors[0],
			status: 'accepted',
			table: 'A1',
			arrived: true,
			invite: null,
			note: null
		}
	] as const;

	const threads = past.map(({ v, org }) => ({
		id: randomUUID(),
		organizationId: org,
		channel: 'web' as const,
		status: 'resolved' as const,
		subject: `Vendor application: ${v.business} — ${event.title}`,
		contactName: v.contact,
		contactEmail: email(v.contact),
		preview: v.offering,
		messageCount: 1,
		lastMessageAt: new Date(startsAt.getTime() - 20 * 24 * 3600_000)
	}));
	await batchInsert(inboxThread, threads);

	await batchInsert(
		marketVendor,
		past.map((p, i) => ({
			eventId: event.id,
			threadId: threads[i].id,
			organizationId: p.org,
			businessName: p.v.business,
			offering: p.v.offering,
			website: p.v.website,
			tablesRequested: p.v.tables,
			needsPower: p.v.power,
			status: p.status,
			tableLabel: p.table,
			decidedByUserId: adminUser.id,
			decidedAt: new Date(startsAt.getTime() - 14 * 24 * 3600_000),
			checkedInAt: p.arrived ? new Date(startsAt.getTime() - 30 * 60_000) : null,
			inviteBack: p.invite,
			inviteBackNote: p.note
		}))
	);
	return past.length;
}
