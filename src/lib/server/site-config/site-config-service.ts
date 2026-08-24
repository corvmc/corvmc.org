import { getJson, putJson, listKeys } from '$lib/server/kv';

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
	'reservation.hourlyRateCents': 1500,

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
	'feature.staffInbox': false,
	'feature.bandPremium': false,
	'feature.emailMarketing': false,
	'feature.equipment': false,
	'feature.helpArticles': false,
	'feature.contentFlags': false,
	'feature.directMessages': false,
	'feature.volunteering': false
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

	throw new Error(`Unknown site config key: ${key}`);
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
