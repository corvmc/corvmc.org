/**
 * The suite's `test`: a failed attempt says what the browser reported.
 *
 * A boundary catches a render error, so it never reaches `pageerror`; kit's
 * `handleError` prints it through `console.error` and nothing else records it.
 * A trace only exists from the first retry (`playwright.config.ts`), so a flake
 * whose retry passes would otherwise leave no error at all.
 */
import { test as base, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { formatPageErrors, type PageErrorEntry } from '../page-error-log';

export * from '@playwright/test';

/** Start recording `context`; the returned function reports on the attempt's outcome. */
export function recordPageErrors(context: BrowserContext, testInfo: TestInfo) {
	const entries: PageErrorEntry[] = [];
	context.on('weberror', (e) => {
		const error = e.error();
		entries.push({
			kind: 'pageerror',
			url: e.page()?.url() ?? '(no page)',
			text: error.stack ?? String(error)
		});
	});
	context.on('console', (message) => {
		if (message.type() !== 'error') return;
		entries.push({
			kind: 'console.error',
			url: message.page()?.url() ?? '(no page)',
			text: message.text()
		});
	});

	return async () => {
		const report = formatPageErrors(entries, {
			title: testInfo.titlePath.join(' > '),
			retry: testInfo.retry,
			failed: testInfo.status !== testInfo.expectedStatus
		});
		if (!report) return;
		// The list reporter forwards a worker's stderr, which puts this in the job log.
		process.stderr.write(`${report}\n`);
		await testInfo.attach('page-errors', { body: report, contentType: 'text/plain' });
	};
}

/**
 * Every `page.goto` in `context` resolves once the page has hydrated. A
 * server-rendered control is visible before then and a click or a change on it
 * is lost. A goto that names its own `waitUntil` is left alone, so a test can
 * still act before hydration on purpose. `src/routes/+layout.svelte` sets the
 * attribute.
 */
export function gotoAwaitsHydration(context: BrowserContext) {
	const patch = (page: Page) => {
		const goto = page.goto.bind(page);
		page.goto = async (url, options) => {
			const response = await goto(url, options);
			const html = response?.headers()['content-type']?.includes('text/html');
			if (!options?.waitUntil && html) {
				await page.locator('html[data-hydrated]').waitFor({ state: 'attached', timeout: 15_000 });
			}
			return response;
		};
	};
	context.pages().forEach(patch);
	context.on('page', patch);
}

export const test = base.extend({
	context: async ({ context }, use, testInfo) => {
		gotoAwaitsHydration(context);
		const report = recordPageErrors(context, testInfo);
		await use(context);
		await report();
	}
});
