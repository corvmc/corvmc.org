import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Asking, and deriving whether it came. Against a real SQLite because the
 * uniqueness rule — one live ask per artifact per act — is a constraint, and a
 * mocked `db` has none.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	// `await import`, not `require`: the helper is TypeScript, which Node's
	// require cannot load. An async hoisted factory still resolves before the
	// mock below is asked for a database.
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const riderSummaries = vi.fn(async () => [] as { name: string; empty: boolean }[]);
vi.mock('$lib/server/band/rider-service', () => ({
	getEventRiderSummaries: () => riderSummaries()
}));

const uploaded = vi.fn(async (_buf: ArrayBuffer, key: string) => key);
vi.mock('$lib/server/storage', () => ({
	uploadFile: (buf: ArrayBuffer, key: string) => uploaded(buf, key),
	resolveImageUrl: (key: string | null) => (key ? `https://media.test/${key}` : null)
}));

const {
	cancelArtifactRequest,
	deliverPosterArt,
	listRequests,
	livePosterRequests,
	outstandingCount,
	promotePosterArt,
	requestArtifact,
	requestableActs,
	searchAskableEntries,
	PosterRequestNotFoundError
} = await import('./artifact-request-service');

const EVENT = 'evt-1';
const ENTRY = 'entry-1';

beforeEach(() => {
	for (const t of [
		'artifact_request',
		'directory_entry',
		'event_band',
		'media_attachment',
		'media',
		'event_listing'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(
		`insert into directory_entry (id, name, visibility) values ('${ENTRY}', 'The Wrens', 'public')`
	);
	riderSummaries.mockResolvedValue([]);
});

describe('asking', () => {
	it('records the ask and its deadline', async () => {
		const due = new Date('2026-10-01T00:00:00Z');
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'tech_rider', dueAt: due });

		const [req] = await listRequests(EVENT);
		expect(req).toMatchObject({ artifact: 'tech_rider', actName: 'The Wrens', fulfilled: false });
		expect(req.dueAt?.toISOString()).toBe(due.toISOString());
	});

	it('treats asking again as a reminder, not a second request', async () => {
		// Two rows would double what the show appears to be waiting on.
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'tech_rider' });
		await requestArtifact({
			eventId: EVENT,
			entryId: ENTRY,
			artifact: 'tech_rider',
			dueAt: new Date('2026-10-05T00:00:00Z')
		});

		const reqs = await listRequests(EVENT);
		expect(reqs).toHaveLength(1);
		expect(reqs[0].dueAt).not.toBeNull();
	});

	it('drops a withdrawn ask out of what is outstanding', async () => {
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk' });
		const [req] = await listRequests(EVENT);
		await cancelArtifactRequest(req.id);
		expect(await listRequests(EVENT)).toHaveLength(0);
	});
});

describe('deriving whether it came', () => {
	it('counts a rider that arrived, asked for or not', async () => {
		riderSummaries.mockResolvedValue([{ name: 'The Wrens', empty: false }]);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'tech_rider' });

		const [req] = await listRequests(EVENT);
		expect(req.fulfilled).toBe(true);
		expect(await outstandingCount(EVENT)).toBe(0);
	});

	it('leaves an empty rider outstanding', async () => {
		riderSummaries.mockResolvedValue([{ name: 'The Wrens', empty: true }]);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'tech_rider' });
		expect(await outstandingCount(EVENT)).toBe(1);
	});

	it('counts a rider file, which is the only kind an act with no account can send', async () => {
		// `rider` is keyed on `group_id` and an external act has no group, so the
		// structured summary is empty however much they sent. Before #863 that
		// made the ask permanently outstanding.
		riderSummaries.mockResolvedValue([{ name: 'The Wrens', empty: true }]);
		sqlite.exec(
			`insert into media_attachment (id, media_id, attachable_type, attachable_id, slot)
			 values ('att-1', 'med-1', 'directory_entry', '${ENTRY}', 'rider')`
		);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'tech_rider' });

		expect((await listRequests(EVENT))[0].fulfilled).toBe(true);
		expect(await outstandingCount(EVENT)).toBe(0);
	});

	it('does not read a file in another slot as a rider', async () => {
		riderSummaries.mockResolvedValue([{ name: 'The Wrens', empty: true }]);
		sqlite.exec(
			`insert into media_attachment (id, media_id, attachable_type, attachable_id, slot)
			 values ('att-2', 'med-2', 'directory_entry', '${ENTRY}', 'stage_plot')`
		);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'tech_rider' });

		expect(await outstandingCount(EVENT)).toBe(1);
	});

	it('reads a press kit off the listing having a bio', async () => {
		sqlite.exec(`update directory_entry set bio = 'Four of them, from Corvallis.'`);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk' });
		expect((await listRequests(EVENT))[0].fulfilled).toBe(true);
	});

	it('treats whitespace as no bio at all', async () => {
		sqlite.exec(`update directory_entry set bio = '   '`);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk' });
		expect((await listRequests(EVENT))[0].fulfilled).toBe(false);
	});
});

