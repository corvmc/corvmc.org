/**
 * migrate-from-postgres.ts
 *
 * ETL script to migrate data from the corvmc-redux Laravel/Postgres database
 * into the corvmc-svelte D1 (SQLite) schema.
 *
 * Usage:
 *   DATABASE_URL="postgres://localhost/corvmc-migration" pnpm tsx scripts/migrate-from-postgres.ts [--commit] [--remote]
 *
 * Flags:
 *   --commit   Actually write to D1 (default is dry-run)
 *   --remote   Write to remote/production D1 instead of local
 *
 * Prerequisites:
 *   - Restore the pg_dump: createdb corvmc-migration && pg_restore -d corvmc-migration dump.Fc
 *   - Local D1 must have migrations applied: pnpm db:migrate:local
 *   - For --remote: wrangler must be authenticated
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import postgres from 'postgres';
import { getPlatformProxy } from 'wrangler';
import { drizzle } from 'drizzle-orm/d1';
import { sql, and, eq, ne } from 'drizzle-orm';

import {
	user,
	account,
	userInstrument,
	userGenre
} from '../src/lib/server/db/schema/authentication';
import { band, bandGenre, bandMember } from '../src/lib/server/db/schema/band';
import { reservation, closure } from '../src/lib/server/db/schema/reservation';
import { recurringSeries } from '../src/lib/server/db/schema/recurring';
import { event } from '../src/lib/server/db/schema/event';
import { mapLegacyEventTicketing } from '../src/lib/server/event/legacy-ticketing';
import { ticket } from '../src/lib/server/db/schema/ticket';
import { creditTransaction, paymentCache } from '../src/lib/server/db/schema/finance';
import { equipmentCategory, equipment, equipmentLoan } from '../src/lib/server/db/schema/equipment';
import { notification, notificationPreference } from '../src/lib/server/db/schema/notification';
import {
	permission,
	role,
	modelHasPermission,
	modelHasRole,
	roleHasPermission
} from '../src/lib/server/db/schema/authorization';
import { platformInvite } from '../src/lib/server/db/schema/platform-invite';
import { detectPlatform } from '../src/lib/utils/link-platform';
import {
	deriveReservationPayment,
	chargePaymentRecordId,
	normalizeCents,
	type LegacyCharge,
	type MappedStatus
} from './lib/reservation-payment';
import { mapMemberFlags } from '../src/lib/server/directory/legacy-flags';
import type { ProfileLink } from '../src/lib/server/db/schema/authentication';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const REMOTE = args.includes('--remote');
const ID_MAP_PATH = resolve(import.meta.dirname!, '.id-map.json');

if (!process.env.DATABASE_URL) {
	console.error('Error: DATABASE_URL is not set');
	process.exit(1);
}

console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'} | Target: ${REMOTE ? 'REMOTE' : 'LOCAL'} D1`);
console.log();

// ---------------------------------------------------------------------------
// ID mapping — Laravel bigint → UUID
// ---------------------------------------------------------------------------

type IdMap = Record<string, Record<string, string>>;

const idMap: IdMap = existsSync(ID_MAP_PATH) ? JSON.parse(readFileSync(ID_MAP_PATH, 'utf-8')) : {};

function mapId(table: string, oldId: number | string): string {
	const key = String(oldId);
	if (!idMap[table]) idMap[table] = {};
	if (!idMap[table][key]) idMap[table][key] = randomUUID();
	return idMap[table][key];
}

function lookupId(table: string, oldId: number | string | null): string | null {
	if (oldId === null || oldId === undefined) return null;
	const key = String(oldId);
	return idMap[table]?.[key] ?? null;
}

function saveIdMap() {
	writeFileSync(ID_MAP_PATH, JSON.stringify(idMap, null, 2));
}

// ---------------------------------------------------------------------------
// Postgres source
// ---------------------------------------------------------------------------

const pg = postgres(process.env.DATABASE_URL);

// ---------------------------------------------------------------------------
// D1 target
// ---------------------------------------------------------------------------

let db: ReturnType<typeof drizzle>;
let dispose: (() => Promise<void>) | undefined;

if (COMMIT) {
	if (REMOTE) {
		// For remote, use wrangler d1 execute via subprocess
		// This is handled differently — we'll batch SQL statements
		console.error(
			'--remote mode requires using wrangler d1 execute. Use local mode and then push.'
		);
		console.error(
			'Alternative: remove --remote and migrate to local D1, then use wrangler d1 export/import.'
		);
		process.exit(1);
	}
	const proxy = await getPlatformProxy();
	db = drizzle(proxy.env.DB);
	dispose = proxy.dispose;
	await db.run(sql`PRAGMA foreign_keys = OFF`);
} else {
	// Dry run — no D1 connection needed
	db = null as unknown as typeof db;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ts(val: Date | string | null): Date | null {
	if (!val) return null;
	if (val instanceof Date) return val;
	return new Date(val);
}

/** Map a legacy charge payment_method to a payment_cache display label. */
function paymentMethodLabel(method: string | null): string {
	switch (String(method ?? '').toLowerCase()) {
		case 'stripe':
		case 'card':
			return 'Card';
		case 'cash':
			return 'Cash';
		case 'venmo':
			return 'Venmo';
		case 'manual':
			return 'Manual';
		default:
			return 'Other';
	}
}

/**
 * Reverse the `/embed/` transforms the legacy app applied, so the new app's
 * `getEmbedUrl()` (which matches canonical watch/track URLs) re-detects them.
 * Already-canonical URLs (youtu.be, watch?v=, bandcamp, plain sites) pass through.
 */
function canonicalizeEmbedUrl(url: string): string {
	const yt = url.match(/youtube\.com\/embed\/([\w-]+)/);
	if (yt) return `https://www.youtube.com/watch?v=${yt[1]}`;

	const sp = url.match(/open\.spotify\.com\/embed\/(track|album|artist|playlist)\/([\w]+)/);
	if (sp) return `https://open.spotify.com/${sp[1]}/${sp[2]}`;

	if (url.includes('embed.music.apple.com')) {
		return url.replace('embed.music.apple.com', 'music.apple.com');
	}

	const sc = url.match(/w\.soundcloud\.com\/player\/\?url=([^&]+)/);
	if (sc) {
		try {
			return decodeURIComponent(sc[1]);
		} catch {
			return url;
		}
	}

	return url;
}

