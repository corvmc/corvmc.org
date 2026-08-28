/**
 * Seed the local D1 database with fake data for UI development.
 *
 * Usage:
 *   pnpm db:seed
 *
 * This is DESTRUCTIVE — it deletes all data and rebuilds from scratch.
 * Do not run against production.
 *
 * Prerequisites:
 *   - Local D1 SQLite file exists (run `pnpm db:push` first)
 */
import 'dotenv/config';
import { randomUUID, randomBytes, scrypt } from 'crypto';
import { getPlatformProxy } from 'wrangler';
import { drizzle } from 'drizzle-orm/d1';
import { sql, eq, inArray } from 'drizzle-orm';

// Mirror the app's password hashing (src/lib/server/auth.ts `scryptHash`). We can't
// import that module here — it pulls SvelteKit-only `$env`/`$app` aliases that don't
// resolve under tsx — so the format is reproduced inline. The app's verifier only
// accepts `scrypt:` / `$2` / `pbkdf2:` prefixes; better-auth's bare-hex hashPassword
// is rejected as `unknown_hash_format`, which is why seeded logins must use this.
const SCRYPT_PARAMS = { N: 16384, r: 16, p: 1, keylen: 64, maxmem: 128 * 16384 * 16 * 2 };
function scryptHash(password: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const salt = randomBytes(16);
		const { N, r, p, keylen, maxmem } = SCRYPT_PARAMS;
		scrypt(password.normalize('NFKC'), salt, keylen, { N, r, p, maxmem }, (err, key) =>
			err
				? reject(err)
				: resolve(`scrypt:${N}:${r}:${p}:${salt.toString('hex')}:${key.toString('hex')}`)
		);
	});
}
import {
	user,
	account,
	type DirectoryContact,
	type DirectoryVisibility,
	type ProfileLink
} from '../src/lib/server/db/schema/authentication';
import { role, modelHasRole } from '../src/lib/server/db/schema/authorization';
import { reservation, closure } from '../src/lib/server/db/schema/reservation';
import { recurringSeries } from '../src/lib/server/db/schema/recurring';
import { event, eventBand } from '../src/lib/server/db/schema/event';
import { ticket } from '../src/lib/server/db/schema/ticket';
import { eventRsvp } from '../src/lib/server/db/schema/event-rsvp';
import {
	creditTransaction,
	paymentCache as paymentRecord
} from '../src/lib/server/db/schema/finance';
import { notification, notificationPreference } from '../src/lib/server/db/schema/notification';
import { directoryEntry, directoryTag } from '../src/lib/server/db/schema/directory';
import { groupMember, groupSlugHistory } from '../src/lib/server/db/schema/group';
import { group } from '../src/lib/server/db/schema/group';
import { bandPageConfig } from '../src/lib/server/db/schema/band-page';
import { media, mediaAttachment } from '../src/lib/server/db/schema/media';
import { bandSite } from '../src/lib/server/db/schema/band-site';
import {
	subscriber,
	audience,
	audienceMember,
	campaign,
	campaignAudience
} from '../src/lib/server/db/schema/marketing';
// Registry only — deliberately free of $lib imports so it resolves under tsx.
import { SYSTEM_AUDIENCES } from '../src/lib/server/marketing/system-audience-defs';
import {
	acquisition,
	acquisitionLine,
	equipmentCategory,
	inventoryAsset,
	inventoryItem,
	inventoryLoan,
	inventoryLocation,
	stockMovement
} from '../src/lib/server/db/schema/inventory';
import { helpCategory, helpArticle } from '../src/lib/server/db/schema/help';
import { inventoryItemArticle } from '../src/lib/server/db/schema/inventory';
import {
	inboxThread,
	inboxMessage,
	inboxNote,
	inboxChannelConfig,
	inboxParticipant
} from '../src/lib/server/db/schema/inbox';
import { contentFlag } from '../src/lib/server/db/schema/flag';
import { userBlock } from '../src/lib/server/db/schema/moderation';
import { memberStanding } from '../src/lib/server/db/schema/standing';
import { suggestion, suggestionVote, suggestionEdit } from '../src/lib/server/db/schema/suggestion';
import {
	volunteerRole,
	volunteerProfile,
	volunteerHourLog,
	volunteerRoleInterest,
	volunteerCertification,
	memberCertification,
	volunteerRoleCertification,
	volunteerShift,
	volunteerSignup,
	volunteerShiftFeedback
} from '../src/lib/server/db/schema/volunteer';
// JSON recurrence format matching the app's rrule-helpers (see scripts/seed-rrule.ts).
import { buildSeedRRule as seedRRule } from './seed-rrule';
const { env, dispose } = await getPlatformProxy();
const db = drizzle(env.DB);
await db.run(sql`PRAGMA foreign_keys = OFF`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
	const shuffled = [...arr].sort(() => Math.random() - 0.5);
	return shuffled.slice(0, n);
}

function randomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function ptDate(daysOffset: number, hour: number, minute = 0): Date {
	const d = new Date();
	d.setDate(d.getDate() + daysOffset);
	d.setUTCHours(hour + 7, minute, 0, 0);
	return d;
}

/**
 * Tags collected while users and bands are seeded, keyed by the SUBJECT id.
 *
 * `directory_tag` hangs off the entry, and entries are created at the very end
 * from everything in the database — so the tags cannot be written at the same
 * moment as the user or band they describe. Collecting them here keeps that one
 * ordering constraint in one place instead of making each seed function know
 * about entries.
 */
const pendingTags: { subjectId: string; kind: 'genre' | 'instrument'; value: string }[] = [];

/**
 * Listing fields collected while users and bands are seeded, keyed by SUBJECT id.
 *
 * These used to be read back off `user` and `group`, which worked while the
 * columns were still there to read. Phase 3c drops them, so the values have to
 * travel from the place that invents them to the place that writes the entry —
 * the same shape `pendingTags` already uses, and for the same reason.
 */
type PendingEntry = {
	bio?: string | null;
	tagline?: string | null;
	hometown?: string | null;
	foundedYear?: string | null;
	links?: ProfileLink[] | null;
	visibility?: DirectoryVisibility;
	contact?: DirectoryContact;
	lookingFor?: 'members' | 'band' | null;
	availableForHire?: boolean;
	teachesLessons?: boolean;
	openToCollaboration?: boolean;
};
const pendingEntries = new Map<string, PendingEntry>();

/**
 * The premium half, keyed by band id, for the same reason `pendingEntries`
 * exists: phase 3c drops `tier`, `subscription` and the five `customDomain*`
 * columns from `group`, so they travel from the band seeder to
 * `seedBandSites` rather than being read back off the group row.
 */
type PendingSite = Partial<typeof bandSite.$inferInsert>;
const pendingSites = new Map<string, PendingSite>();

async function batchInsert<T extends Record<string, unknown>>(
	table: any,
	rows: T[],
	batchSize = 10
): Promise<T[]> {
	const results: T[] = [];
	for (let i = 0; i < rows.length; i += batchSize) {
		const batch = rows.slice(i, i + batchSize);
		const returned = await db.insert(table).values(batch).returning();
		results.push(...returned);
	}
	return results;
}

// ---------------------------------------------------------------------------
// Data pools
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
	'Alex',
	'Jordan',
	'Casey',
	'Morgan',
	'Taylor',
	'Riley',
	'Quinn',
	'Avery',
	'Dakota',
	'Reese',
	'Skyler',
	'Finley',
	'Rowan',
	'Sage',
	'Charlie',
	'Emerson',
	'Hayden',
	'Parker',
	'Blake',
	'Jamie'
];

const LAST_NAMES = [
	'Chen',
	'Rivera',
	'Nguyen',
	'Kowalski',
	'Okafor',
	'Singh',
	'Larsson',
	'Fernandez',
	'Tanaka',
	'Dubois',
	'Kim',
	'Petrov',
	'Anderson',
	'Reyes',
	'Washington',
	'Murphy',
	'Cohen',
	'Yamamoto',
	'Santos',
	'Berg'
];

const PRONOUNS = ['he/him', 'she/her', 'they/them', null, null];

const EVENT_TITLES = [
	'Open Mic Night',
	'Jazz Jam Session',
	'Songwriting Workshop',
	'Battle of the Bands',
	'Acoustic Showcase',
	'Electronic Music Night',
	'Blues & Brews',
	'Hip-Hop Cypher',
	'Classical Recital',
	'Punk Rock Matinee',
	'Folk Circle',
	'Album Release Party',
	'Music Theory Workshop',
	'Guitar Clinic',
	'Drum Circle',
	'Singer-Songwriter Night',
	'Funk & Soul Revue',
	'Latin Night'
];

const EVENT_TAGS_POOL = [
	'open mic',
	'workshop',
	'jam',
	'showcase',
	'all ages',
	'21+',
	'free',
	'ticketed',
	'community',
	'genre night'
];

const CLOSURE_REASONS = [
	'Building maintenance',
	'Holiday closure',
	'Staff retreat',
	'Private rental',
	'Deep cleaning',
	'Equipment installation',
	'Electrical work',
	'Plumbing repair'
];

const BAND_NAMES = [
	'The Voltage Thieves',
	'Half Past Never',
	'Cardboard Satellites',
	'Velvet Brake',
	'Tin Whisker',
	'Slow Catastrophe',
	'Paper Wolves',
	'The After Math'
];

const BAND_POSITIONS = [
	'Guitar',
	'Bass',
	'Drums',
	'Vocals',
	'Keys',
	'Saxophone',
	'Violin',
	'Cello',
	'Trumpet'
];

// Per-band stage names. Only some members have one — the roster, the microsite
// members block and the directory profile all fall back to the account name,
// and that fallback is the path most rows take, so it needs local coverage too.
const BAND_ALIASES = [
	'Ziggy',
	'Slim',
	'Doc',
	'Ace',
	'Kid Vicious',
	'The Reverend',
	'Lefty',
	'Sparrow',
	'Nova',
	'Tex'
];

const TICKET_CODES_PREFIX = 'TIX';

const INSTRUMENTS = [
	'guitar',
	'bass',
	'drums',
	'vocals',
	'keys',
	'piano',
	'saxophone',
	'violin',
	'cello',
	'trumpet',
	'trombone',
	'flute',
	'banjo',
	'mandolin',
	'harmonica',
	'ukulele',
	'synthesizer',
	'turntables',
	'percussion'
];

const GENRES = [
	'jazz',
	'rock',
	'funk',
	'blues',
	'folk',
	'indie',
	'electronic',
	'hip-hop',
	'classical',
	'punk',
	'metal',
	'r&b',
	'soul',
	'country',
	'reggae',
	'latin',
	'world',
	'experimental',
	'pop',
	'ambient'
];

const TAGLINES = [
	'Drummer looking for a funk project',
	'Multi-instrumentalist | Jazz & Soul',
	'Singer-songwriter | Acoustic vibes',
	'Lead guitarist | Rock & Blues',
	'Bassist for hire',
	'Keys player | All genres welcome',
	'Producer & DJ',
	'Classically trained, genre curious',
	'Vocalist | R&B, Soul, Gospel',
	'Percussionist | World music enthusiast'
];

const HOMETOWNS = [
	'Corvallis, OR',
	'Albany, OR',
	'Philomath, OR',
	'Eugene, OR',
	'Salem, OR',
	'Lebanon, OR',
	'Portland, OR'
];

const MEMBER_BIOS = [
	'Been playing since I was 12. Love jamming with new people.',
	'Studied music at OSU. Currently in two bands but always looking for side projects.',
	'Self-taught guitarist. Into anything with a good groove.',
	'Professional session musician. Available for recording and live gigs.',
	'Just moved to Corvallis and looking to connect with local musicians.',
	'Weekend warrior. Day job in tech, music is my therapy.',
	null,
	null,
	null
];

