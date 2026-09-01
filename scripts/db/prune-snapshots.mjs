#!/usr/bin/env node
// Deletes the `snapshot.json` files that nothing will ever read again.
//
// WHY THERE IS ANYTHING TO DELETE
//
// drizzle-kit 1.0 writes a full schema snapshot into every migration directory. Ours are
// ~270KB each, against a median `migration.sql` of well under a kilobyte, so the directory
// was 12MB of which 12.38MB was snapshots — and it grew by another 270KB every time anyone
// touched the schema. That is a real cost on every clone, every CI checkout and every
// worktree, paid for data that is read exactly once and then never again.
//
// WHAT ACTUALLY READS A SNAPSHOT
//
// Verified against drizzle-kit 1.0.0-rc.3 and drizzle-orm 1.0.0-rc.3 rather than assumed:
//
//   - `generate` reads ONE — `snapshots[snapshots.length - 1]`, the newest by path. It is the
//     base it diffs the schema files against.
//   - `check` reads all of them, but only to validate each one's shape and to look for two
//     migrations generated from the same parent. It inspects a parent only when that parent
//     has more than one child (`if (childIds.length <= 1) continue`), and it explicitly
//     tolerates a parent that is absent, falling back to a dry snapshot. So a pruned
//     lineage is a pass, and — the case that matters — two branches that collided are still
//     detected, because both children are still there.
//   - `migrate` reads NO snapshot at all. It selects work by folder NAME
//     (`getMigrationsToRun`: `localMigrations.filter(lm => !dbNamesSet.has(lm.name))`); the
//     `hash` and `created_at` columns in `__drizzle_migrations` are written and never
//     compared. Pruning cannot affect what does or does not get applied to a database.
//   - `scripts/db/d1-safe-rebuild.mjs` reads the snapshot of each migration it rewrites, to
//     derive the foreign-key graph. It only ever rewrites a migration that is still being
//     authored — an applied migration's SQL is history and must not change — which is
//     exactly the set this script keeps.
//
// THE RULE
//
// Keep the newest snapshot, plus the snapshot of any migration that is not yet on
// `origin/main`. The first is `generate`'s diff base. The second keeps work in flight
// checkable, including a PR that generates two migrations, where the older of the two would
// otherwise lose the snapshot `d1-safe-rebuild` needs to check it.
//
// If `origin/main` cannot be resolved, this prunes nothing. Failing open costs disk; failing
// closed would delete a snapshot that an unmerged migration still needs.
import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'migrations';

/** Migration directories, oldest first — `<timestamp>_<name>` sorts chronologically. */
export function migrationDirs(dir = MIGRATIONS_DIR) {
	return readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory() && /^\d{14}_/.test(e.name))
		.map((e) => e.name)
		.sort();
}

/**
 * Migration directories `origin/main` already has, or `null` when it cannot be read.
 *
 * `null` is not an empty set: an empty set would mean "nothing is merged, keep everything",
 * which is the same outcome, but saying so explicitly keeps the caller from treating a
 * missing ref as a licence to prune.
 */
export function mergedDirs(ref = 'origin/main') {
	try {
		const out = execFileSync('git', ['ls-tree', '--name-only', ref, `${MIGRATIONS_DIR}/`], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		});
		return new Set(
			out
				.split('\n')
				.map((line) =>
					line
						.trim()
						.replace(/\/$/, '')
						.slice(MIGRATIONS_DIR.length + 1)
				)
				.filter(Boolean)
		);
	} catch {
		return null;
	}
}

/** Snapshots to delete: on `origin/main`, and not the newest. */
export function prunable(dirs, merged) {
	if (!merged || dirs.length === 0) return [];
	const newest = dirs[dirs.length - 1];
	return dirs.filter((d) => d !== newest && merged.has(d));
}

function main() {
	const dryRun = process.argv.includes('--dry-run');
	const merged = mergedDirs();
	if (!merged) {
		console.log('prune-snapshots: origin/main is unreadable, keeping every snapshot.');
		return;
	}

	const dirs = migrationDirs();
	let freed = 0;
	let removed = 0;
	for (const dir of prunable(dirs, merged)) {
		const path = join(MIGRATIONS_DIR, dir, 'snapshot.json');
		if (!existsSync(path)) continue;
		freed += statSync(path).size;
		removed++;
		if (!dryRun) rmSync(path);
	}

	const mb = (freed / 1024 / 1024).toFixed(1);
	if (removed === 0) console.log('prune-snapshots: nothing to prune.');
	else
		console.log(
			`prune-snapshots: ${dryRun ? 'would remove' : 'removed'} ${removed} snapshot(s), ${mb}MB.`
		);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
