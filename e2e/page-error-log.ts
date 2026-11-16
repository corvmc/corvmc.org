/** What one browser context said went wrong, kept until the test's outcome is known. */
export type PageErrorEntry = { kind: 'pageerror' | 'console.error'; url: string; text: string };

/** A page stuck in a retry loop must not bury the rest of the job log. */
const MAX_ENTRIES = 40;

/**
 * Report lines for one attempt, or `undefined` when there is nothing to say.
 *
 * Console errors print only for a failed attempt: every expected 403 and 404 is
 * one, so a green run would otherwise drown in them. An uncaught exception
 * prints either way, because a passing test does not make it expected.
 */
export function formatPageErrors(
	entries: PageErrorEntry[],
	test: { title: string; retry: number; failed: boolean }
): string | undefined {
	const shown = test.failed ? entries : entries.filter((e) => e.kind === 'pageerror');
	if (shown.length === 0) return undefined;

	const outcome = test.failed ? 'failed' : 'passed';
	const lines = [`[page-errors] ${test.title} (attempt ${test.retry}, ${outcome})`];
	for (const { kind, url, text } of shown.slice(0, MAX_ENTRIES)) {
		lines.push(`  ${kind} at ${url}`, ...text.split('\n').map((line) => `    ${line}`));
	}
	if (shown.length > MAX_ENTRIES) lines.push(`  ...and ${shown.length - MAX_ENTRIES} more`);
	return lines.join('\n');
}
