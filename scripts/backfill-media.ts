/**
 * backfill-media.ts
 *
 * Phase 3 of docs/specs/media-spec.md. Reads the four places an R2 key is stored
 * today into `media` + `media_attachment`, so phase 4 has something to cut over
 * to. Nothing is removed and no behaviour changes: the source columns keep their
 * values and stay authoritative until phase 6 drops them.
 *
 *   event.poster_key   -> slot 'poster'   on attachable_type 'event'
 *   group.avatar_key   -> slot 'avatar'   on attachable_type 'group'
 *   user.image         -> slot 'avatar'   on attachable_type 'user'
 *   band_media.key     -> slot from .type on attachable_type 'group'
 *
 * Usage:
 *   pnpm tsx scripts/backfill-media.ts [--remote] [--commit] [--public-url=URL]
 *
 * Flags:
 *   --remote        Act on the deployed D1 database (default: the local one)
 *   --commit        Apply the inserts (default: dry run, prints the plan)
 *   --public-url    Override the R2 public origin HEAD requests go to
 *
 * Notes:
 *   - **Idempotent.** A key already present in `media` is reused rather than
 *     re-inserted, and an attachment that already exists is skipped, so a
 *     re-run after a partial failure completes the job instead of duplicating it.
 *   - **`byteSize` and `contentType` come from R2, not from the database**,
 *     which stores neither. See `headObject` below for why this is a plain HTTP
 *     HEAD rather than a binding call.
 *   - **A key whose object is missing is reported and skipped, never inserted.**
 *     A `media` row with a fabricated size would be worse than no row: the sweep
 *     would keep it forever (something points at it) while it names nothing.
 *   - `user.image` belongs to better-auth and may hold a full OAuth URL rather
 *     than an R2 key. Those are skipped — see `isR2Key`.
 *   - **`--local` is for exercising the script, not for planning a real run.**
 *     Miniflare's R2 has no HTTP origin, so object lookups always go to the real
 *     bucket while the rows come from the local database. Seeded keys were never
 *     uploaded and are correctly reported missing. `--remote` is the pairing that
 *     means something.
 */

import {
	SLOT_FOR_BAND_MEDIA,
	attachmentFingerprint,
	isR2Key,
	planBackfill,
	type ObjectMeta,
	type Source
} from './lib/media-backfill-plan';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const REMOTE = args.includes('--remote');
const COMMIT = args.includes('--commit');
const DB_NAME = 'corvmc-db';

/** How many HEAD requests are in flight at once. */
const HEAD_CONCURRENCY = 8;
/** Rows per INSERT statement — D1 caps a statement at 100 bound parameters. */
const INSERT_CHUNK = 20;

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

function d1(command: string): Record<string, unknown>[] {
	const out = execFileSync(
		'wrangler',
		['d1', 'execute', DB_NAME, REMOTE ? '--remote' : '--local', '--json', '--command', command],
		{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
	);
	const parsed = JSON.parse(out.slice(out.indexOf('[')));
	return parsed[0]?.results ?? [];
}

function d1File(sql: string): void {
	const path = join(tmpdir(), `backfill-media-${randomUUID()}.sql`);
	writeFileSync(path, sql, 'utf8');
	try {
		execFileSync(
			'wrangler',
			['d1', 'execute', DB_NAME, REMOTE ? '--remote' : '--local', '--file', path],
			{ encoding: 'utf8', stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 }
		);
	} finally {
		unlinkSync(path);
	}
}

const sq = (v: string) => `'${v.replaceAll("'", "''")}'`;

// ---------------------------------------------------------------------------
// R2
// ---------------------------------------------------------------------------

/**
 * The public origin objects are served from. Read from wrangler.toml so the
 * script and the Worker cannot disagree about which bucket is being described.
 */
function publicUrl(): string {
	const flag = args.find((a) => a.startsWith('--public-url='));
	if (flag) return flag.slice('--public-url='.length).replace(/\/+$/, '');
	const toml = readFileSync('wrangler.toml', 'utf8');
	const m = toml.match(/^R2_PUBLIC_URL\s*=\s*"([^"]+)"/m);
	if (!m) throw new Error('R2_PUBLIC_URL not found in wrangler.toml; pass --public-url=');
	return m[1].replace(/\/+$/, '');
}