const SAMPLE_LINKS = [
	{ label: 'My SoundCloud', url: 'https://soundcloud.com/example/tracks' },
	{ label: 'YouTube Channel', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
	{ label: 'Spotify', url: 'https://open.spotify.com/artist/example' },
	{ label: 'Bandcamp', url: 'https://example.bandcamp.com/album/demo' },
	{ label: 'Instagram', url: 'https://instagram.com/musician' },
	{ label: 'Personal Site', url: 'https://example.com' }
];

const BAND_EVENT_TITLES = [
	'Live at The Peacock',
	'House Show — All Ages',
	'Album Release Party',
	'Benefit for Local Food Bank',
	"Late Night at Cloud & Kelly's",
	'Backyard BBQ & Music',
	'Summer Solstice Set',
	'Vinyl Night',
	'Residency Night #4',
	'Co-Headliner with Paper Wolves'
];

const BAND_EVENT_LOCATIONS = [
	'The Peacock Tavern, 125 SW 2nd St',
	"Cloud & Kelly's, 126 SW 1st St",
	'Bombs Away Cafe, 2527 NW Monroe Ave',
	'Majestic Theatre, 115 SW 2nd St',
	'House show (DM for address)',
	'OSU MU Ballroom',
	'Avery Park Amphitheater',
	'Block 15 Brewery, 300 SW Jefferson Ave'
];

/**
 * Support acts with no CMC account — the common case on a real bill, and what
 * the `unlinked` lineup status exists for.
 */
const SUPPORT_BAND_NAMES = [
	'Paper Wolves',
	'Sun Kissed',
	'The Filbert Set',
	'Marys Peak Ramblers',
	'Static Bloom',
	'Willamette Static',
	'Dead Air Radio',
	'The Nine Volts'
];

const PRESS_QUOTES = [
	{
		quote: 'One of the most exciting acts to come out of the Willamette Valley in years.',
		publication: 'Oregon Music News',
		date: '2025-11'
	},
	{
		quote: "Their live energy is absolutely electric — don't miss them.",
		publication: 'Corvallis Gazette-Times',
		date: '2025-09'
	},
	{
		quote: "A refreshing blend of genres that shouldn't work but absolutely does.",
		publication: 'PDX Monthly',
		date: '2026-01'
	},
	{
		quote: 'The real deal. Tight, inventive, and impossible not to dance to.',
		publication: 'Willamette Week',
		date: '2026-03'
	},
	{
		quote: 'They pack every venue they play. Simple as that.',
		publication: 'Eugene Weekly',
		date: '2025-12'
	}
];

const ACHIEVEMENTS_POOL = [
	'Opened for Built to Spill at the McDonald Theatre (2025)',
	'Selected for Pickathon Festival 2026',
	'150,000+ streams on Spotify',
	"Featured on KBOO Portland's Local Music Spotlight",
	'Won Battle of the Bands at Bombs Away (2025)',
	'Sold out Majestic Theatre (400 cap) twice',
	'Oregon Music Award nominee — Best New Act 2025',
	'Recorded at Jackpot! Recording Studio, Portland'
];

const BACKLINE_ITEMS = [
	{
		instrument: 'Drums',
		details: 'DW 5-piece kit, 22" kick. Band provides cymbals and snare.',
		provided: false
	},
	{
		instrument: 'Bass Amp',
		details: 'Ampeg SVT-style, 300W minimum with 4x10 or 8x10 cab',
		provided: false
	},
	{
		instrument: 'Guitar Amp',
		details: 'Fender Twin Reverb or equivalent clean amp',
		provided: false
	},
	{ instrument: 'Keys', details: 'Nord Stage 3 or similar weighted 88-key', provided: false },
	{ instrument: 'Monitors', details: '4 monitor wedges with independent mixes', provided: false },
	{ instrument: 'DI Boxes', details: '2x active DI (Radial J48 or equivalent)', provided: false }
];

// ---------------------------------------------------------------------------
// Seed functions
// ---------------------------------------------------------------------------

async function deleteAll() {
	console.log('Deleting all data...');
	const tables = [
		// Child before parent: volunteer_hour_log has an ON DELETE RESTRICT FK to
		// volunteer_role, so the role rows can't go first. (volunteer_role_interest
		// cascades, but ordering it explicitly keeps the list readable.)
		'volunteer_shift_feedback',
		'volunteer_signup',
		'volunteer_shift',
		'member_certification',
		'volunteer_role_certification',
		'volunteer_certification',
		'volunteer_role_interest',
		'volunteer_hour_log',
		'volunteer_profile',
		'volunteer_role',
		// Before content_flag and user: they reference both.
		'member_standing',
		'user_block',
		'suggestion_edit',
		'suggestion_vote',
		'suggestion',
		'content_flag',
		'inbox_note',
		'inbox_message',
		'inbox_participant',
		'inbox_thread',
		'inbox_channel_config',
		'help_articles',
		'help_categories',
		'stock_movement',
		'inventory_loan',
		'acquisition_line',
		'acquisition',
		'inventory_asset',
		'inventory_item',
		'inventory_location',
		'equipment_category',
		'campaign_audience',
		'campaign',
		'audience_member',
		'audience',
		'subscriber',
		'notification_preference',
		'notification',
		'ticket',
		'band_page_config',
		'band_site',
		// Child before parent, and both before `group` and `user`.
		'directory_tag',
		'directory_entry',
		'group_member',
		'group_slug_history',
		'group',
		'payment_cache',
		'credit_transaction',
		'recurring_series',
		'event',
		'closure',
		'reservation',
		'model_has_roles',
		'model_has_permissions',
		'role_has_permissions',
		'roles',
		'permissions',
		'session',
		'account',
		'verification',
		'user'
	];
	for (const t of tables) {
		await db.run(sql.raw(`DELETE FROM "${t}"`));
	}
}

interface SeedRole {
	id: number;
	name: string;
}
interface SeedUser {
	id: string;
	name: string;
	email: string;
}
interface SeedEvent {
	id: string;
	status: string;
	startsAt: Date;
	endsAt: Date | null;
}
/** Matches the `reservation.hourlyRateCents` site-config default. */
const HOURLY_RATE_CENTS = 1500;

interface SeedReservation {
	id: string;
	createdByUserId: string;
	startsAt: Date;
	endsAt: Date;
	status: string;
}

async function seedRoles(): SeedRole[] {
	console.log('Seeding roles...');
	const roles = ['admin', 'staff', 'member', 'volunteer', 'sustaining'];
	const inserted: SeedRole[] = [];
	for (const name of roles) {
		const [r] = await db.insert(role).values({ name, guardName: 'web' }).returning();
		inserted.push(r);
	}
	return inserted;
}

async function seedUsers(count: number): SeedUser[] {
	console.log(`Seeding ${count} users...`);
	const users: SeedUser[] = [];
	const usedEmails = new Set<string>();

	for (let i = 0; i < count; i++) {
		const first = pick(FIRST_NAMES);
		const last = pick(LAST_NAMES);
		const name = `${first} ${last}`;
		let email = `${first.toLowerCase()}.${last.toLowerCase()}@example.com`;

		let suffix = 1;
		while (usedEmails.has(email)) {
			email = `${first.toLowerCase()}.${last.toLowerCase()}${suffix}@example.com`;
			suffix++;
		}
		usedEmails.add(email);

		const id = randomUUID();
		const createdAt = new Date(Date.now() - randomInt(7, 365) * 86400000);

		const hasProfile = Math.random() > 0.3;
		const memberInstruments = hasProfile ? pickN(INSTRUMENTS, randomInt(1, 3)) : [];
		const memberGenres = hasProfile ? pickN(GENRES, randomInt(1, 3)) : [];
		const memberLinks =
			hasProfile && Math.random() > 0.4 ? pickN(SAMPLE_LINKS, randomInt(1, 3)) : null;
		const visibility = !hasProfile ? 'hidden' : Math.random() > 0.6 ? 'public' : 'members';

		const [u] = await db
			.insert(user)
			.values({
				id,
				name,
				email,
				emailVerified: true,
				pronouns: pick(PRONOUNS),
				phone: Math.random() > 0.4 ? `541-555-${String(randomInt(1000, 9999))}` : null,
				creditFreeHours: randomInt(0, 8),
				creditEquipment: randomInt(0, 3),
				memberNumber: 100 + i,
				createdAt,
				updatedAt: createdAt
			})
			.returning();

		// The listing half. Written to `directory_entry` by `seedDirectoryEntries`
		// once every subject exists — these columns are gone from `user`.
		pendingEntries.set(id, {
			bio: hasProfile ? pick(MEMBER_BIOS) : null,
			tagline: hasProfile ? pick(TAGLINES) : null,
			hometown: hasProfile ? pick(HOMETOWNS) : null,
			lookingFor: hasProfile && Math.random() > 0.7 ? 'band' : null,
			availableForHire: hasProfile && Math.random() > 0.7,
			teachesLessons: hasProfile && Math.random() > 0.8,
			openToCollaboration: hasProfile && Math.random() > 0.5,
			visibility: visibility as DirectoryVisibility,
			contact: visibility === 'public' ? { email } : null,
			links: memberLinks
		});

		for (const value of memberInstruments) {
			pendingTags.push({ subjectId: id, kind: 'instrument', value });
		}
		for (const value of memberGenres) {
			pendingTags.push({ subjectId: id, kind: 'genre', value });
		}

		users.push({ ...u, email });
	}
	return users;
}

async function seedAdminUser(): Promise<SeedUser> {
	console.log('Seeding admin user (admin@corvallismusic.org)...');
	const id = randomUUID();
	const now = new Date();
	const hashedPassword = await scryptHash('password');

	const [adminUser] = await db
		.insert(user)
		.values({
			id,
			name: 'Admin',
			email: 'admin@corvallismusic.org',
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		})
		.returning();

	await db.insert(account).values({
		id: randomUUID(),
		accountId: id,
		providerId: 'credential',
		userId: id,
		password: hashedPassword,
		createdAt: now,
		updatedAt: now
	});

	return { ...adminUser, email: 'admin@corvallismusic.org' };
}

async function seedUserRoles(users: SeedUser[], adminUser: SeedUser, roles: SeedRole[]) {
	console.log('Assigning roles...');
	const adminRole = roles.find((r) => r.name === 'admin')!;
	const staffRole = roles.find((r) => r.name === 'staff')!;
	const memberRole = roles.find((r) => r.name === 'member')!;
	const volunteerRole = roles.find((r) => r.name === 'volunteer')!;
	const sustainingRole = roles.find((r) => r.name === 'sustaining')!;

	await db.insert(modelHasRole).values([
		{ roleId: adminRole.id, userId: adminUser.id },
		{ roleId: staffRole.id, userId: adminUser.id },
		{ roleId: memberRole.id, userId: adminUser.id }
	]);

	for (let i = 0; i < 2; i++) {
		await db.insert(modelHasRole).values([
			{ roleId: adminRole.id, userId: users[i].id },
			{ roleId: staffRole.id, userId: users[i].id }
		]);
	}

	for (let i = 2; i < 5; i++) {
		await db.insert(modelHasRole).values({ roleId: staffRole.id, userId: users[i].id });
	}

	for (const u of users) {
		await db.insert(modelHasRole).values({ roleId: memberRole.id, userId: u.id });
	}

	for (const u of pickN(users, 6)) {
		await db
			.insert(modelHasRole)
			.values({ roleId: volunteerRole.id, userId: u.id })
			.onConflictDoNothing();
	}

	for (const u of pickN(users, 8)) {
		await db
			.insert(modelHasRole)
			.values({ roleId: sustainingRole.id, userId: u.id })
			.onConflictDoNothing();

		// Give sustaining members an active subscription snapshot so the membership
		// page renders the dashboard view. hoursPerReset and creditFreeHours are in
		// credits (30-min blocks): each $5-unit grants one hour = two credits.
		const units = pick([2, 5, 12]); // $10 / $25 / $60 per month
		const hoursPerReset = units * 2;
		const startedAt = new Date(Date.now() - randomInt(30, 365) * 86400000);
		const creditsResetAt = new Date(Date.now() + randomInt(3, 27) * 86400000);
		await db
			.update(user)
			.set({
				stripeId: `cus_seed_${u.id.slice(0, 8)}`,
				creditFreeHours: randomInt(0, hoursPerReset),
				subscription: {
					startedAt: startedAt.toISOString(),
					stripeSubscriptionId: `sub_seed_${randomUUID().slice(0, 8)}`,
					hoursPerReset,
					creditsResetAt: creditsResetAt.toISOString(),
					coveringFees: Math.random() > 0.6,
					cancelAtPeriodEnd: false
				}
			})
			.where(eq(user.id, u.id));
	}
}

async function seedReservations(users: SeedUser[]): SeedReservation[] {
	console.log('Seeding reservations...');
	const rows: SeedReservation[] = [];

	for (let day = -14; day < 0; day++) {
		const count = randomInt(1, 4);
		let hour = randomInt(9, 14);
		for (let i = 0; i < count; i++) {
			const duration = pick([1, 1.5, 2]);
			const startsAt = ptDate(day, hour);
			const endsAt = ptDate(day, hour + duration);
			hour += duration + 0.5;
			if (hour > 21) break;

			const status = Math.random() > 0.15 ? 'completed' : pick(['no_show', 'cancelled']);
			const member = pick(users);

			// Free-hour settlement, mirroring `commitReservationCredits`:
			// `creditsUsed` is denominated in hours and `cashDueCents` freezes the
			// remainder owed at the door. Cancelled and no-show bookings keep both
			// null, the way cancellation resets them.
			//
			// Without this every seeded reservation settled in cash, so the staff
			// Payment column rendered nothing but plain dollar amounts and the
			// credit-covered and mixed shapes went unexercised locally.
			const coverage =
				status === 'completed' ? pick(['none', 'none', 'partial', 'full', 'comped']) : 'none';
			// Measured off the stored timestamps, not `duration`: `ptDate` floors a
			// fractional hour (setUTCHours truncates), and the `hour` accumulator
			// goes fractional, so the booking on disk is regularly longer than the
			// duration picked for it. Deriving from `duration` wrote credits that
			// overran their own reservation.
			const bookedHours = (endsAt.getTime() - startsAt.getTime()) / (1000 * 60 * 60);
			const creditsUsed =
				coverage === 'full'
					? bookedHours
					: coverage === 'partial'
						? Math.min(0.5, bookedHours)
						: null;
			// Comped waives the charge outright: nothing owed and no credits spent.
			// That tuple — cashDueCents 0 with creditsUsed null — is the only thing
			// separating a comped booking from a credit-settled one.
			const cashDueCents =
				coverage === 'comped'
					? 0
					: creditsUsed === null
						? null
						: Math.round((bookedHours - creditsUsed) * HOURLY_RATE_CENTS);

			const [r] = await db
				.insert(reservation)
				.values({
					bookerType: 'user',
					bookerId: member.id,
					createdByUserId: member.id,
					status,
					startsAt,
					endsAt,
					notes: Math.random() > 0.7 ? 'Band practice' : null,
					cancellationReason: status === 'cancelled' ? 'Schedule conflict' : null,
					creditsUsed,
					cashDueCents,
					// A fully covered booking is settled by the credits themselves —
					// leaving `paidAt` null is what marks it "Paid with credits"
					// rather than "Paid".
					// A booking settled by credits or comped away was never *paid* —
					// leaving `paidAt` null is what distinguishes those states.
					paidAt: status === 'completed' && cashDueCents !== 0 ? startsAt : null
				})
				.returning();
			rows.push(r);
		}
	}

	for (let day = 0; day <= 14; day++) {
		const count = randomInt(1, 3);
		let hour = randomInt(10, 15);
		for (let i = 0; i < count; i++) {
			const duration = pick([1, 1.5, 2]);
			const startsAt = ptDate(day, hour);
			const endsAt = ptDate(day, hour + duration);
			hour += duration + 0.5;
			if (hour > 21) break;

			const status = day === 0 ? 'confirmed' : pick(['scheduled', 'confirmed']);
			const member = pick(users);

			// Today's confirmed reservations have a provisioned door code, mirroring
			// the daily lock job (codes are issued the morning of the reservation).
			const lockCode = day === 0 && status === 'confirmed' ? String(randomInt(1000, 9999)) : null;

			const [r] = await db
				.insert(reservation)
				.values({
					bookerType: 'user',
					bookerId: member.id,
					createdByUserId: member.id,
					status,
					startsAt,
					endsAt,
					lockCode,
					notes:
						Math.random() > 0.6
							? pick(['Drum practice', 'Guitar lesson prep', 'Recording session'])
							: null
				})
				.returning();
			rows.push(r);
		}
	}

	// A guaranteed first-timer, for the flag the staff list shows so the desk can
	// put a volunteer on the hour. Both loops above pick their member at random,
	// so whether anybody was booking for the first time came down to the dice —
	// and picking one of `users` would not have settled it either, since bands
	// and recurring series seed reservations for those same members afterwards.
	// This member exists only here and books once, with a note, so both of the
	// list's flags are on screen after every seed.
	const newcomerId = randomUUID();
	const [newcomer] = await db
		.insert(user)
		.values({
			id: newcomerId,
			name: 'Wren Okafor',
			email: 'wren.okafor@example.com',
			emailVerified: true,
			pronouns: 'they/them',
			phone: '541-555-0142',
			memberNumber: 999,
			createdAt: new Date(Date.now() - 2 * 86400000),
			updatedAt: new Date()
		})
		.returning();

	const [firstEver] = await db
		.insert(reservation)
		.values({
			bookerType: 'user',
			bookerId: newcomer.id,
			createdByUserId: newcomer.id,
			status: 'scheduled',
			startsAt: ptDate(2, 18),
			endsAt: ptDate(2, 20),
			notes: 'First time here — is there somewhere to park a van?'
		})
		.returning();
	rows.push(firstEver);

	return rows;
}

async function seedClosures() {
	console.log('Seeding closures...');
	await db.insert(closure).values([
		{ reason: 'Holiday closure — New Year', startsAt: ptDate(-30, 0), endsAt: ptDate(-29, 23, 59) },
		{
			reason: 'Building maintenance — HVAC replacement',
			startsAt: ptDate(21, 8),
			endsAt: ptDate(22, 18)
		},
		{ reason: pick(CLOSURE_REASONS), startsAt: ptDate(35, 0), endsAt: ptDate(35, 23, 59) }
	]);
}

async function seedEvents(users: SeedUser[]): SeedEvent[] {
	console.log('Seeding events...');
	const rows: SeedEvent[] = [];
	const staffUsers = users.slice(0, 6);

	async function createEventReservation(
		eventId: string,
		day: number,
		eventStartHour: number,
		eventEndHour: number,
		createdByUserId: string,
		reservationStatus: string
	): Promise<string> {
		const startsAt = ptDate(day, eventStartHour, -30);
		const endsAt = ptDate(day, eventEndHour, 30);
		const [r] = await db
			.insert(reservation)
			.values({
				bookerType: 'event',
				// The real polymorphic pointer, as event-service writes it. A literal
				// 'event' here left every seeded hold unattached to its show.
				bookerId: eventId,
				createdByUserId,
				status: reservationStatus,
				startsAt,
				endsAt,
				notes: 'Event space reservation',
				cancellationReason: reservationStatus === 'cancelled' ? 'Event cancelled' : null
			})
			.returning();
		return r.id;
	}

	for (let i = 0; i < 6; i++) {
		const day = -randomInt(3, 30);
		const hour = randomInt(18, 20);
		const duration = pick([2, 3]);
		const tags = pickN(EVENT_TAGS_POOL, randomInt(1, 3)).join(', ');
		const startsAt = ptDate(day, hour);
		const endsAt = ptDate(day, hour + duration);
		const publishedAt = new Date(startsAt.getTime() - randomInt(7, 21) * 86400000);
		const creator = pick(staffUsers);

		// The id is minted up front so the hold can point at the event, the same
		// ordering event-service.create() uses.
		const eventId = crypto.randomUUID();
		let reservationId: string | undefined;
		if (Math.random() < 0.75) {
			reservationId = await createEventReservation(
				eventId,
				day,
				hour,
				hour + duration,
				creator.id,
				'completed'
			);
		}

		const [e] = await db
			.insert(event)
			.values({
				id: eventId,
				title: pick(EVENT_TITLES),
				description: 'Join us for an evening of live music and community.',
				startsAt,
				endsAt,
				doorsAt: ptDate(day, hour - 0.5),
				status: 'published',
				publishedAt,
				tags,
				reservationId,
				createdByUserId: creator.id
			})
			.returning();
		rows.push(e);
	}

	// Future events, one per ticketing shape: 2 paid ticketed, 2 free-ticketed,
	// 1 sold off-site with a price, 1 door price, 1 genuinely free.
	const futureConfigs: {
		ticketingEnabled: boolean;
		ticketPrice: number | null;
		ticketQuantity: number | null;
		externalTicketUrl?: string;
	}[] = [
		{ ticketingEnabled: true, ticketPrice: 1500, ticketQuantity: 50 },
		{ ticketingEnabled: true, ticketPrice: 2000, ticketQuantity: 30 },
		{ ticketingEnabled: true, ticketPrice: null, ticketQuantity: 40 },
		{ ticketingEnabled: true, ticketPrice: null, ticketQuantity: null },
		{
			ticketingEnabled: false,
			ticketPrice: 1800,
			ticketQuantity: null,
			externalTicketUrl: 'https://eventbrite.com/e/424242'
		},
		{ ticketingEnabled: false, ticketPrice: 1000, ticketQuantity: null },
		{ ticketingEnabled: false, ticketPrice: null, ticketQuantity: null }
	];

	for (let i = 0; i < futureConfigs.length; i++) {
		const day = randomInt(3, 28);
		const hour = randomInt(18, 20);
		const duration = pick([2, 3]);
		const tags = pickN(EVENT_TAGS_POOL, randomInt(1, 3)).join(', ');
		const startsAt = ptDate(day, hour);
		const endsAt = ptDate(day, hour + duration);
		const creator = pick(staffUsers);
		const config = futureConfigs[i];

		const eventId = crypto.randomUUID();
		let reservationId: string | undefined;
		if (Math.random() < 0.75) {
			reservationId = await createEventReservation(
				eventId,
				day,
				hour,
				hour + duration,
				creator.id,
				'confirmed'
			);
		}

		const [e] = await db
			.insert(event)
			.values({
				id: eventId,
				title: pick(EVENT_TITLES),
				description: config.externalTicketUrl
					? 'Tickets for this one are sold through our partner venue.'
					: config.ticketingEnabled && !config.ticketPrice
						? 'A free community event — grab a ticket to reserve your spot!'
						: 'An evening of live performances at the Collective.',
				startsAt,
				endsAt,
				doorsAt: ptDate(day, hour - 0.5),
				status: 'published',
				publishedAt: new Date(),
				tags,
				reservationId,
				ticketingEnabled: config.ticketingEnabled,
				ticketPrice: config.ticketPrice,
				ticketQuantity: config.ticketQuantity,
				externalTicketUrl: config.externalTicketUrl ?? null,
				createdByUserId: creator.id
			})
			.returning();
		rows.push(e);
	}

	for (let i = 0; i < 2; i++) {
		const day = randomInt(14, 45);
		const hour = randomInt(18, 20);
		const creator = pick(staffUsers);

		const eventId = crypto.randomUUID();
		let reservationId: string | undefined;
		if (Math.random() < 0.75) {
			reservationId = await createEventReservation(
				eventId,
				day,
				hour,
				hour + 3,
				creator.id,
				'scheduled'
			);
		}

		const [e] = await db
			.insert(event)
			.values({
				id: eventId,
				title: pick(EVENT_TITLES),
				description: 'Details TBD',
				startsAt: ptDate(day, hour),
				endsAt: ptDate(day, hour + 3),
				status: 'draft',
				tags: pick(EVENT_TAGS_POOL),
				reservationId,
				createdByUserId: creator.id
			})
			.returning();
		rows.push(e);
	}

	const cancelledCreator = pick(staffUsers);
	const cancelledEventId = crypto.randomUUID();
	const cancelledResId = await createEventReservation(
		cancelledEventId,
		7,
		14,
		20,
		cancelledCreator.id,
		'cancelled'
	);
	const [cancelled] = await db
		.insert(event)
		.values({
			id: cancelledEventId,
			title: 'Cancelled: Outdoor Festival',
			description: 'Unfortunately cancelled due to weather.',
			startsAt: ptDate(7, 14),
			endsAt: ptDate(7, 20),
			status: 'cancelled',
			tags: 'community, all ages',
			reservationId: cancelledResId,
			createdByUserId: cancelledCreator.id
		})
		.returning();
	rows.push(cancelled);

	const [cancelledNoRes] = await db
		.insert(event)
		.values({
			title: 'Cancelled: Benefit Concert',
			description: 'Cancelled — performer unavailable.',
			startsAt: ptDate(14, 19),
			endsAt: ptDate(14, 22),
			status: 'cancelled',
			tags: 'ticketed, community',
			createdByUserId: pick(staffUsers).id
		})
		.returning();
	rows.push(cancelledNoRes);

	// Recurring CMC event: a weekly open mic. Prototype is a published past
	// occurrence; future occurrences are materialized as drafts (as the
	// generation job would produce), each with its own space reservation.
	{
		const creator = pick(staffUsers);
		const protoDay = -7;
		const hour = 19;
		const duration = 3;
		const protoStart = ptDate(protoDay, hour);

		const protoEventId = crypto.randomUUID();
		const protoResId = await createEventReservation(
			protoEventId,
			protoDay,
			hour,
			hour + duration,
			creator.id,
			'completed'
		);

		const [proto] = await db
			.insert(event)
			.values({
				id: protoEventId,
				title: 'Weekly Open Mic',
				description: 'Sign up at the door — all skill levels welcome.',
				startsAt: protoStart,
				endsAt: ptDate(protoDay, hour + duration),
				doorsAt: ptDate(protoDay, hour - 0.5),
				status: 'published',
				publishedAt: new Date(protoStart.getTime() - 14 * 86400000),
				tags: 'open mic, all ages, community',
				reservationId: protoResId,
				createdByUserId: creator.id
			})
			.returning();
		rows.push(proto);

		const rrule = seedRRule(protoStart, 'weekly');
		const [series] = await db
			.insert(recurringSeries)
			.values({
				prototypeType: 'event',
				prototypeId: proto.id,
				rrule,
				createdBy: creator.id
			})
			.returning();

		await db.run(sql`UPDATE event SET recurring_series_id = ${series.id} WHERE id = ${proto.id}`);

		for (let w = 1; w <= 2; w++) {
			const instDay = protoDay + w * 7;
			const instEventId = crypto.randomUUID();
			const instResId = await createEventReservation(
				instEventId,
				instDay,
				hour,
				hour + duration,
				creator.id,
				'scheduled'
			);
			const [inst] = await db
				.insert(event)
				.values({
					id: instEventId,
					title: proto.title,
					description: proto.description,
					startsAt: ptDate(instDay, hour),
					endsAt: ptDate(instDay, hour + duration),
					doorsAt: ptDate(instDay, hour - 0.5),
					status: 'draft',
					tags: proto.tags,
					reservationId: instResId,
					recurringSeriesId: series.id,
					createdByUserId: creator.id
				})
				.returning();
			rows.push(inst);
		}
	}

	// Stamp the back-link every event reservation needs.
	//
	// The app books the room *after* the event exists, so `bookerId` is the event
	// id (`event-service.ts`, `generation-job.ts`). This seed has to go the other
	// way round — `event.reservationId` is set at insert — so the reservation is
	// written first and its booker id is filled in here, once every event exists.
	// Without this pass every seeded event booking has a dangling booker, and the
	// staff reservations list reports the whole lot as "Unknown event".
	await db.run(sql`
		update reservation
		set booker_id = (select id from event where event.reservation_id = reservation.id)
		where booker_type = 'event'
			and exists (select 1 from event where event.reservation_id = reservation.id)
	`);

	return rows;
}

async function seedCreditTransactions(users: SeedUser[]) {
	console.log('Seeding credit transactions...');
	for (const u of users.slice(0, 12)) {
		const hours = randomInt(2, 8);
		await db.insert(creditTransaction).values({
			userId: u.id,
			creditType: 'free_hours',
			amount: hours,
			balanceAfter: hours,
			source: 'monthly_allocation',
			description: 'Monthly free hours allocation',
			metadata: { period: 'May 2026' }
		});

		if (Math.random() > 0.4) {
			const used = randomInt(1, Math.min(3, hours));
			await db.insert(creditTransaction).values({
				userId: u.id,
				creditType: 'free_hours',
				amount: -used,
				balanceAfter: hours - used,
				source: 'reservation',
				description: 'Applied to reservation',
				metadata: {}
			});
		}
	}
}

/**
 * Insert a band together with the `group_member` row that records its owner.
 *
 * These two are one fact stored twice, and the app's guards read only the
 * member row (`requireBandOwner` resolves through `requireBandMember()`), so a
 * band seeded without it has no owner in practice. The seeds can't call the
 * service's `create()` — they need to set slug, tier, timestamps and deletedAt,
 * which `create()` derives — so this is the seed-side equivalent. Going through
 * it everywhere is what stops a new seed band from quietly reproducing the
 * production drift that `scripts/backfill-band-owners.ts` had to repair.
 */
async function insertBandWithOwner(
	values: typeof group.$inferInsert,
	ownerId: string,
	position?: string
) {
	const [b] = await db.insert(group).values(values).returning();
	await db.insert(groupMember).values({
		groupId: b.id,
		userId: ownerId,
		role: 'owner',
		position: position ?? null,
		status: 'active'
	});
	return b;
}

async function seedBands(users: SeedUser[]) {
	console.log('Seeding bands...');
	const bands = [];

	// First 3 bands are premium, rest are free
	const PREMIUM_BAND_COUNT = 3;

	for (let i = 0; i < BAND_NAMES.length; i++) {
		const owner = users[i % users.length];
		// Same rule as `generateSlug`, which is what a real band creation uses.
		const slug = BAND_NAMES[i]
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '')
			.replace(/-{2,}/g, '-')
			.replace(/^-|-$/g, '');

		const genres = pickN(GENRES, randomInt(1, 3));
		const isPremiumBand = i < PREMIUM_BAND_COUNT;
		const bandLinks = [
			{
				label: 'Spotify',
				url: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb',
				embed: true
			},
			{ label: 'YouTube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', embed: true },
			...pickN(SAMPLE_LINKS.slice(3), randomInt(0, 2))
		];
		const bandVisibility = 'public';

		const b = await insertBandWithOwner(
			{
				name: BAND_NAMES[i],
				slug,
				bio: `${BAND_NAMES[i]} is a local band from Corvallis, OR. Formed in 20${randomInt(18, 24)}, they play a mix of ${genres.slice(0, 2).join(' and ')} with influences from all over the map.`,
				ownerId: owner.id
			},
			owner.id,
			pick(BAND_POSITIONS)
		);
		bands.push(b);

		// The premium half — these columns are gone from `group`.
		pendingSites.set(b.id, {
			tier: isPremiumBand ? 'premium' : 'free',
			subscription: isPremiumBand
				? {
						startedAt: new Date(Date.now() - randomInt(30, 180) * 86400000).toISOString(),
						stripeSubscriptionId: `sub_seed_${randomUUID().slice(0, 8)}`,
						billingInterval: i === 0 ? 'yearly' : 'monthly',
						currentPeriodEnd: new Date(Date.now() + randomInt(10, 30) * 86400000).toISOString(),
						cancelAtPeriodEnd: false
					}
				: null,
			// The first premium band has a live custom domain, the second is still
			// waiting on DNS — both states need to be visible in band settings.
			...(isPremiumBand && i < 2
				? {
						customDomain: `${slug.replace(/-/g, '')}.example.com`,
						customDomainStatus: i === 0 ? ('active' as const) : ('pending' as const),
						customDomainHostnameId: `seed-hostname-${randomUUID().slice(0, 8)}`,
						customDomainVerification: {
							ownership: {
								name: `_cf-custom-hostname.${slug.replace(/-/g, '')}.example.com`,
								value: randomUUID()
							},
							ssl: {
								name: `_acme-challenge.${slug.replace(/-/g, '')}.example.com`,
								value: randomUUID().replace(/-/g, '')
							},
							cnameTarget: 'domains.corvmc.org'
						},
						customDomainAddedAt: new Date(Date.now() - randomInt(1, 60) * 86400000)
					}
				: {})
		});

		// The listing half — these columns are gone from `group`.
		pendingEntries.set(b.id, {
			tagline: `${genres[0]} ${pick(['trio', 'quartet', 'duo', 'ensemble', 'collective'])} from Corvallis`,
			hometown: pick(HOMETOWNS),
			foundedYear: String(randomInt(2015, 2024)),
			lookingFor: Math.random() > 0.6 ? 'members' : null,
			visibility: bandVisibility as DirectoryVisibility,
			contact: { email: `booking+${slug}@example.com` },
			links: bandLinks
		});

		for (const value of genres) {
			pendingTags.push({ subjectId: b.id, kind: 'genre', value });
		}

		const memberCount = randomInt(1, 3);
		const candidates = users.filter((u) => u.id !== owner.id);
		const members = pickN(candidates, memberCount);
		for (const m of members) {
			await db.insert(groupMember).values({
				groupId: b.id,
				userId: m.id,
				role: 'member',
				position: pick(BAND_POSITIONS),
				alias: Math.random() > 0.66 ? pick(BAND_ALIASES) : null,
				status: Math.random() > 0.15 ? 'active' : 'pending',
				invitedById: owner.id
			});
		}

		// Give the first premium and first free band a released address, so both
		// old-address redirect paths (microsite and directory profile) have local
		// data to exercise.
		if (i === 0 || i === PREMIUM_BAND_COUNT) {
			await db.insert(groupSlugHistory).values({ slug: `${slug}-old`, groupId: b.id });
		}
	}

	// Onboarding-state bands: a bare just-created band (name only, as the
	// create-band modal produces) and non-public visibilities, so the
	// sparse-profile rendering and directoryVisibility gating paths have local
	// data. Kept out of BAND_NAMES so the fully-filled pool stays untouched.
	// `bio` stays on `group`; visibility, hometown and foundedYear are listing
	// fields and go to the entry, so each state carries the two halves apart.
	const onboardingStates = [
		{ band: { name: 'Fresh Coat', slug: 'fresh-coat' }, entry: { visibility: 'public' as const } },
		{
			band: {
				name: 'Basement Sessions',
				slug: 'basement-sessions',
				bio: 'We keep to ourselves — hidden from the directory.'
			},
			entry: { visibility: 'hidden' as const, hometown: pick(HOMETOWNS) }
		},
		{
			band: {
				name: 'The Quiet Regulars',
				slug: 'the-quiet-regulars',
				bio: 'Members-only listing: visible to logged-in members, not the public.'
			},
			entry: {
				visibility: 'members' as const,
				hometown: pick(HOMETOWNS),
				foundedYear: String(randomInt(2015, 2024))
			}
		}
	];
	for (let i = 0; i < onboardingStates.length; i++) {
		const owner = users[(BAND_NAMES.length + 1 + i) % users.length];
		const b = await insertBandWithOwner(
			{ ownerId: owner.id, ...onboardingStates[i].band },
			owner.id,
			pick(BAND_POSITIONS)
		);
		bands.push(b);
		pendingEntries.set(b.id, onboardingStates[i].entry);
	}

	const deactivatedOwner = users[BAND_NAMES.length % users.length];
	const deactivated = await insertBandWithOwner(
		{
			name: 'Disbanded Project',
			slug: 'disbanded-project',
			bio: 'This band was deactivated by staff.',
			ownerId: deactivatedOwner.id,
			deletedAt: new Date(Date.now() - 10 * 86400000)
		},
		deactivatedOwner.id,
		'Guitar'
	);
	bands.push(deactivated);

	return bands;
}

