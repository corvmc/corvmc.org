import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { ListingViewer } from './visibility';

/**
 * Every public read of listings, on real SQLite, against one listing per
 * visibility (#2662). `scripts/event-visibility.spec.ts` keeps the list of
 * reads honest; this checks each one answers by the predicate.
 */

const { testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb, getRowCount: () => 0 }));
vi.mock('#lib/server/storage.js', () => ({
	resolveImageUrl: (k: string | null) => k,
	uploadFile: vi.fn(),
	deleteObject: vi.fn(),
	validateUpload: vi.fn()
}));

const events = await import('./event-service');
const { canSeeListing } = await import('./visibility');
const { checkForDuplicate } = await import('./community-event-service');
const { listRecentRecaps } = await import('./event-photo-service');
const { monthCalendar } = await import('#lib/server/poster/calendar-service.js');
const { isPublicListing } = await import('#lib/server/task/member-related.js');
const { eventListing, eventBand } = await import('#lib/server/db/schema/event.js');
const { group, groupMember } = await import('#lib/server/db/schema/group.js');
const { user } = await import('#lib/server/db/schema/authentication.js');
const { directoryEntry } = await import('#lib/server/db/schema/directory.js');
const { media, mediaAttachment } = await import('#lib/server/db/schema/media.js');

// 8pm club time on 14 June 2030, and a night in 2020 for the past reads.
const TONIGHT = new Date('2030-06-15T03:00:00Z');
const BEFORE = new Date('2030-06-15T02:00:00Z');
const LONG_AGO = new Date('2020-06-15T03:00:00Z');
const HOUR = 3_600_000;
const visibilities = ['public', 'members', 'group'] as const;

beforeAll(async () => {
	const u = (id: string) => ({ id, name: id, email: `${id}@example.com`, emailVerified: false });
	await testDb.insert(user).values([u('member'), u('outsider')]);
	await testDb.insert(group).values([
		{ id: 'band', kind: 'band', name: 'Band', slug: 'band' },
		{ id: 'club', kind: 'club', name: 'Club', slug: 'club' }
	]);
	await testDb
		.insert(groupMember)
		.values([{ groupId: 'band', userId: 'member', role: 'member', status: 'active' }]);
	await testDb.insert(directoryEntry).values({ id: 'entry-band', groupId: 'band', name: 'Band' });

	for (const v of visibilities) {
		for (const [when, startsAt] of [
			['next', TONIGHT],
			['past', LONG_AGO]
		] as const) {
			const id = `${when}-${v}`;
			await testDb.insert(eventListing).values({
				id,
				// One stem, so the duplicate check has something to match.
				title: `Velvets ${id}`,
				startsAt,
				endsAt: new Date(startsAt.getTime() + 3 * HOUR),
				status: 'published',
				source: 'cmc',
				kind: 'show',
				visibility: v,
				groupId: 'band',
				recapText: 'A night.',
				createdByUserId: 'member'
			});
			await testDb.insert(eventBand).values({
				eventId: id,
				name: 'Band',
				directoryEntryId: 'entry-band',
				status: 'confirmed'
			});
			await testDb.insert(media).values({
				id: `m-${id}`,
				key: `k-${id}`,
				contentType: 'image/jpeg',
				byteSize: 1
			});
			await testDb.insert(mediaAttachment).values({
				mediaId: `m-${id}`,
				attachableType: 'event_listing',
				attachableId: id,
				slot: 'gallery'
			});
		}
	}
});

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
const onlyPublic = (when: string) => [`${when}-public`];
const FROM = new Date('2030-01-01T00:00:00Z');

/** Every read anyone outside staff and the owner sees, and the listings it should return. */
const publicReads: [name: string, read: () => Promise<string[]>, expected: string[]][] = [
	['listUpcoming', async () => ids(await events.listUpcoming()), onlyPublic('next')],
	[
		'getShowTonight',
		async () => [(await events.getShowTonight(BEFORE))?.id ?? ''],
		onlyPublic('next')
	],
	['listPast', async () => ids(await events.listPast()), onlyPublic('past')],
	[
		'listBandEventsUpcoming',
		async () => ids(await events.listBandEventsUpcoming('band')),
		onlyPublic('next')
	],
	[
		'listBandEventsPast',
		async () => ids(await events.listBandEventsPast('band', { limit: 10, offset: 0 })),
		onlyPublic('past')
	],
	['countBandPastEvents', async () => [String(await events.countBandPastEvents('band'))], ['1']],
	[
		'listMemberUpcomingShows',
		async () => ids(await events.listMemberUpcomingShows('member')),
		onlyPublic('next')
	],
	[
		'listMemberPastShows',
		async () => ids(await events.listMemberPastShows('member', { limit: 10, offset: 0 })),
		onlyPublic('past')
	],
	[
		'countMemberPastShows',
		async () => [String(await events.countMemberPastShows('member'))],
		['1']
	],
	[
		'listPublicCalendarEvents',
		async () => ids(await events.listPublicCalendarEvents(FROM, new Date('2031-01-01'))),
		onlyPublic('next')
	],
	[
		'listPublicUpcomingEvents',
		async () => ids(await events.listPublicUpcomingEvents(FROM, { limit: 10, offset: 0 })),
		onlyPublic('next')
	],
	[
		'countPublicUpcomingEvents',
		async () => [String(await events.countPublicUpcomingEvents(FROM))],
		['1']
	],
	['monthCalendar', async () => ids((await monthCalendar('2030-06')).events), onlyPublic('next')],
	['listRecentRecaps', async () => ids(await listRecentRecaps(10, BEFORE)), onlyPublic('past')],
	[
		'checkForDuplicate',
		async () => [(await checkForDuplicate({ title: 'Velvets', startsAt: TONIGHT }))?.id ?? ''],
		onlyPublic('next')
	],
	[
		'isPublicListing',
		async () =>
			(
				await Promise.all(
					visibilities.map(async (v) => ((await isPublicListing(`next-${v}`, null)) ? v : null))
				)
			).flatMap((v) => (v ? [`next-${v}`] : [])),
		onlyPublic('next')
	]
];

describe('public reads', () => {
	it.each(publicReads)('%s returns only public listings', async (_, read, expected) => {
		expect(await read()).toEqual(expected);
	});
});

describe('visibleTo', () => {
	const seen = async (viewer: ListingViewer) => {
		const out: string[] = [];
		for (const v of visibilities) if (await canSeeListing(`next-${v}`, viewer)) out.push(v);
		return out;
	};

	it('shows the public only public listings', async () => {
		expect(await seen(null)).toEqual(['public']);
	});

	it('shows a member members listings but not another group’s', async () => {
		expect(await seen({ userId: 'outsider' })).toEqual(['public', 'members']);
	});

	it('shows a member of the owning group its group listings', async () => {
		expect(await seen({ userId: 'member' })).toEqual(['public', 'members', 'group']);
	});

	it('shows staff every listing', async () => {
		expect(await seen({ userId: 'outsider', seesAll: true })).toEqual([
			'public',
			'members',
			'group'
		]);
	});

	it('widens the guide for a signed-in member', async () => {
		const rows = await events.listPublicUpcomingEvents(
			FROM,
			{ limit: 10, offset: 0 },
			{ userId: 'member' }
		);
		expect(ids(rows)).toEqual(['next-group', 'next-members', 'next-public']);
	});
});
