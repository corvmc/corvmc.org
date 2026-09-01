import { getJson, putJson, listKeys } from '$lib/server/kv';
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
	'feature.bandPremium': false,
	'feature.emailMarketing': false,
	'feature.helpArticles': false,
	'feature.contentFlags': false,
	'feature.directMessages': false,
	'feature.volunteering': false,
	// A flag missing from here makes `config()` *throw* `Unknown site config key`
	// rather than return false, which is why registering it in all three places
	// is one step and `feature-flags.spec.ts` asserts the set both ways.
	'feature.groups': false,
	'feature.groupEvents': false,
	'feature.announcements': false
};

export type SiteConfigKey = keyof typeof DEFAULTS;

// ---------------------------------------------------------------------------
// Core access
// ---------------------------------------------------------------------------

export async function config<T extends string | number | boolean = string | number | boolean>(
	key: string
): Promise<T> {
	const value = await getJson<T>(`${KV_PREFIX}${key}`);
	if (value !== null) return value;

	const fallback = DEFAULTS[key];
	if (fallback !== undefined) return fallback as T;

	throw new UnknownSiteConfigKeyError(key);
}

/** @deprecated Use config() instead */
export const getSiteConfig = config;

export async function getConfigsByPrefix(
	prefix: string
): Promise<Record<string, string | number | boolean>> {
	const result: Record<string, string | number | boolean> = {};

	for (const [key, value] of Object.entries(DEFAULTS)) {
		if (key.startsWith(`${prefix}.`)) {
			const shortKey = key.slice(prefix.length + 1);
			result[shortKey] = value;
		}
	}

	const kvKeys = await listKeys(`${KV_PREFIX}${prefix}.`);
	for (const kvKey of kvKeys) {
		const configKey = kvKey.slice(KV_PREFIX.length);
		const shortKey = configKey.slice(prefix.length + 1);
		const value = await getJson<string | number | boolean>(kvKey);
		if (value !== null) result[shortKey] = value;
	}

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
}

export async function updateSiteConfigs(
	entries: Array<{ key: string; value: string | number }>
): Promise<void> {
	for (const entry of entries) {
		await updateSiteConfig(entry.key, entry.value);
	}
}