/** Parse a JSON column that may arrive as a string or already-parsed value. */
function parseJsonColumn(val: unknown): unknown {
	if (val == null) return null;
	if (typeof val === 'string') {
		try {
			return JSON.parse(val);
		} catch {
			return null;
		}
	}
	return val;
}

/**
 * Build the unified `links` array for the new schema from the legacy `links` and
 * `embeds` columns. Legacy links are `{name, url}` (shown as buttons); legacy embeds
 * are `{url}` (shown as players). The new model unifies both into one array where
 * embeddable URLs auto-render as players. Returns null if empty.
 */
function buildLinks(rawLinks: unknown, rawEmbeds: unknown): ProfileLink[] | null {
	const linksData = parseJsonColumn(rawLinks);
	const links: ProfileLink[] = Array.isArray(linksData)
		? linksData.map((l: Record<string, unknown>) => ({
				label: String(l.label ?? l.name ?? ''),
				url: String(l.url ?? '')
			}))
		: [];

	const seen = new Set(links.map((l) => l.url));

	const embedsData = parseJsonColumn(rawEmbeds);
	if (Array.isArray(embedsData)) {
		for (const e of embedsData as Array<Record<string, unknown>>) {
			const raw = String(e.url ?? '');
			if (!raw) continue;
			const url = canonicalizeEmbedUrl(raw);
			if (seen.has(url)) continue;
			seen.add(url);
			let label = detectPlatform(url)?.name;
			if (!label) {
				try {
					label = new URL(url).hostname.replace(/^www\./, '');
				} catch {
					label = 'Media';
				}
			}
			links.push({ label, url, embed: true });
		}
	}

	return links.length > 0 ? links : null;
}

// ---------------------------------------------------------------------------
// Migration functions
// ---------------------------------------------------------------------------

async function migrateUsers() {
	console.log('── Users ──');
	const users = await pg`
		SELECT u.*, mp.bio, mp.links, mp.embeds, mp.contact, mp.visibility, mp.hometown
		FROM users u
		LEFT JOIN member_profiles mp ON mp.user_id = u.id
	`;
	console.log(`  Source: ${users.length} users`);

	// Get tags (instruments/genres) from spatie tags system
	const tags = await pg`
		SELECT t.name, t.type, taggable_id as user_id
		FROM taggables
		JOIN tags t ON t.id = taggables.tag_id
		WHERE taggable_type = 'member_profile'
	`;
	const tagsByProfile: Record<string, { instruments: string[]; genres: string[] }> = {};

	// Map profile IDs to user IDs
	const profiles = await pg`SELECT id, user_id FROM member_profiles`;
	const profileToUser: Record<string, string> = {};
	for (const p of profiles) {
		profileToUser[String(p.id)] = String(p.user_id);
	}

	for (const tag of tags) {
		const userId = profileToUser[String(tag.user_id)];
		if (!userId) continue;
		if (!tagsByProfile[userId]) tagsByProfile[userId] = { instruments: [], genres: [] };
		const raw =
			typeof tag.name === 'object' && tag.name !== null
				? (tag.name.en ?? Object.values(tag.name)[0] ?? '')
				: String(tag.name);
		if (!raw) continue;
		const names = raw
			.split(',')
			.map((s: string) => s.trim().toLowerCase())
			.filter(Boolean);
		for (const name of names) {
			if (tag.type === 'skill') tagsByProfile[userId].instruments.push(name);
			if (tag.type === 'genre') tagsByProfile[userId].genres.push(name);
		}
	}

	// Member flags live in the polymorphic `flags` table (spatie/laravel-model-flags),
	// keyed by member-profile id. flaggable_type appears in two historical formats.
	const flagRows = await pg`
		SELECT name, flaggable_id
		FROM flags
		WHERE flaggable_type IN ('App\\Models\\MemberProfile', 'member_profile')
	`;
	const flagsByUser: Record<string, Set<string>> = {};
	for (const f of flagRows) {
		const userId = profileToUser[String(f.flaggable_id)];
		if (!userId) continue;
		(flagsByUser[userId] ??= new Set()).add(String(f.name));
	}

	if (!COMMIT) {
		const counts = {
			lookingForBand: 0,
			availableForHire: 0,
			teachesLessons: 0,
			openToCollaboration: 0
		};
		for (const names of Object.values(flagsByUser)) {
			const flags = mapMemberFlags(names);
			for (const key of Object.keys(counts) as (keyof typeof counts)[]) {
				if (flags[key]) counts[key]++;
			}
		}
		console.log(`  Would create: ${users.length} users, instruments/genres for tagged profiles`);
		console.log(
			`  Member flags: lookingForBand=${counts.lookingForBand}, availableForHire=${counts.availableForHire}, teachesLessons=${counts.teachesLessons}, openToCollaboration=${counts.openToCollaboration}`
		);
		return;
	}

	for (const u of users) {
		const id = mapId('users', u.id);
		const contactData = u.contact
			? typeof u.contact === 'string'
				? JSON.parse(u.contact)
				: u.contact
			: null;

		// Fold legacy links + embeds into the new unified links array
		const normalizedLinks = buildLinks(u.links, u.embeds);

		// Directory flags from the legacy `flags` table (keyed by legacy user id,
		// same as tagsByProfile above)
		const memberFlags = mapMemberFlags(flagsByUser[String(u.id)] ?? []);

		// Strip sms_ok from contact (migrated separately as notification preference)
		const hasSmsOk = contactData?.sms_ok;
		if (contactData) {
			delete contactData.sms_ok;
			for (const key of Object.keys(contactData)) {
				if (contactData[key] === null) delete contactData[key];
			}
		}

		await db
			.insert(user)
			.values({
				id,
				name: u.name,
				email: u.email,
				emailVerified: !!u.email_verified_at,
				image: null,
				createdAt: ts(u.created_at)!,
				updatedAt: ts(u.updated_at)!,
				pronouns: u.pronouns,
				phone: u.phone ?? null,
				settings: u.settings
					? typeof u.settings === 'string'
						? JSON.parse(u.settings)
						: u.settings
					: null,
				stripeId: u.stripe_id,
				pmType: u.pm_type,
				pmLastFour: u.pm_last_four,
				creditFreeHours: 0,
				creditEquipment: 0,
				deletedAt: null,
				memberNumber: Number.isInteger(Number(u.id)) ? Number(u.id) : null,
				bio: u.bio,
				tagline: null,
				hometown: u.hometown ?? null,
				lookingForBand: memberFlags.lookingForBand,
				availableForHire: memberFlags.availableForHire,
				teachesLessons: memberFlags.teachesLessons,
				openToCollaboration: memberFlags.openToCollaboration,
				directoryVisibility:
					u.visibility === 'public' ? 'public' : u.visibility === 'private' ? 'hidden' : 'members',
				directoryContact: contactData ?? null,
				links: normalizedLinks ?? null
			})
			.onConflictDoNothing();

		if (hasSmsOk) {
			await db
				.insert(notificationPreference)
				.values({
					userId: id,
					notificationType: 'reservation_reminder',
					emailEnabled: true,
					inAppEnabled: true,
					smsEnabled: true
				})
				.onConflictDoNothing();
		}

		// Create account record for better-auth (credential provider)
		await db
			.insert(account)
			.values({
				id: mapId('accounts', u.id),
				accountId: id,
				providerId: 'credential',
				userId: id,
				password: u.password, // Laravel bcrypt is compatible with better-auth
				createdAt: ts(u.created_at)!,
				updatedAt: ts(u.updated_at)!
			})
			.onConflictDoNothing();

		// Insert instruments/genres
		const userTags = tagsByProfile[String(u.id)];
		if (userTags) {
			for (const instrument of userTags.instruments) {
				await db.insert(userInstrument).values({ userId: id, instrument }).onConflictDoNothing();
			}
			for (const genre of userTags.genres) {
				await db.insert(userGenre).values({ userId: id, genre }).onConflictDoNothing();
			}
		}
	}

	// Migrate credit balances from user_credits table
	const credits = await pg`SELECT * FROM user_credits`;
	for (const c of credits) {
		const userId = lookupId('users', c.user_id);
		if (!userId) continue;
		const creditType = c.type ?? c.credit_type;
		if (creditType === 'free_hours') {
			await db
				.update(user)
				.set({ creditFreeHours: c.balance })
				.where(sql`id = ${userId}`);
		} else if (creditType === 'equipment') {
			await db
				.update(user)
				.set({ creditEquipment: c.balance })
				.where(sql`id = ${userId}`);
		}
	}

	console.log(`  ✓ Migrated ${users.length} users`);
}

