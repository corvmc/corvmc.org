import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const kvStore = new Map<string, string>();

vi.mock('$lib/server/kv', () => ({
	getJson: vi.fn(async (key: string) => {
		const raw = kvStore.get(key);
		return raw !== undefined ? JSON.parse(raw) : null;
	}),
	putJson: vi.fn(async (key: string, value: unknown) => {
		kvStore.set(key, JSON.stringify(value));
	}),
	listKeys: vi.fn(async (prefix: string) => {
		return [...kvStore.keys()].filter((k) => k.startsWith(prefix));
	})
}));

import {
	getSiteConfig,
	getConfigsByPrefix,
	updateSiteConfig,
	updateSiteConfigs,
	UnknownSiteConfigKeyError
} from './site-config-service';

beforeEach(() => {
	kvStore.clear();
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
