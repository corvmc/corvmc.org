import { describe, it, expect } from 'vitest';
import { accountOfferPath } from './account-offer.js';
import { safeReturnPath } from './sign-in.js';

describe('accountOfferPath', () => {
	it('opens the create-account form with the address prefilled', () => {
		const url = new URL(accountOfferPath('fan@example.com'), 'https://x.test');
		expect(url.pathname).toBe('/login');
		expect(url.searchParams.has('register')).toBe(true);
		expect(url.searchParams.get('email')).toBe('fan@example.com');
	});

	it('encodes + and @ so the address survives the query string', () => {
		const path = accountOfferPath('fan+gigs@example.com');
		expect(path).toContain('email=fan%2Bgigs%40example.com');
		expect(new URL(path, 'https://x.test').searchParams.get('email')).toBe('fan+gigs@example.com');
	});

	it('trims the address', () => {
		const url = new URL(accountOfferPath('  fan@example.com '), 'https://x.test');
		expect(url.searchParams.get('email')).toBe('fan@example.com');
	});

	it('returns to a path safeReturnPath accepts', () => {
		const redirect = new URL(accountOfferPath('a@b.co'), 'https://x.test').searchParams.get(
			'redirect'
		);
		expect(redirect).toBe('/member/events');
		expect(safeReturnPath(redirect)).toBe(redirect);
	});
});