describe('overdue', () => {
	const past = new Date('2026-01-01T00:00:00Z');
	const now = new Date('2026-02-01T00:00:00Z');

	it('flags an unfulfilled ask past its date', async () => {
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk', dueAt: past });
		expect((await listRequests(EVENT, now))[0].overdue).toBe(true);
	});

	it('does not flag one that arrived late', async () => {
		// The deadline mattered before it came; afterwards it is just done.
		sqlite.exec(`update directory_entry set bio = 'Here at last.'`);
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk', dueAt: past });
		expect((await listRequests(EVENT, now))[0].overdue).toBe(false);
	});

	it('does not flag an ask with no deadline', async () => {
		await requestArtifact({ eventId: EVENT, entryId: ENTRY, artifact: 'epk' });
		expect((await listRequests(EVENT, now))[0].overdue).toBe(false);
	});
});

describe('who can be asked', () => {
	const credit = (id: string, name: string, order: number, entry: string | null) =>
		sqlite.exec(
			`insert into event_band (id, event_id, name, billing_order, directory_entry_id) values ('${id}', '${EVENT}', '${name}', ${order}, ${entry ? `'${entry}'` : 'null'})`
		);

	it('offers the bill in billing order', async () => {
		credit('eb-2', 'Second', 2, ENTRY);
		sqlite.exec(
			`insert into directory_entry (id, name, visibility) values ('entry-2', 'Openers', 'public')`
		);
		credit('eb-1', 'First', 1, 'entry-2');

		expect(await requestableActs(EVENT)).toEqual([
			{ entryId: 'entry-2', name: 'First' },
			{ entryId: ENTRY, name: 'Second' }
		]);
	});

	it('leaves out a credit with no listing, which has nowhere to receive an ask', async () => {
		credit('eb-1', 'Bare name', 1, null);
		expect(await requestableActs(EVENT)).toEqual([]);
	});
});

