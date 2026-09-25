import { describe, it, expect } from 'vitest';
import { capacityNote } from './capacity';

describe('the capacity note on the door screen', () => {
	it('says nothing for a show with no cap', () => {
		expect(capacityNote(null, 3)).toBeNull();
	});

	it('says how many remain while the sale fits', () => {
		expect(capacityNote(5, 2)).toEqual({ level: 'info', text: '5 tickets left' });
		expect(capacityNote(1, 1)).toEqual({ level: 'info', text: '1 ticket left' });
	});

	it('warns by how much this sale would go over, without refusing it', () => {
		expect(capacityNote(1, 3)).toEqual({
			level: 'warning',
			text: '1 ticket left. This sale puts the show over capacity by 2.'
		});
	});

	it('counts a show already past capacity from where it stands', () => {
		expect(capacityNote(-2, 1)).toEqual({
			level: 'warning',
			text: 'Already over capacity by 2. This sale puts the show over capacity by 3.'
		});
	});
});
