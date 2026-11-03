import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RADIO_PRO_ATTESTATION } from '$lib/config';

/**
 * Track numbering, the publish preconditions and the price rule, against a real
 * SQLite. `(release_id, track_number)` is UNIQUE, so a renumber or reorder done
 * in the wrong order fails on a conflict here exactly as it would on D1.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

// better-sqlite3's drizzle has no `batch`; D1's runs the statements in order, as this does.
vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	})
}));

// R2 and the image transform URL are the outside services.
const deleteAudioObject = vi.fn(async (_key: string) => undefined);
vi.mock('./audio-storage', () => ({ deleteAudioObject }));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: () => null }));

const service = await import('./audio-service');

const T0 = 1_750_000_000;
const DAY = 86_400;

function release(
	id: string,
	opts: {
		status?: string;
		title?: string;
		slug?: string;
		groupId?: string;
		publishedAt?: number | null;
		attestationVersion?: string | null;
		attestedAt?: number | null;
	} = {}
) {
	sqlite
		.prepare(
			`insert into audio_release (id, group_id, title, slug, status, published_at,
			   radio_attestation_version, radio_attested_at)
			 values (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			opts.groupId ?? 'g',
			opts.title ?? 'A',
			opts.slug ?? id,
			opts.status ?? 'draft',
			opts.publishedAt ?? null,
			opts.attestationVersion ?? null,
			opts.attestedAt ?? null
		);
}

function track(id: string, releaseId: string, n: number) {
	sqlite
		.prepare(
			`insert into audio_track (id, release_id, title, track_number, duration_ms, object_key, content_type, byte_size)
			 values (?, ?, ?, ?, 1000, ?, 'audio/wav', 10)`
		)
		.run(id, releaseId, id, n, `bands/audio/${id}.wav`);
}

function purchase(id: string, releaseId: string, status: string) {
	sqlite
		.prepare(
			`insert into release_purchase (id, release_id, buyer_email, purchase_id, amount_paid_cents,
			   platform_fee_cents, band_net_cents, download_token, status)
			 values (?, ?, 'b@example.com', ?, 500, 50, 450, ?, ?)`
		)
		.run(id, releaseId, `p-${id}`, `tok-${id}`, status);
}

const numbers = (releaseId: string) =>
	sqlite
		.prepare('select id, track_number as n from audio_track where release_id = ? order by n')
		.all(releaseId);
const releaseRow = (id: string) =>
	sqlite.prepare('select * from audio_release where id = ?').get(id) as
		Record<string, unknown> | undefined;

beforeEach(() => {
	vi.clearAllMocks();
	for (const t of ['media_attachment', 'media', 'release_purchase', 'audio_track', 'audio_release'])
		sqlite.exec(`delete from ${t}`);
});

describe('nextTrackNumber', () => {
	it('starts an empty release at 1', async () => {
		expect(await service.nextTrackNumber('rel-1')).toBe(1);
	});

	it('continues after the highest number on this release only', async () => {
		track('a', 'rel-1', 1);
		track('b', 'rel-1', 4);
		track('c', 'rel-2', 9);
		expect(await service.nextTrackNumber('rel-1')).toBe(5);
	});
});

describe('deleteTrack', () => {
	it('deletes the object before the row', async () => {
		release('rel-1');
		track('t1', 'rel-1', 1);
		track('t2', 'rel-1', 2);
		// The row is the only record of the key; dropping it first and then failing
		// on R2 strands a file billed forever with nothing pointing at it.
		deleteAudioObject.mockImplementationOnce(async () => {
			expect(sqlite.prepare("select id from audio_track where id = 't2'").get()).toBeDefined();
		});

		await service.deleteTrack('t2');

		expect(deleteAudioObject).toHaveBeenCalledWith('bands/audio/t2.wav');
		expect(numbers('rel-1')).toEqual([{ id: 't1', n: 1 }]);
	});

	it('closes the gap so the next upload does not land on a used number', async () => {
		release('rel-1');
		track('t1', 'rel-1', 1);
		track('t2', 'rel-1', 2);
		track('t3', 'rel-1', 3);
		track('x4', 'rel-1', 4);

		await service.deleteTrack('t2');

		expect(numbers('rel-1')).toEqual([
			{ id: 't1', n: 1 },
			{ id: 't3', n: 2 },
			{ id: 'x4', n: 3 }
		]);
		expect(await service.nextTrackNumber('rel-1')).toBe(4);
	});

	it('leaves other releases alone', async () => {
		release('rel-1');
		track('t1', 'rel-1', 1);
		track('t2', 'rel-1', 2);
		track('o3', 'rel-2', 3);

		await service.deleteTrack('t1');

		expect(numbers('rel-2')).toEqual([{ id: 'o3', n: 3 }]);
	});

	it('refuses a track that does not exist', async () => {
		await expect(service.deleteTrack('nope')).rejects.toThrow(/not found/i);
		expect(deleteAudioObject).not.toHaveBeenCalled();
	});
});

describe('reorderTracks', () => {
	beforeEach(() => {
		release('rel-1');
		track('a', 'rel-1', 1);
		track('b', 'rel-1', 2);
		track('c', 'rel-1', 3);
	});

	it('applies a permutation that swaps numbers without a unique conflict', async () => {
		await service.reorderTracks('rel-1', ['c', 'a', 'b']);
		expect(numbers('rel-1')).toEqual([
			{ id: 'c', n: 1 },
			{ id: 'a', n: 2 },
			{ id: 'b', n: 3 }
		]);
	});

	it('keeps a track the client did not mention instead of dropping it', async () => {
		// A page loaded before a sibling uploaded `d` posts three ids.
		track('d', 'rel-1', 4);
		await service.reorderTracks('rel-1', ['c', 'a', 'b']);
		expect(numbers('rel-1')).toEqual([
			{ id: 'c', n: 1 },
			{ id: 'a', n: 2 },
			{ id: 'b', n: 3 },
			{ id: 'd', n: 4 }
		]);
	});

	it('ignores an id belonging to another release', async () => {
		track('theirs', 'rel-2', 1);
		await service.reorderTracks('rel-1', ['theirs', 'b', 'a', 'c']);
		expect(numbers('rel-2')).toEqual([{ id: 'theirs', n: 1 }]);
		expect(numbers('rel-1').map((r) => (r as { id: string }).id)).toEqual(['b', 'a', 'c']);
	});
});

describe('publishRelease', () => {
	it('refuses a release with no tracks', async () => {
		release('rel-1');
		track('other', 'rel-2', 1);
		await expect(service.publishRelease('rel-1')).rejects.toThrow(/at least one track/i);
		expect(releaseRow('rel-1')?.status).toBe('draft');
	});

	it('refuses to republish a withheld release', async () => {
		// A takedown is not a draft; letting Publish undo it makes moderation advisory.
		release('rel-1', { status: 'withheld' });
		track('t1', 'rel-1', 1);
		await expect(service.publishRelease('rel-1')).rejects.toThrow(/withheld/i);
		expect(releaseRow('rel-1')?.status).toBe('withheld');
	});

	it('keeps the original publishedAt when a pulled release goes back up', async () => {
		// The discography orders by this, so re-publishing must not reshuffle it.
		release('rel-1', { publishedAt: T0 });
		track('t1', 'rel-1', 1);
		await service.publishRelease('rel-1');
		expect(releaseRow('rel-1')).toMatchObject({ status: 'published', published_at: T0 });
	});

	it('stamps publishedAt on a first publish', async () => {
		release('rel-1');
		track('t1', 'rel-1', 1);
		await service.publishRelease('rel-1');
		expect(releaseRow('rel-1')?.published_at).toEqual(expect.any(Number));
	});

	it('does not publish a deleted release', async () => {
		release('rel-1');
		track('t1', 'rel-1', 1);
		sqlite.prepare("update audio_release set deleted_at = ? where id = 'rel-1'").run(T0);
		await expect(service.publishRelease('rel-1')).rejects.toThrow(/not found/i);
	});
});

describe('unpublishRelease', () => {
	it('refuses to touch a withheld release', async () => {
		release('rel-1', { status: 'withheld' });
		await expect(service.unpublishRelease('rel-1')).rejects.toThrow(/withheld/i);
		expect(releaseRow('rel-1')?.status).toBe('withheld');
	});
});

describe('updateRelease — price', () => {
	beforeEach(() => release('rel-1'));

	it('accepts free', async () => {
		await service.updateRelease('rel-1', { priceMinCents: 0 });
		expect(releaseRow('rel-1')?.price_min_cents).toBe(0);
	});

	it('rejects the dead zone between free and the charge floor', async () => {
		// Stripe's minimum is 50¢ and its fixed fee 30¢: almost nothing reaches the band.
		for (const cents of [1, 49, 99, 199]) {
			await expect(service.updateRelease('rel-1', { priceMinCents: cents })).rejects.toThrow(
				/free, or at least/i
			);
		}
		expect(releaseRow('rel-1')?.price_min_cents).toBe(0);
	});

	it('accepts the floor itself', async () => {
		await service.updateRelease('rel-1', { priceMinCents: 200 });
		expect(releaseRow('rel-1')?.price_min_cents).toBe(200);
	});
});

describe('updateRelease — slug', () => {
	it('follows the title while the release is still a draft', async () => {
		release('rel-1', { title: 'Old', slug: 'old' });
		await service.updateRelease('rel-1', { title: 'Marys Peak' });
		expect(releaseRow('rel-1')?.slug).toBe('marys-peak');
	});

	it('suffixes a slug another release of the same band already has', async () => {
		release('rel-1', { title: 'Old', slug: 'old' });
		release('rel-2', { title: 'Marys Peak', slug: 'marys-peak' });
		release('rel-3', { title: 'Demos', slug: 'demos', groupId: 'other-band' });
		await service.updateRelease('rel-1', { title: 'Marys Peak' });
		await service.updateRelease('rel-3', { title: 'Marys Peak' });
		expect(releaseRow('rel-1')?.slug).toBe('marys-peak-2');
		expect(releaseRow('rel-3')?.slug).toBe('marys-peak');
	});

	it('freezes the slug once published, so existing links keep working', async () => {
		release('rel-1', { status: 'published', title: 'Old', slug: 'old' });
		await service.updateRelease('rel-1', { title: 'Marys Peak' });
		expect(releaseRow('rel-1')).toMatchObject({ title: 'Marys Peak', slug: 'old' });
	});
});

describe('deleteRelease', () => {
	it('archives rather than deletes when somebody has bought it', async () => {
		release('rel-1', { status: 'published' });
		track('t1', 'rel-1', 1);
		purchase('p1', 'rel-1', 'paid');

		expect(await service.deleteRelease('rel-1')).toBe('archived');

		// A band must not be able to reach into a buyer's library and empty it.
		expect(deleteAudioObject).not.toHaveBeenCalled();
		expect(releaseRow('rel-1')).toMatchObject({ status: 'draft', deleted_at: expect.any(Number) });
		expect(numbers('rel-1')).toHaveLength(1);
	});

	it('really deletes a release whose only purchases never paid, objects first', async () => {
		release('rel-1');
		track('a', 'rel-1', 1);
		track('b', 'rel-1', 2);
		purchase('p1', 'rel-1', 'pending');
		purchase('p2', 'rel-other', 'paid');
		sqlite.exec(
			`insert into media (id, key, content_type, byte_size) values ('m1', 'k', 'image/png', 1)`
		);
		sqlite.exec(
			`insert into media_attachment (id, media_id, attachable_type, attachable_id, slot)
			 values ('ma1', 'm1', 'audio_release', 'rel-1', 'cover')`
		);

		expect(await service.deleteRelease('rel-1')).toBe('deleted');

		expect(deleteAudioObject.mock.calls.map(([k]) => k).sort()).toEqual([
			'bands/audio/a.wav',
			'bands/audio/b.wav'
		]);
		expect(releaseRow('rel-1')).toBeUndefined();
		// The cover is a shared-by-design `media` row: detached, never deleted.
		expect(sqlite.prepare('select count(*) as n from media_attachment').get()).toEqual({ n: 0 });
		expect(sqlite.prepare('select count(*) as n from media').get()).toEqual({ n: 1 });
	});
});

describe('setRadioOptIn — PRO attestation', () => {
	const NOW = new Date(T0 * 1000);
	const current = RADIO_PRO_ATTESTATION.version;

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(NOW);
	});
	afterEach(() => vi.useRealTimers());

	it('refuses to opt in without the attestation', async () => {
		release('rel-1', { status: 'published' });
		await expect(
			service.setRadioOptIn('rel-1', { optIn: true, attestedNotPro: false, userId: 'u-1' })
		).rejects.toBeInstanceOf(service.RadioAttestationRequiredError);
		expect(releaseRow('rel-1')?.radio_opt_in).toBe(0);
	});

	it('records who attested, when, and to which wording', async () => {
		release('rel-1', { status: 'published' });
		await service.setRadioOptIn('rel-1', { optIn: true, attestedNotPro: true, userId: 'u-1' });
		expect(releaseRow('rel-1')).toMatchObject({
			radio_opt_in: 1,
			radio_attested_by_user_id: 'u-1',
			radio_attestation_version: current,
			radio_attested_at: T0
		});
	});

	it('refuses an attestation to an older wording', async () => {
		release('rel-1', { attestationVersion: 'superseded', attestedAt: T0 - DAY });
		await expect(
			service.setRadioOptIn('rel-1', { optIn: true, attestedNotPro: false, userId: 'u-1' })
		).rejects.toBeInstanceOf(service.RadioAttestationRequiredError);
	});

	it('keeps a current attestation when the band saves again without re-ticking it', async () => {
		release('rel-1', { attestationVersion: current, attestedAt: T0 - DAY });
		sqlite.exec("update audio_release set radio_attested_by_user_id = 'u-1'");
		await service.setRadioOptIn('rel-1', { optIn: true, attestedNotPro: false, userId: 'u-2' });
		expect(releaseRow('rel-1')).toMatchObject({
			radio_opt_in: 1,
			radio_attested_by_user_id: 'u-1',
			radio_attested_at: T0 - DAY
		});
	});

	it('refuses to keep a release on the air once its attestation is a year old', async () => {
		release('rel-1', { attestationVersion: current, attestedAt: T0 - 366 * DAY });
		await expect(
			service.setRadioOptIn('rel-1', { optIn: true, attestedNotPro: false, userId: 'u-1' })
		).rejects.toBeInstanceOf(service.RadioAttestationRequiredError);
	});

	it('renews a lapsed attestation when it is given again', async () => {
		release('rel-1', { attestationVersion: current, attestedAt: T0 - 366 * DAY });
		await service.setRadioOptIn('rel-1', { optIn: true, attestedNotPro: true, userId: 'u-1' });
		expect(releaseRow('rel-1')?.radio_attested_at).toBe(T0);
	});

	it('opts out without an attestation, and keeps the record of an old one', async () => {
		release('rel-1', { attestationVersion: 'superseded', attestedAt: T0 - 400 * DAY });
		sqlite.exec('update audio_release set radio_opt_in = 1');
		await service.setRadioOptIn('rel-1', { optIn: false, attestedNotPro: false, userId: 'u-1' });
		expect(releaseRow('rel-1')).toMatchObject({
			radio_opt_in: 0,
			radio_attestation_version: 'superseded'
		});
	});
});

describe('radioAttested', () => {
	it('is true only for the current wording, given within the year', () => {
		const current = RADIO_PRO_ATTESTATION.version;
		const at = new Date();
		expect(service.radioAttested({ radioAttestationVersion: current, radioAttestedAt: at })).toBe(
			true
		);
		expect(
			service.radioAttested({ radioAttestationVersion: 'superseded', radioAttestedAt: at })
		).toBe(false);
		expect(service.radioAttested({ radioAttestationVersion: null, radioAttestedAt: null })).toBe(
			false
		);
	});
});
