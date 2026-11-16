import { describe, it, expect } from 'vitest';
import { visibleViews } from '../views';
import { activeNavKey } from '../nav-items';
import { gearViews } from './views';

// Gear's lists (#2573, #2767), each behind its remotes' gate.
describe('Gear tabs', () => {
	it.each([
		[['inventory.read'], ['items', 'orders']],
		[
			['inventory.read', 'inventory.manageLoans'],
			['items', 'loans', 'orders']
		],
		[
			['inventory.read', 'inventory.manageAssets', 'inventory.manageAcquisitions'],
			['items', 'problems', 'orders', 'acquisitions']
		]
	])('holding %j shows %j', (held, keys) => {
		expect(visibleViews(gearViews, held).map((v) => v.key)).toEqual(keys);
	});

	it('lights the Gear row on every tab', () => {
		for (const view of gearViews) expect(activeNavKey(view.href)).toBe('gear');
	});
});
