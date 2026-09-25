import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Market vendor applications, against a real SQLite: the public list is a
 * column-by-column select, and only a real table proves no contact detail can
 * reach it.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));
vi.mock('$lib/server/event-bus/event-bus', () => ({ domainEvents: { emit: vi.fn() } }));

// Delivery is the inbox's job; what matters here is that the vendor is told.
const sent = vi.fn(async (_params: { threadId: string; body: string }) => ({ id: 'msg' }));
vi.mock('$lib/server/inbox/message-service', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/inbox/message-service')>()),
	addOutboundMessage: (params: { threadId: string; body: string }) => sent(params)
}));

const {
	openMarketDay,
	getMarketDay,
	getApplicationWindow,
	submitApplication,
	listApplications,
	decideApplication,
	setTableLabel,
	withdrawApplication,
	listPublicVendors,
	getMarketOwnerGroupId,
	getVendorEventId,
	listCommitteeMarkets,
	listMarketDayVendors,
	checkInVendor,
	markVendorNoShow,
	recordInviteBack,
	MarketClosedError,
	VendorTransitionError
} = await import('./market-service');

const EVENT = 'evt-market';
const NOW = new Date('2026-10-01T12:00:00Z');
const STARTS = new Date('2026-10-20T16:00:00Z');
const ACTOR = { id: 'staff-1', name: 'Sam Staff' };

const application = {
	contactName: 'Rosa Diaz',
	contactEmail: 'rosa@example.com',
	contactPhone: '541-555-0100',
	businessName: 'Rosa Ceramics',
	offering: 'Handmade mugs and planters',
	website: 'https://rosa.example.com',
	tablesRequested: 2,
	needsPower: true,
	notes: 'Near an outlet please'
};

