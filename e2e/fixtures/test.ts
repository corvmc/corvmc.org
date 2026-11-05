/**
 * The suite's `test`: a failed attempt says what the browser reported.
 *
 * A boundary catches a render error, so it never reaches `pageerror`; kit's
 * `handleError` prints it through `console.error` and nothing else records it.
 * A trace only exists from the first retry (`playwright.config.ts`), so a flake
 * whose retry passes would otherwise leave no error at all.
 */
import { test as base, type BrowserContext, type TestInfo } from '@playwright/test';
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

export const test = base.extend({
	context: async ({ context }, use, testInfo) => {
		const report = recordPageErrors(context, testInfo);
		await use(context);
		await report();
	}
});