/**
 * Write an event's bill: the owner confirmed at the top, then a mix of the
 * three states a support slot can be in, so every render path has data —
 * plain-text credits, an invitation waiting in a band's inbox, and a decline.
 */
async function seedLineup(
	eventId: string,
	owner: { id: string; name: string } | null,
	support: { name: string; bandId?: string; status?: string }[]
) {
	const rows: any[] = [];
	if (owner) {
		rows.push({
			eventId,
			name: owner.name,
			bandId: owner.id,
			billingOrder: 0,
			status: 'confirmed',
			addedByBandId: owner.id
		});
	}
	support.forEach((sup, i) => {
		rows.push({
			eventId,
			name: sup.name,
			bandId: sup.bandId ?? null,
			billingOrder: rows.length + i,
			status: sup.status ?? (sup.bandId ? 'pending' : 'unlinked'),
			addedByBandId: owner?.id ?? null
		});
	});
	if (rows.length === 0) return;
	// D1 caps a statement at 100 bound params.
	for (let i = 0; i < rows.length; i += 12) {
		await db.insert(eventBand).values(rows.slice(i, i + 12));
	}
}

async function seedBandEvents(bands: any[], _users: SeedUser[]) {
	console.log('Seeding band events...');
	const rows = [];

	// The first live band gets a two-year backlog so the profile's past-shows
	// pager has more than one page to page through.
	const veteran = bands.find((b: any) => !b.deletedAt);
	if (veteran) {
		for (let i = 0; i < 25; i++) {
			const day = -randomInt(20, 730);
			const hour = randomInt(19, 21);
			const startsAt = ptDate(day, hour);
			const [e] = await db
				.insert(event)
				.values({
					title: pick(BAND_EVENT_TITLES),
					description: `${veteran.name} live! An old favourite from the archives.`,
					startsAt,
					endsAt: Math.random() > 0.5 ? ptDate(day, hour + pick([2, 3, 4])) : null,
					doorsAt: ptDate(day, hour - 0.5),
					status: 'published',
					publishedAt: new Date(startsAt.getTime() - 14 * 86400000),
					tags: pickN(EVENT_TAGS_POOL, randomInt(1, 3)).join(', '),
					bandId: veteran.id,
					source: 'band',
					location: pick(BAND_EVENT_LOCATIONS),
					ticketPrice: Math.random() > 0.35 ? pick([500, 1000, 1200, 1500]) : null,
					createdByUserId: veteran.ownerId
				})
				.returning();

			// Half the archive has no end time — a band backfilling old gigs
			// rarely remembers when the night finished, which is why the column
			// is nullable.
			await seedLineup(
				e.id,
				{ id: veteran.id, name: veteran.name },
				pickN(SUPPORT_BAND_NAMES, randomInt(0, 2)).map((name) => ({ name }))
			);
			rows.push(e);
		}
	}

	for (const b of bands.slice(0, 6)) {
		if (b.deletedAt) continue;
		const eventCount = randomInt(2, 4);

		for (let i = 0; i < eventCount; i++) {
			const day = randomInt(-10, 30);
			const hour = randomInt(19, 21);
			const duration = pick([2, 3, 4]);
			const startsAt = ptDate(day, hour);
			const endsAt = ptDate(day, hour + duration);
			const isPast = day < 0;

			const [e] = await db
				.insert(event)
				.values({
					title: pick(BAND_EVENT_TITLES),
					description: `${b.name} live! Join us for a night of original music and good vibes. All ages welcome.`,
					startsAt,
					endsAt,
					doorsAt: ptDate(day, hour - 0.5),
					status: isPast ? 'published' : pick(['published', 'published', 'draft']),
					publishedAt: isPast
						? new Date(startsAt.getTime() - 14 * 86400000)
						: Math.random() > 0.3
							? new Date()
							: null,
					tags: pickN(EVENT_TAGS_POOL, randomInt(1, 3)).join(', '),
					bandId: b.id,
					source: 'band',
					location: pick(BAND_EVENT_LOCATIONS),
					externalTicketUrl:
						Math.random() > 0.5 ? `https://eventbrite.com/e/${randomInt(100000, 999999)}` : null,
					// Gigs are priced at the door or by the venue — never sold by us.
					ticketPrice: Math.random() > 0.35 ? pick([500, 1000, 1200, 1500]) : null,
					createdByUserId: b.ownerId
				})
				.returning();

			// Roughly a third of gigs get support. Mostly off-platform names; the
			// first band on the list also gets a real CMC band so the invitation
			// inbox has something in it, and a declined slot so that render path
			// is visible too.
			const support: { name: string; bandId?: string; status?: string }[] = [];
			if (Math.random() > 0.66) {
				support.push(...pickN(SUPPORT_BAND_NAMES, randomInt(1, 2)).map((name) => ({ name })));
			}
			const otherBand = bands.find((x: any) => x.id !== b.id && !x.deletedAt);
			if (otherBand && i === 0) {
				support.push({
					name: otherBand.name,
					bandId: otherBand.id,
					status: pick(['pending', 'pending', 'confirmed', 'declined'])
				});
			}
			await seedLineup(e.id, { id: b.id, name: b.name }, support);
			rows.push(e);
		}
	}

	return rows;
}

/**
 * Band-booked practice slots. Seeded separately from `seedReservations` because
 * bands do not exist yet at that point, and without these rows the staff
 * reservation queue has no band bookings to render, search or filter.
 */
/**
 * Credit member bands on a few CMC-produced shows.
 *
 * These have no owning band — `event.bandId` stays null, staff run the night —
 * but the bands genuinely played, so the bill is pure attribution. Staff-set
 * slots land confirmed: staff booked the show, the band already agreed.
 */
async function seedCmcEventLineups(events: any[], bands: any[]) {
	const liveBands = bands.filter((b: any) => !b.deletedAt).slice(0, 4);
	if (liveBands.length === 0) return;

	const published = events.filter((e: any) => e.status === 'published').slice(0, 5);
	for (const [i, evt] of published.entries()) {
		const headliner = liveBands[i % liveBands.length];
		await seedLineup(evt.id, null, [
			{ name: headliner.name, bandId: headliner.id, status: 'confirmed' },
			...pickN(SUPPORT_BAND_NAMES, randomInt(0, 2)).map((name) => ({ name }))
		]);
	}
}

/**
 * Member-authored community listings: off-site shows somebody in the scene
 * knows about.
 *
 * Every state is left reachable without clicking, the same discipline seedInbox
 * uses — a published listing on the guide, a draft only its author can see, and
 * a review-required member with one listing waiting on staff and one returned
 * to them. Without the last two the review queue and the fix-and-resubmit loop
 * are both invisible after a fresh seed.
 */
const COMMUNITY_VENUES = [
	'The Whiteside Theatre, Corvallis',
	'Bombs Away Cafe, Corvallis',
	"Cloud & Kelly's, Corvallis",
	'Common Fields, Corvallis',
	'Old World Deli, Corvallis',
	"Sam Bond's Garage, Eugene",
	'The Boreal, Eugene'
];

const COMMUNITY_TITLES = [
	'Basement show: three-band bill',
	'Songwriter round',
	'All-ages punk matinee',
	'Jazz night',
	'Folk showcase',
	'Noise & drone night',
	'Benefit show for the food bank'
];

async function seedCommunityEvents(members: SeedUser[], staffUser: SeedUser) {
	console.log('Seeding community listings...');
	const rows = [];

	if (members.length < 2) return rows;

	const trusted = members[0];
	const onReview = members[1];

	// Published, from a trusted member — what the gig guide shows.
	for (let i = 0; i < 4; i++) {
		const [e] = await db
			.insert(event)
			.values({
				title: COMMUNITY_TITLES[i % COMMUNITY_TITLES.length],
				description: 'Posted by a member. Not a CMC production.',
				startsAt: ptDate(randomInt(3, 40), randomInt(18, 21)),
				endsAt: null,
				location: pick(COMMUNITY_VENUES),
				source: 'community',
				status: 'published',
				publishedAt: new Date(),
				tags: pick(['all ages', 'punk, all ages', 'jazz', 'folk']),
				// A door price, an off-site link, or free — never CMC checkout.
				ticketPrice: pick([null, 500, 1000, 1500]),
				externalTicketUrl: i === 0 ? 'https://www.eventbrite.com/e/example' : null,
				createdByUserId: trusted.id
			})
			.returning();
		rows.push(e);
	}

	// A draft, so the member-side publish flow is reachable straight away.
	const [draft] = await db
		.insert(event)
		.values({
			title: 'Untitled show (draft)',
			description: 'Half-written — still checking the date.',
			startsAt: ptDate(21, 20),
			endsAt: null,
			location: 'Bombs Away Cafe, Corvallis',
			source: 'community',
			status: 'draft',
			createdByUserId: trusted.id
		})
		.returning();
	rows.push(draft);

	// A member whose trust was revoked after an upheld report: one listing
	// waiting on staff, one returned to them with a reason.
	const [pending] = await db
		.insert(event)
		.values({
			title: 'Warehouse show, address on request',
			description: 'DIY space, BYO.',
			startsAt: ptDate(12, 21),
			endsAt: null,
			location: 'Address given on request, Corvallis',
			source: 'community',
			status: 'pending_review',
			createdByUserId: onReview.id
		})
		.returning();
	rows.push(pending);

	const [rejected] = await db
		.insert(event)
		.values({
			title: 'House party (bring your own)',
			description: 'No details yet.',
			startsAt: ptDate(9, 22),
			endsAt: null,
			location: 'Somewhere in Corvallis',
			source: 'community',
			status: 'rejected',
			reviewNotes: 'We need a real venue and a contact before this goes on the public calendar.',
			createdByUserId: onReview.id
		})
		.returning();
	rows.push(rejected);

	await db.insert(memberStanding).values({
		userId: onReview.id,
		scope: 'community_event',
		status: 'restricted',
		reason: 'A report about an earlier listing was upheld.',
		updatedByUserId: staffUser.id,
		updatedAt: new Date()
	});

	console.log(`  ${rows.length} community listings`);
	return rows;
}

async function seedBandReservations(bands: any[]) {
	console.log('Seeding band reservations...');
	const rows = [];

	for (const b of bands.filter((x: any) => !x.deletedAt).slice(0, 4)) {
		for (const day of [-6, 3]) {
			const hour = randomInt(17, 20);
			const duration = pick([2, 3]);
			const startsAt = ptDate(day, hour);
			const endsAt = ptDate(day, hour + duration);
			const isPast = day < 0;

			const [r] = await db
				.insert(reservation)
				.values({
					bookerType: 'group',
					bookerId: b.id,
					// A band booking is still made by a person, and their free hours
					// settle it — same shape the band-facing booking form produces.
					createdByUserId: b.ownerId,
					status: isPast ? 'completed' : 'confirmed',
					startsAt,
					endsAt,
					notes: pick(['Full band rehearsal', 'Set list run-through', 'Pre-show practice']),
					paidAt: isPast ? startsAt : null
				})
				.returning();
			rows.push(r);
		}
	}

	return rows;
}

/**
 * One `band_site` per band, mirroring `scripts/db/backfill/band-site.sql`.
 *
 * Every band gets one regardless of tier: the row is what `tier` lives on, and
 * it is never deleted while the band lives, because `band_page_config` and
 * `band_media` cascade from it — a cancelled subscription must not take a
 * band's blocks, theme, CSS, EPK and images with it.
 */
async function seedBandSites(bands: any[]) {
	console.log('Seeding band sites...');
	// The premium half comes from `pendingSites`, not off the band row: those
	// columns are gone from `group`.
	const rows = bands.map((b: any) => ({
		id: randomUUID(),
		groupId: b.id,
		tier: 'free' as const,
		subscription: null,
		createdAt: b.createdAt ?? new Date(),
		updatedAt: b.updatedAt ?? new Date(),
		...(pendingSites.get(b.id) ?? {})
	}));
	// 11 columns at their widest × 9 = 99, under D1's 100 bound parameters.
	await batchInsert(bandSite, rows, 9);
	return new Map(rows.map((r) => [r.groupId, r.id]));
}

async function seedBandPageConfigs(bands: any[], siteIdByBand: Map<string, string>) {
	console.log('Seeding band page configs (premium bands)...');
	const configs = [];
	const themes = ['punk', 'jazz', 'electronic', 'metal', 'indie', 'folk'] as const;

	// Only premium bands get page configs. Tier lives on the site row now, so the
	// filter reads what was collected for it rather than the band row.
	const premiumBands = bands.filter(
		(b) => pendingSites.get(b.id)?.tier === 'premium' && !b.deletedAt
	);

	for (let i = 0; i < premiumBands.length; i++) {
		const b = premiumBands[i];
		const theme = themes[i % themes.length];

		const blocks = [
			{
				id: randomUUID(),
				type: 'hero',
				imageKey: 'bands/hero-placeholder.jpg',
				headline: b.name,
				subtitle: b.tagline || 'Live music from Corvallis, OR'
			},
			{
				id: randomUUID(),
				type: 'bio',
				content:
					b.bio || `${b.name} brings their unique sound to venues across the Pacific Northwest.`
			},
			{
				id: randomUUID(),
				type: 'embed',
				platform: 'spotify',
				url: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb'
			},
			{ id: randomUUID(), type: 'events', limit: 5 },
			{ id: randomUUID(), type: 'members', showPositions: true },
			{ id: randomUUID(), type: 'links', style: 'buttons' },
			{ id: randomUUID(), type: 'press' },
			{ id: randomUUID(), type: 'achievements' },
			{
				id: randomUUID(),
				type: 'gallery',
				imageKeys: ['bands/gallery-1.jpg', 'bands/gallery-2.jpg', 'bands/gallery-3.jpg'],
				downloadable: true
			},
			{ id: randomUUID(), type: 'contact', showForm: true },
			{
				id: randomUUID(),
				type: 'custom_html',
				content: `<div style="text-align:center"><em>${b.name} is booking now for summer shows.</em></div>`
			},
			{ id: randomUUID(), type: 'tech_rider' },
			{ id: randomUUID(), type: 'spacer', height: 'md' }
		];

		const epk = {
			bookingContact: {
				name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
				email: `booking@${b.slug}.band`,
				phone: `541-555-${randomInt(1000, 9999)}`
			},
			managementContact: {
				name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
				email: `mgmt@${b.slug}.band`
			},
			prContact:
				Math.random() > 0.5
					? {
							name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
							email: `press@${b.slug}.band`
						}
					: undefined,
			pressQuotes: pickN(PRESS_QUOTES, randomInt(2, 4)),
			achievements: pickN(ACHIEVEMENTS_POOL, randomInt(3, 5)),
			backline: pickN(BACKLINE_ITEMS, randomInt(3, 5)),
			technicalRiderKey: 'bands/rider-placeholder.pdf',
			stagePlotKey: 'bands/stage-plot-placeholder.png'
		};

		const customCss =
			theme === 'punk'
				? `.band-site-hero { text-transform: uppercase; letter-spacing: 0.1em; }\n.band-site-block { border-bottom: 2px solid var(--bs-accent); }`
				: theme === 'electronic'
					? `.band-site-hero h1 { text-shadow: 0 0 20px var(--bs-accent); }\n.band-site-block { transition: opacity 0.3s; }`
					: null;

		const [config] = await db
			.insert(bandPageConfig)
			.values({
				bandId: b.id,
				bandSiteId: siteIdByBand.get(b.id) ?? null,
				theme,
				customCss,
				blocks,
				epk,
				updatedAt: new Date()
			})
			.returning();
		configs.push(config);

		// Band media, in the media tables the microsite reads and the upload
		// endpoint writes. `band_media` is gone as of phase 6 — nothing had read it
		// since the cut-over, and production held no rows in it at all.
		const mediaSlots = [
			['gallery', 'image'],
			['gallery', 'image'],
			['gallery', 'image'],
			['hero', 'hero'],
			['stage_plot', 'stage_plot'],
			['rider', 'rider']
		] as const;
		for (let m = 0; m < mediaSlots.length; m++) {
			const [slot, legacyType] = mediaSlots[m];
			const key = `bands/${b.slug}/${legacyType}-${m}.jpg`;
			const caption =
				slot === 'gallery' ? `${b.name} live at ${pick(BAND_EVENT_LOCATIONS).split(',')[0]}` : null;

			// Sizes are fabricated: these keys name no real object, which is exactly
			// why `backfill-media.ts` refuses to invent them and the seed may.
			const [mediaRow] = await db
				.insert(media)
				.values({
					key,
					contentType: 'image/jpeg',
					byteSize: 200_000 + m * 1000,
					caption
				})
				.returning();

			await db.insert(mediaAttachment).values({
				mediaId: mediaRow.id,
				attachableType: 'group',
				attachableId: b.id,
				slot,
				sortOrder: m
			});
		}
	}

	return configs;
}