async function migrateRoles() {
	console.log('── Roles & Permissions ──');
	const roles = await pg`SELECT * FROM roles ORDER BY id`;
	const permissions = await pg`SELECT * FROM permissions ORDER BY id`;
	const rolePerms = await pg`SELECT * FROM role_has_permissions`;
	const modelRoles = await pg`SELECT * FROM model_has_roles`;
	const modelPerms = await pg`SELECT * FROM model_has_permissions`;

	console.log(
		`  Source: ${roles.length} roles, ${permissions.length} permissions, ${modelRoles.length} user-role assignments`
	);

	if (!COMMIT) return;

	for (const r of roles) {
		await db
			.insert(role)
			.values({
				id: r.id,
				name: r.name,
				guardName: r.guard_name,
				createdAt: ts(r.created_at),
				updatedAt: ts(r.updated_at)
			})
			.onConflictDoNothing();
	}

	for (const p of permissions) {
		await db
			.insert(permission)
			.values({
				id: p.id,
				name: p.name,
				guardName: p.guard_name,
				createdAt: ts(p.created_at),
				updatedAt: ts(p.updated_at)
			})
			.onConflictDoNothing();
	}

	for (const rp of rolePerms) {
		await db
			.insert(roleHasPermission)
			.values({
				permissionId: rp.permission_id,
				roleId: rp.role_id
			})
			.onConflictDoNothing();
	}

	for (const mr of modelRoles) {
		const userId = lookupId('users', mr.model_id);
		if (!userId) continue;
		await db
			.insert(modelHasRole)
			.values({
				roleId: mr.role_id,
				userId
			})
			.onConflictDoNothing();
	}

	for (const mp of modelPerms) {
		const userId = lookupId('users', mp.model_id);
		if (!userId) continue;
		await db
			.insert(modelHasPermission)
			.values({
				permissionId: mp.permission_id,
				userId
			})
			.onConflictDoNothing();
	}

	console.log(`  ✓ Migrated roles/permissions`);
}

