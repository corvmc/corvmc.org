import { describe, it, expect } from 'vitest';
import { DEFAULTS } from './site-config-service';
import { SETTING_LABELS, settingLabel } from '#lib/utils/audit-display.js';

/**
 * A settings entry in the audit log names each key it changed. A key with no
 * label reads as code (`reservation.feeGateFrom`), so every registered key has one,
 * and a label for a key no longer registered is dead weight.
 */
describe('setting labels', () => {
	it('labels every registered key', () => {
		const unlabelled = Object.keys(DEFAULTS).filter((key) => settingLabel(key) === key);
		expect(unlabelled).toEqual([]);
	});

	it('labels no key the registry has dropped', () => {
		const stale = Object.keys(SETTING_LABELS).filter((key) => !(key in DEFAULTS));
		expect(stale).toEqual([]);
	});

	it('names a product field rather than printing its key', () => {
		for (const field of ['name', 'description', 'unitAmountCents']) {
			const key = `product.fee_coverage.${field}`;
			expect(settingLabel(key)).not.toBe(key);
		}
	});
});
