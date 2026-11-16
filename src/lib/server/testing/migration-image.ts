import { createHash } from 'node:crypto';
import { globSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const CACHE_DIR = 'node_modules/.cache/migrated-sqlite';

/**
 * A serialized SQLite holding every committed migration through `through`.
 * Replaying takes ~2s, which a loaded machine stretches past the 5s test
 * timeout (#2749), so the image is cached on disk under a hash of the
 * migrations it replays. Written to a temp name and renamed, so a concurrent
 * reader never sees half a file.
 */
export function migrationImage(through?: string): Buffer {
	const files = globSync('migrations/*/migration.sql').sort();
	const last = through ? files.findLastIndex((f) => f.includes(`_${through}/`)) : files.length - 1;
	if (last < 0) throw new Error(`No migration named *_${through}`);

	const sources = files.slice(0, last + 1).map((f) => readFileSync(f, 'utf8'));
	const hash = createHash('sha256');
	for (const sql of sources) hash.update(sql).update('\0');
	const path = join(CACHE_DIR, `${hash.digest('hex').slice(0, 16)}.sqlite`);

	try {
		return readFileSync(path);
	} catch {
		const image = replay(sources);
		mkdirSync(CACHE_DIR, { recursive: true });
		const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}`;
		writeFileSync(tmp, image);
		renameSync(tmp, path);
		return image;
	}
}

function replay(sources: string[]): Buffer {
	const sqlite = new Database(':memory:');
	for (const sql of sources) {
		for (const statement of sql
			.split('--> statement-breakpoint')
			.map((s) => s.trim())
			.filter(Boolean)) {
			sqlite.exec(statement);
		}
	}
	const image = sqlite.serialize();
	sqlite.close();
	return image;
}
