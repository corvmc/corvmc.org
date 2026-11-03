import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RADIO_PRO_ATTESTATION } from '#lib/config.js';

/**
 * The station's programming rules. `pickNextTrack` is pure and asserted
 * directly; eligibility and the materialized timetable run against a real
 * SQLite, since both are `WHERE` clauses and rows a fake `db` would agree with.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/storage.js', () => ({ resolveImageUrl: () => null }));

const radio = await import('./radio-service');

const NOW = new Date('2026-09-03T12:00:00Z');
const NOW_S = NOW.getTime() / 1000;
const DAY_S = 86_400;
const MIN = 60_000;

const track = (id: string, groupId: string, lastPlayedAt: Date | null, durationMs = 180_000) => ({
	trackId: id,
	groupId,
	lastPlayedAt,
	durationMs
});

function band(id: string, deletedAt: number | null = null) {
	sqlite
		.prepare(`insert into "group" (id, kind, name, slug, deleted_at) values (?, 'band', ?, ?, ?)`)
		.run(id, id, id, deletedAt);
}

function release(
	id: string,
	groupId: string,
	opts: {
		status?: string;
		optIn?: boolean;
		version?: string;
		attestedAt?: number;
		excludedAt?: number | null;
		deletedAt?: number | null;
	} = {}
) {
	sqlite
		.prepare(
			`insert into audio_release (id, group_id, title, slug, status, radio_opt_in,
			   radio_attestation_version, radio_attested_at, radio_excluded_at, deleted_at)
			 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			groupId,
			id,
			id,
			opts.status ?? 'published',
			opts.optIn === false ? 0 : 1,
			opts.version ?? RADIO_PRO_ATTESTATION.version,
			opts.attestedAt ?? NOW_S - 30 * DAY_S,
			opts.excludedAt ?? null,
			opts.deletedAt ?? null
		);
}

function audio(
	id: string,
	releaseId: string,
	durationMs = 180_000,
	excludedAt: number | null = null
) {
	sqlite
		.prepare(
			`insert into audio_track (id, release_id, title, track_number, duration_ms, object_key,
			   content_type, byte_size, radio_excluded_at)
			 values (?, ?, ?, (select count(*) + 1 from audio_track where release_id = ?), ?, ?, 'audio/mpeg', 1, ?)`
		)
		.run(id, releaseId, id, releaseId, durationMs, `k/${id}`, excludedAt);
}

/** A band with one on-air release holding the given tracks. */
function onAir(groupId: string, tracks: [string, number][]) {
	band(groupId);
	release(`rel-${groupId}`, groupId);
	for (const [id, ms] of tracks) audio(id, `rel-${groupId}`, ms);
}

function play(id: string, trackId: string, startsAt: number, endsAt: number) {
	sqlite
		.prepare('insert into radio_play (id, track_id, starts_at, ends_at) values (?, ?, ?, ?)')
		.run(id, trackId, startsAt, endsAt);
}

const schedule = () =>
	sqlite
		.prepare(
			'select track_id as trackId, starts_at as startsAt, ends_at as endsAt from radio_play order by starts_at'
		)
		.all() as { trackId: string; startsAt: number; endsAt: number }[];

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	for (const t of ['radio_play', 'audio_track', 'audio_release', '"group"'])
		sqlite.exec(`delete from ${t}`);
});
afterEach(() => vi.useRealTimers());

describe('listEligibleTracks', () => {
	const ids = async () => (await radio.listEligibleTracks()).map((t) => t.trackId).sort();

	it('plays a published, opted-in, attested track and reports when it last played', async () => {
		onAir('b1', [['t1', 180_000]]);
		play('p1', 't1', NOW_S - 3600, NOW_S - 3420);
		play('p0', 't1', NOW_S - 7200, NOW_S - 7020);

		expect(await radio.listEligibleTracks()).toEqual([
			{
				trackId: 't1',
				groupId: 'b1',
				durationMs: 180_000,
				lastPlayedAt: new Date((NOW_S - 3600) * 1000)
			}
		]);
	});

	it('plays only releases attested to the current PRO wording', async () => {
		onAir('b1', [['ok', 180_000]]);
		release('old-wording', 'b1', { version: 'superseded' });
		audio('stale', 'old-wording');
		expect(await ids()).toEqual(['ok']);
	});

	it('drops a release once its attestation is a year old', async () => {
		onAir('b1', [['ok', 180_000]]);
		release('lapsed', 'b1', { attestedAt: NOW_S - 366 * DAY_S });
		audio('stale', 'lapsed');
		expect(await ids()).toEqual(['ok']);
	});

	it('drops what is unpublished, opted out, excluded or deleted', async () => {
		onAir('b1', [['ok', 180_000]]);
		release('draft', 'b1', { status: 'draft' });
		release('out', 'b1', { optIn: false });
		release('vetoed', 'b1', { excludedAt: NOW_S });
		release('gone', 'b1', { deletedAt: NOW_S });
		for (const r of ['draft', 'out', 'vetoed', 'gone']) audio(`t-${r}`, r);
		audio('track-vetoed', 'rel-b1', 180_000, NOW_S);
		band('b-gone', NOW_S);
		release('rel-gone-band', 'b-gone');
		audio('t-gone-band', 'rel-gone-band');

		expect(await ids()).toEqual(['ok']);
	});

	it('keeps tracks inside the duration bounds', async () => {
		// Without the ceiling a forty-minute live set holds the stream for forty minutes.
		onAir('b1', [
			['too-short', 29_000],
			['shortest', 30_000],
			['longest', 15 * MIN],
			['too-long', 15 * MIN + 1000]
		]);
		expect(await ids()).toEqual(['longest', 'shortest']);
	});
});

