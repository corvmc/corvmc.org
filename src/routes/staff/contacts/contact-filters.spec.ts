import { describe, expect, it } from 'vitest';
import { defaultCreateRole, legacyContactsHref, parseRoles, toggleRole } from './contact-filters';

const at = (query: string) => new URL(`https://corvmc.test/staff/contacts${query}`);

describe('the role filter in the URL', () => {
	it('reads known roles in catalog order and drops the rest', () => {
		expect(parseRoles('sponsor,funder,bogus')).toEqual(['funder', 'sponsor']);
		expect(parseRoles('')).toEqual([]);
	});

	it('turns one role on or off without disturbing the others', () => {
		expect(toggleRole('funder', 'press', true)).toBe('funder,press');
		expect(toggleRole('funder,press', 'funder', false)).toBe('press');
		expect(toggleRole('funder', 'funder', true)).toBe('funder');
	});
});

describe('the create modal role', () => {
	it('starts on the one role filtered on, and on partner otherwise', () => {
		expect(defaultCreateRole(['press'])).toBe('press');
		expect(defaultCreateRole(['press', 'funder'])).toBe('partner');
		expect(defaultCreateRole([])).toBe('partner');
		expect(defaultCreateRole(['contractor'])).toBe('partner');
	});
});

describe('links from the tabbed page', () => {
	it('moves a role tab onto the role filter, keeping the archived flag', () => {
		expect(legacyContactsHref(at('?view=funder&archived=1'))).toBe(
			'/staff/contacts?role=funder&archived=1'
		);
	});

	it('sends the All tab and an unknown tab to the unfiltered list', () => {
		expect(legacyContactsHref(at('?view=all'))).toBe('/staff/contacts');
		expect(legacyContactsHref(at('?view=nope'))).toBe('/staff/contacts');
	});

	it('leaves a current URL alone', () => {
		expect(legacyContactsHref(at('?role=funder'))).toBeNull();
		expect(legacyContactsHref(at(''))).toBeNull();
	});
});
