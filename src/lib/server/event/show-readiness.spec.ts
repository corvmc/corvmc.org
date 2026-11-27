import { describe, expect, it } from 'vitest';
import { LISTING_GAP_WORDS, listingGaps } from './show-readiness';

const complete = {
	title: 'Open mic',
	startsAt: new Date('2030-06-07T02:00:00Z'),
	description: 'Come play'
};

describe('listingGaps', () => {
	it('is empty for a complete listing', () => {
		expect(listingGaps(complete)).toEqual([]);
	});

	it('names a blank title, however it is blank', () => {
		expect(listingGaps({ ...complete, title: '   ' })).toEqual(['title']);
		expect(listingGaps({ ...complete, title: null })).toEqual(['title']);
	});

	it('names a missing or blank description', () => {
		expect(listingGaps({ ...complete, description: null })).toEqual(['description']);
		expect(listingGaps({ ...complete, description: ' \n ' })).toEqual(['description']);
	});

	it('names a missing start', () => {
		expect(listingGaps({ ...complete, startsAt: null })).toEqual(['startsAt']);
	});

	it('lists every gap in the order of the Listing tab', () => {
		expect(listingGaps({ title: '', startsAt: null, description: '' })).toEqual([
			'title',
			'startsAt',
			'description'
		]);
	});

	it('has plain words for every gap it can name', () => {
		const every = listingGaps({ title: '', startsAt: null, description: '' });
		expect(Object.keys(LISTING_GAP_WORDS).sort()).toEqual([...every].sort());
	});
});