/**
 * Size and content type for one object.
 *
 * A plain HTTP HEAD against the bucket's public custom domain, deliberately: the
 * database stores neither value, `wrangler r2 object` has no metadata
 * subcommand (only get/put/delete, and `get` would download every byte), and the
 * S3 SDK is not a dependency of this project. Every object in this bucket is
 * publicly readable — that is a documented property of attaching a custom domain
 * to an R2 bucket, and the reason groups-spec puts private documents in a second
 * bucket — so no credentials are involved.
 *
 * **The bare object URL, never the transform URL.** `getPublicUrl()` wraps image
 * keys in `/cdn-cgi/image/...`, which would report the size of a resized variant
 * rather than of the object being recorded.
 */
async function headObject(
	origin: string,
	key: string
): Promise<{ contentType: string; byteSize: number } | null> {
	const res = await fetch(`${origin}/${key}`, { method: 'HEAD' });
	if (!res.ok) return null;
	const len = Number(res.headers.get('content-length'));
	if (!Number.isFinite(len) || len <= 0) return null;
	return {
		contentType:
			res.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream',
		byteSize: len
	};
}

/** Map over `items` with a bounded number of promises in flight. */
async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i]);
			}
		})
	);
	return out;
}

// ---------------------------------------------------------------------------

function collectSources(): Source[] {
	const sources: Source[] = [];

	for (const r of d1(
		`SELECT id, poster_key, title FROM event WHERE poster_key IS NOT NULL AND poster_key != ''`
	)) {
		sources.push({
			key: String(r.poster_key),
			attachableType: 'event',
			attachableId: String(r.id),
			slot: 'poster',
			caption: null,
			sortOrder: 0,
			label: `event "${r.title}"`
		});
	}

	for (const r of d1(
		`SELECT id, avatar_key, name FROM "group" WHERE avatar_key IS NOT NULL AND avatar_key != ''`
	)) {
		sources.push({
			key: String(r.avatar_key),
			attachableType: 'group',
			attachableId: String(r.id),
			slot: 'avatar',
			caption: null,
			sortOrder: 0,
			label: `group "${r.name}"`
		});
	}

	for (const r of d1(`SELECT id, image, name FROM user WHERE image IS NOT NULL AND image != ''`)) {
		const image = String(r.image);
		if (!isR2Key(image)) continue; // an OAuth avatar URL, not ours to record
		sources.push({
			key: image,
			attachableType: 'user',
			attachableId: String(r.id),
			slot: 'avatar',
			caption: null,
			sortOrder: 0,
			label: `user "${r.name}"`
		});
	}

	for (const r of d1(
		`SELECT id, band_id, key, type, caption, sort_order FROM band_media ORDER BY band_id, sort_order`
	)) {
		const slot = SLOT_FOR_BAND_MEDIA[String(r.type)];
		if (!slot) {
			console.error(`  ! band_media ${r.id} has unmapped type "${r.type}" — skipped`);
			continue;
		}
		sources.push({
			key: String(r.key),
			attachableType: 'group',
			attachableId: String(r.band_id),
			slot,
			caption: r.caption === null ? null : String(r.caption),
			sortOrder: Number(r.sort_order ?? 0),
			label: `band_media ${r.id} (${r.type})`
		});
	}

	return sources;
}

