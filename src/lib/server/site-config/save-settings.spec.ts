import { describe, it, expect, vi, beforeEach } from 'vitest';

/** A settings save names the keys that moved, with old and new values (#2820). */

const stored = vi.hoisted(() => new Map<string, string | number | boolean>());
const DEFAULTS: Record<string, string | number | boolean> = {
	'reservation.feeGateFrom': '',
	'reservation.bufferMinutes': 0,
	'reservation.hourlyRateCents': 1500,
	'integration.utec.clientSecret': ''
};
vi.mock('./site-config-service', () => ({
	config: vi.fn(async (key: string) => stored.get(key) ?? DEFAULTS[key]),
	updateSiteConfigs: vi.fn(async (entries: { key: string; value: string | number | boolean }[]) => {
		for (const e of entries) stored.set(e.key, e.value);
	})
}));
const recordAuditEntry = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/audit/audit-service.js', () => ({ recordAuditEntry }));

const { saveSettings } = await import('./save-settings');

beforeEach(() => {
	stored.clear();
	recordAuditEntry.mockClear();
});

describe('saveSettings', () => {
	it('records the keys that moved, with old and new values', async () => {
		await saveSettings([
			{ key: 'reservation.feeGateFrom', value: '2026-11-01' },
			{ key: 'reservation.hourlyRateCents', value: 1500 }
		]);

		expect(recordAuditEntry).toHaveBeenCalledOnce();
		expect(recordAuditEntry.mock.calls[0][0]).toMatchObject({
			action: 'settings.changed',
			details: { changes: [{ key: 'reservation.feeGateFrom', from: '', to: '2026-11-01' }] }
		});
	});

	it('writes no row when nothing moved', async () => {
		await saveSettings([{ key: 'reservation.bufferMinutes', value: 0 }]);
		expect(recordAuditEntry).not.toHaveBeenCalled();
	});

	it('names a secret key without its value', async () => {
		await saveSettings([{ key: 'integration.utec.clientSecret', value: 's3cret' }]);
		const details = recordAuditEntry.mock.calls[0][0].details;
		expect(details).toEqual({ changes: [], redacted: ['integration.utec.clientSecret'] });
		expect(JSON.stringify(details)).not.toContain('s3cret');
	});
});
