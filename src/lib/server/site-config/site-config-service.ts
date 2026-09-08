import { getJson, putJson } from '$lib/server/kv';
import { DomainError } from '$lib/server/domain-error';

/** The caller asked for a config key that is not in the registry. */
export class UnknownSiteConfigKeyError extends DomainError {
	readonly httpStatus = 400;

	constructor(key: string) {
		super(`Unknown site config key: ${key}`);
	}
}

const KV_PREFIX = 'site-config:';

// ---------------------------------------------------------------------------
// Defaults — used when no KV entry exists for a key
// ---------------------------------------------------------------------------

// Exported so `feature-flags.spec.ts` can assert every FeatureFlag has a
// default here and vice versa — the two lists drifting is what left the
// Content Flags toggle throwing a 400.
export const DEFAULTS: Record<string, string | number | boolean> = {
	'reservation.operatingHoursStart': '09:00',
	'reservation.operatingHoursEnd': '22:00',
	'reservation.minDurationHours': 1,
	'reservation.maxDurationHours': 8,
	'reservation.timeSlotMinutes': 30,
	'reservation.bufferMinutes': 0,
	'reservation.maxAdvanceDaysOneoff': 14,
	'reservation.maxAdvanceDaysRecurring': 17.5,
	// Written by `updateReservationSettings` but absent here until now, so
	// `config('reservation.minAdvanceMinutes')` threw Unknown site config key.
	// It worked only because `reservation/config.ts` supplies its own fallback.
	'reservation.minAdvanceMinutes': 60,
	'reservation.hourlyRateCents': 1500,
	// Teaching terms. The rate is not a discount on the one above — it is what a
	// sustaining member's contribution already buys, with the monthly cap lifted.
	'reservation.teachingRateCents': 500,
	'reservation.teachingMinDurationHours': 0.5,
	'reservation.teachingMaxAdvanceDaysOneoff': 60,
	'reservation.teachingMaxAdvanceDaysRecurring': 90,

	// What an hour of donated time is worth, for grant applications and impact
	// reports. This is the *impact* rate and it covers every approved hour;
	// recognizable contributed services under FASB are a different, narrower
	// number carried per-role, and the two are never summed.
	//
	// Independent Sector republishes every April, so this is runtime config
	// rather than a constant -- a hardcoded figure is wrong within a year, and
	// the annual refresh should be a settings edit rather than a deploy. Oregon
	// rather than the national $36.14, because the state runs above it. Read off
	// the 2026 report's state table, whose 2025 column is marked preliminary;
	// note it is NOT the $36.44 a state calculator will quote you, which is that
	// table's 2024 column.
	'volunteer.hourValueCents': 3766,
	// Cited in the report itself. A funder-facing number whose provenance is not
	// on the page cannot be defended, and the citation has to move with the
	// figure or it silently starts describing the wrong year.
	'volunteer.hourValueSource': 'Independent Sector, Oregon, 2025 (2026 report, preliminary)',

	// How many inputs the desk in the practice room can actually take.
	//
	// Runtime config rather than a constant because it is a fact about a piece of
	// gear, and the gear gets replaced: a rider that over-specs the room is the
	// thing Production asked to be able to flag ("what the room cannot do", in
	// `committees-and-roles-spec.md`), and an answer that needs a deploy to
	// correct is one that will quietly go wrong the first time the console does.
	// Zero disables the check rather than failing every rider.
	'venue.consoleChannels': 16,

	'org.name': 'Corvallis Music Collective',
	'org.shortName': 'CorvMC',
	'org.contactEmail': 'staff@corvmc.org',
	'org.timezone': 'America/Los_Angeles',

	'org.addressStreet': '6775 SW Philomath Blvd',
	'org.addressCity': 'Corvallis',
	'org.addressState': 'OR',
	'org.addressZip': '97333',

	'org.socialFacebook': '',
	'org.socialInstagram': '',

	'integration.utec.clientId': '',
	'integration.utec.clientSecret': '',
	'integration.utec.deviceId': '',
	'integration.utec.refreshToken': '',

	// Flags gate the member, band and public surfaces only — the staff panel
	// always shows every feature — so they all start off.
	'feature.directMessages': false,
	'feature.bandAudio': false,
	'feature.cmcRadio': false
	// A flag missing from here makes `config()` *throw* `Unknown site config key`
	// rather than return false, which is why registering it in both places is one
	// step and `feature-flags.spec.ts` asserts the set both ways.
};

