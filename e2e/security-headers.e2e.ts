import { expect, test } from '@playwright/test';
import { E2E_PREVIEW_PORT } from './state-dir';
import { SEED_PUBLIC_BAND_SLUG } from './fixtures/seed-band-onboarding';

/**
 * The headers from #628, asserted against a real built worker rather than a
 * mocked handle chain — which is the half the unit tests cannot reach: that
 * kit.csp survives the production build, and that the hook survives the
 * adapter.
 *
 * The CSP is report-only by design for everything except frame-ancestors, so
 * these assert the *shape* of the rollout, not a locked-down policy.
 */
const PORT = E2E_PREVIEW_PORT;

test('a page response carries the always-on security headers', async ({ page }) => {
	const response = await page.goto(`http://localhost:${PORT}/`);
	const headers = response?.headers() ?? {};

	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
	expect(headers['x-frame-options']).toBe('SAMEORIGIN');
});

test('frame-ancestors is enforced and everything else is report-only', async ({ page }) => {
	const response = await page.goto(`http://localhost:${PORT}/`);
	const headers = response?.headers() ?? {};

	expect(headers['content-security-policy']).toBe("frame-ancestors 'self'");

	const reportOnly = headers['content-security-policy-report-only'] ?? '';
	expect(reportOnly).toContain("default-src 'self'");
	expect(reportOnly).toContain('report-uri https://');
});

// Kit adds a nonce only to a directive that does not already allow
// 'unsafe-inline', and a nonce would make the browser ignore 'unsafe-inline' —
// silently killing every inline style attribute and the band custom CSS that is
// injected as a <style> element. Assert the nonce landed on scripts and nowhere
// near the styles.
test('the CSP nonce is on script-src only', async ({ page }) => {
	const response = await page.goto(`http://localhost:${PORT}/`);
	const reportOnly = response?.headers()['content-security-policy-report-only'] ?? '';

	const directive = (name: string) =>
		reportOnly
			.split(';')
			.map((part) => part.trim())
			.find((part) => part.startsWith(`${name} `)) ?? '';

	expect(directive('script-src')).toContain('nonce-');
	for (const name of ['style-src', 'style-src-elem', 'style-src-attr']) {
		expect(directive(name)).not.toContain('nonce-');
		expect(directive(name)).toContain("'unsafe-inline'");
	}
});

// handleBandSubdomain builds this redirect by hand and never calls resolve, so
// it is the branch a header hook placed too low in the sequence would miss.
test('a band-subdomain redirect carries the headers too', async ({ request }) => {
	const response = await request.get(`http://${SEED_PUBLIC_BAND_SLUG}.localhost:${PORT}/`, {
		maxRedirects: 0
	});

	expect(response.status()).toBe(302);
	expect(response.headers()['x-frame-options']).toBe('SAMEORIGIN');
	expect(response.headers()['x-content-type-options']).toBe('nosniff');
});

// HSTS is scoped to https on our own domains. The preview serves plain http, so
// its absence here is the gate working, not a gap in it.
test('no HSTS over plain http', async ({ page }) => {
	const response = await page.goto(`http://localhost:${PORT}/`);

	expect(response?.headers()['strict-transport-security']).toBeUndefined();
});
