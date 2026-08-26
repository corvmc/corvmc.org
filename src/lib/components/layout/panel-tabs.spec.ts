import { describe, expect, it } from 'vitest';
import { panelTabs } from './panel-tabs';

/**
 * The same block used to be written out in all three panel layouts, differing
 * only in whether the Staff tab was conditional.
 */

const BANDS = [
	{ slug: 'the-velvet-underground', name: 'The Velvet Underground' },
	{ slug: 'stereolab', name: 'Stereolab' }
];

describe('panelTabs', () => {
	it('always offers the member panel first', () => {
		expect(panelTabs({ userBands: [] })[0]).toMatchObject({ key: 'member', href: '/member' });
	});

	it('offers the staff panel only to staff', () => {
		expect(panelTabs({ isStaff: true, userBands: [] }).map((p) => p.key)).toContain('staff');
		expect(panelTabs({ isStaff: false, userBands: [] }).map((p) => p.key)).not.toContain('staff');
		expect(panelTabs({ userBands: [] }).map((p) => p.key)).not.toContain('staff');
	});

	it('lists every band after the fixed panels, in order', () => {
		expect(panelTabs({ isStaff: true, userBands: BANDS }).map((p) => p.key)).toEqual([
			'member',
			'staff',
			'the-velvet-underground',
			'stereolab'
		]);
	});

	it('addresses a band by slug', () => {
		const [band] = panelTabs({ userBands: [BANDS[0]] }).filter((p) => p.type === 'band');
		expect(band).toMatchObject({
			href: '/band/the-velvet-underground',
			label: 'The Velvet Underground'
		});
	});

	it('types each tab so the topbar can split fixed panels from bands', () => {
		const tabs = panelTabs({ isStaff: true, userBands: BANDS });
		expect(tabs.filter((p) => p.type !== 'band')).toHaveLength(2);
		expect(tabs.filter((p) => p.type === 'band')).toHaveLength(2);
	});
});