async function main() {
	console.log(
		`Target: ${REMOTE ? 'REMOTE (deployed)' : 'LOCAL'} | Mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}`
	);
	const origin = publicUrl();
	console.log(`R2 origin: ${origin}`);
	if (!REMOTE) {
		// There is no local R2 to HEAD — miniflare's bucket has no HTTP origin — so
		// the object lookup always goes to the real one while the rows come from
		// the local database. Seed keys were never uploaded anywhere, so they are
		// *correctly* reported missing; that is a property of the seed, not a
		// finding about production. Only `--remote` pairs the two consistently.
		console.log(
			'NOTE: local D1 rows are checked against the real bucket, so seeded keys\n' +
				'      will read as missing. Use --remote for a meaningful plan.'
		);
	}
	console.log();

	const sources = collectSources();
	if (sources.length === 0) {
		console.log('Nothing to back-fill — no source row holds a key.');
		return;
	}

	// What is already recorded, so a re-run completes rather than duplicates.
	const existingMedia = new Map<string, string>(
		d1(`SELECT id, key FROM media`).map((r) => [String(r.key), String(r.id)])
	);
	const existingAttachments = new Set(
		d1(`SELECT media_id, attachable_type, attachable_id, slot FROM media_attachment`).map((r) =>
			attachmentFingerprint(
				String(r.media_id),
				String(r.attachable_type),
				String(r.attachable_id),
				String(r.slot)
			)
		)
	);

	// One HEAD per distinct key, not per usage: the whole point of the new tables
	// is that several parents may share one object.
	const newKeys = [...new Set(sources.map((s) => s.key))].filter((k) => !existingMedia.has(k));
	console.log(`${sources.length} usages over ${newKeys.length} keys not yet recorded.`);
	console.log(`Reading size and type from R2 (${HEAD_CONCURRENCY} at a time)...\n`);

	const heads = await mapLimit(newKeys, HEAD_CONCURRENCY, async (key) => ({
		key,
		meta: await headObject(origin, key)
	}));

	const missing = heads.filter((h) => !h.meta).map((h) => h.key);
	const found = heads.filter((h) => h.meta) as {
		key: string;
		meta: NonNullable<Awaited<ReturnType<typeof headObject>>>;
	}[];

	if (missing.length) {
		console.error(`${missing.length} key(s) name no object in R2 — skipped, not inserted:`);
		for (const k of missing) console.error(`  ! ${k}`);
		console.error();
	}

	const metaByKey = new Map<string, ObjectMeta>(found.map(({ key, meta }) => [key, meta] as const));
	const plan = planBackfill(sources, existingMedia, existingAttachments, metaByKey, () =>
		randomUUID()
	);

	const mediaRows = plan.media.map(
		(m) =>
			`(${sq(m.id)}, ${sq(m.key)}, ${sq(m.contentType)}, ${m.byteSize}, NULL, NULL, NULL, NULL, unixepoch())`
	);
	const attachmentRows = plan.attachments.map(
		(a) =>
			`(${sq(a.id)}, ${sq(a.mediaId)}, ${sq(a.attachableType)}, ${sq(a.attachableId)}, ${sq(a.slot)}, ${a.sortOrder}, unixepoch())`
	);

	console.log(`Plan:`);
	console.log(`  media rows to insert:            ${mediaRows.length}`);
	console.log(`  media_attachment rows to insert: ${attachmentRows.length}`);
	console.log(`  usages skipped (already done):   ${plan.alreadyDone}`);
	console.log(`  usages skipped (object missing): ${plan.missing.length}`);

	if (!mediaRows.length && !attachmentRows.length) {
		console.log('\nNothing to do.');
		return;
	}

	const statements: string[] = [];
	for (let i = 0; i < mediaRows.length; i += INSERT_CHUNK) {
		statements.push(
			`INSERT INTO media (id, key, content_type, byte_size, filename, alt_text, caption, uploaded_by_user_id, created_at) VALUES\n${mediaRows.slice(i, i + INSERT_CHUNK).join(',\n')};`
		);
	}
	for (let i = 0; i < attachmentRows.length; i += INSERT_CHUNK) {
		statements.push(
			`INSERT INTO media_attachment (id, media_id, attachable_type, attachable_id, slot, sort_order, created_at) VALUES\n${attachmentRows.slice(i, i + INSERT_CHUNK).join(',\n')};`
		);
	}
	const sql = statements.join('\n\n');

	if (!COMMIT) {
		console.log('\n--- SQL (dry run; re-run with --commit to apply) ---\n');
		console.log(sql);
		return;
	}

	console.log('\nApplying...');
	d1File(sql);
	console.log('Done.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