async function migrateBands() {
	console.log('── Bands ──');
	const bands = await pg`SELECT * FROM band_profiles WHERE deleted_at IS NULL`;
	const members = await pg`SELECT * FROM band_profile_members`;

	// Get band genres from spatie tags
	const bandTags = await pg`
		SELECT t.name, taggable_id as band_id
		FROM taggables
		JOIN tags t ON t.id = taggables.tag_id
		WHERE taggable_type = 'band' AND t.type = 'genre'
	`;

	console.log(`  Source: ${bands.length} bands, ${members.length} members`);

	if (!COMMIT) return;

	for (const b of bands) {
		const id = mapId('band_profiles', b.id);
		const ownerId = lookupId('users', b.owner_id);
		if (!ownerId) continue;

		const contactData = b.contact
			? typeof b.contact === 'string'
				? JSON.parse(b.contact)
				: b.contact
			: null;

		// Fold legacy links + embeds into the new unified links array
		const normalizedLinks = buildLinks(b.links, b.embeds);

		// Strip sms_ok and null values from contact
		if (contactData) {
			delete contactData.sms_ok;
			for (const key of Object.keys(contactData)) {
				if (contactData[key] === null) delete contactData[key];
			}
		}

		await db
			.insert(band)
			.values({
				id,
				name: b.name,
				// A legacy slug is a live address and is preserved as-is. Only the
				// fallback follows the current rule (see `generateSlug`), which drops
				// spaces rather than hyphenating them.
				slug: b.slug || b.name.toLowerCase().replace(/[^a-z0-9-]+/g, ''),
				bio: b.bio,
				ownerId,
				avatarKey: null,
				createdAt: ts(b.created_at)!,
				updatedAt: ts(b.updated_at)!,
				deletedAt: null,
				tagline: null,
				hometown: b.hometown ?? null,
				lookingForMembers: false,
				directoryVisibility:
					b.visibility === 'public' ? 'public' : b.visibility === 'private' ? 'hidden' : 'members',
				directoryContact: contactData ?? null,
				links: normalizedLinks ?? null
			})
			.onConflictDoNothing();
	}

	// Band genres
	for (const tag of bandTags) {
		const bandId = lookupId('band_profiles', tag.band_id);
		if (!bandId) continue;
		const raw =
			typeof tag.name === 'object' && tag.name !== null
				? (tag.name.en ?? Object.values(tag.name)[0] ?? '')
				: String(tag.name);
		if (!raw) continue;
		const genres = raw
			.split(',')
			.map((s: string) => s.trim().toLowerCase())
			.filter(Boolean);
		for (const genre of genres) {
			await db.insert(bandGenre).values({ bandId, genre }).onConflictDoNothing();
		}
	}

	// Band members
	for (const m of members) {
		const bandId = lookupId('band_profiles', m.band_profile_id);
		const userId = lookupId('users', m.user_id);
		if (!bandId || !userId) continue;

		await db
			.insert(bandMember)
			.values({
				id: mapId('band_members', m.id),
				bandId,
				userId,
				role: m.role || 'member',
				position: m.position,
				status: 'active',
				invitedById: null,
				createdAt: ts(m.created_at)!
			})
			.onConflictDoNothing();
	}

	// Reconcile ownership. `band.owner_id` and the `band_member` row whose role is
	// 'owner' are two records of the same fact, and they arrive here from two
	// different legacy tables: `band_profiles.owner_id` above, and
	// `band_profile_members.role` in the loop just before this. Nothing upstream
	// keeps them in step, and the app reads only the member row —
	// `requireBandOwner` resolves through `requireBandMember()` — so a band whose
	// owner is recorded as 'admin' here, or who is missing from
	// `band_profile_members` entirely, has no owner at all once migrated: no
	// address change, no delete, no transfer, no subscription, no custom domain.
	// That is exactly what happened to 5 of 16 bands on the first cutover.
	// Repaired retroactively by `scripts/backfill-band-owners.ts`; this keeps a
	// re-run of the migrator from reintroducing it.
	let ownersFixed = 0;
	for (const b of bands) {
		const bandId = mapId('band_profiles', b.id);
		const ownerId = lookupId('users', b.owner_id);
		if (!ownerId) continue;

		// Another user already holding 'owner' is left alone: two records
		// disagreeing about who owns the band is not something to guess at.
		const [conflict] = await db
			.select({ id: bandMember.id })
			.from(bandMember)
			.where(
				and(
					eq(bandMember.bandId, bandId),
					eq(bandMember.role, 'owner'),
					ne(bandMember.userId, ownerId)
				)
			)
			.limit(1);
		if (conflict) {
			console.warn(`  ! ${b.slug ?? b.name}: another member already holds owner; left as-is`);
			continue;
		}

		const [existing] = await db
			.select({ id: bandMember.id, role: bandMember.role, status: bandMember.status })
			.from(bandMember)
			.where(and(eq(bandMember.bandId, bandId), eq(bandMember.userId, ownerId)))
			.limit(1);

		if (!existing) {
			await db
				.insert(bandMember)
				.values({ bandId, userId: ownerId, role: 'owner', status: 'active' })
				.onConflictDoNothing();
			ownersFixed++;
		} else if (existing.role !== 'owner' || existing.status !== 'active') {
			await db
				.update(bandMember)
				.set({ role: 'owner', status: 'active' })
				.where(eq(bandMember.id, existing.id));
			ownersFixed++;
		}
	}

	console.log(
		`  ✓ Migrated ${bands.length} bands, ${members.length} members${ownersFixed ? `, reconciled ${ownersFixed} owner row(s)` : ''}`
	);
}

/**
 * Convert an RFC 5545 RRULE string to the new JSON format.
 * Example input: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU"
 */
function convertRruleToJson(rruleStr: string, startDate: Date | string | null): string {
	const startDt = startDate
		? new Date(startDate instanceof Date ? startDate : startDate)
		: new Date();

	// Parse RRULE parts
	const parts: Record<string, string> = {};
	for (const part of rruleStr.replace(/^RRULE:/, '').split(';')) {
		const [key, val] = part.split('=');
		if (key && val) parts[key] = val;
	}

	const dayMap: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
	const interval = Number(parts.INTERVAL ?? 1);
	const freq = parts.FREQ === 'MONTHLY' ? ('monthly' as const) : ('weekly' as const);
	const byDay = parts.BYDAY ?? '';
	const weekday = dayMap[byDay.replace(/[^A-Z]/g, '')] ?? startDt.getDay();
	const nthWeek = freq === 'monthly' ? Math.ceil(startDt.getDate() / 7) : undefined;

	const tz = 'America/Los_Angeles';
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		hour12: false
	});
	const dateParts = formatter.formatToParts(startDt);
	const get = (type: Intl.DateTimeFormatPartTypes) =>
		Number(dateParts.find((p) => p.type === type)?.value ?? 0);

	return JSON.stringify({
		freq,
		interval,
		tz,
		start: {
			year: get('year'),
			month: get('month'),
			day: get('day'),
			hour: get('hour'),
			minute: get('minute')
		},
		weekday,
		...(nthWeek !== undefined ? { nthWeek } : {})
	});
}

async function migrateRecurringSeries() {
	console.log('── Recurring Series ──');
	const series = await pg`SELECT * FROM recurring_series WHERE status = 'active'`;
	console.log(`  Source: ${series.length} active series`);

	if (!COMMIT) return;

	for (const s of series) {
		const id = mapId('recurring_series', s.id);
		// All legacy recurring_series are reservation series (recurable_type).
		const protoType = 'reservation';
		const userId = lookupId('users', s.user_id);
		if (!userId) continue;

		// Convert RFC 5545 RRULE to new JSON format
		const rruleJson = convertRruleToJson(
			s.recurrence_rule ?? 'FREQ=WEEKLY;INTERVAL=1',
			s.start_date ?? s.created_at
		);

		await db
			.insert(recurringSeries)
			.values({
				id,
				supersededBy: null,
				prototypeType: protoType,
				// Placeholder: prototypeId must reference the prototype reservation, which
				// doesn't exist yet (reservations migrate after this step). Backfilled to
				// the earliest instance in migrateReservations(). Orphan series with no
				// instances keep this self-id, which never joins a reservation (correct).
				prototypeId: id,
				rrule: rruleJson,
				createdBy: userId,
				createdAt: ts(s.created_at)!,
				cancelledAt: s.status === 'cancelled' ? ts(s.updated_at) : null
			})
			.onConflictDoNothing();
	}

	console.log(`  ✓ Migrated ${series.length} recurring series`);
}

