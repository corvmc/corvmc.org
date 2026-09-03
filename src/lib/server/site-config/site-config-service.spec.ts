import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
//
// `vi.hoisted` rather than plain module consts: `vi.mock` is hoisted above the
// imports, so anything its factory closes over has to be hoisted with it.
// ---------------------------------------------------------------------------

const kv = vi.hoisted(() => {
	const kvStore = new Map<string, string>();

	/** Peak `getJson` calls in flight at once — what proves the fan-out. */
	const counters = { inFlight: 0, peak: 0 };

	const getJson = vi.fn(async (key: string, _opts?: { cacheTtl?: number }) => {
		counters.inFlight++;
		counters.peak = Math.max(counters.peak, counters.inFlight);
		// Yield, so a sequential caller cannot accidentally look concurrent.
		await Promise.resolve();
		counters.inFlight--;
		const raw = kvStore.get(key);
		return raw !== undefined ? JSON.parse(raw) : null;
	});

	const putJson = vi.fn(async (key: string, value: unknown) => {
		kvStore.set(key, JSON.stringify(value));
	});

	const listKeys = vi.fn(async (prefix: string) =>
		[...kvStore.keys()].filter((k) => k.startsWith(prefix))
	);

	return { kvStore, counters, getJson, putJson, listKeys };
});

const { kvStore, counters, getJson, putJson, listKeys } = kv;

vi.mock('$lib/server/kv', () => ({
	getJson: kv.getJson,
	putJson: kv.putJson,
	listKeys: kv.listKeys
}));

import {
	getSiteConfig,
	getConfigsByPrefix,
	updateSiteConfig,
	updateSiteConfigs,
	clearSiteConfigMemo,
	DEFAULTS,
	UnknownSiteConfigKeyError
} from './site-config-service';

beforeEach(() => {
	kvStore.clear();
	// The memo is module state, so it outlives this hook and would otherwise
	// serve one test's writes to the next.
	clearSiteConfigMemo();
	getJson.mockClear();
	putJson.mockClear();
	listKeys.mockClear();
	counters.inFlight = 0;
	counters.peak = 0;
});

// ---------------------------------------------------------------------------
// getSiteConfig
// ---------------------------------------------------------------------------

describe('getSiteConfig', () => {
	it('returns the KV value when an entry exists', async () => {
		kvStore.set('site-config:reservation.operatingHoursStart', JSON.stringify('10:00'));
		const result = await getSiteConfig('reservation.operatingHoursStart');
		expect(result).toBe('10:00');
	});

	it('returns the default value when no KV entry exists', async () => {
		const result = await getSiteConfig('reservation.operatingHoursStart');
		expect(result).toBe('09:00');
	});

	it('returns numeric defaults correctly', async () => {
		const result = await getSiteConfig<number>('reservation.timeSlotMinutes');
		expect(result).toBe(30);
	});

	it('throws for unknown keys', async () => {
		await expect(getSiteConfig('unknown.key')).rejects.toThrow(UnknownSiteConfigKeyError);
	});
});

// ---------------------------------------------------------------------------
// getConfigsByPrefix
// ---------------------------------------------------------------------------

describe('getConfigsByPrefix', () => {
	it('returns defaults when no KV entries exist', async () => {
		const result = await getConfigsByPrefix('reservation');
		expect(result.operatingHoursStart).toBe('09:00');
		expect(result.operatingHoursEnd).toBe('22:00');
		expect(result.timeSlotMinutes).toBe(30);
		expect(result.minDurationHours).toBe(1);
		expect(result.maxDurationHours).toBe(8);
		expect(result.bufferMinutes).toBe(0);
		expect(result.maxAdvanceDaysOneoff).toBe(14);
		expect(result.maxAdvanceDaysRecurring).toBe(17.5);
	});

	it('overrides defaults with KV values', async () => {
		kvStore.set('site-config:reservation.operatingHoursStart', JSON.stringify('08:00'));
		kvStore.set('site-config:reservation.maxDurationHours', JSON.stringify(10));

		const result = await getConfigsByPrefix('reservation');
		expect(result.operatingHoursStart).toBe('08:00');
		expect(result.maxDurationHours).toBe(10);
		expect(result.operatingHoursEnd).toBe('22:00');
	});

	it('returns org defaults', async () => {
		const result = await getConfigsByPrefix('org');
		expect(result.name).toBe('Corvallis Music Collective');
		expect(result.shortName).toBe('CorvMC');
		expect(result.contactEmail).toBe('staff@corvmc.org');
		expect(result.timezone).toBe('America/Los_Angeles');
	});

	it('returns integration defaults as empty strings', async () => {
		const result = await getConfigsByPrefix('integration.utec');
		expect(result.clientId).toBe('');
		expect(result.clientSecret).toBe('');
		expect(result.deviceId).toBe('');
		expect(result.refreshToken).toBe('');
	});
});

