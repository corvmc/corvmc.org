import { describe, it, expect } from 'vitest';
import { visibleViews } from '../views';
import { activeNavKey } from '../nav-items';
import { gearViews } from './views';

// Loans, reported problems and compliance are Gear's tabs (#2573), each behind its old gate.
describe('Gear tabs', () => {
	it.each([
		[['inventory.read'], ['items']],
		[
			['inventory.read', 'inventory.manageLoans'],
			['items', 'loans']
		],
		[
			['inventory.read', 'inventory.manageAssets', 'inventory.manageAcquisitions'],
			['items', 'problems', 'compliance']
		]
	])('holding %j shows %j', (held, keys) => {
		expect(visibleViews(gearViews, held).map((v) => v.key)).toEqual(keys);
	});

	it('lights the Gear row on every tab', () => {
		for (const view of gearViews) expect(activeNavKey(view.href)).toBe('gear');
	});
});