async function seedRecurringSeries(users: SeedUser[]) {
	console.log('Seeding recurring series...');
	const rows = [];
	const frequencies = ['weekly', 'biweekly', 'monthly'] as const;

	for (let i = 0; i < 4; i++) {
		const member = users[i % users.length];
		const freq = frequencies[i % frequencies.length];
		const dayOffset = i;
		const hour = 10 + i * 2;
		const duration = pick([1, 1.5, 2]);

		const protoStart = ptDate(dayOffset - 14, hour);
		const protoEnd = ptDate(dayOffset - 14, hour + duration);

		const [proto] = await db
			.insert(reservation)
			.values({
				bookerType: 'user',
				bookerId: member.id,
				createdByUserId: member.id,
				status: 'completed',
				startsAt: protoStart,
				endsAt: protoEnd,
				notes: `Recurring ${freq} practice`
			})
			.returning();

		const rrule = seedRRule(protoStart, freq);

		const [series] = await db
			.insert(recurringSeries)
			.values({
				prototypeType: 'reservation',
				prototypeId: proto.id,
				rrule,
				createdBy: member.id
			})
			.returning();
		rows.push(series);

		await db.run(
			sql`UPDATE reservation SET recurring_series_id = ${series.id} WHERE id = ${proto.id}`
		);

		for (let w = 1; w <= 2; w++) {
			const instStart = ptDate(dayOffset - 14 + w * 7, hour);
			const instEnd = ptDate(dayOffset - 14 + w * 7, hour + duration);
			const status = instStart < new Date() ? 'completed' : 'scheduled';

			await db.insert(reservation).values({
				bookerType: 'user',
				bookerId: member.id,
				createdByUserId: member.id,
				status,
				startsAt: instStart,
				endsAt: instEnd,
				notes: `Recurring ${freq} practice`,
				recurringSeriesId: series.id
			});
		}
	}

	{
		const member = users[5];
		const protoStart = ptDate(-21, 14);
		const protoEnd = ptDate(-21, 16);

		const [proto] = await db
			.insert(reservation)
			.values({
				bookerType: 'user',
				bookerId: member.id,
				createdByUserId: member.id,
				status: 'completed',
				startsAt: protoStart,
				endsAt: protoEnd,
				notes: 'Cancelled recurring session'
			})
			.returning();

		const rrule = seedRRule(protoStart, 'weekly');

		const [series] = await db
			.insert(recurringSeries)
			.values({
				prototypeType: 'reservation',
				prototypeId: proto.id,
				rrule,
				createdBy: member.id,
				cancelledAt: new Date(Date.now() - 7 * 86400000)
			})
			.returning();
		rows.push(series);

		await db.run(
			sql`UPDATE reservation SET recurring_series_id = ${series.id} WHERE id = ${proto.id}`
		);
	}

	return rows;
}

async function seedPaymentRecords(users: SeedUser[], reservations: SeedReservation[]) {
	console.log('Seeding payment records...');
	const rows = [];

	const payableReservations = reservations
		.filter((r) => ['completed', 'confirmed', 'scheduled'].includes(r.status))
		.slice(0, 25);

	for (const r of payableReservations) {
		const hours = Math.round(((r.endsAt.getTime() - r.startsAt.getTime()) / 3600000) * 2) / 2;
		const amountCents = hours * 1500;
		const method = Math.random() > 0.3 ? 'Cash' : 'Credits';

		const [p] = await db
			.insert(paymentRecord)
			.values({
				id: `pr_seed_${randomUUID().slice(0, 8)}`,
				userId: r.createdByUserId,
				reservationId: r.id,
				stripeCustomerId: `cus_seed${randomInt(1000, 9999)}`,
				amountCents,
				paymentMethod: method,
				status: Math.random() > 0.1 ? 'completed' : 'refunded',
				paidAt: r.startsAt,
				refundedAt: Math.random() > 0.9 ? new Date() : null
			})
			.returning();
		rows.push(p);
	}

	return rows;
}

async function seedTickets(users: SeedUser[], _events: SeedEvent[]) {
	console.log('Seeding tickets...');
	const rows = [];

	const ticketedEvents = await db
		.select({ id: event.id, startsAt: event.startsAt, ticketPrice: event.ticketPrice })
		.from(event)
		.where(eq(event.ticketingEnabled, true));

	for (const evt of ticketedEvents) {
		const ticketCount = randomInt(3, 8);
		const isPast = evt.startsAt < new Date();
		const isFree = !evt.ticketPrice || evt.ticketPrice === 0;

		// Group tickets into 2-3 separate purchases/RSVPs
		const purchaseCount = randomInt(2, 3);
		let remaining = ticketCount;

		for (let p = 0; p < purchaseCount && remaining > 0; p++) {
			const qty = p === purchaseCount - 1 ? remaining : randomInt(1, Math.min(3, remaining));
			remaining -= qty;

			const purchaseId = isFree ? `rsvp-${randomUUID()}` : randomUUID();
			const buyer = pick(users);
			const email = `${buyer.name.toLowerCase().replace(' ', '.')}@example.com`;

			for (let i = 0; i < qty; i++) {
				const code = `${TICKET_CODES_PREFIX}-${randomUUID().slice(0, 8).toUpperCase()}`;
				const checkedIn = isPast && Math.random() > 0.3;

				const [t] = await db
					.insert(ticket)
					.values({
						eventId: evt.id,
						purchaseId,
						userId: buyer.id,
						attendeeName: buyer.name,
						attendeeEmail: email,
						code,
						status: checkedIn ? 'checked_in' : 'valid',
						checkedInAt: checkedIn ? evt.startsAt : null,
						checkedInByUserId: checkedIn ? users[0].id : null
					})
					.returning();
				rows.push(t);
			}
		}
	}

	return rows;
}

async function seedRsvps(users: SeedUser[]) {
	console.log('Seeding RSVPs...');
	const rows = [];

	// RSVPs only apply to non-ticketed events (lightweight headcount, no codes).
	const nonTicketedEvents = await db
		.select({ id: event.id })
		.from(event)
		.where(eq(event.ticketingEnabled, false));

	for (const evt of nonTicketedEvents) {
		// A random, distinct subset of members RSVP (unique per event_id, user_id).
		for (const u of pickN(users, randomInt(2, 8))) {
			const [r] = await db
				.insert(eventRsvp)
				.values({
					eventId: evt.id,
					userId: u.id,
					attendeeName: u.name,
					attendeeEmail: `${u.name.toLowerCase().replace(' ', '.')}@example.com`
				})
				.onConflictDoNothing({ target: [eventRsvp.eventId, eventRsvp.userId] })
				.returning();
			if (r) rows.push(r);
		}
	}

	return rows;
}

async function seedNotifications(users: SeedUser[]) {
	console.log('Seeding notifications...');
	const rows = [];

	const types = [
		{
			type: 'reservation_reminder',
			title: 'Upcoming reservation',
			body: 'Your reservation is tomorrow at 2:00 PM.',
			href: '/member/reservations'
		},
		{
			type: 'confirmation_reminder',
			title: 'Please confirm your reservation',
			body: 'You have an unconfirmed reservation this week.',
			href: '/member/reservations'
		},
		{
			type: 'band_invitation',
			title: 'Band invitation',
			body: "You've been invited to join The Voltage Thieves.",
			href: '/member/bands'
		},
		{
			type: 'band_invitation_accepted',
			title: 'Invitation accepted',
			body: 'Jordan Nguyen accepted your band invitation.',
			href: '/member/bands'
		},
		{
			type: 'recurring_skipped',
			title: 'Recurring reservation skipped',
			body: 'Your weekly reservation was skipped due to a closure.',
			href: '/member/reservations'
		},
		{
			type: 'ticket_confirmation',
			title: 'Tickets confirmed',
			body: 'Your tickets for Open Mic Night are confirmed!',
			href: '/member/tickets'
		},
		{
			type: 'event_cancellation',
			title: 'Event cancelled',
			body: 'Outdoor Festival has been cancelled. Your tickets will be refunded.',
			href: '/member/tickets'
		}
	];

	for (const u of users) {
		const count = randomInt(0, 5);
		const selected = pickN(types, count);

		for (const n of selected) {
			const daysAgo = randomInt(0, 14);
			const createdAt = new Date(Date.now() - daysAgo * 86400000);
			const isRead = Math.random() > 0.4;

			const [row] = await db
				.insert(notification)
				.values({
					userId: u.id,
					type: n.type,
					title: n.title,
					body: n.body,
					href: n.href,
					readAt: isRead ? new Date(createdAt.getTime() + randomInt(1, 24) * 3600000) : null,
					createdAt
				})
				.returning();
			rows.push(row);
		}
	}

	return rows;
}

async function seedNotificationPreferences(users: SeedUser[]) {
	console.log('Seeding notification preferences...');
	const rows = [];
	const configurableTypes = [
		'check_in_reminder',
		'reservation_reminder',
		'confirmation_reminder',
		'band_invitation',
		'band_invitation_accepted',
		'recurring_skipped'
	];

	const customizers = pickN(users, Math.ceil(users.length * 0.3));

	for (const u of customizers) {
		const tweaked = pickN(configurableTypes, randomInt(1, 3));
		for (const nt of tweaked) {
			const [row] = await db
				.insert(notificationPreference)
				.values({
					userId: u.id,
					notificationType: nt,
					emailEnabled: Math.random() > 0.3,
					inAppEnabled: Math.random() > 0.2
				})
				.returning();
			rows.push(row);
		}
	}

	return rows;
}

async function seedMarketing(users: SeedUser[]) {
	console.log('Seeding marketing...');

	const audienceRows = await db
		.insert(audience)
		.values([
			{
				id: randomUUID(),
				name: 'Newsletter',
				slug: 'newsletter',
				description: 'Monthly updates from CorvMC.',
				allowOptIn: true
			},
			{
				id: randomUUID(),
				name: 'Event Updates',
				slug: 'event-updates',
				description: 'Get notified about upcoming shows.',
				allowOptIn: true
			},
			{
				id: randomUUID(),
				name: 'Member Announcements',
				slug: 'member-announcements',
				description: 'Important announcements for members.',
				allowOptIn: false
			},
			{
				id: randomUUID(),
				name: 'Public Updates',
				slug: 'public-updates',
				description: 'General updates and news.',
				allowOptIn: true
			}
		])
		.returning();

	// Built-in audiences. Membership is a SQL predicate resolved at send time,
	// so these get no audience_member rows — see marketing/system-audiences.ts.
	const systemAudienceRows = await db
		.insert(audience)
		.values(
			(Object.keys(SYSTEM_AUDIENCES) as (keyof typeof SYSTEM_AUDIENCES)[]).map((key) => ({
				id: randomUUID(),
				name: SYSTEM_AUDIENCES[key].name,
				slug: key,
				description: SYSTEM_AUDIENCES[key].description,
				allowOptIn: false,
				systemKey: key
			}))
		)
		.returning();
	const allMembersAudience = systemAudienceRows.find((a) => a.systemKey === 'all-members')!;
	const sustainingAudience = systemAudienceRows.find((a) => a.systemKey === 'sustaining-members')!;

	const subscriberRows = await db
		.insert(subscriber)
		.values(users.map((u) => ({ id: randomUUID(), email: u.email, name: u.name, userId: u.id })))
		.returning();

	const externalEmails = [
		'fan1@example.com',
		'fan2@example.com',
		'localpress@example.com',
		'musicblog@example.com',
		'concertgoer@example.com',
		'neighbor@example.com',
		'sponsor@example.com'
	];
	const externalSubs = await db
		.insert(subscriber)
		.values(
			externalEmails.map((email) => ({
				id: randomUUID(),
				email,
				name: email.split('@')[0].replace(/\d+/g, ''),
				userId: null
			}))
		)
		.returning();

	const allSubs = [...subscriberRows, ...externalSubs];

	const membershipRows: {
		id: string;
		subscriberId: string;
		audienceId: string;
		unsubscribedAt: Date | null;
	}[] = [];
	for (const sub of allSubs) {
		for (const aud of audienceRows) {
			if (Math.random() < 0.7) {
				membershipRows.push({
					id: randomUUID(),
					subscriberId: sub.id,
					audienceId: aud.id,
					unsubscribedAt:
						Math.random() < 0.1 ? new Date(Date.now() - Math.random() * 30 * 86400000) : null
				});
			}
		}
	}

	// One opt-out tombstone against a built-in audience: the only kind of
	// audience_member row a system audience ever has, and the thing that keeps
	// one-click unsubscribe working when there is no membership row to flip.
	membershipRows.push({
		id: randomUUID(),
		subscriberId: subscriberRows[1].id,
		audienceId: allMembersAudience.id,
		unsubscribedAt: new Date(Date.now() - 5 * 86400000)
	});

	if (membershipRows.length > 0) {
		await batchInsert(audienceMember, membershipRows);
	}

	// Globally suppressed by a bounce — excluded from every audience regardless
	// of opt-in. Previously unexercised in dev data.
	await db
		.update(subscriber)
		.set({ suppressedAt: new Date(Date.now() - 3 * 86400000), suppressionReason: 'bounce' })
		.where(eq(subscriber.id, externalSubs[0].id));

	const adminUser = users[0];

	const sentCampaigns = [
		{
			subject: 'Welcome to the CorvMC Newsletter!',
			markdownBody: '# Welcome!\n\nThanks for subscribing.',
			sentAt: new Date(Date.now() - 14 * 86400000),
			recipientCount: 18
		},
		{
			subject: 'February Events Roundup',
			markdownBody: "# February Events\n\nHere's what happened this month.",
			sentAt: new Date(Date.now() - 7 * 86400000),
			recipientCount: 15
		}
	];

	for (const c of sentCampaigns) {
		const [row] = await db
			.insert(campaign)
			.values({
				id: randomUUID(),
				subject: c.subject,
				markdownBody: c.markdownBody,
				htmlBody: `<p>${c.markdownBody.replace(/\n/g, '</p><p>')}</p>`,
				scheduledFor: c.sentAt,
				sentAt: c.sentAt,
				sentById: adminUser.id,
				recipientCount: c.recipientCount
			})
			.returning();
		await db.insert(campaignAudience).values([
			{ campaignId: row.id, audienceId: audienceRows[0].id },
			{ campaignId: row.id, audienceId: audienceRows[1].id }
		]);
	}

	const [scheduled] = await db
		.insert(campaign)
		.values({
			id: randomUUID(),
			subject: 'Upcoming: Spring Concert Series',
			markdownBody: '# Spring Concert Series\n\nMore details coming soon.',
			htmlBody: '<p>Spring Concert Series preview</p>',
			scheduledFor: new Date(Date.now() + 3 * 86400000),
			sentAt: null,
			sentById: adminUser.id,
			recipientCount: null
		})
		.returning();
	await db.insert(campaignAudience).values([
		{ campaignId: scheduled.id, audienceId: audienceRows[0].id },
		{ campaignId: scheduled.id, audienceId: audienceRows[3].id }
	]);

	const [draft1] = await db
		.insert(campaign)
		.values({
			id: randomUUID(),
			subject: 'New Practice Room Hours',
			markdownBody: '# Updated Hours\n\nPractice rooms available until 11pm on weekends.',
			htmlBody: '<p>Draft</p>',
			scheduledFor: null,
			sentAt: null,
			sentById: adminUser.id,
			recipientCount: null
		})
		.returning();
	await db
		.insert(campaignAudience)
		.values({ campaignId: draft1.id, audienceId: audienceRows[2].id });

	const [draft2] = await db
		.insert(campaign)
		.values({
			id: randomUUID(),
			subject: 'Volunteer Opportunities',
			markdownBody: "# Help Out at CorvMC\n\nWe're looking for volunteers.",
			htmlBody: '<p>Draft</p>',
			scheduledFor: null,
			sentAt: null,
			sentById: adminUser.id,
			recipientCount: null
		})
		.returning();
	await db
		.insert(campaignAudience)
		.values({ campaignId: draft2.id, audienceId: audienceRows[0].id });

	// Campaigns targeting built-in audiences. The sent one also overlaps the
	// Newsletter list, which is the case the recipient dedupe exists for.
	const [sentToAll] = await db
		.insert(campaign)
		.values({
			id: randomUUID(),
			subject: 'Studio Closed for Maintenance This Weekend',
			markdownBody: '# Heads up\n\nThe practice rooms are closed Saturday and Sunday.',
			htmlBody: '<p>The practice rooms are closed Saturday and Sunday.</p>',
			scheduledFor: new Date(Date.now() - 2 * 86400000),
			sentAt: new Date(Date.now() - 2 * 86400000),
			sentById: adminUser.id,
			recipientCount: users.length
		})
		.returning();
	await db.insert(campaignAudience).values([
		{ campaignId: sentToAll.id, audienceId: allMembersAudience.id },
		{ campaignId: sentToAll.id, audienceId: audienceRows[0].id }
	]);

	const [sustainingDraft] = await db
		.insert(campaign)
		.values({
			id: randomUUID(),
			subject: 'Thank You for Sustaining CorvMC',
			markdownBody: '# Thank you\n\nYour membership keeps the doors open.',
			htmlBody: '<p>Your membership keeps the doors open.</p>',
			scheduledFor: null,
			sentAt: null,
			sentById: adminUser.id,
			recipientCount: null
		})
		.returning();
	await db
		.insert(campaignAudience)
		.values({ campaignId: sustainingDraft.id, audienceId: sustainingAudience.id });

	return {
		audiences: audienceRows.length + systemAudienceRows.length,
		subscribers: allSubs.length,
		memberships: membershipRows.length,
		campaigns: sentCampaigns.length + 5
	};
}

