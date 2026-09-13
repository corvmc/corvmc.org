import { describe, it, expect, vi } from 'vitest';
import { SENTRY_DSN } from '$lib/sentry-dsn';

// Importing the real config would pull in adapter-cloudflare, and through it
// miniflare's raw TypeScript sources, which this runner cannot parse. The
// adapter contributes nothing to the CSP.
vi.mock('@sveltejs/adapter-cloudflare', () => ({ default: () => ({ name: 'stub' }) }));

const { default: config } = await import('../svelte.config.js');

// `svelte.config.js` is plain JS loaded by Node before any alias map exists, so
// it cannot import `$lib/sentry-dsn` and the report endpoint is written out
// longhand. These assertions are what keeps the two in step.

const csp = config.kit?.csp;

describe('kit.csp', () => {
	it('points report-uri at the Sentry project in SENTRY_DSN', () => {
		const dsn = new URL(SENTRY_DSN);
		const projectId = dsn.pathname.slice(1);
		const publicKey = dsn.username;

		const reportUri = csp?.directives?.['report-uri']?.[0];
		expect(reportUri).toBeDefined();

		const url = new URL(reportUri as string);
		expect(url.origin).toBe(dsn.origin);
		expect(url.pathname).toBe(`/api/${projectId}/security/`);
		expect(url.searchParams.get('sentry_key')).toBe(publicKey);
	});

	// Every checkout used to be a top-level navigation to checkout.stripe.com, so
	// `form-action` was the only Stripe directive that mattered. The in-app
	// checkout embeds Stripe instead: Stripe.js is a script, the card fields are
	// an iframe, and the Element calls the API from the page. Now that the policy
	// is enforced, dropping one of these silently breaks every payment.
	it('allows the Stripe origins the embedded Payment Element needs', () => {
		expect(csp?.directives?.['script-src']).toContain('https://js.stripe.com');
		// The card fields, and the 3-D Secure challenge.
		expect(csp?.directives?.['frame-src']).toContain('https://js.stripe.com');
		expect(csp?.directives?.['frame-src']).toContain('https://hooks.stripe.com');
		expect(csp?.directives?.['connect-src']).toContain('https://api.stripe.com');
	});

	// Kit only injects a nonce into a style directive that does NOT already allow
	// 'unsafe-inline' (runtime/server/page/csp.js). A nonce would make the browser
	// ignore 'unsafe-inline', which would break ~97 inline style attributes, the
	// `<div style="display: contents">` in app.html, and the two places band
	// custom CSS is injected as a `<style>` element through {@html}.
	it('keeps unsafe-inline on every style directive so Kit adds no style nonce', () => {
		for (const directive of ['style-src', 'style-src-attr', 'style-src-elem'] as const) {
			expect(csp?.directives?.[directive]).toContain('unsafe-inline');
		}
	});

	// The barcode scanner's zxing build fetches its wasm from jsdelivr at runtime,
	// from inside a dynamically imported dependency — invisible to a grep of src/.
	it('allows the wasm and its CDN that the barcode scanner needs', () => {
		expect(csp?.directives?.['script-src']).toContain('wasm-unsafe-eval');
		expect(csp?.directives?.['connect-src']).toContain('https://fastly.jsdelivr.net');
	});

	// The whole policy is enforced. A directive left in `reportOnly` would be
	// sent as Content-Security-Policy-Report-Only, so the browser reports the
	// violation and loads the resource anyway — the state this policy spent two
	// weeks in on purpose, and must not fall back into unnoticed.
	it('enforces the whole policy rather than reporting any of it', () => {
		expect(csp?.reportOnly).toBeUndefined();
		expect(csp?.directives?.['frame-ancestors']).toEqual(['self']);
	});

	// src/ has no inline on* attribute; every such violation in the report-only
	// window was injected by an in-app browser or an extension. script-src covers
	// this already, because Kit's nonce there makes the browser ignore any
	// 'unsafe-inline' — this directive is what keeps it covered if script-src
	// ever has to allow inline for something else.
	it('refuses inline event-handler attributes outright', () => {
		expect(csp?.directives?.['script-src-attr']).toEqual(['none']);
	});
});