describe('pickNextTrack', () => {
	it('returns nothing when the pool is empty', () => {
		// The state before launch, and the reason the station has a staff toggle.
		expect(radio.pickNextTrack([], null)).toBeNull();
	});

	it('prefers a track that has never played', () => {
		const played = track('old', 'band-1', new Date('2026-01-01'));
		const never = track('new', 'band-2', null);
		// A record uploaded this morning should be on the air today.
		expect(radio.pickNextTrack([played, never], null, () => 0)?.trackId).toBe('new');
	});

	it('orders by how long ago, coldest first', () => {
		const recent = track('recent', 'band-1', new Date('2026-03-01'));
		const stale = track('stale', 'band-2', new Date('2026-01-01'));
		expect(radio.pickNextTrack([recent, stale], null, () => 0)?.trackId).toBe('stale');
	});

	it('never plays the same band twice in a row when there is an alternative', () => {
		const pool = [
			track('a1', 'band-1', new Date('2026-01-01')),
			track('a2', 'band-1', new Date('2026-01-02')),
			track('b1', 'band-2', new Date('2026-06-01'))
		];
		// `band-1` holds the two coldest slots, so a scheduler that only sorted
		// would play them back to back.
		for (let i = 0; i < 10; i++) {
			const pick = radio.pickNextTrack(pool, 'band-1', () => i / 10);
			expect(pick?.groupId).toBe('band-2');
		}
	});

	it('still plays a band back to back when it is the only one', () => {
		// Refusing would leave dead air, which is worse than a repeat.
		const pool = [track('a1', 'band-1', null), track('a2', 'band-1', null)];
		expect(radio.pickNextTrack(pool, 'band-1', () => 0)).not.toBeNull();
	});

	it('draws from the coldest ten rather than always the single coldest', () => {
		// Straight least-recently-played is a fixed rotation, the one thing a
		// station must not sound like.
		const pool = Array.from({ length: 20 }, (_, i) =>
			track(`t${i}`, `band-${i}`, new Date(2026, 0, i + 1))
		);
		const picks = new Set<string>();
		for (let i = 0; i < 10; i++) picks.add(radio.pickNextTrack(pool, null, () => i / 10)!.trackId);
		expect(picks.size).toBeGreaterThan(1);

		// ...but bounded, so nothing goes unplayed while something else repeats.
		expect([...picks].every((id) => Number(id.slice(1)) < 10)).toBe(true);
	});
});