async function seedEquipment(users: SeedUser[]) {
	console.log('Seeding inventory...');

	const categories = await db
		.insert(equipmentCategory)
		.values([
			{ id: randomUUID(), name: 'Guitars', displayOrder: 0, pricingTier: 'major' },
			{ id: randomUUID(), name: 'Amplifiers', displayOrder: 1, pricingTier: 'major' },
			{ id: randomUUID(), name: 'Microphones', displayOrder: 2, pricingTier: 'major' },
			{ id: randomUUID(), name: 'Drum Hardware', displayOrder: 3, pricingTier: 'major' },
			{ id: randomUUID(), name: 'Cables & Accessories', displayOrder: 4, pricingTier: 'accessory' },
			{ id: randomUUID(), name: 'Consumables', displayOrder: 5, pricingTier: 'accessory' }
		])
		.returning();

	const catByName = Object.fromEntries(categories.map((c) => [c.name, c.id]));

	// "Main room → stage left rack" is how people say it out loud, so the tree is
	// two deep rather than one flat list of compound names.
	const mainRoom = { id: randomUUID(), name: 'Main room', parentId: null, displayOrder: 0 };
	const storage = { id: randomUUID(), name: 'Storage closet', parentId: null, displayOrder: 1 };
	const locations = await batchInsert(
		inventoryLocation,
		[
			mainRoom,
			storage,
			{ id: randomUUID(), name: 'Stage left rack', parentId: mainRoom.id, displayOrder: 0 },
			{ id: randomUUID(), name: 'Supply shelf', parentId: storage.id, displayOrder: 0 }
		],
		4
	);
	const locByName = Object.fromEntries(locations.map((l) => [l.name, l.id]));

	/**
	 * Both kinds, and both loanable and not — the seed has to exercise the
	 * cable-drawer case (`bulk` *and* returnable) or the two-axis model is never
	 * actually tried locally.
	 */
	const items = await batchInsert(
		inventoryItem,
		[
			{
				id: randomUUID(),
				name: 'Fender Stratocaster',
				description: 'Sunburst finish, maple neck.',
				categoryId: catByName['Guitars'],
				kind: 'serialized' as const,
				isLoanable: true,
				resourceId: 'EQ-001'
			},
			{
				id: randomUUID(),
				name: 'Gibson Les Paul Standard',
				description: 'Cherry burst. Donated.',
				categoryId: catByName['Guitars'],
				kind: 'serialized' as const,
				isLoanable: true
			},
			{
				id: randomUUID(),
				name: 'Fender Blues Deluxe',
				description: '40W tube combo.',
				categoryId: catByName['Amplifiers'],
				kind: 'serialized' as const,
				isLoanable: true
			},
			{
				id: randomUUID(),
				name: 'QSC K12.2 Powered Speaker',
				description: '2000W powered PA speaker.',
				categoryId: catByName['Amplifiers'],
				kind: 'serialized' as const,
				isLoanable: true
			},
			{
				id: randomUUID(),
				name: 'Shure SM58',
				description: 'Cardioid dynamic vocal mic.',
				categoryId: catByName['Microphones'],
				kind: 'serialized' as const,
				isLoanable: true
			},
			{
				id: randomUUID(),
				name: 'AKG P420 Condenser',
				description: 'Multi-pattern large-diaphragm condenser.',
				categoryId: catByName['Microphones'],
				kind: 'serialized' as const,
				isLoanable: true
			},
			// Counted, but it comes back — the case a single asset/consumable enum
			// could not express.
			{
				id: randomUUID(),
				name: 'XLR Cable (25ft)',
				description: 'Neutrik ends.',
				categoryId: catByName['Cables & Accessories'],
				kind: 'bulk' as const,
				unitOfMeasure: 'each' as const,
				isLoanable: true,
				reorderPoint: 6,
				reorderQuantity: 12
			},
			{
				id: randomUUID(),
				name: 'Boom Mic Stand',
				categoryId: catByName['Drum Hardware'],
				kind: 'bulk' as const,
				isLoanable: true,
				reorderPoint: 2,
				reorderQuantity: 4
			},
			// Counted and consumed — a consumable is derived from exactly this
			// pair, never stored as its own flag.
			{
				id: randomUUID(),
				name: "D'Addario EXL110 Strings",
				description: 'Regular light, 10–46.',
				categoryId: catByName['Consumables'],
				kind: 'bulk' as const,
				unitOfMeasure: 'pack' as const,
				gtin: '019954141042',
				isLoanable: false,
				reorderPoint: 4,
				reorderQuantity: 12
			},
			{
				id: randomUUID(),
				name: 'Vic Firth 5A Drumsticks',
				categoryId: catByName['Consumables'],
				kind: 'bulk' as const,
				unitOfMeasure: 'pair' as const,
				gtin: '750795000159',
				isLoanable: false,
				reorderPoint: 3,
				reorderQuantity: 10
			},
			{
				id: randomUUID(),
				name: '9V Batteries',
				categoryId: catByName['Consumables'],
				kind: 'bulk' as const,
				unitOfMeasure: 'box' as const,
				isLoanable: false,
				// Deliberately seeded below its reorder point so the low-stock
				// surface has something to show without anyone arranging it.
				reorderPoint: 5,
				reorderQuantity: 20
			}
		],
		4
	);

	const itemByName = Object.fromEntries(items.map((i) => [i.name, i]));
	const now = new Date();
	const day = 86400000;
	const staffId = users[0].id;

	// -----------------------------------------------------------------------
	// Acquisitions. Every arrival goes through one, so the spend report has
	// something to add up and the gifts-in-kind disclosure has something to
	// disaggregate.
	// -----------------------------------------------------------------------
	const purchase = {
		id: randomUUID(),
		kind: 'purchase' as const,
		occurredAt: new Date(now.getTime() - 200 * day),
		sourceName: 'Guitar Center',
		reference: 'INV-88213',
		totalCents: 184_000,
		recordedByUserId: staffId
	};
	const donation = {
		id: randomUUID(),
		kind: 'donation' as const,
		occurredAt: new Date(now.getTime() - 120 * day),
		sourceName: 'Estate of R. Whitfield',
		donorUserId: users[2].id,
		fairValueCents: 250_000,
		fairValueBasis: 'Reverb comparable sales, three listings averaged',
		intendedUse: 'Practice-room backline, available to all members',
		monetized: false,
		acknowledgedAt: new Date(now.getTime() - 118 * day),
		recordedByUserId: staffId
	};
	const restock = {
		id: randomUUID(),
		kind: 'purchase' as const,
		occurredAt: new Date(now.getTime() - 20 * day),
		sourceName: 'Sweetwater',
		reference: 'SW-4471902',
		totalCents: 21_400,
		recordedByUserId: staffId
	};
	const grant = {
		id: randomUUID(),
		kind: 'grant' as const,
		occurredAt: new Date(now.getTime() - 300 * day),
		sourceName: 'Benton County Cultural Coalition',
		reference: 'BCCC-2025-14',
		totalCents: 96_000,
		intendedUse: 'PA capacity for all-ages programming',
		recordedByUserId: staffId
	};

	await batchInsert(acquisition, [purchase, donation, restock, grant], 4);

	// A helper so a seeded arrival cannot drift from the ledger it implies: one
	// call writes the line *and* the movement, the way the service does.
	const lines: (typeof acquisitionLine.$inferInsert)[] = [];
	const movements: (typeof stockMovement.$inferInsert)[] = [];
	const assets: (typeof inventoryAsset.$inferInsert)[] = [];

	function received(
		acq: { id: string; occurredAt: Date },
		itemName: string,
		quantity: number,
		unitValueCents: number | null,
		opts: {
			units?: { tag?: string; serial?: string; condition?: string }[];
			locationId?: string;
		} = {}
	) {
		const item = itemByName[itemName];
		lines.push({
			id: randomUUID(),
			acquisitionId: acq.id,
			itemId: item.id,
			quantity,
			unitValueCents
		});

		if (item.kind === 'serialized') {
			const units = opts.units ?? Array.from({ length: quantity }, () => ({}));
			for (const unit of units) {
				const assetId = randomUUID();
				assets.push({
					id: assetId,
					itemId: item.id,
					assetTag: unit.tag ?? null,
					serialNumber: unit.serial ?? null,
					condition: (unit.condition ?? 'good') as 'excellent' | 'good' | 'fair' | 'poor',
					status: 'in_service',
					locationId: opts.locationId ?? null,
					acquisitionId: acq.id
				});
				movements.push({
					id: randomUUID(),
					itemId: item.id,
					assetId,
					quantity: 1,
					reason: 'receive',
					locationId: opts.locationId ?? null,
					acquisitionId: acq.id,
					actorId: staffId,
					occurredAt: acq.occurredAt
				});
			}
		} else {
			movements.push({
				id: randomUUID(),
				itemId: item.id,
				quantity,
				reason: 'receive',
				locationId: opts.locationId ?? null,
				acquisitionId: acq.id,
				actorId: staffId,
				occurredAt: acq.occurredAt
			});
		}
	}

	received(purchase, 'Fender Stratocaster', 1, 89_900, {
		units: [{ tag: 'CMC-000101', serial: 'FEN-STR-2019-0041' }],
		locationId: locByName['Main room']
	});
	received(purchase, 'Fender Blues Deluxe', 1, 94_100, {
		units: [{ tag: 'CMC-000102', serial: 'FBD-114522', condition: 'fair' }],
		locationId: locByName['Main room']
	});
	received(donation, 'Gibson Les Paul Standard', 1, 250_000, {
		units: [{ tag: 'CMC-000103', serial: 'GIB-LP-91188', condition: 'excellent' }],
		locationId: locByName['Main room']
	});
	// A donated unit the collective has since let go of, 40 days ago — inside the
	// three-year window, so it owes a Form 8282 decision and the compliance list
	// has a live row. Retired below, once the ids exist.
	received(donation, 'Fender Blues Deluxe', 1, 65_000, {
		units: [{ tag: 'CMC-000110', serial: 'FEN-BD-55021', condition: 'poor' }],
		locationId: locByName['Main room']
	});
	received(grant, 'QSC K12.2 Powered Speaker', 2, 48_000, {
		units: [{ tag: 'CMC-000104' }, { tag: 'CMC-000105' }],
		locationId: locByName['Stage left rack']
	});
	// One unit deliberately left untagged: gear gets entered before the roll of
	// stickers arrives, and the UI has to show that state honestly.
	received(purchase, 'Shure SM58', 3, 11_900, {
		units: [{ tag: 'CMC-000106' }, { tag: 'CMC-000107' }, {}],
		locationId: locByName['Stage left rack']
	});
	received(purchase, 'AKG P420 Condenser', 1, 29_900, {
		units: [{ tag: 'CMC-000108' }],
		locationId: locByName['Stage left rack']
	});
	received(purchase, 'XLR Cable (25ft)', 12, 1_800, { locationId: locByName['Stage left rack'] });
	received(purchase, 'Boom Mic Stand', 4, 3_500, { locationId: locByName['Storage closet'] });
	received(restock, "D'Addario EXL110 Strings", 12, 700, { locationId: locByName['Supply shelf'] });
	received(restock, 'Vic Firth 5A Drumsticks', 10, 1_100, {
		locationId: locByName['Supply shelf']
	});
	received(restock, '9V Batteries', 6, 1_400, { locationId: locByName['Supply shelf'] });

	await batchInsert(acquisitionLine, lines, 4);
	await batchInsert(inventoryAsset, assets, 4);

	const assetByTag = Object.fromEntries(
		assets.filter((a) => a.assetTag).map((a) => [a.assetTag, a])
	);

	// -----------------------------------------------------------------------
	// Consumption and corrections, so the ledger reads like a real quarter and
	// the batteries land under their reorder point on their own.
	// -----------------------------------------------------------------------
	function used(itemName: string, quantity: number, daysAgo: number, notes: string) {
		movements.push({
			id: randomUUID(),
			itemId: itemByName[itemName].id,
			quantity: -quantity,
			reason: 'consume',
			locationId: locByName['Supply shelf'],
			actorId: staffId,
			occurredAt: new Date(now.getTime() - daysAgo * day),
			notes
		});
	}

	used("D'Addario EXL110 Strings", 3, 15, 'Restrung the house Strat');
	used("D'Addario EXL110 Strings", 2, 8, 'Open mic night');
	used('Vic Firth 5A Drumsticks', 4, 12, 'House kit');
	used('Vic Firth 5A Drumsticks', 3, 4, 'Broken during all-ages show');
	used('9V Batteries', 2, 18, 'Active DI boxes');
	// Leaves 9V at 6 − 2 − 2 = 2 against a reorder point of 5.
	used('9V Batteries', 2, 6, 'Wireless packs');

	// A stocktake correction: the honest way to change a count, and the reason
	// `adjust` is the one caller-signed reason in the vocabulary.
	movements.push({
		id: randomUUID(),
		itemId: itemByName['XLR Cable (25ft)'].id,
		quantity: -1,
		reason: 'adjust',
		locationId: locByName['Stage left rack'],
		actorId: staffId,
		occurredAt: new Date(now.getTime() - 5 * day),
		notes: 'Quarterly count — one unaccounted for'
	});

	// One amp out for repair, so a unit exists that is owned, on hand, and not
	// available. Only the per-unit status can say that.
	const blues = assetByTag['CMC-000102'];
	movements.push({
		id: randomUUID(),
		itemId: blues.itemId,
		assetId: blues.id,
		quantity: -1,
		reason: 'repair_out',
		actorId: staffId,
		occurredAt: new Date(now.getTime() - 3 * day),
		notes: 'Crackling on the clean channel'
	});

	// -----------------------------------------------------------------------
	// Loans across every state, with the movements they imply.
	// -----------------------------------------------------------------------
	const strat = assetByTag['CMC-000101'];
	const sm58 = assetByTag['CMC-000106'];
	const lespaul = assetByTag['CMC-000103'];
	const speaker = assetByTag['CMC-000104'];

	const loanRows: (typeof inventoryLoan.$inferInsert)[] = [
		{
			id: randomUUID(),
			itemId: strat.itemId,
			assetId: strat.id,
			userId: users[0].id,
			quantity: 1,
			requestedPickupDate: new Date(now.getTime() - 10 * day),
			scheduledPickupDate: new Date(now.getTime() - 9 * day),
			dueDate: new Date(now.getTime() + 3 * day),
			checkedOutAt: new Date(now.getTime() - 9 * day),
			status: 'checked_out',
			dailyRateCents: 500,
			memberNotes: 'Need it for a gig this weekend'
		},
		{
			id: randomUUID(),
			itemId: sm58.itemId,
			assetId: sm58.id,
			userId: users[1].id,
			quantity: 1,
			requestedPickupDate: new Date(now.getTime() - 14 * day),
			scheduledPickupDate: new Date(now.getTime() - 13 * day),
			dueDate: new Date(now.getTime() - 2 * day),
			checkedOutAt: new Date(now.getTime() - 13 * day),
			status: 'checked_out',
			dailyRateCents: 500
		},
		{
			id: randomUUID(),
			itemId: lespaul.itemId,
			userId: users[2].id,
			quantity: 1,
			requestedPickupDate: new Date(now.getTime() + 2 * day),
			status: 'requested',
			memberNotes: 'Would love to try this for a recording session'
		},
		{
			id: randomUUID(),
			itemId: speaker.itemId,
			userId: users[3].id,
			quantity: 1,
			requestedPickupDate: new Date(now.getTime() + 1 * day),
			scheduledPickupDate: new Date(now.getTime() + 1 * day),
			status: 'scheduled',
			memberNotes: 'Need for band practice'
		},
		{
			id: randomUUID(),
			itemId: null,
			userId: users[4].id,
			quantity: 1,
			requestedPickupDate: new Date(now.getTime() + 3 * day),
			status: 'requested',
			memberNotes: 'Looking for a bass amp 300W+'
		},
		{
			id: randomUUID(),
			itemId: itemByName['XLR Cable (25ft)'].id,
			userId: users[1].id,
			quantity: 3,
			requestedPickupDate: new Date(now.getTime() - 20 * day),
			scheduledPickupDate: new Date(now.getTime() - 19 * day),
			dueDate: new Date(now.getTime() - 15 * day),
			checkedOutAt: new Date(now.getTime() - 19 * day),
			returnedAt: new Date(now.getTime() - 16 * day),
			status: 'returned',
			dailyRateCents: 0,
			totalChargeCents: 0,
			creditsCents: 0,
			cashCents: 0,
			staffNotes: 'Sustaining member — accessories free'
		},
		{
			id: randomUUID(),
			itemId: itemByName['AKG P420 Condenser'].id,
			userId: users[5].id,
			quantity: 1,
			requestedPickupDate: new Date(now.getTime() - 7 * day),
			status: 'cancelled'
		}
	];

	const loans = await batchInsert(inventoryLoan, loanRows, 3);

	// The two open checkouts have left the building; the returned cable loan went
	// out and came back. Written here so on-hand reflects what is physically in
	// the room, which is the invariant the whole rebuild rests on.
	for (const loan of loanRows) {
		if (!loan.itemId) continue;
		if (loan.checkedOutAt) {
			movements.push({
				id: randomUUID(),
				itemId: loan.itemId,
				assetId: loan.assetId ?? null,
				quantity: -(loan.quantity ?? 1),
				reason: 'loan_out',
				loanId: loan.id,
				actorId: staffId,
				occurredAt: loan.checkedOutAt
			});
		}
		if (loan.returnedAt) {
			movements.push({
				id: randomUUID(),
				itemId: loan.itemId,
				assetId: loan.assetId ?? null,
				quantity: loan.quantity ?? 1,
				reason: 'loan_return',
				loanId: loan.id,
				actorId: staffId,
				occurredAt: loan.returnedAt
			});
		}
	}

	// Units currently out or in the shop say so, so availability and the ledger
	// agree without anyone reconciling them by hand.
	await db
		.update(inventoryAsset)
		.set({ status: 'on_loan' })
		.where(inArray(inventoryAsset.id, [strat.id!, sm58.id!]));
	await db
		.update(inventoryAsset)
		.set({ status: 'maintenance', condition: 'poor' })
		.where(eq(inventoryAsset.id, blues.id!));

	// Disposed of 40 days ago: donated, inside the three-year window, and nobody
	// has recorded a Form 8282 outcome — so it shows on /staff/inventory/compliance
	// with roughly 85 of the 125 days left.
	const donatedDisposal = assets.find((a) => a.assetTag === 'CMC-000110');
	if (donatedDisposal) {
		const disposedAt = new Date(now.getTime() - 40 * day);
		await db
			.update(inventoryAsset)
			.set({
				status: 'retired',
				retiredAt: disposedAt,
				retiredReason: 'Cracked cabinet, sold for parts'
			})
			.where(eq(inventoryAsset.id, donatedDisposal.id!));
		movements.push({
			id: randomUUID(),
			itemId: donatedDisposal.itemId,
			assetId: donatedDisposal.id!,
			quantity: -1,
			reason: 'retire',
			actorId: staffId,
			occurredAt: disposedAt,
			notes: 'Cracked cabinet, sold for parts'
		});
	}

	await batchInsert(stockMovement, movements, 4);

	return {
		categories: categories.length,
		locations: locations.length,
		items: items.length,
		assets: assets.length,
		acquisitions: 4,
		movements: movements.length,
		loans: loans.length
	};
}

// ---------------------------------------------------------------------------
// Help Articles
// ---------------------------------------------------------------------------

/**
 * Link a how-to to the gear it explains.
 *
 * Runs after both `seedEquipment` and `seedHelp`, and looks its rows up by name
 * rather than threading ids through two unrelated seeders for one join.
 */
async function seedItemArticles() {
	const [pa] = await db
		.select({ id: inventoryItem.id })
		.from(inventoryItem)
		.where(eq(inventoryItem.name, 'QSC K12.2 Powered Speaker'))
		.limit(1);
	const [article] = await db
		.select({ id: helpArticle.id })
		.from(helpArticle)
		.where(eq(helpArticle.published, true))
		.limit(1);

	if (!pa || !article) return { links: 0 };

	await db
		.insert(inventoryItemArticle)
		.values({ itemId: pa.id, articleId: article.id })
		.onConflictDoNothing();

	return { links: 1 };
}

