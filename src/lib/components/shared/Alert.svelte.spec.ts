import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AlertHarness from './Alert.test.svelte';

/**
 * The client counterpart to `Alert.ssr.spec.ts`: rendered in the browser the
 * children are appended as nodes, so a `<p>` wrapper does not get broken apart
 * by the parser — it just holds invalid markup that hydration then has to
 * reconcile against the server's fixed-up DOM.
 */
describe('Alert with block-level children', () => {
	it('does not nest block content inside a paragraph', async () => {
		render(AlertHarness);

		await expect.element(page.getByRole('alert')).toBeInTheDocument();
		expect(document.querySelectorAll('p p, p ul, p div')).toHaveLength(0);
	});
});
