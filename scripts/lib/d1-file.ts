/**
 * The SQLite file behind a local D1 `DB` binding.
 *
 * miniflare names the file after the database id and keeps its own
 * `metadata.sqlite` next to it, so the binding's file is the one that is left.
 * The name is a hash miniflare derives itself — not the `database_id` from
 * `wrangler.toml` — so it has to be discovered rather than constructed.
 *
 * Lives here rather than in `e2e/` because both sides need it: the e2e suite
 * reads its own run's database (`e2e/state-dir.ts`), and `db:migrate:local`
 * migrates whichever state directory it was pointed at. `scripts/lib/` is
 * already where that kind of shared derivation lives — `checkout-ports.ts` is
 * imported by `e2e/state-dir.ts` for the same reason.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param persistPath the `v3` directory, as `getPlatformProxy({ persist: { path } })`
 *   wants it — *not* the root `wrangler --persist-to` takes.
 */
export function d1File(persistPath: string): string {
	const dir = join(persistPath, 'd1', 'miniflare-D1DatabaseObject');
	const files = existsSync(dir)
		? readdirSync(dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')
		: [];

	if (files.length !== 1) {
		throw new Error(
			`Expected exactly one D1 database file in ${dir}, found ${files.length}` +
				` (${files.join(', ') || 'none'}). Run \`pnpm db:migrate:local\`, which creates it.`
		);
	}
	return join(dir, files[0]);
}

/** Whether `persistPath` already holds a D1 database, i.e. miniflare has run over it. */
export function hasD1File(persistPath: string): boolean {
	return existsSync(join(persistPath, 'd1', 'miniflare-D1DatabaseObject'));
}