async function seedHelp() {
	const cats = await batchInsert(
		helpCategory,
		[
			{
				name: 'Getting Started',
				slug: 'getting-started',
				description: 'Learn the basics of your membership',
				icon: 'book',
				sortOrder: 0,
				minRole: 'member'
			},
			{
				name: 'Reservations',
				slug: 'reservations',
				description: 'Booking rooms and managing your time',
				icon: 'calendar',
				sortOrder: 1,
				minRole: 'member'
			},
			{
				name: 'Bands',
				slug: 'bands',
				description: 'Creating and managing bands',
				icon: 'music',
				sortOrder: 3,
				minRole: 'member'
			},
			{
				name: 'Staff Guide',
				slug: 'staff-guide',
				description: 'Operations and admin tasks',
				icon: 'settings',
				sortOrder: 8,
				minRole: 'staff'
			},
			{
				name: 'Profile & Directory',
				slug: 'profile-directory',
				description: 'Your profile, visibility, and being found',
				icon: 'user',
				sortOrder: 2,
				minRole: 'member'
			},
			{
				name: 'Band Pages (Premium)',
				slug: 'band-pages',
				description: 'Premium band websites, page editor, and press kit',
				icon: 'layout',
				sortOrder: 4,
				minRole: 'member'
			},
			{
				name: 'Events & Tickets',
				slug: 'events-tickets',
				description: 'Browsing events, buying tickets, and check-in',
				icon: 'ticket',
				sortOrder: 5,
				minRole: 'member'
			},
			{
				name: 'Equipment Lending',
				slug: 'equipment',
				description: 'Borrowing gear from the lending library',
				icon: 'package',
				sortOrder: 6,
				minRole: 'member'
			},
			{
				name: 'Membership & Billing',
				slug: 'membership',
				description: 'Sustaining membership, benefits, and billing',
				icon: 'heart',
				sortOrder: 7,
				minRole: 'member'
			},
			{
				name: 'Volunteering',
				slug: 'volunteering',
				description: 'Volunteer roles, logging hours, and how review works',
				icon: 'heart-handshake',
				sortOrder: 9,
				minRole: 'member'
			},
			{
				name: 'Messages',
				slug: 'messaging',
				description: 'Talking to staff, and to other members',
				icon: 'message',
				sortOrder: 10,
				minRole: 'member'
			},
			{
				name: 'Suggestions',
				slug: 'suggestions',
				description: 'The member idea board and how staff answer it',
				icon: 'bulb',
				sortOrder: 11,
				minRole: 'member'
			}
		],
		9
	);

	const articles = await batchInsert(
		helpArticle,
		[
			{
				categoryId: cats[0].id,
				title: 'Welcome to CorvMC',
				slug: 'welcome',
				summary: 'An overview of your membership and what you can do.',
				content:
					'## Welcome\n\nCorvMC is a community music space where you can book rehearsal rooms, connect with other musicians, and join bands.\n\n## What You Can Do\n\n- **Book Reservations** — Reserve practice rooms by the hour\n- **Join the Directory** — Share your instruments and genres so others can find you\n- **Create or Join Bands** — Collaborate with other members\n- **Attend Events** — Check out shows and community events',
				source: 'static',
				minRole: 'member',
				published: true,
				sortOrder: 0
			},
			{
				categoryId: cats[0].id,
				title: 'Your Profile',
				slug: 'your-profile',
				summary: 'How to set up and customize your member profile.',
				content:
					'## Your Profile\n\nYour profile helps other members find you in the directory.\n\n### What to Add\n\n- **Instruments** — What do you play?\n- **Genres** — What styles are you into?\n- **Looking for a band** — Toggle this to show up in searches\n\n### Updating Your Profile\n\nNavigate to your account settings to update your display name, pronouns, and contact info.',
				source: 'static',
				minRole: 'member',
				published: true,
				sortOrder: 1
			},
			{
				categoryId: cats[1].id,
				title: 'Booking a Session',
				slug: 'booking-a-session',
				summary: 'How to reserve practice time at the studio.',
				content:
					'## Booking a Session\n\nYou can book a rehearsal room from your member dashboard.\n\n### How to Book\n\n1. Navigate to **Reservations** in the sidebar\n2. Select an available time slot\n3. Choose the duration (1-4 hours)\n4. Confirm your booking\n\n### Cancellation Policy\n\nYou can cancel up to 24 hours before the start time without charge.',
				source: 'static',
				minRole: 'member',
				published: true,
				sortOrder: 0
			},
			{
				categoryId: cats[1].id,
				title: 'Recurring Reservations',
				slug: 'recurring-reservations',
				summary: 'Set up weekly or biweekly practice schedules.',
				content:
					'## Recurring Reservations\n\nIf you practice at the same time each week, set up a recurring reservation.\n\n### How It Works\n\n- Choose weekly, biweekly, or monthly frequency\n- Recurring reservations are created in advance\n- You can skip individual occurrences without cancelling the series\n\n### Eligibility\n\nRecurring reservations are available to sustaining members and above.',
				source: 'static',
				minRole: 'member',
				published: true,
				sortOrder: 1
			},
			{
				categoryId: cats[2].id,
				title: 'Creating a Band',
				slug: 'creating-a-band',
				summary: 'How to create a band and invite members.',
				content:
					'## Creating a Band\n\nBands allow you to share a practice schedule and coordinate with other members.\n\n### Steps\n\n1. Go to **My Bands** in the sidebar\n2. Click **Create Band**\n3. Name your band and add a bio\n4. Invite members by searching the directory\n\n### Roles\n\n- **Owner** — Full control, can delete the band\n- **Admin** — Can manage members and book on behalf of the band\n- **Member** — Can view the schedule and band info',
				source: 'static',
				minRole: 'member',
				published: true,
				sortOrder: 0
			},
			{
				categoryId: cats[3].id,
				title: 'Managing Reservations',
				slug: 'staff-managing-reservations',
				summary: 'How to confirm, complete, and resolve reservations.',
				content:
					"## Managing Reservations\n\nAs staff, you can manage all member reservations.\n\n### Actions\n\n- **Confirm** — Approve a pending reservation\n- **Complete** — Mark as done after the session\n- **No-show** — Mark if the member didn't arrive\n- **Cancel** — Cancel with an optional reason\n\n### Resolving Issues\n\nUse the Resolve panel to handle unresolved reservations (past their end time but not completed).",
				source: 'static',
				minRole: 'staff',
				published: true,
				sortOrder: 0
			}
		],
		6
	);

	return { categories: cats.length, articles: articles.length };
}

// ---------------------------------------------------------------------------
// Inbox threads
// ---------------------------------------------------------------------------

/**
 * Member↔member conversations, covering every state the UI has to render:
 * an accepted conversation, a request waiting on a decision, a request the
 * sender is still waiting on, a block, a member on probation, a member who
 * switched their own messaging off, and a reported conversation in triage.
 */
async function seedDirectMessages(users: SeedUser[], adminUser: SeedUser) {
	const now = new Date();
	const hour = 3600_000;
	const day = 24 * hour;

	// Six distinct members so no two scenarios interfere.
	const [alice, bob, carol, dave, erin, frank] = users.slice(0, 6);
	if (!frank) return { threads: 0, blocks: 0, standings: 0 };

	const accepted = randomUUID();
	const pendingForBob = randomUUID();
	const pendingFromCarol = randomUUID();
	const reported = randomUUID();

	const threads = await batchInsert(
		inboxThread,
		[
			{
				id: accepted,
				channel: 'direct' as const,
				status: 'open' as const,
				preview: 'Sounds good — Thursday works for me. I can bring an amp.',
				messageCount: 3,
				lastMessageAt: new Date(now.getTime() - 2 * hour),
				createdAt: new Date(now.getTime() - 3 * day),
				updatedAt: new Date(now.getTime() - 2 * hour)
			},
			{
				id: pendingForBob,
				channel: 'direct' as const,
				status: 'open' as const,
				preview: 'Hi! Saw you play bass at the open mic — I am putting a soul band together.',
				messageCount: 1,
				lastMessageAt: new Date(now.getTime() - 6 * hour),
				createdAt: new Date(now.getTime() - 6 * hour),
				updatedAt: new Date(now.getTime() - 6 * hour)
			},
			{
				id: pendingFromCarol,
				channel: 'direct' as const,
				status: 'open' as const,
				preview: 'Are you still looking for a drummer?',
				messageCount: 1,
				lastMessageAt: new Date(now.getTime() - day),
				createdAt: new Date(now.getTime() - day),
				updatedAt: new Date(now.getTime() - day)
			},
			{
				id: reported,
				channel: 'direct' as const,
				// Reporting closes the conversation, same as declining.
				status: 'resolved' as const,
				preview: 'I said I am not interested. Please stop messaging me.',
				messageCount: 3,
				lastMessageAt: new Date(now.getTime() - 2 * day),
				createdAt: new Date(now.getTime() - 4 * day),
				updatedAt: new Date(now.getTime() - 2 * day)
			}
		],
		2
	);

	// acceptedAt is the request mechanism: stamped on the person who started the
	// conversation, null on the recipient until they accept.
	await batchInsert(
		inboxParticipant,
		[
			{
				id: randomUUID(),
				threadId: accepted,
				userId: alice.id,
				role: 'member' as const,
				acceptedAt: new Date(now.getTime() - 3 * day),
				lastReadAt: new Date(now.getTime() - 2 * hour),
				createdAt: new Date(now.getTime() - 3 * day)
			},
			{
				id: randomUUID(),
				threadId: accepted,
				userId: bob.id,
				role: 'member' as const,
				acceptedAt: new Date(now.getTime() - 3 * day),
				lastReadAt: new Date(now.getTime() - 3 * hour),
				createdAt: new Date(now.getTime() - 3 * day)
			},

			// Waiting on Bob: he sees this in Messages tagged "Request".
			{
				id: randomUUID(),
				threadId: pendingForBob,
				userId: carol.id,
				role: 'member' as const,
				acceptedAt: new Date(now.getTime() - 6 * hour),
				lastReadAt: new Date(now.getTime() - 6 * hour),
				createdAt: new Date(now.getTime() - 6 * hour)
			},
			{
				id: randomUUID(),
				threadId: pendingForBob,
				userId: bob.id,
				role: 'member' as const,
				acceptedAt: null,
				lastReadAt: null,
				createdAt: new Date(now.getTime() - 6 * hour)
			},

			// Waiting on Dave: counts against Carol's outstanding-request cap.
			{
				id: randomUUID(),
				threadId: pendingFromCarol,
				userId: carol.id,
				role: 'member' as const,
				acceptedAt: new Date(now.getTime() - day),
				lastReadAt: new Date(now.getTime() - day),
				createdAt: new Date(now.getTime() - day)
			},
			{
				id: randomUUID(),
				threadId: pendingFromCarol,
				userId: dave.id,
				role: 'member' as const,
				acceptedAt: null,
				lastReadAt: null,
				createdAt: new Date(now.getTime() - day)
			},

			{
				id: randomUUID(),
				threadId: reported,
				userId: erin.id,
				role: 'member' as const,
				acceptedAt: new Date(now.getTime() - 4 * day),
				lastReadAt: new Date(now.getTime() - 2 * day),
				createdAt: new Date(now.getTime() - 4 * day)
			},
			{
				id: randomUUID(),
				threadId: reported,
				userId: frank.id,
				role: 'member' as const,
				acceptedAt: new Date(now.getTime() - 4 * day),
				lastReadAt: null,
				createdAt: new Date(now.getTime() - 4 * day)
			}
		],
		2
	);

	// Every DM is 'peer': nobody wrote to CorvMC and CorvMC sent nothing.
	await batchInsert(
		inboxMessage,
		[
			{
				id: randomUUID(),
				threadId: accepted,
				direction: 'peer' as const,
				body: 'Hey — are you free to jam this week?',
				authorName: alice.name,
				authorUserId: alice.id,
				createdAt: new Date(now.getTime() - 3 * day)
			},
			{
				id: randomUUID(),
				threadId: accepted,
				direction: 'peer' as const,
				body: 'Yeah! Thursday or Saturday both work.',
				authorName: bob.name,
				authorUserId: bob.id,
				createdAt: new Date(now.getTime() - 2 * day)
			},
			{
				id: randomUUID(),
				threadId: accepted,
				direction: 'peer' as const,
				body: 'Sounds good — Thursday works for me. I can bring an amp.',
				authorName: alice.name,
				authorUserId: alice.id,
				createdAt: new Date(now.getTime() - 2 * hour)
			},

			{
				id: randomUUID(),
				threadId: pendingForBob,
				direction: 'peer' as const,
				body: 'Hi! Saw you play bass at the open mic — I am putting a soul band together and wondered if you were looking for something.',
				authorName: carol.name,
				authorUserId: carol.id,
				createdAt: new Date(now.getTime() - 6 * hour)
			},

			{
				id: randomUUID(),
				threadId: pendingFromCarol,
				direction: 'peer' as const,
				body: 'Are you still looking for a drummer?',
				authorName: carol.name,
				authorUserId: carol.id,
				createdAt: new Date(now.getTime() - day)
			},

			{
				id: randomUUID(),
				threadId: reported,
				direction: 'peer' as const,
				body: 'Hi, want to get a drink sometime?',
				authorName: frank.name,
				authorUserId: frank.id,
				createdAt: new Date(now.getTime() - 4 * day)
			},
			{
				id: randomUUID(),
				threadId: reported,
				direction: 'peer' as const,
				body: 'No thanks, I am just here for the music.',
				authorName: erin.name,
				authorUserId: erin.id,
				createdAt: new Date(now.getTime() - 3 * day)
			},
			{
				id: randomUUID(),
				threadId: reported,
				direction: 'peer' as const,
				body: 'I said I am not interested. Please stop messaging me.',
				authorName: erin.name,
				authorUserId: erin.id,
				createdAt: new Date(now.getTime() - 2 * day)
			}
		],
		3
	);

	// Reporting blocks the other person straight away — the reporter should not
	// have to wait on the staff queue to stop hearing from them.
	const blocks = await batchInsert(
		userBlock,
		[
			{
				id: randomUUID(),
				blockerUserId: erin.id,
				blockedUserId: frank.id,
				source: 'reported' as const,
				createdAt: new Date(now.getTime() - 2 * day)
			},
			{
				id: randomUUID(),
				blockerUserId: dave.id,
				blockedUserId: alice.id,
				source: 'declined_request' as const,
				createdAt: new Date(now.getTime() - 5 * day)
			}
		],
		2
	);

	const reportFlag = randomUUID();
	await batchInsert(
		contentFlag,
		[
			{
				id: reportFlag,
				entityType: 'inbox_thread' as const,
				entityId: reported,
				reportedByUserId: erin.id,
				reason: 'Harassment',
				description: 'They kept messaging after I said no.',
				status: 'pending' as const,
				createdAt: new Date(now.getTime() - 2 * day),
				updatedAt: new Date(now.getTime() - 2 * day)
			}
		],
		1
	);

	// Probation from an upheld report: Frank can reply where he already is, but
	// cannot start anything new. A moderation record, so it is a standing row.
	const standings = await batchInsert(
		memberStanding,
		[
			{
				userId: frank.id,
				scope: 'messaging' as const,
				status: 'restricted' as const,
				reason: 'Continued messaging after being asked to stop.',
				triggeringFlagId: reportFlag,
				updatedByUserId: adminUser.id,
				updatedAt: new Date(now.getTime() - day)
			}
		],
		1
	);

	// Dave switched his own messaging off. Deliberately NOT a standing row —
	// nothing was imposed on him, so there is no moderation record to write, and
	// staff have nothing to restore. It is a preference on his user row, and it
	// is the reason `member_standing` needs no `source` column.
	await db.update(user).set({ acceptsDirectMessages: false }).where(eq(user.id, dave.id));

	return { threads: threads.length, blocks: blocks.length, standings: standings.length };
}