async function migrateReservations() {
	console.log('── Reservations ──');
	const reservations = await pg`
		SELECT * FROM reservations
		WHERE deleted_at IS NULL AND reserved_at IS NOT NULL AND reserved_until IS NOT NULL
		ORDER BY id
	`;
	console.log(`  Source: ${reservations.length} reservations`);

	if (!COMMIT) return;

	// Build event→organizer lookup for event-type reservations
	const eventOrganizers = await pg`SELECT id, organizer_id FROM events`;
	const eventOrganizerMap: Record<string, string | null> = {};
	for (const e of eventOrganizers) {
		eventOrganizerMap[String(e.id)] = e.organizer_id ? String(e.organizer_id) : null;
	}
	const fallbackUserId = lookupId('users', 162)!;

	// Authoritative payment state lives in the legacy `charges` table, not on the
	// reservation row (hours_used/free_hours_used are unreliable). Load reservation
	// charges once and pick the most-relevant charge per reservation: prefer a
	// real-money (`net_amount > 0`) paid charge, then most recent by paid/updated/
	// created time — so a re-paid booking wins over an earlier credit/comp/refund.
	const reservationCharges = await pg`
		SELECT c.*, u.stripe_id
		FROM charges c
		JOIN users u ON u.id = c.user_id
		WHERE c.chargeable_type = 'rehearsal_reservation'
	`;
	type ChargeRow = LegacyCharge & {
		chargeable_id: number | string;
		user_id: number | string;
		stripe_id: string | null;
		payment_method: string | null;
		updated_at: Date | string | null;
		created_at: Date | string | null;
	};
	const chargeTime = (c: ChargeRow): number => {
		const t = c.paid_at ?? c.updated_at ?? c.created_at;
		return t ? new Date(t as string).getTime() : 0;
	};
	const chargeByReservation = new Map<string, ChargeRow>();
	for (const raw of reservationCharges) {
		const c = raw as ChargeRow;
		const key = String(c.chargeable_id);
		const prev = chargeByReservation.get(key);
		if (!prev) {
			chargeByReservation.set(key, c);
			continue;
		}
		const cPaid = normalizeCents(c.net_amount) > 0;
		const prevPaid = normalizeCents(prev.net_amount) > 0;
		// Real-money charge beats non-money; otherwise newest wins.
		if (cPaid !== prevPaid ? cPaid : chargeTime(c) >= chargeTime(prev)) {
			chargeByReservation.set(key, c);
		}
	}

	// Sustaining-membership intervals per legacy user. A confirmed booking with no
	// charge was covered by the member's free hours (legacy showed "covered by
	// credits" but persisted nothing); we reconstruct that only when the booker had
	// an active subscription as of the reservation date. Incomplete subscriptions
	// (never activated) don't count.
	const subs = await pg`
		SELECT user_id, created_at, ends_at FROM subscriptions
		WHERE stripe_status NOT IN ('incomplete', 'incomplete_expired')
	`;
	const subsByUser = new Map<string, { start: number; end: number }[]>();
	for (const s of subs) {
		const key = String(s.user_id);
		const start = s.created_at ? new Date(s.created_at as string).getTime() : 0;
		const end = s.ends_at ? new Date(s.ends_at as string).getTime() : Number.POSITIVE_INFINITY;
		if (!subsByUser.has(key)) subsByUser.set(key, []);
		subsByUser.get(key)!.push({ start, end });
	}
	const coveredByMembership = (legacyUserId: number | string | null, reservedAt: Date | null) => {
		if (legacyUserId == null || !reservedAt) return false;
		const intervals = subsByUser.get(String(legacyUserId));
		if (!intervals) return false;
		const t = reservedAt.getTime();
		return intervals.some((i) => i.start <= t && t <= i.end);
	};

	for (const r of reservations) {
		const id = mapId('reservations', r.id);

		let bookerId: string | null;
		const rType = String(r.reservable_type ?? '').toLowerCase();
		if (rType === 'event') {
			const orgId = eventOrganizerMap[String(r.reservable_id)];
			bookerId = orgId ? lookupId('users', orgId) : fallbackUserId;
		} else {
			bookerId = lookupId('users', r.reservable_id) ?? fallbackUserId;
		}
		const bookerType = 'user';

		// Map status
		let status = 'scheduled';
		const rawStatus = String(r.status ?? '').toLowerCase();
		if (rawStatus.includes('cancel')) status = 'cancelled';
		else if (rawStatus.includes('confirm') || rawStatus === 'confirmed') status = 'confirmed';
		else if (rawStatus.includes('complet')) status = 'completed';
		else if (rawStatus === 'pending') status = 'scheduled';

		const recurringId = r.recurring_series_id
			? lookupId('recurring_series', r.recurring_series_id)
			: null;

		// Reconstruct payment state from the reservation's authoritative legacy
		// charge: net_amount > 0 ⇒ cash/online paid (link the real PaymentIntent or
		// a synthetic id); credits_applied with net 0 ⇒ paid with credits; comped or
		// no charge ⇒ comped/unpaid. See scripts/lib/reservation-payment.ts.
		const charge = chargeByReservation.get(String(r.id)) ?? null;
		const startsAt = ts(r.reserved_at);
		const endsAt = ts(r.reserved_until);
		const durationHours =
			startsAt && endsAt ? (endsAt.getTime() - startsAt.getTime()) / (1000 * 60 * 60) : 0;
		// Membership coverage only applies to member (rehearsal) bookings, not events.
		const memberCovered = rType !== 'event' && coveredByMembership(r.reservable_id, startsAt);
		const payment = deriveReservationPayment(charge, {
			status: status as MappedStatus,
			updatedAt: ts(r.updated_at),
			durationHours,
			coveredByMembership: memberCovered
		});

		await db
			.insert(reservation)
			.values({
				id,
				bookerType,
				bookerId,
				createdByUserId: bookerId,
				status,
				startsAt: ts(r.reserved_at)!,
				endsAt: ts(r.reserved_until)!,
				notes: r.notes,
				cancellationReason: r.cancellation_reason ?? null,
				paidAt: payment.paidAt,
				refundedAt: payment.refundedAt,
				cashDueCents: payment.cashDueCents,
				creditsUsed: payment.creditsUsed,
				stripePaymentRecordId: payment.stripePaymentRecordId,
				lockAccessId: null,
				recurringSeriesId: recurringId,
				createdAt: ts(r.created_at)!,
				updatedAt: ts(r.updated_at)!
			})
			.onConflictDoNothing();

		// Mirror real-money payments into payment_cache (local Stripe mirror). Only
		// charges with cash (net_amount > 0) get a record; credit/comp carry no money
		// and no Stripe record. No live Stripe writes — online charges reuse their
		// existing PaymentIntent id, cash charges a deterministic synthetic id.
		if (charge && normalizeCents(charge.net_amount) > 0) {
			const chargeUserId = lookupId('users', charge.user_id) ?? bookerId;
			const isRefunded = String(charge.status ?? '').toLowerCase() === 'refunded';
			await db
				.insert(paymentCache)
				.values({
					id: chargePaymentRecordId(charge),
					userId: chargeUserId,
					reservationId: id,
					stripeCustomerId: charge.stripe_id ?? null,
					amountCents: normalizeCents(charge.net_amount),
					currency: 'usd',
					paymentMethod: paymentMethodLabel(charge.payment_method),
					status: isRefunded ? 'refunded' : 'completed',
					paidAt: ts(charge.paid_at) ?? ts(r.updated_at) ?? ts(r.created_at)!,
					refundedAt: isRefunded ? (ts(charge.paid_at) ?? ts(r.updated_at)) : null
				})
				.onConflictDoNothing();
		}
	}

	// Backfill recurring_series.prototype_id → earliest reservation instance.
	// Series are created before reservations exist, so prototypeId starts as a
	// placeholder; the app joins recurringSeries.prototypeId = reservation.id.
	const seriesIds = Object.values(idMap['recurring_series'] ?? {});
	let prototypesLinked = 0;
	for (const seriesId of seriesIds) {
		const rows = await db.all<{ id: string }>(
			sql`SELECT id FROM reservation WHERE recurring_series_id = ${seriesId} ORDER BY starts_at ASC LIMIT 1`
		);
		const protoId = rows[0]?.id;
		if (protoId) {
			await db
				.update(recurringSeries)
				.set({ prototypeId: protoId })
				.where(sql`id = ${seriesId}`);
			prototypesLinked++;
		}
	}

	console.log(`  ✓ Migrated ${reservations.length} reservations`);
	console.log(`  ✓ Linked ${prototypesLinked}/${seriesIds.length} recurring-series prototypes`);
}

