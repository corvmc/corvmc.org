import { describe, expect, it } from 'vitest';
import { m } from '$lib/paraglide/messages.js';
import { entityLabels, groupKindLabels, many, one } from './terms';

describe('terms', () => {
	it('takes one and many from the message, not a suffix', () => {
		expect(one(m.term_band)).toBe('Act');
		expect(many(m.term_band)).toBe('Acts');
		expect(entityLabels.recurring).toEqual({
			one: 'Recurring series',
			many: 'Recurring series'
		});
	});

	it('keeps a group kind lower-case, and the band kind "band"', () => {
		expect(groupKindLabels).toEqual({ band: 'band', club: 'club', committee: 'committee' });
	});

	it('labels the entity types exactly as config.ts did', () => {
		expect(entityLabels.band).toEqual({ one: 'Act', many: 'Acts' });
		expect(entityLabels.flag).toEqual({ one: 'Report', many: 'Reports' });
		expect(entityLabels.role).toEqual({ one: 'Volunteer role', many: 'Volunteer roles' });
	});
});