function insertEvent(status = 'published', startsAt = STARTS) {
	const s = Math.floor(startsAt.getTime() / 1000);
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id)
		 values ('${EVENT}', 'Autumn Market', ${s}, ${s + 4 * 3600}, '${status}', 'cmc', 'show', 'staff-1')`
	);
}

beforeEach(() => {
	for (const t of [
		'market_vendor',
		'market_day',
		'inbox_message',
		'inbox_thread',
		'event_listing',
		'project'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sent.mockClear();
});

describe('opening a market day', () => {
	it('marks the listing a market and records the setup', async () => {
		insertEvent();
		const closes = new Date('2026-10-10T00:00:00Z');
		await openMarketDay(EVENT, { applicationsCloseAt: closes, tableCount: 20 });

		const kind = sqlite.prepare(`select kind from event_listing where id = ?`).get(EVENT) as {
			kind: string;
		};
		expect(kind.kind).toBe('market');
		const day = await getMarketDay(EVENT, NOW);
		expect(day).toMatchObject({ tableCount: 20, accepting: true });
		expect(day?.applicationsCloseAt?.toISOString()).toBe(closes.toISOString());
	});

	it('updates the setup when opened again', async () => {
		insertEvent();
		await openMarketDay(EVENT, { applicationsCloseAt: null, tableCount: 10 });
		await openMarketDay(EVENT, { applicationsCloseAt: null, tableCount: 12 });
		expect((await getMarketDay(EVENT, NOW))?.tableCount).toBe(12);
	});

	it('is null for a listing that is not a market', async () => {
		insertEvent();
		expect(await getMarketDay(EVENT, NOW)).toBeNull();
		expect(await getApplicationWindow(EVENT, NOW)).toBeNull();
	});
});

describe('the application window', () => {
	it('is open on a published market before the closing date', async () => {
		insertEvent();
		await openMarketDay(EVENT, {
			applicationsCloseAt: new Date('2026-10-10T00:00:00Z'),
			tableCount: null
		});
		expect(await getApplicationWindow(EVENT, NOW)).toMatchObject({
			title: 'Autumn Market',
			accepting: true
		});
	});

	it('closes at the closing date', async () => {
		insertEvent();
		await openMarketDay(EVENT, {
			applicationsCloseAt: new Date('2026-09-30T00:00:00Z'),
			tableCount: null
		});
		expect((await getApplicationWindow(EVENT, NOW))?.accepting).toBe(false);
	});

	it('closes when the market starts, with no closing date set', async () => {
		insertEvent('published', new Date('2026-09-30T16:00:00Z'));
		await openMarketDay(EVENT, { applicationsCloseAt: null, tableCount: null });
		expect((await getApplicationWindow(EVENT, NOW))?.accepting).toBe(false);
	});

	it('is hidden from the public while the listing is a draft', async () => {
		insertEvent('draft');
		await openMarketDay(EVENT, { applicationsCloseAt: null, tableCount: null });
		expect(await getApplicationWindow(EVENT, NOW)).toBeNull();
	});
});

describe('applying', () => {
	beforeEach(async () => {
		insertEvent();
		await openMarketDay(EVENT, { applicationsCloseAt: null, tableCount: 20 });
	});

	it('opens an inbox thread holding the contact, and files the application', async () => {
		await submitApplication(EVENT, application, NOW);

		const [row] = await listApplications(EVENT);
		expect(row).toMatchObject({
			businessName: 'Rosa Ceramics',
			status: 'applied',
			tablesRequested: 2,
			needsPower: true,
			contactName: 'Rosa Diaz',
			contactEmail: 'rosa@example.com',
			contactPhone: '541-555-0100'
		});
		const thread = sqlite
			.prepare(`select channel, subject from inbox_thread where id = ?`)
			.get(row.threadId) as { channel: string; subject: string };
		expect(thread.channel).toBe('web');
		expect(thread.subject).toContain('Rosa Ceramics');
		const msg = sqlite
			.prepare(`select body from inbox_message where thread_id = ?`)
			.get(row.threadId) as { body: string };
		expect(msg.body).toContain('Handmade mugs and planters');
	});

	it('keeps contact details off the vendor row', () => {
		const cols = (
			sqlite.prepare(`pragma table_info(market_vendor)`).all() as { name: string }[]
		).map((c) => c.name);
		expect(cols.filter((c) => /email|phone|contact/.test(c))).toEqual([]);
	});

	it('refuses once applications have closed', async () => {
		await expect(
			submitApplication(EVENT, application, new Date('2026-10-21T00:00:00Z'))
		).rejects.toBeInstanceOf(MarketClosedError);
		expect(await listApplications(EVENT)).toHaveLength(0);
	});

	it('refuses a listing that is not a market', async () => {
		sqlite.exec(`delete from market_day`);
		await expect(submitApplication(EVENT, application, NOW)).rejects.toBeInstanceOf(
			MarketClosedError
		);
	});
});

describe('deciding', () => {
	let vendorId: string;
	beforeEach(async () => {
		insertEvent();
		await openMarketDay(EVENT, { applicationsCloseAt: null, tableCount: 20 });
		({ id: vendorId } = await submitApplication(EVENT, application, NOW));
	});

	it('accepts with a table, and tells the vendor on the thread', async () => {
		await decideApplication(
			vendorId,
			{ decision: 'accepted', tableLabel: 'B3', message: 'You are in — table B3.' },
			ACTOR
		);
		const [row] = await listApplications(EVENT);
		expect(row).toMatchObject({ status: 'accepted', tableLabel: 'B3', decidedByUserId: 'staff-1' });
		expect(sent).toHaveBeenCalledWith(
			expect.objectContaining({ threadId: row.threadId, body: 'You are in — table B3.' })
		);
	});

	it('declines and clears any table', async () => {
		await decideApplication(
			vendorId,
			{ decision: 'accepted', tableLabel: 'B3', message: 'In.' },
			ACTOR
		);
		await decideApplication(vendorId, { decision: 'declined', message: 'Sorry.' }, ACTOR);
		const [row] = await listApplications(EVENT);
		expect(row).toMatchObject({ status: 'declined', tableLabel: null });
	});

	it('refuses to decide the same way twice', async () => {
		await decideApplication(vendorId, { decision: 'declined', message: 'No.' }, ACTOR);
		await expect(
			decideApplication(vendorId, { decision: 'declined', message: 'No.' }, ACTOR)
		).rejects.toBeInstanceOf(VendorTransitionError);
	});

	it('treats withdrawn as final', async () => {
		await withdrawApplication(vendorId);
		await expect(
			decideApplication(vendorId, { decision: 'accepted', message: 'In.' }, ACTOR)
		).rejects.toBeInstanceOf(VendorTransitionError);
		expect(sent).not.toHaveBeenCalled();
	});

	it('moves a table only for an accepted vendor', async () => {
		await expect(setTableLabel(vendorId, 'A1')).rejects.toBeInstanceOf(VendorTransitionError);
		await decideApplication(vendorId, { decision: 'accepted', message: 'In.' }, ACTOR);
		await setTableLabel(vendorId, 'A1');
		expect((await listApplications(EVENT))[0].tableLabel).toBe('A1');
	});

	it('counts what the market has', async () => {
		await decideApplication(
			vendorId,
			{ decision: 'accepted', tableLabel: 'B3', message: 'In.' },
			ACTOR
		);
		await submitApplication(EVENT, { ...application, businessName: 'Second' }, NOW);
		expect((await getMarketDay(EVENT, NOW))?.counts).toEqual({
			applied: 1,
			accepted: 1,
			declined: 0,
			withdrawn: 0,
			no_show: 0
		});
	});
});

describe('the public vendor list', () => {
	it('lists accepted vendors only, with no contact detail', async () => {
		insertEvent();
		await openMarketDay(EVENT, { applicationsCloseAt: null, tableCount: 20 });
		const a = await submitApplication(EVENT, { ...application, businessName: 'Zed Soap' }, NOW);
		const b = await submitApplication(EVENT, { ...application, businessName: 'Apple Press' }, NOW);
		await submitApplication(EVENT, { ...application, businessName: 'Pending Co' }, NOW);
		await decideApplication(
			a.id,
			{ decision: 'accepted', tableLabel: 'C1', message: 'In.' },
			ACTOR
		);
		await decideApplication(b.id, { decision: 'accepted', message: 'In.' }, ACTOR);

		const list = await listPublicVendors(EVENT);
		expect(list.map((v) => v.businessName)).toEqual(['Apple Press', 'Zed Soap']);
		expect(Object.keys(list[0]).sort()).toEqual([
			'businessName',
			'offering',
			'tableLabel',
			'website'
		]);
	});
});

describe('the committee that owns a market', () => {
	const COMMITTEE = 'grp-dev';

	function ownEventBy(groupId: string | null) {
		sqlite.exec(
			`insert into project (id, name, status, group_id) values ('prj-1', 'Autumn Market', 'open', ${
				groupId ? `'${groupId}'` : 'null'
			})`
		);
		sqlite.exec(`update event_listing set project_id = 'prj-1' where id = '${EVENT}'`);
	}

	it("is the owning group of the listing's project", async () => {
		insertEvent();
		ownEventBy(COMMITTEE);
		expect(await getMarketOwnerGroupId(EVENT)).toBe(COMMITTEE);
	});

	it('is null for a listing with no project, or a project with no owner', async () => {
		insertEvent();
		expect(await getMarketOwnerGroupId(EVENT)).toBeNull();
		ownEventBy(null);
		expect(await getMarketOwnerGroupId(EVENT)).toBeNull();
	});

	it("reads a vendor's market from the row", async () => {
		insertEvent();
		await openMarketDay(EVENT, { applicationsCloseAt: null, tableCount: null });
		const { id } = await submitApplication(EVENT, application, NOW);
		expect(await getVendorEventId(id)).toBe(EVENT);
	});

	it("lists the committee's market days with how many wait on a decision", async () => {
		insertEvent();
		ownEventBy(COMMITTEE);
		await openMarketDay(EVENT, { applicationsCloseAt: null, tableCount: null });
		await submitApplication(EVENT, application, NOW);

		expect(await listCommitteeMarkets(COMMITTEE)).toEqual([
			{ eventId: EVENT, title: 'Autumn Market', startsAt: STARTS, toReview: 1 }
		]);
		expect(await listCommitteeMarkets('grp-other')).toEqual([]);
	});
});

describe('market day: check-in, no-shows and invite-back (#1505)', () => {
	let vendorId: string;
	beforeEach(async () => {
		insertEvent();
		await openMarketDay(EVENT, { applicationsCloseAt: null, tableCount: 20 });
		({ id: vendorId } = await submitApplication(EVENT, application, NOW));
	});

	const accept = () =>
		decideApplication(vendorId, { decision: 'accepted', tableLabel: 'A1', message: 'In.' }, ACTOR);

	it('checks in an accepted vendor, and can undo it', async () => {
		await accept();
		const at = new Date('2026-10-20T16:05:00Z');
		expect(await checkInVendor(vendorId, true, at)).toEqual({ eventId: EVENT });
		let [row] = await listMarketDayVendors(EVENT);
		expect(row).toMatchObject({ status: 'accepted', tableLabel: 'A1', checkedInAt: at });

		await checkInVendor(vendorId, false);
		[row] = await listMarketDayVendors(EVENT);
		expect(row.checkedInAt).toBeNull();
	});

	it('refuses to check in a vendor who was never accepted', async () => {
		await expect(checkInVendor(vendorId, true)).rejects.toBeInstanceOf(VendorTransitionError);
	});

	it('marks an accepted vendor who never arrived a no-show, and back', async () => {
		await accept();
		await markVendorNoShow(vendorId, true);
		expect((await listApplications(EVENT))[0].status).toBe('no_show');
		expect(await listPublicVendors(EVENT)).toEqual([]);
		expect((await getMarketDay(EVENT, NOW))?.counts.no_show).toBe(1);

		await markVendorNoShow(vendorId, false);
		expect((await listApplications(EVENT))[0].status).toBe('accepted');
	});

	it('will not call a vendor who checked in a no-show', async () => {
		await accept();
		await checkInVendor(vendorId, true);
		await expect(markVendorNoShow(vendorId, true)).rejects.toBeInstanceOf(VendorTransitionError);
	});

	it('does not let a decision move a no-show', async () => {
		await accept();
		await markVendorNoShow(vendorId, true);
		await expect(
			decideApplication(vendorId, { decision: 'accepted', message: 'In.' }, ACTOR)
		).rejects.toBeInstanceOf(VendorTransitionError);
		expect(sent).toHaveBeenCalledTimes(1);
	});

	it('lists only accepted vendors and no-shows for the day, without contact detail', async () => {
		await submitApplication(EVENT, { ...application, businessName: 'Pending Co' }, NOW);
		await accept();
		const rows = await listMarketDayVendors(EVENT);
		expect(rows.map((r) => r.businessName)).toEqual(['Rosa Ceramics']);
		expect(Object.keys(rows[0])).not.toContain('contactEmail');
		expect(Object.keys(rows[0])).not.toContain('threadId');
	});

	it('records whether to invite a vendor back, with a note', async () => {
		await accept();
		await recordInviteBack(vendorId, { inviteBack: true, note: '  Sold out by two.  ' });
		expect((await listMarketDayVendors(EVENT))[0]).toMatchObject({
			inviteBack: true,
			inviteBackNote: 'Sold out by two.'
		});
	});

	it('refuses an invite-back record for a vendor who was not at the market', async () => {
		await expect(
			recordInviteBack(vendorId, { inviteBack: false, note: '' })
		).rejects.toBeInstanceOf(VendorTransitionError);
	});

	it("shows the last market's invite-back record on the vendor's next application", async () => {
		const LATER = 'evt-market-2';
		const s = Math.floor(new Date('2026-12-05T17:00:00Z').getTime() / 1000);
		sqlite.exec(
			`insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id)
			 values ('${LATER}', 'Winter Market', ${s}, ${s + 3600}, 'published', 'cmc', 'show', 'staff-1')`
		);
		await openMarketDay(LATER, { applicationsCloseAt: null, tableCount: 20 });

		await accept();
		await markVendorNoShow(vendorId, true);
		await recordInviteBack(vendorId, { inviteBack: false, note: 'Never came, never called.' });

		// Same person, different capitalisation; and a stranger with no history.
		const applyAt = new Date('2026-11-01T12:00:00Z');
		await submitApplication(LATER, { ...application, contactEmail: 'Rosa@Example.com' }, applyAt);
		await submitApplication(
			LATER,
			{ ...application, businessName: 'New Co', contactEmail: 'new@example.com' },
			applyAt
		);

		const later = await listApplications(LATER);
		expect(later.find((a) => a.businessName === 'Rosa Ceramics')?.previous).toEqual({
			eventTitle: 'Autumn Market',
			startsAt: STARTS,
			status: 'no_show',
			inviteBack: false,
			note: 'Never came, never called.'
		});
		expect(later.find((a) => a.businessName === 'New Co')?.previous).toBeNull();
		// The earlier market does not look forward.
		expect((await listApplications(EVENT))[0].previous).toBeNull();
	});
});