async function migrateClosures() {
	console.log('── Closures ──');
	const closures = await pg`SELECT * FROM space_closures WHERE deleted_at IS NULL`;
	console.log(`  Source: ${closures.length} closures`);

	if (!COMMIT) return;

	for (const c of closures) {
		await db
			.insert(closure)
			.values({
				id: mapId('closures', c.id),
				reason: c.reason || 'Closed',
				startsAt: ts(c.starts_at ?? c.start_date)!,
				endsAt: ts(c.ends_at ?? c.end_date)!,
				createdAt: ts(c.created_at)!
			})
			.onConflictDoNothing();
	}

	console.log(`  ✓ Migrated ${closures.length} closures`);
}

async function migrateEvents() {
	console.log('── Events ──');
	const events = await pg`SELECT * FROM events WHERE deleted_at IS NULL ORDER BY id`;
	console.log(`  Source: ${events.length} events`);

	if (!COMMIT) return;

	const fallbackUserId = lookupId('users', 162)!;

	for (const e of events) {
		const id = mapId('events', e.id);
		const createdByUserId = lookupId('users', e.organizer_id) ?? fallbackUserId;
		if (!createdByUserId) continue;
		if (!e.start_datetime) continue;

		let status = 'draft';
		if (e.status === 'approved' && e.published_at) status = 'published';
		else if (e.status === 'approved') status = 'draft';
		else if (e.status === 'cancelled') status = 'cancelled';
		else if (e.status === 'scheduled' && e.published_at) status = 'published';

		let startsAt = ts(e.start_datetime)!;
		let endsAt = ts(e.end_datetime ?? e.start_datetime)!;
		if (endsAt < startsAt) [startsAt, endsAt] = [endsAt, startsAt];
		// The `event_time_order` check requires ends_at > starts_at. Some legacy rows
		// have a missing/equal end time; give them a default 2-hour duration rather
		// than dropping the event entirely.
		if (endsAt <= startsAt) endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);

		// Legacy location is JSON { is_external, details }; carry the human-readable address.
		const locationData = e.location
			? typeof e.location === 'string'
				? JSON.parse(e.location)
				: e.location
			: null;
		const location = locationData?.details ?? null;

		const ticketing = mapLegacyEventTicketing(e);

		try {
			await db
				.insert(event)
				.values({
					id,
					title: e.title || 'Untitled Event',
					description: e.description,
					startsAt,
					endsAt,
					doorsAt: ts(e.doors_datetime),
					status,
					publishedAt: ts(e.published_at),
					reservationId: null,
					posterKey: null,
					location,
					tags: e.event_type,
					ticketingEnabled: ticketing.ticketingEnabled,
					ticketPrice: ticketing.ticketPrice,
					ticketQuantity: ticketing.ticketQuantity,
					externalTicketUrl: ticketing.externalTicketUrl,
					createdByUserId,
					createdAt: ts(e.created_at)!,
					updatedAt: ts(e.updated_at)!
				})
				.onConflictDoNothing();
		} catch (err) {
			console.warn(`  ⚠ Skipped event ${e.id} (${e.title}): ${(err as Error).message}`);
		}
	}

	console.log(`  ✓ Migrated ${events.length} events`);
}

