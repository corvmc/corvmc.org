import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error -- plain .mjs helper, no types
import { tableOrder } from './d1-table-order.mjs';

/**
 * `deleteAll()` in `scripts/seed-dev.ts` used to carry its own list of tables to
 * wipe, and it drifted: by the time anyone looked it named nine tables fewer
 * than `scripts/d1-table-order.mjs` did. `media` was one, and because the seed
 * builds `media.key` from the band slug, a second `pnpm db:seed` against an
 * already-seeded database died with `UNIQUE constraint failed: media.key`. The
 * seven other seeded ones — `announcement`, `event_band`, `event_group`,
 * `event_rsvp`, `group_invite`, `inventory_item_article`, `media_attachment` —
 * failed more quietly: their rows survived a wipe that reported success. (The
 * ninth, `product_config`, is an orphaned table nothing seeds.)
 *
 * `scripts/d1-table-order.mjs` is the list that is actually checked against the
 * drizzle snapshot (`scripts/d1-table-order.spec.ts`), so the seed has to take
 * its wipe from there rather than keep a copy. This holds it to that.
 */
const source = readFileSync(new URL('./seed-dev.ts', import.meta.url), 'utf8');

/** The body of `deleteAll()`, from its signature to the first column-0 `}`. */
function deleteAllBody(): string {
	const start = source.indexOf('async function deleteAll()');
	expect(start, 'seed-dev.ts still defines deleteAll()').toBeGreaterThan(-1);
	const end = source.indexOf('\n}\n', start);
	return source.slice(start, end);
}

describe('seed wipe', () => {
	it('takes its table list from tableOrder', () => {
		expect(deleteAllBody()).toContain('tableOrder');
	});

	it('keeps no second list of table names', () => {
		const named = [...deleteAllBody().matchAll(/'([a-z][a-z0-9_]*)'/g)]
			.map((m) => m[1])
			.filter((name) => (tableOrder as string[]).includes(name));
		expect(
			named,
			`deleteAll() names tables directly; use tableOrder so the wipe cannot drift:\n${named.join(', ')}`
		).toEqual([]);
	});
});