describe('poster art', () => {
	const ARTIST = 'entry-artist';
	const png = { buffer: new ArrayBuffer(8), contentType: 'image/png', filename: 'art.png' };

	beforeEach(() => {
		sqlite.exec(
			`insert into directory_entry (id, name, visibility) values ('${ARTIST}', 'Ada Ink', 'hidden')`
		);
		sqlite.exec(
			`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id)
			 values ('${EVENT}', 'Harvest Show', 1790000000, 1790010000, 'u-1')`
		);
		uploaded.mockClear();
	});

	async function ask() {
		await requestArtifact({ eventId: EVENT, entryId: ARTIST, artifact: 'poster_art' });
		return (await listRequests(EVENT))[0];
	}

	it('reads outstanding until the artist delivers, then in', async () => {
		const req = await ask();
		expect(req).toMatchObject({ fulfilled: false, deliveredUrl: null });

		await deliverPosterArt({ entryId: ARTIST, requestId: req.id, file: png });

		const [after] = await listRequests(EVENT);
		expect(after.fulfilled).toBe(true);
		expect(after.deliveredUrl).toMatch(/^https:\/\/media\.test\//);
	});

	it('credits the artist on the delivered file', async () => {
		const req = await ask();
		await deliverPosterArt({ entryId: ARTIST, requestId: req.id, file: png });
		const row = sqlite.prepare('select caption from media').get() as { caption: string };
		expect(row.caption).toBe('Poster art by Ada Ink');
	});

	it('replaces a first delivery with a second', async () => {
		const req = await ask();
		await deliverPosterArt({ entryId: ARTIST, requestId: req.id, file: png });
		await deliverPosterArt({ entryId: ARTIST, requestId: req.id, file: png });
		const n = sqlite
			.prepare(
				`select count(*) as n from media_attachment where attachable_type = 'artifact_request'`
			)
			.get() as { n: number };
		expect(n.n).toBe(1);
	});

	it("refuses a request that is not this entry's, before uploading anything", async () => {
		// The token authorizes one entry. A request id is client-supplied.
		const req = await ask();
		await expect(
			deliverPosterArt({ entryId: ENTRY, requestId: req.id, file: png })
		).rejects.toBeInstanceOf(PosterRequestNotFoundError);
		expect(uploaded).not.toHaveBeenCalled();
	});

	it('refuses a withdrawn request', async () => {
		const req = await ask();
		await cancelArtifactRequest(req.id);
		await expect(
			deliverPosterArt({ entryId: ARTIST, requestId: req.id, file: png })
		).rejects.toBeInstanceOf(PosterRequestNotFoundError);
	});

	it('refuses a request for something other than poster art', async () => {
		await requestArtifact({ eventId: EVENT, entryId: ARTIST, artifact: 'epk' });
		const [req] = await listRequests(EVENT);
		await expect(
			deliverPosterArt({ entryId: ARTIST, requestId: req.id, file: png })
		).rejects.toBeInstanceOf(PosterRequestNotFoundError);
	});

	it('promotes the delivered art to the poster without copying the object', async () => {
		const req = await ask();
		await deliverPosterArt({ entryId: ARTIST, requestId: req.id, file: png });
		await promotePosterArt(req.id);

		const rows = sqlite
			.prepare(`select attachable_type, media_id from media_attachment order by attachable_type`)
			.all() as { attachable_type: string; media_id: string }[];
		expect(rows.map((r) => r.attachable_type)).toEqual(['artifact_request', 'event_listing']);
		expect(rows[0].media_id).toBe(rows[1].media_id);
		expect(sqlite.prepare('select count(*) as n from media').get()).toEqual({ n: 1 });
	});

	it('refuses to promote art that has not arrived', async () => {
		const req = await ask();
		await expect(promotePosterArt(req.id)).rejects.toBeInstanceOf(PosterRequestNotFoundError);
	});

	it("lists an artist's live asks, with the show they are for", async () => {
		const req = await ask();
		await requestArtifact({ eventId: EVENT, entryId: ARTIST, artifact: 'epk' });

		expect(await livePosterRequests(ARTIST)).toEqual([
			expect.objectContaining({ id: req.id, eventTitle: 'Harvest Show', deliveredUrl: null })
		]);

		await cancelArtifactRequest(req.id);
		expect(await livePosterRequests(ARTIST)).toEqual([]);
	});
});

describe('finding someone to ask', () => {
	it('finds a listing by name, bill or no bill', async () => {
		expect(await searchAskableEntries('wren')).toEqual([{ id: ENTRY, name: 'The Wrens' }]);
	});

	it('leaves out a deleted listing', async () => {
		sqlite.exec(`update directory_entry set deleted_at = 1`);
		expect(await searchAskableEntries('wren')).toEqual([]);
	});

	it('needs two characters before it searches', async () => {
		expect(await searchAskableEntries('w')).toEqual([]);
	});
});