async function migrateTickets() {
	console.log('── Tickets ──');

	// Check if tickets table exists in source
	const tableCheck = await pg`
		SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tickets')
	`;
	if (!tableCheck[0].exists) {
		console.log('  Source: tickets table not found, skipping');
		return;
	}

	const tickets = await pg`
		SELECT t.*, o.event_id, o.user_id, o.uuid as order_uuid
		FROM tickets t
		JOIN ticket_orders o ON o.id = t.ticket_order_id
		ORDER BY t.id
	`;
	console.log(`  Source: ${tickets.length} tickets`);

	if (!COMMIT) return;

	for (const t of tickets) {
		const eventId = lookupId('events', t.event_id);
		if (!eventId) continue;
		const userId = t.user_id ? lookupId('users', t.user_id) : null;

		try {
			await db
				.insert(ticket)
				.values({
					id: mapId('tickets', t.id),
					eventId,
					purchaseId: t.order_uuid ?? mapId('ticket_purchases', t.id),
					userId,
					attendeeName: t.attendee_name ?? 'Unknown',
					attendeeEmail: t.attendee_email ?? '',
					code: t.code ?? mapId('ticket_codes', t.id).slice(0, 8),
					status: t.status === 'confirmed' ? 'valid' : (t.status ?? 'valid'),
					checkedInAt: ts(t.checked_in_at),
					checkedInByUserId: t.checked_in_by ? lookupId('users', t.checked_in_by) : null,
					createdAt: ts(t.created_at)!,
					updatedAt: ts(t.updated_at)!
				})
				.onConflictDoNothing();
		} catch (err) {
			console.warn(`  ⚠ Skipped ticket ${t.id}: ${(err as Error).message}`);
		}
	}

	console.log(`  ✓ Migrated ${tickets.length} tickets`);
}

async function migrateCreditTransactions() {
	console.log('── Credit Transactions ──');
	const txns = await pg`SELECT * FROM credit_transactions ORDER BY id`;
	console.log(`  Source: ${txns.length} transactions`);

	if (!COMMIT) return;

	for (const t of txns) {
		const userId = lookupId('users', t.user_id);
		if (!userId) continue;

		await db
			.insert(creditTransaction)
			.values({
				id: t.id,
				userId,
				creditType: t.credit_type ?? t.type ?? 'free_hours',
				amount: t.amount,
				balanceAfter: t.balance_after ?? 0,
				source: t.source ?? 'legacy',
				sourceId: t.source_id ? String(t.source_id) : null,
				description: t.description ?? 'Migrated from legacy system',
				metadata: t.metadata
					? typeof t.metadata === 'string'
						? JSON.parse(t.metadata)
						: t.metadata
					: {},
				createdAt: ts(t.created_at)!
			})
			.onConflictDoNothing();
	}

	console.log(`  ✓ Migrated ${txns.length} credit transactions`);
}

async function migrateEquipment() {
	console.log('── Equipment ──');

	const tableCheck = await pg`
		SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'equipment')
	`;
	if (!tableCheck[0].exists) {
		console.log('  Source: equipment table not found, skipping');
		return;
	}

	const items = await pg`SELECT * FROM equipment WHERE deleted_at IS NULL`;
	const loans = await pg`SELECT * FROM equipment_loans`;
	console.log(`  Source: ${items.length} items, ${loans.length} loans`);

	if (!COMMIT) return;

	// Create categories from distinct category values
	const categories = new Map<string, string>();
	for (const item of items) {
		const cat = item.category ?? 'General';
		if (!categories.has(cat)) {
			const catId = mapId('equipment_categories', cat);
			categories.set(cat, catId);
			await db
				.insert(equipmentCategory)
				.values({
					id: catId,
					name: cat,
					displayOrder: categories.size,
					pricingTier: 'accessory',
					createdAt: ts(item.created_at)!,
					updatedAt: ts(item.updated_at)!
				})
				.onConflictDoNothing();
		}
	}

	for (const item of items) {
		const id = mapId('equipment', item.id);
		const categoryId = categories.get(item.category ?? 'General')!;

		await db
			.insert(equipment)
			.values({
				id,
				name: item.name,
				description: item.description,
				categoryId,
				totalQuantity: item.total_quantity ?? item.quantity ?? 1,
				outOfOrderQuantity: 0,
				serialNumber: item.serial_number,
				resourceId: null,
				condition: item.condition ?? 'good',
				status: item.status ?? 'available',
				notes: item.notes,
				imageUrl: null,
				createdAt: ts(item.created_at)!,
				updatedAt: ts(item.updated_at)!,
				deletedAt: null
			})
			.onConflictDoNothing();
	}

	for (const loan of loans) {
		const equipmentId = lookupId('equipment', loan.equipment_id);
		const userId = lookupId('users', loan.user_id);
		if (!userId) continue;

		await db
			.insert(equipmentLoan)
			.values({
				id: mapId('equipment_loans', loan.id),
				equipmentId,
				userId,
				quantity: loan.quantity ?? 1,
				requestedPickupDate: ts(loan.requested_pickup_date ?? loan.created_at)!,
				scheduledPickupDate: ts(loan.scheduled_pickup_date),
				dueDate: ts(loan.due_date),
				checkedOutAt: ts(loan.checked_out_at),
				returnedAt: ts(loan.returned_at),
				status: loan.status ?? 'requested',
				dailyRateCents: loan.daily_rate_cents,
				totalChargeCents: loan.total_charge_cents,
				creditsCents: loan.credits_cents,
				cashCents: loan.cash_cents,
				memberNotes: loan.member_notes,
				staffNotes: loan.staff_notes,
				createdAt: ts(loan.created_at)!,
				updatedAt: ts(loan.updated_at)!
			})
			.onConflictDoNothing();
	}

	console.log(`  ✓ Migrated ${items.length} equipment items, ${loans.length} loans`);
}

async function migrateNotifications() {
	console.log('── Notifications ──');
	const notifications = await pg`
		SELECT * FROM notifications
		WHERE notifiable_type = 'App\\Models\\User'
		ORDER BY created_at DESC
		LIMIT 1000
	`;
	console.log(`  Source: ${notifications.length} notifications (limited to most recent 1000)`);

	if (!COMMIT) return;

	for (const n of notifications) {
		const userId = lookupId('users', n.notifiable_id);
		if (!userId) continue;

		const data = n.data ? (typeof n.data === 'string' ? JSON.parse(n.data) : n.data) : {};

		await db
			.insert(notification)
			.values({
				id: n.id ?? mapId('notifications', n.id ?? userId + n.created_at),
				userId,
				type: n.type?.split('\\').pop() ?? 'general',
				title: data.title ?? data.subject ?? n.type?.split('\\').pop() ?? 'Notification',
				body: data.body ?? data.message ?? null,
				href: data.action_url ?? data.url ?? null,
				data: data,
				readAt: ts(n.read_at),
				createdAt: ts(n.created_at)!
			})
			.onConflictDoNothing();
	}

	console.log(`  ✓ Migrated ${notifications.length} notifications`);
}