async function seedInbox(adminUser: SeedUser, memberUser: SeedUser) {
	const now = new Date();
	const hour = 3600_000;
	const day = 24 * hour;

	const threads = await batchInsert(
		inboxThread,
		[
			{
				id: randomUUID(),
				channel: 'web' as const,
				status: 'open' as const,
				subject: 'General Inquiry',
				preview:
					'Hi, I was wondering about your membership options and pricing. Do you offer student discounts?',
				contactName: 'Sarah Chen',
				contactEmail: 'sarah.chen@example.com',
				messageCount: 2,
				// Staff answered and nobody has written back: still open, but waiting
				// on her rather than on us, so it carries the awaiting-reply marker and
				// drops out of the nav badge. Matches the outbound message below.
				awaitingReplySince: new Date(now.getTime() - 2 * hour),
				lastMessageAt: new Date(now.getTime() - 2 * hour),
				createdAt: new Date(now.getTime() - day),
				updatedAt: new Date(now.getTime() - 2 * hour)
			},
			{
				id: randomUUID(),
				channel: 'web' as const,
				status: 'open' as const,
				subject: 'Performance Inquiry',
				preview:
					'We are a 5-piece indie rock band looking to book a show at your venue. We have a press kit available.',
				contactName: 'Marcus Rivera',
				contactEmail: 'marcus@thelateshift.band',
				messageCount: 1,
				lastMessageAt: new Date(now.getTime() - 6 * hour),
				createdAt: new Date(now.getTime() - 6 * hour),
				updatedAt: new Date(now.getTime() - 6 * hour)
			},
			{
				id: randomUUID(),
				channel: 'email' as const,
				status: 'open' as const,
				subject: 'Broken mic stand in Room B',
				preview:
					"Hey, just a heads up that the mic stand in Room B has a stripped threading and won't tighten.",
				contactName: 'Jordan Lee',
				contactEmail: 'jordan.lee@gmail.com',
				messageCount: 3,
				lastMessageAt: new Date(now.getTime() - 12 * hour),
				createdAt: new Date(now.getTime() - 2 * day),
				updatedAt: new Date(now.getTime() - 12 * hour)
			},
			{
				id: randomUUID(),
				channel: 'web' as const,
				status: 'resolved' as const,
				subject: 'Volunteer Opportunities',
				preview: "Thanks for the info! I'll sign up for the next orientation session.",
				contactName: 'Priya Patel',
				contactEmail: 'priya.p@outlook.com',
				messageCount: 4,
				lastMessageAt: new Date(now.getTime() - 3 * day),
				createdAt: new Date(now.getTime() - 5 * day),
				updatedAt: new Date(now.getTime() - 3 * day)
			},
			{
				id: randomUUID(),
				channel: 'sms' as const,
				status: 'open' as const,
				preview: "Is the studio open tomorrow? Google says you're closed on Mondays.",
				contactName: null,
				contactPhone: '+15415551234',
				messageCount: 1,
				lastMessageAt: new Date(now.getTime() - hour),
				createdAt: new Date(now.getTime() - hour),
				updatedAt: new Date(now.getTime() - hour)
			},

			// Portal threads. Unlike every channel above, these belong to a real
			// account — the member reads and answers them at /member/messages, and
			// the participant rows below are what make them theirs.
			{
				id: randomUUID(),
				channel: 'portal' as const,
				status: 'open' as const,
				subject: 'Question about after-hours access',
				preview:
					"You're all set — your fob works until 11pm on weeknights. Let us know if it gives you trouble.",
				contactName: memberUser.name,
				contactEmail: memberUser.email,
				messageCount: 2,
				// Same again on the portal channel, where the member replying from
				// /member/messages is what clears it.
				awaitingReplySince: new Date(now.getTime() - 4 * hour),
				lastMessageAt: new Date(now.getTime() - 4 * hour),
				createdAt: new Date(now.getTime() - day),
				updatedAt: new Date(now.getTime() - 4 * hour)
			},
			{
				id: randomUUID(),
				channel: 'portal' as const,
				status: 'resolved' as const,
				subject: 'Amp buzzing in Room A',
				preview: 'Swapped the cable — no buzz now. Thanks for flagging it.',
				contactName: memberUser.name,
				contactEmail: memberUser.email,
				messageCount: 2,
				lastMessageAt: new Date(now.getTime() - 6 * day),
				createdAt: new Date(now.getTime() - 7 * day),
				updatedAt: new Date(now.getTime() - 6 * day)
			}
		],
		4
	);

	// Read cursors. The open thread is left unread so the member portal opens
	// with a badge on the Messages nav item; the resolved one is caught up, which
	// is what exercises the closed-conversation view.
	await batchInsert(
		inboxParticipant,
		[
			{
				id: randomUUID(),
				threadId: threads[5].id,
				userId: memberUser.id,
				role: 'member' as const,
				lastReadAt: null,
				createdAt: new Date(now.getTime() - day)
			},
			{
				id: randomUUID(),
				threadId: threads[6].id,
				userId: memberUser.id,
				role: 'member' as const,
				lastReadAt: new Date(now.getTime() - 5 * day),
				createdAt: new Date(now.getTime() - 7 * day)
			}
		],
		2
	);

	const messages = await batchInsert(
		inboxMessage,
		[
			// Thread 1: Sarah Chen contact form
			{
				id: randomUUID(),
				threadId: threads[0].id,
				direction: 'inbound' as const,
				body: 'Hi, I was wondering about your membership options and pricing. Do you offer student discounts?',
				authorName: 'Sarah Chen',
				createdAt: new Date(now.getTime() - day)
			},
			{
				id: randomUUID(),
				threadId: threads[0].id,
				direction: 'outbound' as const,
				body: 'Hi Sarah! Yes, we offer a free membership tier and discounted rates for students with a valid .edu email. Check out our membership page for details!',
				authorName: adminUser.name,
				authorUserId: adminUser.id,
				createdAt: new Date(now.getTime() - 2 * hour)
			},

			// Thread 2: Marcus performance inquiry
			{
				id: randomUUID(),
				threadId: threads[1].id,
				direction: 'inbound' as const,
				body: "We are a 5-piece indie rock band looking to book a show at your venue. We have a press kit available. Our EPK is at thelateshift.band/press. We're free most weekends in June and July.",
				authorName: 'Marcus Rivera',
				createdAt: new Date(now.getTime() - 6 * hour)
			},

			// Thread 3: Jordan equipment report
			{
				id: randomUUID(),
				threadId: threads[2].id,
				direction: 'inbound' as const,
				body: "Hey, just a heads up that the mic stand in Room B has a stripped threading and won't tighten. It was like that when I arrived for my 2pm session.",
				authorName: 'Jordan Lee',
				createdAt: new Date(now.getTime() - 2 * day)
			},
			{
				id: randomUUID(),
				threadId: threads[2].id,
				direction: 'outbound' as const,
				body: "Thanks for letting us know, Jordan. We'll get that replaced. Sorry for the inconvenience!",
				authorName: adminUser.name,
				authorUserId: adminUser.id,
				createdAt: new Date(now.getTime() - day)
			},
			{
				id: randomUUID(),
				threadId: threads[2].id,
				direction: 'inbound' as const,
				body: 'No worries, I just used Room A instead. Thanks for the quick response!',
				authorName: 'Jordan Lee',
				createdAt: new Date(now.getTime() - 12 * hour)
			},

			// Thread 4: Priya volunteer (resolved)
			{
				id: randomUUID(),
				threadId: threads[3].id,
				direction: 'inbound' as const,
				body: "Hi! I'm interested in volunteering at CorvMC. What opportunities do you have available?",
				authorName: 'Priya Patel',
				createdAt: new Date(now.getTime() - 5 * day)
			},
			{
				id: randomUUID(),
				threadId: threads[3].id,
				direction: 'outbound' as const,
				body: "Hey Priya! We'd love to have you. We have sound engineer, event setup, and front desk volunteer roles. Would any of those interest you?",
				authorName: adminUser.name,
				authorUserId: adminUser.id,
				createdAt: new Date(now.getTime() - 4 * day)
			},
			{
				id: randomUUID(),
				threadId: threads[3].id,
				direction: 'inbound' as const,
				body: 'Sound engineering sounds amazing! How do I get started?',
				authorName: 'Priya Patel',
				createdAt: new Date(now.getTime() - 4 * day + hour)
			},
			{
				id: randomUUID(),
				threadId: threads[3].id,
				direction: 'outbound' as const,
				body: 'Great choice! We run orientation sessions on the first Saturday of each month. Sign up at our events page. See you there!',
				authorName: adminUser.name,
				authorUserId: adminUser.id,
				createdAt: new Date(now.getTime() - 3 * day)
			},

			// Thread 5: SMS about hours
			{
				id: randomUUID(),
				threadId: threads[4].id,
				direction: 'inbound' as const,
				body: "Is the studio open tomorrow? Google says you're closed on Mondays.",
				createdAt: new Date(now.getTime() - hour)
			},

			// Thread 6: portal, still open. authorUserId is what puts the member's
			// own message on their side of the timeline.
			{
				id: randomUUID(),
				threadId: threads[5].id,
				direction: 'inbound' as const,
				body: 'Hi! Does my fob still work after 9pm? I got locked out last Tuesday around 9:30.',
				authorName: memberUser.name,
				authorUserId: memberUser.id,
				createdAt: new Date(now.getTime() - day)
			},
			{
				id: randomUUID(),
				threadId: threads[5].id,
				direction: 'outbound' as const,
				body: "You're all set — your fob works until 11pm on weeknights. Let us know if it gives you trouble.",
				authorName: adminUser.name,
				authorUserId: adminUser.id,
				createdAt: new Date(now.getTime() - 4 * hour)
			},

			// Thread 7: portal, resolved — the member can read it but not reply.
			{
				id: randomUUID(),
				threadId: threads[6].id,
				direction: 'inbound' as const,
				body: 'The amp in Room A is buzzing pretty badly on the clean channel.',
				authorName: memberUser.name,
				authorUserId: memberUser.id,
				createdAt: new Date(now.getTime() - 7 * day)
			},
			{
				id: randomUUID(),
				threadId: threads[6].id,
				direction: 'outbound' as const,
				body: 'Swapped the cable — no buzz now. Thanks for flagging it.',
				authorName: adminUser.name,
				authorUserId: adminUser.id,
				createdAt: new Date(now.getTime() - 6 * day)
			}
		],
		8
	);

	// Add a staff note to thread 3
	const notes = await batchInsert(
		inboxNote,
		[
			{
				id: randomUUID(),
				threadId: threads[2].id,
				authorUserId: adminUser.id,
				body: 'Ordered replacement mic stand from Sweetwater — should arrive Thursday.',
				createdAt: new Date(now.getTime() - 18 * hour)
			}
		],
		1
	);

	// Channels default to disabled, so without these rows the seeded SMS thread
	// opens with a "channel is disabled" banner and a composer that refuses to
	// send — a dead end on a fresh local database.
	await batchInsert(
		inboxChannelConfig,
		[
			{ id: randomUUID(), channel: 'web' as const, enabled: true, config: {} },
			{ id: randomUUID(), channel: 'email' as const, enabled: true, config: {} },
			{ id: randomUUID(), channel: 'sms' as const, enabled: true, config: {} }
		],
		3
	);

	return { threads: threads.length, messages: messages.length, notes: notes.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

const SUGGESTION_SEEDS = [
	{
		title: 'Gear checkout calendar',
		body: "Right now you have to ask in the group chat whether the good SM58s are free. A shared calendar showing what's out and when it's back would save a lot of back-and-forth.",
		category: 'gear_equipment'
	},
	{
		title: 'Sunday afternoon open mic',
		body: 'Evenings are hard for anyone with a kid or an early shift. A 2pm Sunday slot would open the room up to a different crowd.',
		category: 'events_programming'
	},
	{
		title: 'Dark mode on the member portal',
		body: 'Booking a room at 11pm is currently a flashbang. The rest of the site could follow the system theme.',
		category: 'website_tools'
	},
	{
		title: 'Better soundproofing in room B',
		body: "You can hear room A's kick drum through the wall, which makes room B hard to use for anything quiet.",
		category: 'the_space'
	},
	{
		title: 'Publish the board meeting minutes',
		body: 'Members should be able to read what was decided without having to ask. A page with the last year of minutes would do it.',
		category: 'policy'
	},
	{
		title: 'Coffee that is not instant',
		body: 'A french press and a bag of beans from a local roaster. That is the whole suggestion.',
		category: 'other'
	},
	{
		title: 'Repair night once a month',
		body: 'Somebody who can solder, a soldering iron, and a couple of hours. Half the broken cables in the bin are a five-minute fix.',
		category: 'gear_equipment'
	},
	{
		title: 'Loop the sign-up sheet into the website',
		body: 'The paper sheet by the door and the online calendar disagree constantly. Pick one.',
		category: 'website_tools'
	}
] as const;

async function seedSuggestions(users: any[], adminUser: any) {
	console.log('Seeding suggestions...');
	if (users.length < 4) return { total: 0, votes: 0 };

	const voters = users.slice(0, Math.min(users.length, 12));
	const rows: any[] = [];
	const voteRows: { suggestionId: string; userId: string }[] = [];

	/** Give a suggestion `n` distinct voters, deterministically. */
	function addVotes(suggestionId: string, n: number, offset = 0) {
		for (let i = 0; i < Math.min(n, voters.length); i++) {
			voteRows.push({ suggestionId, userId: voters[(i + offset) % voters.length].id });
		}
	}

	// --- On the board, one per lifecycle status so every branch is reachable ---
	const onBoard: Array<{ status: string; response: string | null; votes: number }> = [
		// Paired with SUGGESTION_SEEDS by index, so each reply has to read as an
		// answer to *that* suggestion.
		// 0: gear checkout calendar   1: Sunday open mic
		{ status: 'open', response: null, votes: 11 },
		{ status: 'open', response: null, votes: 6 },
		{
			status: 'planned',
			response: "Good idea. It's on the list for the next round of portal work.",
			votes: 9
		},
		{
			status: 'in_progress',
			response: 'Acoustic panels are ordered. Should be up by the end of the month.',
			votes: 7
		},
		{ status: 'done', response: 'Done as of last week. Thanks for the nudge.', votes: 4 },
		{
			status: 'declined',
			response:
				'We tried this in 2024 and the press went unwashed for a month. Happy to revisit if somebody wants to own keeping it clean.',
			votes: 3
		}
	];

	for (let i = 0; i < onBoard.length; i++) {
		const seed = SUGGESTION_SEEDS[i];
		const spec = onBoard[i];
		// A couple from the admin so a familiar name shows up on the board.
		const author = i % 3 === 0 ? adminUser : users[(i + 1) % users.length];
		const [row] = await db
			.insert(suggestion)
			.values({
				authorUserId: author.id,
				title: seed.title,
				body: seed.body,
				category: seed.category,
				status: spec.status as any,
				visibility: 'visible',
				responseBody: spec.response,
				responseByUserId: spec.response ? adminUser.id : null,
				responseAt: spec.response ? ptDate(-randomInt(2, 20), 10) : null,
				createdAt: ptDate(-randomInt(5, 60), randomInt(9, 20))
			})
			.returning();
		rows.push(row);
		addVotes(row.id, spec.votes, i);
	}

	// --- A merged pair whose voter sets OVERLAP ---
	//
	// This is the row that makes dedup visible in the UI: the target's count is
	// the union of both voter sets, not the sum. Without an overlap you can't
	// tell a correct merge from a broken one by looking.
	const [mergeTarget] = await db
		.insert(suggestion)
		.values({
			authorUserId: users[1].id,
			title: 'Fix the cable situation',
			body: 'A labelled cable rack by the door, and a bin for the dead ones.',
			category: 'gear_equipment',
			visibility: 'visible',
			createdAt: ptDate(-30, 14)
		})
		.returning();
	rows.push(mergeTarget);
	addVotes(mergeTarget.id, 5, 0); // voters 0-4

	const [mergeSource] = await db
		.insert(suggestion)
		.values({
			authorUserId: users[2].id,
			title: 'Cable rack please',
			body: 'Same as the other one — the cable pile has become a hazard.',
			category: 'gear_equipment',
			visibility: 'visible',
			mergedIntoId: mergeTarget.id,
			mergedByUserId: adminUser.id,
			mergedAt: ptDate(-3, 11),
			createdAt: ptDate(-25, 16)
		})
		.returning();
	rows.push(mergeSource);
	// Voters 3-7: three of them (3, 4) already voted on the target above, so the
	// union is 8 and the naive sum would be 10.
	addVotes(mergeSource.id, 5, 3);
	for (let i = 3; i < 8; i++) {
		voteRows.push({ suggestionId: mergeTarget.id, userId: voters[i % voters.length].id });
	}

	// --- Reported, pulled from the board, with the report still open ---
	const reporter = users[3];
	const reportedAuthor = users[4] ?? users[1];
	const [reported] = await db
		.insert(suggestion)
		.values({
			authorUserId: reportedAuthor.id,
			title: "Buy my friend's PA system",
			body: "He is selling it cheap and I get a finder's fee. DM me.",
			category: 'gear_equipment',
			visibility: 'under_review',
			visibilityChangedAt: ptDate(-1, 9),
			createdAt: ptDate(-2, 19)
		})
		.returning();
	rows.push(reported);
	addVotes(reported.id, 1, 6);

	await db.insert(contentFlag).values({
		entityType: 'suggestion',
		entityId: reported.id,
		reportedByUserId: reporter.id,
		reason: 'Self-dealing / advertising',
		description: 'Reads like an ad, and they say outright they get a cut.',
		status: 'pending',
		createdAt: ptDate(-1, 9)
	});

	// --- A member on probation, with a post waiting on staff ---
	//
	// Seeded with an already-upheld flag so "why am I in review?" resolves to a
	// real report rather than a dangling id.
	const probationUser = users[5] ?? users[2];
	const [upheldFlag] = await db
		.insert(contentFlag)
		.values({
			entityType: 'suggestion',
			entityId: rows[0].id,
			reportedByUserId: reporter.id,
			reason: 'Abusive language',
			status: 'resolved',
			resolvedByUserId: adminUser.id,
			resolutionNotes: 'Upheld — please keep it civil.',
			resolvedAt: ptDate(-14, 15),
			createdAt: ptDate(-15, 12)
		})
		.returning();

	await db.insert(memberStanding).values({
		userId: probationUser.id,
		scope: 'suggestion',
		status: 'restricted',
		reason: 'Upheld — please keep it civil.',
		triggeringFlagId: upheldFlag.id,
		updatedByUserId: adminUser.id,
		updatedAt: ptDate(-14, 15)
	});

	const [pending] = await db
		.insert(suggestion)
		.values({
			authorUserId: probationUser.id,
			title: SUGGESTION_SEEDS[6].title,
			body: SUGGESTION_SEEDS[6].body,
			category: SUGGESTION_SEEDS[6].category,
			visibility: 'pending_review',
			visibilityChangedAt: ptDate(-1, 13),
			createdAt: ptDate(-1, 13)
		})
		.returning();
	rows.push(pending);

	// --- A pending edit on a suggestion that already has votes ---
	//
	// The most-voted suggestion, so the staff diff card shows a real "11 members
	// already voted for this" and the before/after has something at stake.
	await db.insert(suggestionEdit).values({
		suggestionId: rows[0].id,
		requestedByUserId: rows[0].authorUserId,
		proposedTitle: 'Gear checkout calendar (and a sign-out sheet)',
		proposedBody:
			"Right now you have to ask in the group chat whether the good SM58s are free. A shared calendar showing what's out and when it's back would save a lot of back-and-forth — plus a paper sheet by the cage for anyone who grabs something on the way in.",
		proposedCategory: 'gear_equipment',
		originalTitle: SUGGESTION_SEEDS[0].title,
		originalBody: SUGGESTION_SEEDS[0].body,
		originalCategory: SUGGESTION_SEEDS[0].category,
		status: 'pending',
		createdAt: ptDate(-1, 15)
	});

	// --- Hidden by staff, with the reason on it ---
	const [hidden] = await db
		.insert(suggestion)
		.values({
			authorUserId: users[2].id,
			title: SUGGESTION_SEEDS[7].title,
			body: SUGGESTION_SEEDS[7].body,
			category: SUGGESTION_SEEDS[7].category,
			visibility: 'hidden',
			visibilityNote: 'Duplicate of an older thread, and the tone got personal.',
			visibilityChangedAt: ptDate(-8, 10),
			visibilityChangedByUserId: adminUser.id,
			createdAt: ptDate(-10, 17)
		})
		.returning();
	rows.push(hidden);

	// Dedupe before insert: the unique index would reject a repeat anyway, and a
	// seed that relies on the DB rejecting its own rows is a seed nobody trusts.
	const seen = new Set<string>();
	const uniqueVotes = voteRows.filter((v) => {
		const key = `${v.suggestionId}:${v.userId}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	await batchInsert(suggestionVote, uniqueVotes);

	return { total: rows.length, votes: uniqueVotes.length, pendingEdits: 1 };
}

// ---------------------------------------------------------------------------
// Directory entries
// ---------------------------------------------------------------------------

/**
 * Derive `directory_entry` and `directory_tag` from everything already seeded,
 * mirroring `scripts/db/backfill/directory-entry.sql` statement for statement.
 *
 * It runs last and reads the tables back rather than being threaded through the
 * dozen places that insert a user or a group, because `pnpm db:reset` replays
 * migrations and then seeds — the backfill script never runs locally or in e2e.
 * Without this, every directory page goes blank the moment phase 3a's readers
 * land, and it reads as a query bug rather than a fixture gap.
 */
async function seedDirectoryEntries() {
	console.log('Seeding directory entries...');

	// Identity and timestamps still come off the subject; everything the listing
	// owns comes from `pendingEntries`, because phase 3c drops those columns.
	const users = await db
		.select({
			id: user.id,
			name: user.name,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
			deletedAt: user.deletedAt
		})
		.from(user);

	const groups = await db
		.select({
			id: group.id,
			name: group.name,
			bio: group.bio,
			avatarKey: group.avatarKey,
			createdAt: group.createdAt,
			updatedAt: group.updatedAt,
			deletedAt: group.deletedAt
		})
		.from(group);

	// `deletedAt` is carried, not reset: an entry that did not follow its
	// deactivated band would put that band back in the public directory.
	const entries = [
		...groups.map((g) => {
			const p = pendingEntries.get(g.id) ?? {};
			return {
				id: randomUUID(),
				groupId: g.id,
				name: g.name,
				// `bio` is a copy that stays canonical on `group`, so it still
				// comes from there. Everything else below moved.
				bio: g.bio,
				tagline: p.tagline ?? null,
				hometown: p.hometown ?? null,
				foundedYear: p.foundedYear ?? null,
				avatarKey: g.avatarKey,
				links: p.links ?? null,
				visibility: p.visibility ?? ('public' as DirectoryVisibility),
				contact: p.contact ?? null,
				lookingFor: p.lookingFor ?? null,
				createdAt: g.createdAt,
				updatedAt: g.updatedAt,
				deletedAt: g.deletedAt
			};
		}),
		// `avatarKey` is deliberately null for a member: their avatar stays
		// `user.image`, which may hold a full OAuth URL rather than an R2 key.
		...users.map((u) => {
			const p = pendingEntries.get(u.id) ?? {};
			return {
				id: randomUUID(),
				userId: u.id,
				name: u.name,
				bio: p.bio ?? null,
				tagline: p.tagline ?? null,
				hometown: p.hometown ?? null,
				links: p.links ?? null,
				visibility: p.visibility ?? ('members' as DirectoryVisibility),
				contact: p.contact ?? null,
				lookingFor: p.lookingFor ?? null,
				availableForHire: p.availableForHire ?? false,
				teachesLessons: p.teachesLessons ?? false,
				openToCollaboration: p.openToCollaboration ?? false,
				createdAt: u.createdAt,
				updatedAt: u.updatedAt,
				deletedAt: u.deletedAt
			};
		})
	];

	// 19 columns × the default batch of 10 is 190 bound parameters, over D1's
	// 100-variable ceiling. 5 × 19 = 95.
	await batchInsert(directoryEntry, entries, 5);

	const byGroup = new Map(entries.filter((e) => 'groupId' in e).map((e: any) => [e.groupId, e.id]));
	const byUser = new Map(entries.filter((e) => 'userId' in e).map((e: any) => [e.userId, e.id]));

	// Deduped through a Set the way the backfill's ON CONFLICT DO NOTHING does:
	// `directory_tag` has a unique index that the three tables it replaced never
	// had, so a subject picked the same genre twice would abort the insert.
	const seen = new Set<string>();
	const tags: { entryId: string; kind: 'genre' | 'instrument'; value: string }[] = [];
	for (const { subjectId, kind, value } of pendingTags) {
		const entryId = byUser.get(subjectId) ?? byGroup.get(subjectId);
		if (!entryId) continue;
		const key = `${entryId}:${kind}:${value}`;
		if (seen.has(key)) continue;
		seen.add(key);
		tags.push({ entryId, kind, value });
	}

	// 3 columns × 30 = 90.
	await batchInsert(directoryTag, tags, 30);

	return { entries: entries.length, tags: tags.length };
}

async function main() {
	console.log('\nStarting dev seed...\n');

	await deleteAll();

	const roles = await seedRoles();
	const adminUser = await seedAdminUser();
	const users = await seedUsers(20);
	await seedUserRoles(users, adminUser, roles);
	const allUsers = [adminUser, ...users];
	const reservations = await seedReservations(allUsers);
	await seedClosures();
	const events = await seedEvents(allUsers);
	const bands = await seedBands(allUsers);
	const bandEvents = await seedBandEvents(bands, allUsers);
	await seedCommunityEvents(users, adminUser);
	await seedCmcEventLineups(events, bands);
	const bandReservations = await seedBandReservations(bands);
	const bandSites = await seedBandSites(bands);
	const pageConfigs = await seedBandPageConfigs(bands, bandSites);
	const series = await seedRecurringSeries(allUsers);
	const payments = await seedPaymentRecords(allUsers, reservations);
	const tickets = await seedTickets(allUsers, events);
	const rsvps = await seedRsvps(allUsers);
	const notifications = await seedNotifications(allUsers);
	const preferences = await seedNotificationPreferences(allUsers);
	await seedCreditTransactions(allUsers);
	const marketing = await seedMarketing(allUsers);
	const eq = await seedEquipment(allUsers);
	const help = await seedHelp();
	const itemArticles = await seedItemArticles();
	const inbox = await seedInbox(adminUser, users[0]);
	const directMessages = await seedDirectMessages(users, adminUser);
	const flags = await seedContentFlags(allUsers, bands, bandEvents);
	const volunteerRoles = await seedVolunteerRoles();
	// Profiles first, and everything downstream is seeded against the members who
	// actually finished onboarding. Hours or a shift signup belonging to somebody
	// with no profile would be invisible to them — /member/volunteer would bounce
	// them to /start before the page rendered.
	const volunteerProfiles = await seedVolunteerProfiles(allUsers, adminUser);
	const activeVolunteers = volunteerProfiles.active;
	const volunteerHours = await seedVolunteerHours(activeVolunteers, volunteerRoles);
	const volunteerInterests = await seedVolunteerInterests(activeVolunteers, volunteerRoles);
	const certifications = await seedCertifications(allUsers, volunteerRoles);
	const volunteerShifts = await seedVolunteerShifts(activeVolunteers, volunteerRoles, events);
	const suggestions = await seedSuggestions(allUsers, adminUser);
	// Last: it reads back every user and group the seed created.
	const directory = await seedDirectoryEntries();

	await db.run(sql`PRAGMA foreign_keys = ON`);

	const premiumBands = bands.filter(
		(b: any) => pendingSites.get(b.id)?.tier === 'premium' && !b.deletedAt
	);
	console.log('\nSeed complete:');
	console.log(`  ${allUsers.length} users (admin: admin@corvallismusic.org / password)`);
	console.log(`  ${roles.length} roles`);
	console.log(`  ${reservations.length} reservations`);
	console.log(`  ${events.length} CMC events`);
	console.log(`  ${bands.length} bands (${premiumBands.length} premium)`);
	console.log(`  ${bandEvents.length} band events`);
	console.log(`  ${bandReservations.length} band reservations`);
	console.log(`  ${bandSites.size} band sites`);
	console.log(`  ${pageConfigs.length} band page configs with EPK data`);
	console.log(`  ${series.length} recurring series`);
	console.log(`  ${payments.length} payment records`);
	console.log(`  ${tickets.length} tickets`);
	console.log(`  ${rsvps.length} RSVPs`);
	console.log(`  ${notifications.length} notifications`);
	console.log(`  ${preferences.length} notification preferences`);
	console.log(
		`  ${marketing.audiences} audiences, ${marketing.subscribers} subscribers, ${marketing.campaigns} campaigns`
	);
	console.log(
		`  ${eq.categories} categories, ${eq.locations} locations, ${eq.items} items, ${eq.assets} units,\n` +
			`  ${eq.acquisitions} acquisitions, ${eq.movements} stock movements, ${eq.loans} loans`
	);
	console.log(
		`  ${help.categories} help categories, ${help.articles} help articles, ${itemArticles.links} linked to gear`
	);
	console.log(`  ${directory.entries} directory entries, ${directory.tags} directory tags`);
	console.log(`  ${inbox.threads} inbox threads, ${inbox.messages} messages, ${inbox.notes} notes`);
	console.log(
		`  ${directMessages.threads} direct conversations, ${directMessages.blocks} blocks, ${directMessages.standings} messaging standings, 1 member-set messaging preference`
	);
	console.log(`  ${flags.length} content flags`);
	console.log(
		`  ${volunteerRoles.length} volunteer roles, ${volunteerProfiles.rows.length} volunteer profiles (${volunteerProfiles.blocked} awaiting review), ${volunteerHours.length} volunteer hour logs, ${volunteerInterests.length} role interests`
	);
	console.log(
		`  ${certifications.certs} certifications (${certifications.held} held), ${volunteerShifts.shifts} shifts, ${volunteerShifts.signups} signups, ${volunteerShifts.feedback} feedback`
	);
	console.log(
		`  ${suggestions.total} suggestions (${suggestions.votes} votes, ${suggestions.pendingEdits} edit awaiting review)`
	);
	console.log('\n  Premium band pages available at:');
	for (const b of premiumBands) {
		console.log(`    http://localhost:5173/?__band_subdomain=${b.slug}`);
	}

	await dispose();
}

// ---------------------------------------------------------------------------
// Volunteering
// ---------------------------------------------------------------------------

// `defaultDurationMinutes` / `defaultCapacity` are what the New Shift form starts
// with, so they are only set on the roles that really are scheduled as shifts —
// leaving the committee roles blank exercises the fallback path too.
const VOLUNTEER_ROLE_SEEDS: Array<{
	name: string;
	description: string;
	group: 'at-shows' | 'away-from-shows' | 'committee';
	displayOrder: number;
	isActive?: boolean;
	defaultDurationMinutes?: number;
	defaultCapacity?: number;
}> = [
	{
		name: 'Sound Engineering',
		group: 'at-shows' as const,
		description:
			'Run the board for a show or open mic. Line check, monitor mixes, and a house mix that respects the room.\n\n**No experience needed** — we will train you on the desk before you fly solo.',
		displayOrder: 10,
		defaultDurationMinutes: 300,
		defaultCapacity: 1
	},
	{
		name: 'Event Setup',
		group: 'at-shows' as const,
		description:
			'Get the room ready before doors: chairs, tables, PA, stage lighting, and the merch table.\n\nUsually a two-hour window starting three hours before the show.',
		displayOrder: 20,
		defaultDurationMinutes: 120,
		defaultCapacity: 3
	},
	{
		name: 'Front Desk',
		group: 'at-shows' as const,
		description:
			'Cover the door during open hours or at a show. Greet people, take entry, answer questions about membership, and point folks at the practice room.',
		displayOrder: 30,
		defaultDurationMinutes: 240,
		defaultCapacity: 2
	},
	{
		name: 'Load-Out & Teardown',
		group: 'at-shows' as const,
		description:
			'After the last set: strike the stage, coil cables, reset the floor, and take the trash out. The fastest way to make yourself indispensable.',
		displayOrder: 40,
		defaultDurationMinutes: 90,
		defaultCapacity: 4
	},
	{
		name: 'Facilities & Maintenance',
		group: 'away-from-shows' as const,
		description:
			'Keep the space working — patch drywall, swap bulbs, restring the loaner guitars, fix the door that sticks.\n\nBring whatever skills you have; there is always something.',
		displayOrder: 50
	},
	{
		name: 'Outreach & Tabling',
		group: 'away-from-shows' as const,
		description:
			'Represent CMC at the farmers market, campus events, and other venues. Hand out info, talk to musicians, sign people up.',
		displayOrder: 60
	},
	{
		name: 'Administration',
		group: 'committee' as const,
		description:
			'Behind-the-scenes work: data entry, grant paperwork, scheduling, and answering the inbox.',
		displayOrder: 70
	},
	{
		// Archived so the restore path and the "archived roles still resolve in
		// reports" behaviour both have coverage on a fresh seed.
		name: 'Zine & Print',
		group: 'committee' as const,
		description: 'Layout and printing for the quarterly zine. On hiatus while we rethink the run.',
		displayOrder: 80,
		isActive: false
	}
];

const VOLUNTEER_DESCRIPTIONS = [
	'Ran sound for the Thursday open mic',
	'Set up chairs and PA for the all-ages show',
	'Front desk during afternoon open hours',
	'Load-out and floor reset after the show',
	'Restrung and cleaned the loaner guitars',
	'Tabled at the farmers market',
	'Sorted and labelled the cable bin',
	'Covered the door for the benefit gig',
	'Monitor mixes for the four-band bill',
	'Patched and repainted the green room wall',
	'Entered new member signups from the show',
	'Hauled the backline over from storage'
];

const VOLUNTEER_REJECT_NOTES = [
	'This looks like a duplicate of the log you filed the same day — resubmit just the one.',
	'We had you down for two hours on this, not five. Log the corrected time and we will approve it.',
	'Practice time is not volunteer time, but thanks for pitching in on the reset afterward — log that part.',
	'No record of this shift. Check the date and resubmit.'
];

async function seedVolunteerRoles() {
	console.log('Seeding volunteer roles...');
	return batchInsert(volunteerRole, VOLUNTEER_ROLE_SEEDS);
}

const VOLUNTEER_AVAILABILITY = [
	'Weekday evenings, and most Saturdays.',
	'Anytime after 5pm. Weekends are easiest.',
	'Sunday afternoons only — I work six days.',
	'Flexible, just give me a few days notice.',
	'Fridays and Saturdays, load-out included.',
	null,
	null
];

/**
 * Volunteer profiles, and the gate they control.
 *
 * Deliberately not one per member: the last two users are left without a profile
 * so the onboarding flow is reachable on a fresh seed instead of only ever being
 * testable by hand-deleting a row.
 *
 * The minors are the point of the table, so both sides of the override are
 * represented — two waiting in the staff queue, and one already cleared, which
 * still reads as a minor because approval moves `status` and leaves `isAdult`
 * alone. Same philosophy as the deliberately-archived role above.
 */
async function seedVolunteerProfiles(users: any[], reviewer: any) {
	console.log('Seeding volunteer profiles...');
	if (users.length < 4) return { rows: [], active: users, blocked: 0 };

	// Reserved as "hasn't signed up to volunteer yet".
	const notOnboarded = users.slice(-2);
	const onboarded = users.slice(0, -2);

	// Minors are picked from the front of the list rather than at random so a
	// fresh seed always has the same three to click through.
	const blockedMinors = onboarded.slice(1, 3);
	const approvedMinor = onboarded[3];
	const now = new Date();
	const day = 86_400_000;

	const rows = onboarded.map((u, i) => {
		const [first = u.name, ...rest] = String(u.name).trim().split(/\s+/);
		const isBlockedMinor = blockedMinors.includes(u);
		const isApprovedMinor = u === approvedMinor;
		const isAdult = !isBlockedMinor && !isApprovedMinor;

		return {
			id: randomUUID(),
			userId: u.id,
			firstName: first,
			lastName: rest.join(' ') || 'Member',
			isAdult,
			status: isBlockedMinor ? 'blocked' : 'active',
			// A blocked minor never reached the interests step, so no note either.
			availability: isBlockedMinor ? null : pick(VOLUNTEER_AVAILABILITY),
			approvedByUserId: isApprovedMinor ? reviewer.id : null,
			approvedAt: isApprovedMinor ? new Date(now.getTime() - 3 * day) : null,
			createdAt: new Date(now.getTime() - (i + 1) * day)
		};
	});

	// 11 columns × the default batch of 10 is 110 bound parameters, over D1's
	// 100-variable ceiling for a single statement. 8 × 11 = 88.
	const inserted = await batchInsert(volunteerProfile, rows, 8);

	const blockedIds = new Set(blockedMinors.map((u) => u.id));
	return {
		rows: inserted,
		active: users.filter((u) => !blockedIds.has(u.id) && !notOnboarded.includes(u)),
		blocked: blockedMinors.length
	};
}

/**
 * Standing "I'd help with this" marks. About a third of members put their hand
 * up for something — enough for the staff interest page to have rows and for
 * the per-role filter to actually narrow, without every member matching every
 * role and making the filter look broken.
 */
async function seedVolunteerInterests(users: any[], roles: any[]) {
	console.log('Seeding volunteer role interests...');
	const liveRoles = roles.filter((r: any) => r.isActive !== false);
	if (liveRoles.length === 0 || users.length === 0) return [];

	const rows = users
		.filter(() => Math.random() < 0.35)
		.flatMap((u: any) =>
			pickN(liveRoles, randomInt(1, 3)).map((role: any) => ({
				id: randomUUID(),
				userId: u.id,
				volunteerRoleId: role.id
			}))
		);

	return batchInsert(volunteerRoleInterest, rows);
}

/**
 * A small certification catalog with every derived state represented: one
 * internal clearance that never lapses, one external card with holders who are
 * current, expiring inside the warning window, and lapsed — so the clearances
 * view has all its tabs populated on a fresh seed.
 */
async function seedCertifications(users: any[], roles: any[]) {
	console.log('Seeding certifications...');
	const now = new Date();
	const day = 86_400_000;

	const [deskCert, foodCert] = await batchInsert(volunteerCertification, [
		{
			id: randomUUID(),
			name: 'Sound Desk Cleared',
			description:
				'Cleared to run the desk unsupervised. Ask a staff engineer to sign you off after two shadowed shifts.',
			issuedBy: null,
			validityMonths: null,
			displayOrder: 10
		},
		{
			id: randomUUID(),
			name: 'Food Handler',
			description: 'Oregon Food Handler card, required for concessions.',
			issuedBy: 'Oregon Health Authority',
			validityMonths: 36,
			displayOrder: 20
		}
	]);

	// Sound Engineering requires the desk clearance, so the member shift board
	// has a visibly gated role out of the box.
	const soundRole = roles.find((r: any) => r.name === 'Sound Engineering');
	if (soundRole) {
		await db
			.insert(volunteerRoleCertification)
			.values({ volunteerRoleId: soundRole.id, certificationId: deskCert.id });
	}

	const holders = pickN(users, Math.min(6, users.length));
	const held = await batchInsert(
		memberCertification,
		holders.flatMap((u: any, i: number) => {
			const rows: any[] = [
				{
					id: randomUUID(),
					userId: u.id,
					certificationId: deskCert.id,
					grantedAt: new Date(now.getTime() - (30 + i * 10) * day),
					expiresAt: null
				}
			];
			// Rotate the card states: current / expiring soon / lapsed.
			const granted = new Date(now.getTime() - 300 * day);
			const expires =
				i % 3 === 0
					? new Date(now.getTime() + 400 * day)
					: i % 3 === 1
						? new Date(now.getTime() + 30 * day)
						: new Date(now.getTime() - 20 * day);
			rows.push({
				id: randomUUID(),
				userId: u.id,
				certificationId: foodCert.id,
				grantedAt: granted,
				expiresAt: expires
			});
			return rows;
		})
	);

	return { certs: 2, held: held.length };
}

/**
 * A fortnight of shifts either side of today: past ones completed with
 * feedback, today's confirmed, upcoming ones part-claimed so the staff list
 * shows real needed-vs-claimed numbers and the member board has things to take.
 */
async function seedVolunteerShifts(users: any[], roles: any[], events: SeedEvent[]) {
	console.log('Seeding volunteer shifts...');
	const liveRoles = roles.filter((r: any) => r.isActive !== false);
	if (liveRoles.length === 0 || users.length === 0) return { shifts: 0, signups: 0, feedback: 0 };

	const now = new Date();
	const day = 86_400_000;
	const at = (daysOffset: number, hour: number) => {
		const d = new Date(now.getTime() + daysOffset * day);
		d.setHours(hour, 0, 0, 0);
		return d;
	};

	// Most volunteer shifts staff a show, so most of the seeded ones carry an
	// event — but not all of them. Work parties and gear-repair days are why
	// `eventId` is nullable, and both branches of every "linked to an event?"
	// check need data or nobody sees the unlinked rendering until production.
	//
	// Attached shifts take their times *from the show*, half an hour before doors
	// through the end of the night. A shift pointing at a gig on some other
	// evening would be worse than no link at all.
	const published = events.filter((e) => e.status === 'published');
	const pastShows = published.filter((e) => e.startsAt < now);
	const futureShows = published.filter((e) => e.startsAt >= now);

	const shiftRows = await batchInsert(
		volunteerShift,
		[-10, -7, -4, -2, 1, 2, 4, 6, 8, 11].map((offset, i) => {
			// Every third shift is deliberately left unattached.
			const pool = offset < 0 ? pastShows : futureShows;
			const show = i % 3 === 2 ? undefined : pool[Math.floor(i / 3) % (pool.length || 1)];

			const startsAt = show ? new Date(show.startsAt.getTime() - 30 * 60_000) : at(offset, 18);
			const endsAt = show
				? (show.endsAt ?? new Date(show.startsAt.getTime() + 4 * 3_600_000))
				: at(offset, 22);

			return {
				id: randomUUID(),
				volunteerRoleId: pick(liveRoles).id,
				eventId: show?.id ?? null,
				startsAt,
				endsAt,
				capacity: 1 + (i % 3),
				notes: i % 2 === 0 ? 'Meet at the side door 15 minutes early.' : null
			};
		}),
		// One more bound column per row than this insert used to carry, and D1 caps
		// a statement at 100 parameters.
		8
	);

	const signupRows: any[] = [];
	const feedbackRows: any[] = [];
	for (const shift of shiftRows) {
		const isPast = shift.startsAt < now;
		const takers = pickN(users, Math.min(shift.capacity, users.length));
		for (const [i, u] of takers.entries()) {
			const signupId = randomUUID();
			// Upcoming shifts mix claimed and confirmed; past ones completed, with
			// the occasional no-show so the detail view shows the whole vocabulary.
			const status = isPast
				? i === 0 && Math.random() < 0.2
					? 'no_show'
					: 'completed'
				: i === 0
					? 'confirmed'
					: 'claimed';
			signupRows.push({
				id: signupId,
				shiftId: shift.id,
				userId: u.id,
				status,
				claimedAt: new Date(shift.startsAt.getTime() - 5 * day),
				confirmedAt: status === 'claimed' ? null : new Date(shift.startsAt.getTime() - 4 * day),
				completedAt: status === 'completed' ? shift.endsAt : null
			});
			if (status === 'completed' && Math.random() < 0.7) {
				feedbackRows.push({
					id: randomUUID(),
					signupId,
					rating: 3 + Math.floor(Math.random() * 3),
					wasSetUp: Math.random() < 0.75,
					comment:
						Math.random() < 0.5
							? pick([
									'Smooth night, good crowd.',
									'Could use a checklist by the door.',
									'Nobody told me where the float was kept.',
									'More gaff tape by the desk, please.'
								])
							: null,
					submittedAt: new Date(shift.endsAt.getTime() + day)
				});
			}
		}
	}

	// 8 cols x default 10 rows = 80 bound params — inside D1's 100 ceiling, but
	// batch smaller anyway to stay clear of drizzle's own additions.
	const signups = await batchInsert(volunteerSignup, signupRows, 8);
	const feedback = await batchInsert(volunteerShiftFeedback, feedbackRows, 8);

	return { shifts: shiftRows.length, signups: signups.length, feedback: feedback.length };
}

async function seedVolunteerHours(users: any[], roles: any[]) {
	console.log('Seeding volunteer hour logs...');
	if (roles.length === 0 || users.length === 0) return [];

	// Weighted so the queue has real work on first load, and the report has
	// enough approved history to be worth opening.
	const STATUS_MIX = [
		...Array(10).fill('pending'),
		...Array(36).fill('approved'),
		...Array(4).fill('rejected')
	] as const;

	const volunteers = pickN(users, Math.min(10, users.length));
	const reviewer = users[0];
	const archivedRole = roles.find((r: any) => !r.isActive);
	const activeRoles = roles.filter((r: any) => r.isActive);

	const values = STATUS_MIX.map((status, i) => {
		// A few logs against the archived role, so the report has to prove it
		// still resolves retired roles.
		const role = archivedRole && i % 17 === 0 ? archivedRole : pick(activeRoles);
		const workedOn = ptDate(-randomInt(1, 180), 12);
		const reviewed = status !== 'pending';

		return {
			userId: pick(volunteers).id,
			volunteerRoleId: role.id,
			shiftId: null,
			workedOn,
			minutes: pick([60, 90, 120, 180, 240, 300]),
			description: pick(VOLUNTEER_DESCRIPTIONS),
			status,
			reviewedByUserId: reviewed ? reviewer.id : null,
			reviewedAt: reviewed ? new Date(workedOn.getTime() + 2 * 24 * 60 * 60 * 1000) : null,
			reviewNotes: status === 'rejected' ? pick(VOLUNTEER_REJECT_NOTES) : null
		};
	});

	// 13 columns × the default batch of 10 is 130 bound parameters, over D1's
	// 100-variable ceiling for a single statement. 7 × 13 = 91.
	return batchInsert(volunteerHourLog, values, 7);
}

async function seedContentFlags(users: any[], bands: any[], bandEvents: any[] = []) {
	console.log('Seeding content flags...');
	const REASONS = [
		'Inappropriate language in bio',
		'Possible impersonation',
		'Spam links in profile',
		'Offensive band name',
		'Outdated / misleading info'
	];
	const STATUSES = ['pending', 'pending', 'pending', 'resolved', 'dismissed'] as const;
	const rows = [];

	for (let i = 0; i < 5; i++) {
		const reporter = users[i % users.length];
		const flagBand = i % 2 === 0 && bands.length > 0;
		const target = flagBand ? pick(bands) : pick(users.filter((u) => u.id !== reporter.id));
		const status = STATUSES[i];
		const resolved = status !== 'pending';

		const [row] = await db
			.insert(contentFlag)
			.values({
				entityType: flagBand ? 'band_profile' : 'member_profile',
				entityId: target.id,
				reportedByUserId: reporter.id,
				reason: REASONS[i],
				description: i % 3 === 0 ? 'Flagged via the directory report button.' : null,
				status,
				resolvedByUserId: resolved ? users[0].id : null,
				resolutionNotes: resolved
					? status === 'resolved'
						? 'Content edited.'
						: 'No action needed.'
					: null,
				resolvedAt: resolved ? new Date() : null
			})
			.returning();
		rows.push(row);
	}

	// Event listing flags: reportable by anyone (Turnstile-gated), so include an
	// anonymous report alongside a member report and a resolved-with-note row.
	const published = bandEvents.filter((e) => e.status === 'published');
	const EVENT_FLAGS = [
		{
			reporter: users[1] ?? users[0],
			reason: 'Event is not real',
			description: null,
			status: 'pending' as const
		},
		{
			reporter: users[2] ?? users[0],
			reason: 'Offensive poster art',
			description: null,
			status: 'resolved' as const
		},
		// Anonymous report — requires the nullable reported_by_user_id migration.
		{
			reporter: null,
			reason: 'Misleading ticket link',
			description: 'The tickets button goes to an unrelated site.',
			status: 'pending' as const
		}
	];

	for (let i = 0; i < EVENT_FLAGS.length && i < published.length; i++) {
		const f = EVENT_FLAGS[i];
		const resolved = f.status !== 'pending';
		const [row] = await db
			.insert(contentFlag)
			.values({
				entityType: 'event',
				entityId: published[i].id,
				reportedByUserId: f.reporter?.id ?? null,
				reason: f.reason,
				description: f.description,
				status: f.status,
				resolvedByUserId: resolved ? users[0].id : null,
				resolutionNotes: resolved ? 'Event unpublished; band notified.' : null,
				resolvedAt: resolved ? new Date() : null
			})
			.returning();
		rows.push(row);
	}

	return rows;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
