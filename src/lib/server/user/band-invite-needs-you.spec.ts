import { describe, it, expect } from 'vitest';
import { bandInviteNeedsYouItems } from './band-invite-needs-you';

describe('bandInviteNeedsYouItems', () => {
	it('lists nothing with no invitations', () => {
		expect(bandInviteNeedsYouItems([])).toEqual([]);
	});

	// The class: an invitation prompt that names no group (#3052).
	it('names the band of a single invitation', () => {
		const [item] = bandInviteNeedsYouItems([{ name: 'Late Bloomers' }]);
		expect(item.title).toContain('Late Bloomers');
	});

	it('names every band when there are several', () => {
		const [item] = bandInviteNeedsYouItems([{ name: 'Late Bloomers' }, { name: 'Hum' }]);
		const text = `${item.title} ${item.detail ?? ''}`;
		expect(text).toContain('Late Bloomers');
		expect(text).toContain('Hum');
	});
});
