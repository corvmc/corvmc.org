/**
 * Playwright global setup: reject a stale preview server, then warm the real one.
 *
 * Runs once per `playwright test` invocation. Playwright builds its startup
 * tasks as [remove output dirs, plugin setup, global setup], and `webServer` is
 * a plugin whose setup polls the URL until it responds — so by the time this
 * hook runs the preview server is already up and reachable. That makes it the
 * right place to check *which* build is being served, and the wrong place to
 * touch the database: migrating and seeding from here ran a second miniflare
 * against the state directory while the server held it, which killed the runtime
 * outright once the file needed recovery. That work moved to `e2e/prepare.ts`,
 * which the `test:e2e` script runs before Playwright starts.
 */
import { readFile } from 'node:fs/promises';
import type { FullConfig } from '@playwright/test';
import { E2E_PREVIEW_PORT } from './state-dir';

/**
 * Guard against a zombie `vite preview` serving a stale build.
 *
 * `playwright.config.ts` sets `reuseExistingServer: !CI`, so when anything is
 * already listening on the preview port Playwright skips `npm run build && npm
 * run preview` entirely and points the tests at whatever is there. A preview
 * left running by an old — even since-deleted — worktree gets adopted silently:
 * the suite then tests a build that is not this checkout, and before commit
 * 9c6ace4 that server's errors also landed in production Sentry tagged
 * environment:production (JAVASCRIPT-SVELTEKIT-1V/1W/1X/1Y/1Z).
 *
 * SvelteKit stamps each build with a unique version and `vite preview` serves
 * it with sirv straight out of `.svelte-kit/output/client`, so the served
 * `/_app/version.json` and the on-disk one are the same file for a legitimate
 * local preview and differ for an adopted foreign one.
 */
async function assertPreviewMatchesBuild(config: FullConfig) {
	const port = config.webServer?.port ?? E2E_PREVIEW_PORT;

	let served: string | undefined;
	try {
		const response = await fetch(`http://localhost:${port}/_app/version.json`);
		if (!response.ok) return; // not a SvelteKit preview; let the tests report it
		served = ((await response.json()) as { version?: string }).version;
	} catch {
		return; // unreachable: not staleness, and the tests will fail loudly anyway
	}
	if (!served) return;

	let built: string | undefined;
	try {
		const onDisk = new URL('../.svelte-kit/output/client/_app/version.json', import.meta.url);
		built = JSON.parse(await readFile(onDisk, 'utf8')).version;
	} catch {
		// No local build at all, yet something answers on the preview port — that
		// server certainly is not this checkout. Fall through and abort.
	}

	if (built === served) return;

	throw new Error(
		[
			`Stale preview server on port ${port} — aborting before any test runs.`,
			``,
			`  serving build: ${served}`,
			`  local build:   ${built ?? '<none: .svelte-kit/output/client/_app/version.json is missing>'}`,
			``,
			`Playwright reused an existing server instead of rebuilding, so this run`,
			`would test a build that is not this checkout. Kill it and re-run:`,
			``,
			`  lsof -ti:${port} | xargs kill`,
			``
		].join('\n')
	);
}

/**
 * Make the server open its D1 while it is still the only process on the file.
 *
 * workerd opens its SQLite *lazily, on the first request*, and if the file's WAL
 * needs recovering it wants an exclusive lock to do it. Playwright's workers each
 * open a read-only `readLocalDb` connection on that same file, and workerd does
 * not retry — it dies outright, taking the suite with it (#793). Checkpointing
 * before the server starts (`e2e/checkpoint.ts`) makes recovery unlikely; it
 * cannot make workerd open the file at a safe *moment*. This hook can: Playwright
 * runs it after the web server is up and before any worker exists, so the first
 * request is made here, deliberately, with no reader to lose the race to.
 *
 * `/sitemap.xml` because it is server-only, unauthenticated, reads D1, and
 * renders no page. D1 is the file that matters: it is the only one in the state
 * directory that anything other than the server opens during a run.
 */
async function warmPlatformBindings(port: number) {
	let response: Response;
	try {
		response = await fetch(`http://localhost:${port}/sitemap.xml`);
	} catch (cause) {
		throw new Error(
			[
				`The e2e web server did not start — port ${port} was open, then answered nothing.`,
				``,
				`Its first request is what opens the run's SQLite, so a server that dies here`,
				`died of the SQLITE_BUSY_RECOVERY race (#793) rather than of anything a test did.`,
				`Re-run \`pnpm test:e2e\`, which re-prepares and re-checkpoints the state directory.`,
				``
			].join('\n'),
			{ cause }
		);
	}

	// A response of any status means the request reached the app and the bindings
	// are open, which is all this is for. A bad one is still worth saying.
	if (!response.ok) {
		console.warn(`Warm-up request to /sitemap.xml answered ${response.status}.`);
	}
}

export default async function globalSetup(config: FullConfig) {
	await assertPreviewMatchesBuild(config);
	await warmPlatformBindings(config.webServer?.port ?? E2E_PREVIEW_PORT);
}
