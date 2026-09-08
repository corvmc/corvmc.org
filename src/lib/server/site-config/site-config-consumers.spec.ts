import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULTS } from './site-config-service';

/**
 * Every registered key is one something reads.
 *
 * A key nothing consumes renders a staff field that saves into KV and changes
 * nothing, which the next person to need that setting will trust. A grep does
 * not settle it either way: a prefix read never names the full key.
 */

/**
 * Key → the module that reads it. Verified below only as far as the prefix,
 * since a prefix read cannot prove which suffixes it uses; the `org` key set
 * is pinned exactly in `site-config-service.spec.ts`.
 */
const READERS: Record<string, string> = {
	'reservation.operatingHoursStart': 'src/lib/server/reservation/config.ts',
	'reservation.operatingHoursEnd': 'src/lib/server/reservation/config.ts',
	'reservation.minDurationHours': 'src/lib/server/reservation/config.ts',
	'reservation.maxDurationHours': 'src/lib/server/reservation/config.ts',
	'reservation.timeSlotMinutes': 'src/lib/server/reservation/config.ts',
	'reservation.bufferMinutes': 'src/lib/server/reservation/config.ts',
	'reservation.maxAdvanceDaysOneoff': 'src/lib/server/reservation/config.ts',
	'reservation.maxAdvanceDaysRecurring': 'src/lib/server/reservation/config.ts',
	'reservation.minAdvanceMinutes': 'src/lib/server/reservation/config.ts',
	'reservation.hourlyRateCents': 'src/lib/server/reservation/config.ts',
	'reservation.teachingRateCents': 'src/lib/server/reservation/config.ts',
	'reservation.teachingMinDurationHours': 'src/lib/server/reservation/config.ts',
	'reservation.teachingMaxAdvanceDaysOneoff': 'src/lib/server/reservation/config.ts',
	'reservation.teachingMaxAdvanceDaysRecurring': 'src/lib/server/reservation/config.ts',

	'volunteer.hourValueCents': 'src/lib/server/volunteer/hour-value.ts',
	'volunteer.hourValueSource': 'src/lib/server/volunteer/hour-value.ts',

	'venue.consoleChannels': 'src/lib/remote/rider.remote.ts',

	// The footer and /contact, via `getConfigsByPrefix('org')`.
	'org.addressStreet': 'src/lib/remote/settings.remote.ts',
	'org.addressCity': 'src/lib/remote/settings.remote.ts',
	'org.addressState': 'src/lib/remote/settings.remote.ts',
	'org.addressZip': 'src/lib/remote/settings.remote.ts',
	'org.socialFacebook': 'src/lib/remote/settings.remote.ts',
	'org.socialInstagram': 'src/lib/remote/settings.remote.ts',

	'integration.utec.clientId': 'src/lib/server/lock/ultraloc-client.ts',
	'integration.utec.clientSecret': 'src/lib/server/lock/ultraloc-client.ts',
	'integration.utec.deviceId': 'src/lib/server/lock/ultraloc-client.ts',
	'integration.utec.refreshToken': 'src/lib/server/lock/ultraloc-client.ts',

	'feature.directMessages': 'src/lib/server/feature-flags.ts',
	'feature.bandAudio': 'src/lib/server/feature-flags.ts',
	'feature.cmcRadio': 'src/lib/server/feature-flags.ts'
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A `config('key')` call, or a `getConfigsByPrefix()` covering it. */
function reads(text: string, key: string): boolean {
	if (new RegExp(`config(?:<[^>]*>)?\\(\\s*['"\`]${escape(key)}['"\`]`).test(text)) return true;

	const parts = key.split('.');
	return parts
		.slice(0, -1)
		.some((_, i) =>
			new RegExp(
				`getConfigsByPrefix\\(\\s*['"\`]${escape(parts.slice(0, i + 1).join('.'))}['"\`]`
			).test(text)
		);
}

describe('site config consumers', () => {
	it('declares a reader for every registered key, and no others', () => {
		expect(Object.keys(READERS).sort()).toEqual(Object.keys(DEFAULTS).sort());
	});

	it.each(Object.entries(READERS))('%s is read by its declared module', (key, reader) => {
		const path = join(process.cwd(), reader);
		expect(existsSync(path), `${reader} does not exist`).toBe(true);
		expect(reads(readFileSync(path, 'utf8'), key), `${reader} does not read ${key}`).toBe(true);
	});
});
