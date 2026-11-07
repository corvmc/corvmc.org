import { test, expect } from './fixtures/test';
import { freshSignIn, signInAs } from './fixtures/auth';
import { SEED_STAFF_EMAIL, SEED_STAFF_PASSWORD } from './fixtures/seed-staff-user';

const STAFF = { email: SEED_STAFF_EMAIL, password: SEED_STAFF_PASSWORD };
const RUNS = 5;

// Temporary, for the journey timing experiment. `signInAs` is what the specs call
// and caches per worker; `freshSignIn` is the POST it caches. Page timings show
// what a new context costs beyond the session: no HTTP cache to reuse.
test('login timing', async ({ browser }) => {
	test.setTimeout(180_000);
	const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL;

	for (let run = 1; run <= RUNS; run++) {
		const started = performance.now();
		const context = await browser.newContext({ baseURL });
		const page = await context.newPage();
		const opened = performance.now();
		await signInAs(page, STAFF);
		const signedIn = performance.now();
		expect(await context.cookies()).not.toHaveLength(0);

		await page.goto('/staff/events');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		const cold = performance.now();
		await page.goto('/staff/events');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		const warm = performance.now();

		console.log(`LOGIN_MS kind=newContext run=${run} ms=${Math.round(opened - started)}`);
		console.log(`LOGIN_MS kind=signInAs run=${run} ms=${Math.round(signedIn - opened)}`);
		console.log(`LOGIN_MS kind=coldGoto run=${run} ms=${Math.round(cold - signedIn)}`);
		console.log(`LOGIN_MS kind=warmGoto run=${run} ms=${Math.round(warm - cold)}`);
		await context.close();
	}

	for (let run = 1; run <= RUNS; run++) {
		const context = await browser.newContext({ baseURL });
		const page = await context.newPage();
		const started = performance.now();
		await freshSignIn(page, STAFF);
		console.log(
			`LOGIN_MS kind=freshSignIn run=${run} ms=${Math.round(performance.now() - started)}`
		);
		expect(await context.cookies()).not.toHaveLength(0);
		await context.close();
	}
});
