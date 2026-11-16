import { expect, test } from './fixtures/test';
import { E2E_PREVIEW_PORT } from './state-dir';
import { SEED_PUBLIC_BAND_SLUG } from './fixtures/seed-band-onboarding';

/**
 * The headers from #628, against a real built worker: that kit.csp survives the
 * production build and the hook survives the adapter is what a mocked handle
 * chain cannot reach. No browser, because only the headers are read.
 */
const PORT = E2E_PREVIEW_PORT;

test('security headers survive the production build', async ({ request }) => {
	const home = await request.get(`http://localhost:${PORT}/`, {
		headers: { accept: 'text/html' }
	});
	const headers = home.headers();
	expect(home.status()).toBe(200);

	expect.soft(headers['x-content-type-options']).toBe('nosniff');
	expect.soft(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
	expect.soft(headers['x-frame-options']).toBe('SAMEORIGIN');

	// The whole policy is enforced, with nothing left report-only.
	const csp = headers['content-security-policy'] ?? '';
	expect.soft(csp).toContain("default-src 'self'");
	expect.soft(csp).toContain("frame-ancestors 'self'");
	expect.soft(csp).toContain('report-uri https://');
	expect.soft(headers['content-security-policy-report-only']).toBeUndefined();

	// A nonce makes the browser ignore 'unsafe-inline', which would kill every inline
	// style attribute and the band custom CSS. So it belongs on scripts alone.
	const directive = (name: string) =>
		csp
			.split(';')
			.map((part) => part.trim())
			.find((part) => part.startsWith(`${name} `)) ?? '';
	expect.soft(directive('script-src')).toContain('nonce-');
	for (const name of ['style-src', 'style-src-elem', 'style-src-attr']) {
		expect.soft(directive(name), name).not.toContain('nonce-');
		expect.soft(directive(name), name).toContain("'unsafe-inline'");
	}

	// HSTS is scoped to https on our own domains, and the preview serves plain http.
	expect.soft(headers['strict-transport-security']).toBeUndefined();

	// handleBandSubdomain builds this redirect by hand and never calls resolve, so it
	// is the branch a header hook placed too low in the sequence would miss.
	const redirect = await request.get(`http://${SEED_PUBLIC_BAND_SLUG}.localhost:${PORT}/`, {
		maxRedirects: 0
	});
	expect.soft(redirect.status()).toBe(302);
	expect.soft(redirect.headers()['x-frame-options']).toBe('SAMEORIGIN');
	expect.soft(redirect.headers()['x-content-type-options']).toBe('nosniff');
});