async function migrateInvitations() {
	console.log('── Platform Invitations ──');

	const tableCheck = await pg`
		SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'support_invitations')
	`;
	if (!tableCheck[0].exists) {
		console.log('  Source: support_invitations table not found, skipping');
		return;
	}

	const invitations = await pg`
		SELECT * FROM support_invitations
		WHERE status = 'pending' AND invitable_type LIKE '%Band%'
	`;
	console.log(`  Source: ${invitations.length} pending band invitations`);

	if (!COMMIT) return;

	for (const inv of invitations) {
		const bandId = lookupId('band_profiles', inv.invitable_id);
		const invitedById = lookupId('users', inv.inviter_id);
		if (!bandId || !invitedById) continue;

		await db
			.insert(platformInvite)
			.values({
				id: mapId('platform_invites', inv.id),
				email: inv.email,
				token: inv.token ?? mapId('invite_tokens', inv.id),
				bandId,
				role: 'member',
				position: null,
				invitedById,
				status: 'pending',
				expiresAt: ts(inv.expires_at) ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
				createdAt: ts(inv.created_at)!,
				acceptedAt: null
			})
			.onConflictDoNothing();
	}

	console.log(`  ✓ Migrated ${invitations.length} invitations`);
}

async function exportCashPayments() {
	console.log('── Real-money Payments (export only) ──');
	// All real money (net_amount > 0), regardless of method — this includes online
	// Stripe charges, which a future idempotent Stripe-materialization step will
	// *link* via stripePaymentIntentId rather than re-*report*. Cash/Venmo/manual
	// charges (no intent id) get reported as custom Payment Records by that step.
	const charges = await pg`
		SELECT c.*, u.name as user_name, u.email as user_email, u.stripe_id
		FROM charges c
		JOIN users u ON u.id = c.user_id
		WHERE c.net_amount > 0
		ORDER BY c.paid_at
	`;
	console.log(`  Source: ${charges.length} real-money charges (net_amount > 0)`);

	const records = charges.map((c) => {
		return {
			stripeCustomerId: c.stripe_id ?? null,
			userName: c.user_name,
			userEmail: c.user_email,
			amountCents: normalizeCents(c.net_amount),
			paymentMethod: c.payment_method,
			status: c.status,
			stripePaymentIntentId: c.stripe_payment_intent_id ?? null,
			stripeSessionId: c.stripe_session_id ?? null,
			paidAt: ts(c.paid_at)!,
			notes: c.notes,
			reservationId: c.chargeable_id ? lookupId('reservations', c.chargeable_id) : null,
			legacyChargeId: c.id
		};
	});

	const outPath = resolve(import.meta.dirname!, 'cash-payments.json');
	writeFileSync(outPath, JSON.stringify(records, null, 2));
	console.log(`  ✓ Exported ${records.length} records to ${outPath}`);
}

async function migrateMedia() {
	console.log('── Media (R2 keys) ──');

	// Spatie media library stores files at {media_id}/{file_name} in R2
	const media = await pg`
		SELECT m.id as media_id, m.model_type, m.model_id, m.file_name,
			CASE
				WHEN m.model_type = 'member_profile' THEN (SELECT user_id FROM member_profiles WHERE id = m.model_id)
				WHEN m.model_type = 'staff_profile' THEN (SELECT user_id FROM staff_profiles WHERE id = m.model_id)
				WHEN m.model_type = 'event' THEN m.model_id
				WHEN m.model_type = 'band' THEN m.model_id
			END as resolved_id
		FROM media m
		ORDER BY m.id
	`;
	console.log(`  Source: ${media.length} media records`);

	if (!COMMIT) return;

	const seenUsers = new Set<string>();
	let updated = 0;

	// Process in reverse so latest media wins for users with multiple uploads
	for (const m of [...media].reverse()) {
		const r2Key = `${m.media_id}/${m.file_name}`;
		const resolvedId = String(m.resolved_id);

		if (m.model_type === 'band') {
			const bandId = lookupId('band_profiles', resolvedId);
			if (bandId) {
				await db
					.update(band)
					.set({ avatarKey: r2Key })
					.where(sql`id = ${bandId}`);
				updated++;
			}
		} else if (m.model_type === 'event') {
			const eventId = lookupId('events', resolvedId);
			if (eventId) {
				await db
					.update(event)
					.set({ posterKey: r2Key })
					.where(sql`id = ${eventId}`);
				updated++;
			}
		} else if (m.model_type === 'member_profile' || m.model_type === 'staff_profile') {
			if (seenUsers.has(resolvedId)) continue;
			seenUsers.add(resolvedId);
			const userId = lookupId('users', resolvedId);
			if (userId) {
				await db
					.update(user)
					.set({ image: r2Key })
					.where(sql`id = ${userId}`);
				updated++;
			}
		}
	}

	console.log(`  ✓ Updated ${updated} image/avatar/poster references`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	console.log('Starting migration from Postgres → D1\n');

	await migrateUsers();
	await migrateRoles();
	await migrateBands();
	await migrateRecurringSeries();
	await migrateReservations();
	await migrateClosures();
	await migrateEvents();
	await migrateTickets();
	await migrateCreditTransactions();
	await exportCashPayments();
	await migrateEquipment();
	await migrateNotifications();
	await migrateInvitations();
	await migrateMedia();

	// Save ID map for reference/re-runs
	saveIdMap();
	console.log(`\nID map saved to ${ID_MAP_PATH}`);

	if (!COMMIT) {
		console.log('\n⚠️  DRY RUN — no data was written. Use --commit to write to D1.');
	} else {
		console.log('\n✓ Migration complete.');
	}
}

main()
	.catch((err) => {
		console.error('Fatal:', err);
		process.exit(1);
	})
	.finally(async () => {
		await pg.end();
		if (dispose) await dispose();
	});
