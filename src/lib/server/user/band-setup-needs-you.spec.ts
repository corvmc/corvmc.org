import { describe, it, expect } from 'vitest';
import { bandSetupNeedsYouItems, type BandNeedingMembers } from './band-setup-needs-you';

function band(over: Partial<BandNeedingMembers> = {}): BandNeedingMembers {
	return {
		id: 'band-1',
		name: 'Second Thoughts',
		slug: 'second-thoughts',
		role: 'owner',
		status: 'active',
		memberCount: 1,
		...over
	};
}

describe('bandSetupNeedsYouItems', () => {
	it('lists an owned band with only its owner, linking to its members page', () => {
		const [item] = bandSetupNeedsYouItems([band()]);
		expect(item).toMatchObject({ id: 'band-no-members:band-1', dueAt: null });
		expect(item.href).toContain('/band/second-thoughts/members');
	});

	it('drops the band once a second member joins', () => {
		expect(bandSetupNeedsYouItems([band({ memberCount: 2 })])).toEqual([]);
	});

	it('leaves out bands the member does not own', () => {
		expect(bandSetupNeedsYouItems([band({ role: 'admin' }), band({ role: 'member' })])).toEqual([]);
	});

	it('leaves out a band the member was only invited to', () => {
		expect(bandSetupNeedsYouItems([band({ status: 'pending' })])).toEqual([]);
	});
});