export type SiteConfigKey = keyof typeof DEFAULTS;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * How long a colo may serve a config key from its edge cache.
 *
 * Longer than KV's 60-second default because these change on a staff form
 * submit rather than on a request. Note this stacks on top of the isolate memo
 * below, so a memoized key's worst-case staleness is the sum of the two, not
 * the larger — which is why the exempt prefix stays on KV's default (60s is
 * also the floor; KV rejects less).
 */
const KV_CACHE_TTL_SECONDS = 300;
const KV_CACHE_TTL_EXEMPT_SECONDS = 60;

/**
 * How long this isolate may serve a config value from memory.
 *
 * An isolate handles many requests, so this is what turns a fifteen-key prefix
 * read into roughly one KV read per key per isolate per minute. The cost is
 * staleness: a write in one isolate cannot clear another isolate's copy, so a
 * changed value takes up to this long to reach every colo.
 */
const MEMO_TTL_MS = 60_000;

/**
 * Feature flags are exempt from the memo, and it is staleness that decides it
 * rather than read cost. Nobody watches a room rate take effect; a staff member
 * who toggles a flag and sees nothing happen does, and reads it as a bug.
 *
 * This does not make a flag instant — KV's own edge cache was always in front
 * of it. What the exemption buys is that flags keep the ~60s they already had
 * instead of compounding a second cache on top.
 */
const MEMO_EXEMPT_PREFIX = 'feature.';

type ConfigValue = string | number | boolean;

const memo = new Map<string, { value: ConfigValue | null; expiresAt: number }>();

/**
 * Test-only. The memo is module state, so it outlives a spec's `beforeEach` and
 * would serve one test's writes to the next.
 */
export function clearSiteConfigMemo(): void {
	memo.clear();
}

/** The stored override for a key, or null when nothing has been written. */
async function readStored(key: string): Promise<ConfigValue | null> {
	const memoizable = !key.startsWith(MEMO_EXEMPT_PREFIX);

	if (memoizable) {
		const hit = memo.get(key);
		if (hit && hit.expiresAt > Date.now()) return hit.value;
	}

	const value = await getJson<ConfigValue>(`${KV_PREFIX}${key}`, {
		cacheTtl: memoizable ? KV_CACHE_TTL_SECONDS : KV_CACHE_TTL_EXEMPT_SECONDS
	});

	if (memoizable) memo.set(key, { value, expiresAt: Date.now() + MEMO_TTL_MS });

	return value;
}

export async function config<T extends string | number | boolean = string | number | boolean>(
	key: string
): Promise<T> {
	const value = await readStored(key);
	if (value !== null) return value as T;

	const fallback = DEFAULTS[key];
	if (fallback !== undefined) return fallback as T;

	throw new UnknownSiteConfigKeyError(key);
}

/** @deprecated Use config() instead */
export const getSiteConfig = config;

/**
 * Every key under a prefix, defaults overlaid with whatever KV holds.
 *
 * This used to ask KV `list()` which keys existed and then fetch them one at a
 * time. Both halves were wrong. `DEFAULTS` already enumerates every legal key —
 * it is what `config()` throws `UnknownSiteConfigKeyError` against — so KV was
 * being asked a question it is not the authority for, and a `list()` does not
 * edge-cache the way a `get()` does. The consequence of fixing it: a key stored
 * in KV but absent from `DEFAULTS` is no longer surfaced here. Nothing writes
 * one, because `updateSiteConfig` is only ever called with registered keys.
 */
export async function getConfigsByPrefix(
	prefix: string
): Promise<Record<string, string | number | boolean>> {
	const keys = Object.keys(DEFAULTS).filter((key) => key.startsWith(`${prefix}.`));
	const stored = await Promise.all(keys.map(readStored));

	const result: Record<string, string | number | boolean> = {};
	keys.forEach((key, i) => {
		// `??` rather than `||`: `false` and `0` are legitimate stored values.
		result[key.slice(prefix.length + 1)] = stored[i] ?? DEFAULTS[key];
	});

	return result;
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

export async function updateSiteConfig(
	key: string,
	value: string | number | boolean
): Promise<void> {
	await putJson(`${KV_PREFIX}${key}`, value);
	memo.delete(key);
}

/**
 * Concurrent rather than sequential. KV has no batch put, so a partial failure
 * was always possible and still is — now in nondeterministic order, which is
 * acceptable for a settings form and would not be for a ledger.
 */
export async function updateSiteConfigs(
	entries: Array<{ key: string; value: string | number }>
): Promise<void> {
	await Promise.all(entries.map((entry) => updateSiteConfig(entry.key, entry.value)));
}
