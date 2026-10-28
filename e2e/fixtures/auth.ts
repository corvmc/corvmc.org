/**
 * Signed-in pages without a UI login per test: each persona signs in once per
 * worker, through the endpoint `/login` posts to, and later tests reuse the
 * cookie. Specs about signing in keep driving the form instead.
 *
 * A shared session is only safe for a test that leaves it valid. One that signs
 * out, changes the password or bans the user takes `freshSignIn`.
 */
import { test as base, expect, request, type Page } from '@playwright/test';

export { expect };

export type Persona = { email: string; password: string };

type StorageState = Awaited<
	ReturnType<import('@playwright/test').APIRequestContext['storageState']>
>;

// One per worker: each Playwright worker is its own process, so module state
// lives exactly as long as the worker does, across every file it runs.
const sessions = new Map<string, Promise<StorageState>>();

/** `playwright.config.ts` sets no baseURL; the webServer plugin exports this. */
function baseURL(): string {
	const url = process.env.PLAYWRIGHT_TEST_BASE_URL;
	if (!url) throw new Error('PLAYWRIGHT_TEST_BASE_URL is unset; is the webServer configured?');
	return url;
}

/**
 * The sign-in `/login` makes, minus the page. better-auth's limiter is off for
 * local origins (`authRateLimitEnabled`), so a burst of these is not throttled.
 */
async function mint({ email, password }: Persona): Promise<StorageState> {
	const origin = baseURL();
	const ctx = await request.newContext({ baseURL: origin });
	try {
		const res = await ctx.post('/api/auth/sign-in/email', {
			data: { email, password },
			headers: { origin }
		});
		if (!res.ok()) {
			throw new Error(`Sign-in as ${email} answered ${res.status()}: ${await res.text()}`);
		}
		return await ctx.storageState();
	} finally {
		await ctx.dispose();
	}
}

function cachedSession(persona: Persona): Promise<StorageState> {
	let session = sessions.get(persona.email);
	if (!session) {
		session = mint(persona);
		// A failed sign-in must not poison every later test in the worker.
		session.catch(() => sessions.delete(persona.email));
		sessions.set(persona.email, session);
	}
	return session;
}

/** Swap `page`'s context onto `persona`'s shared session. */
export async function signInAs(page: Page, persona: Persona): Promise<void> {
	const { cookies } = await cachedSession(persona);
	await page.context().clearCookies();
	await page.context().addCookies(cookies);
}

/** A session of the test's own, for a test that ends it or invalidates it. */
export async function freshSignIn(page: Page, persona: Persona): Promise<void> {
	const { cookies } = await mint(persona);
	await page.context().clearCookies();
	await page.context().addCookies(cookies);
}

/**
 * `test.use({ persona })` starts every `page` signed in. `authedPage(persona)`
 * opens a second, independent context for a test that needs two people at once.
 */
export const test = base.extend<{
	persona: Persona | null;
	authedPage: (persona: Persona) => Promise<Page>;
}>({
	persona: [null, { option: true }],
	storageState: async ({ persona, storageState }, use) => {
		await use(persona ? await cachedSession(persona) : storageState);
	},
	authedPage: async ({ browser }, use) => {
		const opened: Array<{ close(): Promise<void> }> = [];
		await use(async (persona) => {
			const context = await browser.newContext({
				baseURL: baseURL(),
				storageState: await cachedSession(persona)
			});
			opened.push(context);
			return context.newPage();
		});
		await Promise.all(opened.map((c) => c.close()));
	}
});
