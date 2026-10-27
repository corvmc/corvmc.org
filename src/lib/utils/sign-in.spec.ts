import { describe, it, expect } from 'vitest';
import { safeReturnPath, signInHref, signInInterruptFor, verificationCallbackURL } from './sign-in';

describe('safeReturnPath', () => {
	it.each([
		['/events/e1', '/events/e1'],
		['/events/e1?tab=info#rsvp', '/events/e1?tab=info#rsvp'],
		['/member', '/member']
	])('keeps a same-origin path %s', (raw, want) => {
		expect(safeReturnPath(raw)).toBe(want);
	});

	it.each([
		'//evil.com',
		'//evil.com/events',
		'/\\evil.com',
		'/\\/evil.com',
		'https://evil.com',
		'http://corvmc.org/member',
		'javascript:alert(1)',
		'JavaScript:alert(1)',
		'data:text/html,hi',
		'events/e1',
		'/\tevil.com',
		'/%0d%0aSet-Cookie:x',
		'\n/member',
		'',
		null,
		undefined,
		'/login',
		'/login?redirect=/member'
	])('refuses %j', (raw) => {
		const got = safeReturnPath(raw as string | null | undefined);
		// An encoded CRLF stays encoded in the path, so it is harmless — but it
		// must never decode into a header or a second origin.
		if (raw === '/%0d%0aSet-Cookie:x') expect(got).toBe('/%0d%0aSet-Cookie:x');
		else expect(got).toBeNull();
	});
});

describe('signInHref', () => {
	it('carries the return path and the intent', () => {
		const href = signInHref({ returnTo: '/events/e1', intent: 'RSVP to Spring Workshop' });
		const url = new URL(href, 'https://x.test');
		expect(url.pathname).toBe('/login');
		expect(url.searchParams.get('redirect')).toBe('/events/e1');
		expect(url.searchParams.get('intent')).toBe('RSVP to Spring Workshop');
		expect(url.searchParams.has('register')).toBe(false);
	});

	it('opens the create-account form in the shape /login reads', () => {
		const href = signInHref({ returnTo: '/events/e1', register: true });
		expect(href.startsWith('/login?register&')).toBe(true);
		expect(new URL(href, 'https://x.test').searchParams.get('redirect')).toBe('/events/e1');
	});

	it('drops an unsafe return rather than passing it on', () => {
		expect(signInHref({ returnTo: '//evil.com' })).toBe('/login');
		expect(signInHref({ returnTo: 'https://evil.com', register: true })).toBe('/login?register');
	});

	it('caps the intent label', () => {
		const href = signInHref({ intent: 'x'.repeat(500) });
		expect(new URL(href, 'https://x.test').searchParams.get('intent')).toHaveLength(120);
	});
});

describe('signInInterruptFor', () => {
	const current = new URL('https://corvmc.org/events/e1?tab=info');

	it('turns a 401 into the sign-in href, returning to this page', () => {
		const href = signInInterruptFor(
			{ status: 401, body: { message: 'Not authenticated' } },
			current
		);
		expect(href).toBe(signInHref({ returnTo: '/events/e1?tab=info' }));
	});

	it.each([{ status: 403 }, { status: 500 }, new Error('boom'), null])(
		'leaves anything else an error (%o)',
		(err) => {
			expect(signInInterruptFor(err, current)).toBeNull();
		}
	);
});

describe('verificationCallbackURL', () => {
	// better-auth puts this in the verification email's link and redirects to it
	// on success, which is how an RSVP started signed out survives the inbox.
	it('passes a safe return through to the verification link', () => {
		expect(verificationCallbackURL('/events/e1')).toBe('/events/e1');
	});

	it('sends nothing for an unsafe or missing return, so better-auth uses /', () => {
		expect(verificationCallbackURL('//evil.com')).toBeUndefined();
		expect(verificationCallbackURL(null)).toBeUndefined();
	});
});