describe('scheduleRadio', () => {
	it('schedules nothing and says so when no track is eligible', async () => {
		band('b1');
		release('draft', 'b1', { status: 'draft' });
		audio('t1', 'draft');

		const result = await radio.scheduleRadio({ now: NOW });

		expect(result).toMatchObject({ scheduled: 0, poolEmpty: true });
		expect(schedule()).toEqual([]);
	});

	it('fills forward from now when the timetable is empty', async () => {
		onAir('b1', [['t1', 180_000]]);
		await radio.scheduleRadio({ now: NOW, horizonMs: 10 * MIN, random: () => 0 });

		const rows = schedule();
		expect(rows.length).toBeGreaterThan(0);
		expect(rows[0].startsAt).toBe(NOW_S);
	});

	it('leaves no gap between one track and the next', async () => {
		onAir('b1', [['t1', 120_000]]);
		onAir('b2', [['t2', 150_000]]);
		await radio.scheduleRadio({ now: NOW, horizonMs: 10 * MIN, random: () => 0 });

		// Dead air between entries is the failure a listener notices immediately.
		const rows = schedule();
		expect(rows.length).toBeGreaterThan(1);
		for (let i = 1; i < rows.length; i++) expect(rows[i].startsAt).toBe(rows[i - 1].endsAt);
	});

	it('appends after an existing schedule rather than overwriting it', async () => {
		onAir('b1', [['t1', 120_000]]);
		play('earlier', 't-earlier', NOW_S, NOW_S + 300);

		await radio.scheduleRadio({ now: NOW, horizonMs: 10 * MIN, random: () => 0 });

		// Rows already handed out do not move: the reason the schedule is materialized.
		const rows = schedule();
		expect(rows[0]).toEqual({ trackId: 't-earlier', startsAt: NOW_S, endsAt: NOW_S + 300 });
		expect(rows[1].startsAt).toBe(NOW_S + 300);
	});

	it('restarts from now when the last entry has already finished', async () => {
		// Backfilling an idle hour would burn the rotation on music nobody heard.
		onAir('b1', [['t1', 120_000]]);
		play('old', 't1', NOW_S - 3720, NOW_S - 3600);

		await radio.scheduleRadio({ now: NOW, horizonMs: 10 * MIN, random: () => 0 });

		expect(schedule()[1].startsAt).toBe(NOW_S);
	});

	it('does not fill the horizon with one track on repeat', async () => {
		// Without the in-loop `lastPlayedAt` update every pick re-reads the same
		// coldest track and the next hour is one song.
		onAir('b1', [['t1', 60_000]]);
		onAir('b2', [['t2', 60_000]]);
		onAir('b3', [['t3', 60_000]]);
		await radio.scheduleRadio({ now: NOW, horizonMs: 6 * MIN, random: () => 0 });

		expect(new Set(schedule().map((r) => r.trackId)).size).toBeGreaterThan(1);
	});

	it('stops at the horizon rather than running away on short tracks', async () => {
		onAir('b1', [['t1', 30_000]]);
		onAir('b2', [['t2', 30_000]]);
		await radio.scheduleRadio({ now: NOW, horizonMs: 5 * MIN, random: () => 0 });

		// The first entry to reach past the horizon is the last one written.
		const rows = schedule();
		expect(rows.at(-1)!.startsAt).toBeLessThan(NOW_S + 300);
		expect(rows.at(-1)!.endsAt).toBeGreaterThanOrEqual(NOW_S + 300);
	});

	it('is idempotent across back-to-back runs', async () => {
		onAir('b1', [['t1', 180_000]]);
		await radio.scheduleRadio({ now: NOW, horizonMs: 10 * MIN, random: () => 0 });
		const first = schedule().length;
		const again = await radio.scheduleRadio({ now: NOW, horizonMs: 10 * MIN, random: () => 0 });
		expect(again.scheduled).toBe(0);
		expect(schedule()).toHaveLength(first);
	});

	it('prunes aged-out history on every run', async () => {
		// Without this the table becomes a permanent log of every song ever played.
		play('p1', 't1', NOW_S - 9 * DAY_S, NOW_S - 9 * DAY_S + 180);
		play('p2', 't1', NOW_S - 8 * DAY_S, NOW_S - 8 * DAY_S + 180);
		play('keep', 't1', NOW_S - 6 * DAY_S, NOW_S - 6 * DAY_S + 180);

		const result = await radio.scheduleRadio({ now: NOW });

		expect(result.pruned).toBe(2);
		expect(sqlite.prepare('select id from radio_play').all()).toEqual([{ id: 'keep' }]);
	});

	it('chunks its inserts under D1’s bound-parameter cap', async () => {
		// D1 caps a statement at 100 bound parameters and SQLite does not, so the
		// row count per insert is read off the builder.
		onAir('b1', [['t1', 30_000]]);
		const sizes: number[] = [];
		const realInsert = testDb.insert.bind(testDb);
		const spy = vi.spyOn(testDb, 'insert').mockImplementation(((table: never) => {
			const builder = realInsert(table);
			const values = builder.values.bind(builder);
			builder.values = ((rows: unknown[]) => {
				sizes.push(rows.length);
				return values(rows as never);
			}) as never;
			return builder;
		}) as never);
		try {
			await radio.scheduleRadio({ now: NOW, horizonMs: 60 * MIN, random: () => 0 });
		} finally {
			spy.mockRestore();
		}

		expect(sizes.length).toBeGreaterThan(1);
		for (const n of sizes) expect(n).toBeLessThanOrEqual(20);
		expect(schedule()).toHaveLength(sizes.reduce((a, b) => a + b, 0));
	});
});
