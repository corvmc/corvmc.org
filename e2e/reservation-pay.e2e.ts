import { expect, test, type Response } from '@playwright/test';
import {
	SEED_MEMBER_EMAIL,
	SEED_MEMBER_PASSWORD,
	SEED_RESERVATION_ID
} from './fixtures/seed-pay-reservation';

/**
 * Regression test for the reservation "cover processing fees" payment flow.
 *
 * Background: the `coverFees` control is a FormField checkbox bound to a
 * `z.boolean()` schema field, submitted with SvelteKit's `b:` prefix so it
 * arrives as a real boolean. A prior bug typed the schema as `z.enum(['','on'])`,
 * which threw `Invalid option: expected one of ""|"on"` during form submission
 * (Zod validation) the moment a member checked "cover fees" — BEFORE any Stripe
 * redirect.
 *
 * This test drives the real browser → SvelteKit → Zod → handler path and asserts
 * the submission gets PAST Zod validation: no "Invalid option" / "expected one
 * of" error surfaces, and the request proceeds (it does not re-render the page
 * with a validation issue, and the server response is not a validation error).
 *
 * It deliberately does NOT complete a real Stripe payment — the dummy Stripe key
 * means the post-validation Stripe call may fail, but that failure is distinct
 * from (and proves we passed) the Zod validation the bug lived in.
 */

const ZOD_BUG_PATTERNS = [/invalid option/i, /expected one of/i];

/**
 * The one server error this spec is allowed to see, and nothing else (#546).
 *
 * `payReservation` reaches `ensureStripeCustomer` → `checkout`, and `main` has
 * no fake gateway to resolve instead (the `PAYMENTS_DRIVER` seam is #522), so
 * the pinned `sk_test_dummy_e2e` key earns a 401 from Stripe and the submission
 * 500s. That is expected here; every *other* 5xx is not. Delete this tolerance
 * when the driver seam lands — the submission should then succeed.
 */
const TOLERATED_SERVER_ERROR = {
	method: 'POST',
	path: /^(\/member\/reservations\/[^/]+\/pay|\/_app\/remote\/)/
};

async function login(page: import('@playwright/test').Page) {
	await page.goto('/login');
	await page.locator('input[name="email"]').fill(SEED_MEMBER_EMAIL);
	await page.locator('input[name="password"]').fill(SEED_MEMBER_PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	// Successful login redirects to /member.
	await page.waitForURL(/\/member(\/|$|\?)/, { timeout: 15000 });
}

test('covering processing fees submits without a Zod validation error', async ({ page }) => {
	// Every 5xx this test provokes, so the assertion at the end can insist the
	// only one is the tolerated gateway failure. Before this, the spec asserted
	// `status !== 400` and nothing more, so a 500 from any cause passed (#546).
	const serverErrors: string[] = [];
	page.on('response', (res) => {
		if (res.status() < 500) return;
		const { pathname } = new URL(res.url());
		const method = res.request().method();
		const tolerated =
			method === TOLERATED_SERVER_ERROR.method && TOLERATED_SERVER_ERROR.path.test(pathname);
		if (!tolerated) serverErrors.push(`${method} ${pathname} → ${res.status()}`);
	});

	await login(page);

	await page.goto(`/member/reservations/${SEED_RESERVATION_ID}/pay`);

	// Page rendered the pay form for a balance-due ($15.00) reservation. The
	// balance summary and the cover-fees checkbox are both present.
	await expect(page.getByText('$15.00').first()).toBeVisible();

	// The cover-fees checkbox is the boolean field rendered with the SvelteKit
	// `b:` prefix — the exact mechanism the bug fix relies on.
	const checkbox = page.locator('input[name="b:coverFees"]');
	await expect(checkbox).toBeVisible();
	await checkbox.check();
	await expect(checkbox).toBeChecked();

	// The submit button shows the charge amount (with the processing fee once
	// cover-fees is checked), e.g. "Pay $15.44".
	const submit = page.getByRole('button', { name: /^Pay \$/ });
	await expect(submit).toBeVisible();

	// Capture the POST to the payReservation remote form so we can confirm the
	// server did not reject the submission with a validation error.
	const remotePost = page.waitForResponse(
		(res: Response) =>
			res.request().method() === 'POST' && /payReservation|remote/i.test(res.url()),
		{ timeout: 15000 }
	);

	await submit.click();

	const response = await remotePost;
	const bodyText = await response.text().catch(() => '');

	// The submission must NOT be rejected as a Zod validation error. The old bug
	// (coverFees typed as z.enum(['','on'])) produced an "Invalid option: expected
	// one of ""|"on"" issue the moment the boolean `b:coverFees` value arrived.
	//
	// SvelteKit remote forms always return HTTP 200 and carry the real outcome in
	// a JSON envelope, so assert on the envelope, not the transport status:
	//   - validation failure → { type: 'error', status: 400, ... } mentioning the issue
	//   - success            → a redirect/result (no error)
	//   - post-validation failure (the dummy Stripe key) → status 500
	// The 500 happens AFTER Zod validation, so it proves the fix works — but it
	// is tolerated only on this one request, and the assertion below says so.
	for (const pattern of ZOD_BUG_PATTERNS) {
		expect(bodyText, `payReservation response: ${bodyText.slice(0, 400)}`).not.toMatch(pattern);
	}

	let envelope: { type?: string; status?: number } = {};
	try {
		envelope = JSON.parse(bodyText);
	} catch {
		// Non-JSON (e.g. a 303 redirect to Stripe) — that's a pass: it means the
		// handler ran past validation and reached the checkout/redirect step.
	}
	expect(
		envelope.status,
		`payReservation returned a 400 validation error: ${bodyText.slice(0, 400)}`
	).not.toBe(400);

	// And the rendered page must never show the validation error text either.
	await expect(page.locator('body')).not.toContainText('Invalid option');
	await expect(page.locator('body')).not.toContainText('expected one of');

	// Nothing else in this flow may 500. The login, the pay page itself and the
	// remote query behind it are all covered by this — a regression that broke
	// any of them used to leave this test green (#546).
	expect(serverErrors, `unexpected server error(s): ${serverErrors.join(', ')}`).toEqual([]);
});
