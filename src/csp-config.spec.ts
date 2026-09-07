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

		const reportUri = csp?.reportOnly?.['report-uri']?.[0];
		expect(reportUri).toBeDefined();

		const url = new URL(reportUri as string);
		expect(url.origin).toBe(dsn.origin);
		expect(url.pathname).toBe(`/api/${projectId}/security/`);
		expect(url.searchParams.get('sentry_key')).toBe(publicKey);
	});

	// Kit only injects a nonce into a style directive that does NOT already allow
	// 'unsafe-inline' (runtime/server/page/csp.js). A nonce would make the browser
	// ignore 'unsafe-inline', which would break ~97 inline style attributes, the
	// `<div style="display: contents">` in app.html, and the two places band
	// custom CSS is injected as a `<style>` element through {@html}.
	it('keeps unsafe-inline on every style directive so Kit adds no style nonce', () => {
		for (const directive of ['style-src', 'style-src-attr', 'style-src-elem'] as const) {
			expect(csp?.reportOnly?.[directive]).toContain('unsafe-inline');
		}
	});

	// The barcode scanner's zxing build fetches its wasm from jsdelivr at runtime,
	// from inside a dynamically imported dependency — invisible to a grep of src/.
	it('allows the wasm and its CDN that the barcode scanner needs', () => {
		expect(csp?.reportOnly?.['script-src']).toContain('wasm-unsafe-eval');
		expect(csp?.reportOnly?.['connect-src']).toContain('https://fastly.jsdelivr.net');
	});

	// frame-ancestors is enforced from day one; everything else is report-only
	// until the violation data says what the real allowlist is.
	it('enforces frame-ancestors and nothing else', () => {
		expect(csp?.directives).toEqual({ 'frame-ancestors': ['self'] });
	});
});
