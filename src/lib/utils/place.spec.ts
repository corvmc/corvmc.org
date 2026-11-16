import { describe, expect, it } from 'vitest';
import { mapUrl, placeLine, venueAddress } from './place';

describe('placeLine', () => {
	it('joins venue and address', () => {
		expect(placeLine({ location: 'Bombs Away Cafe', address: '2527 NW Monroe Ave' })).toBe(
			'Bombs Away Cafe, 2527 NW Monroe Ave'
		);
	});

	it('returns a pre-address row as it was written', () => {
		expect(placeLine({ location: 'Whiteside, 361 SW Madison', address: null })).toBe(
			'Whiteside, 361 SW Madison'
		);
	});

	it('is null when neither is set', () => {
		expect(placeLine({ location: '  ', address: '' })).toBeNull();
	});
});

describe('mapUrl', () => {
	it('searches the venue and address together', () => {
		const url = new URL(mapUrl({ location: 'Bombs Away', address: '2527 NW Monroe' })!);
		expect(url.searchParams.get('query')).toBe('Bombs Away, 2527 NW Monroe');
	});

	it('is null without an address', () => {
		expect(mapUrl({ location: 'Bombs Away', address: null })).toBeNull();
	});
});

describe('venueAddress', () => {
	it('formats street, city and region', () => {
		expect(
			venueAddress({
				address1: '361 SW Madison Ave',
				city: 'Corvallis',
				state: 'OR',
				postalCode: '97333'
			})
		).toBe('361 SW Madison Ave, Corvallis, OR 97333');
	});

	it('is null for a venue with no address', () => {
		expect(venueAddress({ address1: null, city: null, state: null, postalCode: null })).toBeNull();
	});
});