// ---------------------------------------------------------------------------
// updateSiteConfig
// ---------------------------------------------------------------------------

describe('updateSiteConfig', () => {
	it('stores value in KV', async () => {
		await updateSiteConfig('reservation.operatingHoursStart', '08:00');
		expect(kvStore.get('site-config:reservation.operatingHoursStart')).toBe(
			JSON.stringify('08:00')
		);
	});

	it('handles numeric values', async () => {
		await updateSiteConfig('reservation.timeSlotMinutes', 15);
		expect(kvStore.get('site-config:reservation.timeSlotMinutes')).toBe(JSON.stringify(15));
	});
});

// ---------------------------------------------------------------------------
// updateSiteConfigs (batch)
// ---------------------------------------------------------------------------

describe('updateSiteConfigs', () => {
	it('updates multiple keys', async () => {
		await updateSiteConfigs([
			{ key: 'reservation.operatingHoursStart', value: '08:00' },
			{ key: 'reservation.operatingHoursEnd', value: '23:00' }
		]);
		expect(kvStore.size).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// The read path
// ---------------------------------------------------------------------------

describe('getConfigsByPrefix read path', () => {
	const reservationKeyCount = Object.keys(DEFAULTS).filter((k) =>
		k.startsWith('reservation.')
	).length;

	it('never asks KV which keys exist', async () => {
		kvStore.set('site-config:reservation.operatingHoursStart', JSON.stringify('08:00'));

		await getConfigsByPrefix('reservation');

		// DEFAULTS is the registry. A `list()` asks KV a question it is not the
		// authority for, and unlike `get()` it does not edge-cache at all.
		expect(listKeys).not.toHaveBeenCalled();
	});

	it('reads every registered key under the prefix, concurrently', async () => {
		await getConfigsByPrefix('reservation');

		expect(getJson).toHaveBeenCalledTimes(reservationKeyCount);
		expect(counters.peak).toBeGreaterThan(1);
	});

	it('does not surface a stored key that is absent from DEFAULTS', async () => {
		kvStore.set('site-config:reservation.retiredSetting', JSON.stringify('ghost'));

		const result = await getConfigsByPrefix('reservation');

		expect(result.retiredSetting).toBeUndefined();
	});

	it('prefers a stored falsy value over a truthy default', async () => {
		// `??` not `||`. `timeSlotMinutes` defaults to 30, so a stored 0 is the
		// case that tells the two apart — and `false` and `0` are both values a
		// staff member can legitimately save.
		kvStore.set('site-config:reservation.timeSlotMinutes', JSON.stringify(0));

		const result = await getConfigsByPrefix('reservation');

		expect(result.timeSlotMinutes).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// The isolate memo
// ---------------------------------------------------------------------------

describe('the isolate memo', () => {
	it('serves a second read without touching KV', async () => {
		await getSiteConfig('reservation.hourlyRateCents');
		expect(getJson).toHaveBeenCalledTimes(1);

		await getSiteConfig('reservation.hourlyRateCents');
		expect(getJson).toHaveBeenCalledTimes(1);
	});

	it('is busted by a write, so a staff save is visible in this isolate at once', async () => {
		await getSiteConfig('reservation.hourlyRateCents');

		await updateSiteConfig('reservation.hourlyRateCents', 2000);

		expect(await getSiteConfig('reservation.hourlyRateCents')).toBe(2000);
	});

	it('exempts feature flags, so a toggle does not compound two caches', async () => {
		await getSiteConfig('feature.bandPremium');
		await getSiteConfig('feature.bandPremium');

		// Nobody watches a room rate take effect. A staff member who toggles a
		// flag does, so flags pay the read rather than adding this cache on top
		// of the edge cache that was always in front of them.
		expect(getJson).toHaveBeenCalledTimes(2);
	});

	it('gives an exempt key a shorter edge cacheTtl than a memoized one', async () => {
		await getSiteConfig('reservation.hourlyRateCents');
		await getSiteConfig('feature.bandPremium');

		const [memoized, exempt] = getJson.mock.calls;
		expect(memoized[1]).toEqual({ cacheTtl: 300 });
		// A long edge TTL here would defeat the exemption above entirely.
		expect(exempt[1]).toEqual({ cacheTtl: 60 });
	});
});

// ---------------------------------------------------------------------------
// updateSiteConfigs concurrency
// ---------------------------------------------------------------------------

describe('updateSiteConfigs', () => {
	it('writes concurrently', async () => {
		await updateSiteConfigs([
			{ key: 'reservation.operatingHoursStart', value: '08:00' },
			{ key: 'reservation.operatingHoursEnd', value: '23:00' },
			{ key: 'reservation.timeSlotMinutes', value: 15 }
		]);

		expect(putJson).toHaveBeenCalledTimes(3);
	});
});
