import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeSplit, suggestedShareCents } from '#lib/finance/split.js';
import { AUDIO_PLATFORM_FEE_BPS, RADIO_PRO_ATTESTATION } from '#lib/config.js';

/**
 * The collective's own sales report, and the one thing it must never get wrong:
 * to bands + card fees + what CMC kept has to reconcile with the gross.
 * `platform_fee_cents` already stores the net share the buyer saw, so
 * subtracting card processing again is self-consistent arithmetic that is
 * wrong about the column. Against a real SQLite, so the sums are SQL's.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
// Reached only through audio-service's imports: R2 and the image transform URL.
vi.mock('./audio-storage', () => ({ deleteAudioObject: vi.fn() }));
vi.mock('#lib/server/storage.js', () => ({ resolveImageUrl: () => null }));

const service = await import('./staff-audio-service');

const NOW = new Date('2026-09-24T12:00:00Z');
const NOW_S = NOW.getTime() / 1000;
const DAY_S = 86_400;

/** One sale, priced through the same module the buyer's bar renders from. */
function sale(totalCents: number, coverFees = false, bps = AUDIO_PLATFORM_FEE_BPS) {
	const divisible = computeSplit({ totalCents, shareCents: 0, coverFees }).remainderCents;
	const s = computeSplit({
		totalCents,
		shareCents: suggestedShareCents(divisible, bps),
		coverFees
	});
	return { amount: s.chargeCents, band: s.remainderCents, platform: s.shareCents };
}

let n = 0;
function insertSales(sales: ReturnType<typeof sale>[], status = 'paid') {
	for (const s of sales) {
		n += 1;
		sqlite
			.prepare(
				`insert into release_purchase (id, release_id, buyer_email, purchase_id, amount_paid_cents,
				   platform_fee_cents, band_net_cents, download_token, status)
				 values (?, 'rel-1', 'b@example.com', ?, ?, ?, ?, ?, ?)`
			)
			.run(`row-${n}`, `p-${n}`, s.amount, s.platform, s.band, `tok-${n}`, status);
	}
}

function band(id: string, deletedAt: number | null = null) {
	sqlite
		.prepare(`insert into "group" (id, kind, name, slug, deleted_at) values (?, 'band', ?, ?, ?)`)
		.run(id, id, id, deletedAt);
}

function release(
	id: string,
	groupId: string,
	opts: { attestedAt?: number; optIn?: boolean; createdAt?: number } = {}
) {
	sqlite
		.prepare(
			`insert into audio_release (id, group_id, title, slug, status, radio_opt_in,
			   radio_attestation_version, radio_attested_at, created_at)
			 values (?, ?, ?, ?, 'published', ?, ?, ?, ?)`
		)
		.run(
			id,
			groupId,
			id,
			id,
			opts.optIn === false ? 0 : 1,
			RADIO_PRO_ATTESTATION.version,
			opts.attestedAt ?? NOW_S - 30 * DAY_S,
			opts.createdAt ?? NOW_S
		);
}

function audio(id: string, releaseId: string, durationMs: number) {
	sqlite
		.prepare(
			`insert into audio_track (id, release_id, title, track_number, duration_ms, object_key, content_type, byte_size)
			 values (?, ?, ?, (select count(*) + 1 from audio_track where release_id = ?), ?, ?, 'audio/mpeg', 1)`
		)
		.run(id, releaseId, id, releaseId, durationMs, `k/${id}`);
}

beforeEach(() => {
	for (const t of ['release_purchase', 'audio_track', 'audio_release', '"group"'])
		sqlite.exec(`delete from ${t}`);
});

describe('salesTotals', () => {
	it('reconciles: bands + collective + card fees is the gross', async () => {
		insertSales([
			sale(1000),
			sale(1000, true),
			sale(500),
			sale(2500, false, 2500),
			sale(1000, false, 0)
		]);

		const t = await service.salesTotals();

		expect(t.sales).toBe(5);
		expect(t.toBandsCents + t.toCollectiveCents + t.feesCents).toBe(t.grossCents);
	});

	it('reports the collective’s take net of processing, not gross of it', async () => {
		// A single $10 sale at the suggested 10%: 59¢ to the card, 94¢ kept.
		insertSales([sale(1000)]);

		expect(await service.salesTotals()).toMatchObject({
			grossCents: 1000,
			feesCents: 59,
			toCollectiveCents: 94,
			toBandsCents: 847
		});
	});

	it('counts only paid sales', async () => {
		insertSales([sale(1000)]);
		insertSales([sale(2500)], 'pending');
		insertSales([sale(2500)], 'refunded');

		expect(await service.salesTotals()).toMatchObject({
			sales: 1,
			grossCents: 1000,
			feesCents: 59
		});
	});

	it('keeps the realised take honest when buyers refuse the cut', async () => {
		// The realised rate has to fall and never go negative — which it did when
		// the fee was subtracted from a share that was already zero.
		insertSales([sale(1000), sale(1000, false, 0)]);

		const t = await service.salesTotals();

		expect(t.toCollectiveCents).toBe(94);
		expect(t.realisedTakeBps).toBe(470);
		expect(t.toBandsCents + t.toCollectiveCents + t.feesCents).toBe(t.grossCents);
	});

	it('is all zeroes with nothing sold, rather than a division by zero', async () => {
		expect(await service.salesTotals()).toMatchObject({
			sales: 0,
			grossCents: 0,
			feesCents: 0,
			realisedTakeBps: 0
		});
	});

	it('counts free downloads without letting them distort the split', async () => {
		insertSales([sale(0), sale(1000)]);

		const t = await service.salesTotals();

		expect(t.freeSales).toBe(1);
		expect(t.sales).toBe(2);
		expect(t.toBandsCents + t.toCollectiveCents + t.feesCents).toBe(t.grossCents);
	});
});

describe('the radio readiness panel (#1516)', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(NOW);
	});
	afterEach(() => vi.useRealTimers());

	it('counts only releases whose attestation is under a year old', async () => {
		band('b1');
		band('b2');
		release('fresh', 'b1');
		audio('ok', 'fresh', 180_000);
		audio('long', 'fresh', 40 * 60_000);
		release('lapsed', 'b2', { attestedAt: NOW_S - 366 * DAY_S });
		audio('stale', 'lapsed', 180_000);

		expect(await service.radioPoolStats()).toEqual({
			eligibleTracks: 1,
			bands: 1,
			optedInReleases: 1,
			excludedByLength: 1
		});
	});

	it('counts distinct bands, and leaves out deleted bands and opted-out releases', async () => {
		band('b1');
		band('b2');
		band('gone', NOW_S);
		release('r1', 'b1');
		release('r2', 'b2');
		release('r3', 'gone');
		release('r4', 'b1', { optIn: false });
		for (const r of ['r1', 'r2', 'r3', 'r4']) audio(`t-${r}`, r, 180_000);
		audio('t-r1b', 'r1', 180_000);

		expect(await service.radioPoolStats()).toMatchObject({
			eligibleTracks: 3,
			bands: 2,
			optedInReleases: 2
		});
	});

	it('marks a release with a lapsed attestation as not attested', async () => {
		band('b1');
		release('lapsed', 'b1', { attestedAt: NOW_S - 388 * DAY_S, createdAt: NOW_S - 1 });
		release('fresh', 'b1');

		const rows = await service.listAllReleases();

		expect(rows.map((r) => [r.id, r.radioAttested])).toEqual([
			['fresh', true],
			['lapsed', false]
		]);
	});
});
