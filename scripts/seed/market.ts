import { randomUUID } from 'crypto';
import { eventListing } from '../../src/lib/server/db/schema/event';
import { inboxMessage, inboxThread } from '../../src/lib/server/db/schema/inbox';
import { marketDay, marketVendor } from '../../src/lib/server/db/schema/market';
import type { MarketVendorStatus } from '../../src/lib/config';
import { batchInsert, db } from './db';
import type { SeedUser } from './types';

/**
 * One market day CMC hosts, taking applications. docs/specs/market-vendors-spec.md.
 *
 * A vendor in every status, so each tab of /staff/events/[id]/vendors has rows,
 * plus the awkward ones: no website, two tables with power. Each has the web
 * thread its application opened, and a decided one has the staff reply.
 */
const vendors: {
	business: string;
	contact: string;
	offering: string;
	website: string | null;
	tables: number;
	power: boolean;
	status: MarketVendorStatus;
	table?: string;
}[] = [
	{
		business: 'Willamette Honey Co.',
		contact: 'June Park',
		offering: 'Raw local honey, beeswax candles and lip balm',
		website: 'https://willamette-honey.example.com',
		tables: 1,
		power: false,
		status: 'accepted',
		table: 'A1'
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

	const [event] = await db
		.insert(eventListing)
		.values({
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
		tableCount: 16
	});

	const threads = vendors.map((v, i) => ({
		id: randomUUID(),
		channel: 'web' as const,
		status: 'open' as const,
		subject: `Vendor application: ${v.business} — ${event.title}`,
		contactName: v.contact,
		contactEmail: `${v.contact.split(' ')[0].toLowerCase()}@example.com`,
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
			businessName: v.business,
			offering: v.offering,
			website: v.website,
			tablesRequested: v.tables,
			needsPower: v.power,
			status: v.status,
			tableLabel: v.table ?? null,
			decidedByUserId: v.status === 'accepted' || v.status === 'declined' ? adminUser.id : null,
			decidedAt: v.status === 'accepted' || v.status === 'declined' ? new Date() : null
		}))
	);

	return { markets: 1, vendors: vendors.length };
}
