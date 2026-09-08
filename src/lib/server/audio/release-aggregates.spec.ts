import { describe, it, expect } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { releaseAggregates } from './audio-service';

/**
 * The correlated subqueries that count a release's tracks and sales, rendered
 * and inspected — no database, per the repo's "test SQL without a DB" note.
 *
 * These shipped broken and looked right. Interpolating drizzle's table objects
 * (`${audioRelease.id}`) renders a **bare** `id` in a single-table select,
 * because drizzle only qualifies column references when the statement has a
 * join. Inside `FROM audio_track` that bare `id` resolves to the *inner* table,
 * so the correlation became `audio_track.release_id = audio_track.id` — never
 * true. Every release reported 0 tracks on the band panel and the public
 * profile, while the staff list was fine purely because it joins `group`.
 *
 * Nothing in a unit test over the service would have caught it; the bug was in
 * SQL that only a real query executes. This asserts the shape instead.
 */
const dialect = new SQLiteSyncDialect();
const render = (fragment: Parameters<typeof dialect.sqlToQuery>[0]) =>
	dialect.sqlToQuery(fragment).sql;

describe('release aggregate subqueries', () => {
	it('correlates on the OUTER release, table-qualified', () => {
		for (const [name, fragment] of Object.entries(releaseAggregates)) {
			const sql = render(fragment);
			// The whole bug in one assertion: the right-hand side of the
			// correlation must name `audio_release`, not a bare `id` that the
			// inner FROM would capture.
			expect(sql, name).toContain('"audio_release"."id"');
			expect(sql, name).not.toMatch(/=\s*"?id"?\s*\)/);
		}
	});

	it('qualifies every column it reads, so no join is required for correctness', () => {
		const counts = render(releaseAggregates.TRACK_COUNT);
		expect(counts).toContain('"audio_track"."release_id"');

		const runtime = render(releaseAggregates.TRACK_RUNTIME);
		expect(runtime).toContain('"audio_track"."duration_ms"');
		expect(runtime).toContain('"audio_track"."release_id"');

		const sales = render(releaseAggregates.PAID_SALES);
		expect(sales).toContain('"release_purchase"."release_id"');
		expect(sales).toContain('"release_purchase"."status"');
	});

	it('counts only paid purchases', () => {
		// A pending row is an abandoned checkout. Counting it would show a band
		// sales it was never paid for.
		expect(render(releaseAggregates.PAID_SALES)).toContain("'paid'");
	});

	it('reports zero runtime rather than null for a release with no tracks', () => {
		// `SUM` over no rows is NULL, and `formatRuntime(null)` is not a thing.
		expect(render(releaseAggregates.TRACK_RUNTIME)).toContain('COALESCE');
	});
});
