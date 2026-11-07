import { expect, test, type Page } from './fixtures/test';
import { signInAs } from './fixtures/auth';
import {
	SEED_OWNER_EMAIL,
	SEED_OWNER_PASSWORD,
	SEED_PUBLIC_BAND_NAME,
	SEED_HIDDEN_BAND_SLUG,
	SEED_HIDDEN_BAND_NAME,
	SEED_MEMBERS_BAND_SLUG,
	SEED_MEMBERS_BAND_NAME,
	SEED_PREMIUM_BAND_SLUG,
	SEED_PREMIUM_BAND_NAME
} from './fixtures/seed-band-onboarding';
import {
	SEED_HIDDEN_SLUG,
	SEED_JOINABLE_INSTRUCTIONS,
	SEED_JOINABLE_NAME,
	SEED_JOINABLE_SLUG
} from './fixtures/seed-groups';

/**
 * Runs against build + preview on purpose. In the minified build a sibling derived
 * reading a rejected query reached the boundary with a Svelte-internals TypeError
 * before the real 404, and dev builds never showed it. Public pages server-render
 * their queries, so the gate is a real HTTP 404 from +error.svelte, not a 200 shell.
 */
const withheld: { path: string; leak?: string }[] = [
	{ path: `/directory/bands/${SEED_HIDDEN_BAND_SLUG}`, leak: SEED_HIDDEN_BAND_NAME },
	{ path: `/directory/bands/${SEED_MEMBERS_BAND_SLUG}`, leak: SEED_MEMBERS_BAND_NAME },
	{ path: '/directory/bands/does-not-exist-xyz' },
	{ path: '/directory/members/does-not-exist-xyz' }
];

/** The error page renders `page.status`, so the heading is the render gate for the rest. */
async function expectReal404(page: Page, { path, leak }: { path: string; leak?: string }) {
	const response = await page.goto(path);
	expect.soft(response?.status(), path).toBe(404);
	await expect
		.soft(page.getByRole('heading', { level: 1 }), path)
		.toHaveText(`${response?.status()}`);
	await expect.soft(page.locator('[data-boundary-failed]'), path).toHaveCount(0);
	if (leak) await expect.soft(page.getByText(leak), path).toHaveCount(0);
}

test('a signed-out visitor sees only what is public', async ({ page }) => {
	test.setTimeout(120_000);

	await test.step('hidden and missing profiles are real 404s', async () => {
		for (const row of withheld) await expectReal404(page, row);
	});

	await test.step('the band directory lists only the public band', async () => {
		await page.goto('/directory');
		// One named band, not a count: the card count depends on other suites' fixtures.
		await expect(page.getByRole('link', { name: new RegExp(SEED_PUBLIC_BAND_NAME) })).toBeVisible();
		await expect(page.getByRole('link', { name: new RegExp(SEED_HIDDEN_BAND_NAME) })).toHaveCount(
			0
		);
		await expect(page.getByRole('link', { name: new RegExp(SEED_MEMBERS_BAND_NAME) })).toHaveCount(
			0
		);
	});

	await test.step('public groups are listed, and offer a way back in', async () => {
		await page.goto('/groups');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await expect(page.getByRole('link', { name: SEED_JOINABLE_NAME })).toBeVisible();

		await page.goto(`/groups/${SEED_JOINABLE_SLUG}`);
		await expect(page.getByRole('heading', { name: SEED_JOINABLE_NAME })).toBeVisible();
		await expect(page.getByText(SEED_JOINABLE_INSTRUCTIONS)).toBeVisible();
		// Scoped to `main`: the public header carries its own sign-in link. The address
		// is the point: it brings them back to this group.
		const signIn = page
			.getByRole('main')
			.locator(`a[href="/login?redirect=${encodeURIComponent(`/groups/${SEED_JOINABLE_SLUG}`)}"]`);
		await expect(signIn).toBeVisible();

		const hidden = await page.goto(`/groups/${SEED_HIDDEN_SLUG}`);
		expect(hidden?.status()).toBe(404);
	});

	await test.step('a public band site carries none of the editor chrome', async () => {
		await page.goto(`/band-site/${SEED_PREMIUM_BAND_SLUG}`);
		await expect(page.getByText(SEED_PREMIUM_BAND_NAME).first()).toBeVisible();

		// One component draws both surfaces, so these are the leak detectors.
		await expect(page.getByLabel(/^Move /)).toHaveCount(0);
		await expect(page.getByLabel(/^Stop publishing /)).toHaveCount(0);
		await expect(page.locator('.editor-chrome')).toHaveCount(0);
		// An empty block stays empty in public: the ghost link is editor-only.
		await expect(page.locator(`a[href="/band/${SEED_PREMIUM_BAND_SLUG}/events"]`)).toHaveCount(0);
	});

	await test.step('the members-only band renders once signed in', async () => {
		await signInAs(page, { email: SEED_OWNER_EMAIL, password: SEED_OWNER_PASSWORD });
		await page.goto(`/member/directory/bands/${SEED_MEMBERS_BAND_SLUG}`);
		await expect(page.getByText(SEED_MEMBERS_BAND_NAME).first()).toBeVisible();
	});
});
