import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Harness from './Alert.test.svelte';

/**
 * Alert used to wrap its children in a `<p>`. Four call sites pass block-level
 * content — a paragraph under a heading line, a `<ul>` of sync errors — and the
 * HTML parser closes an open `<p>` the moment it meets one, so the server-sent
 * markup came apart on the way into the DOM. `.alert` is a grid, so the freed
 * paragraph and list each became their own column instead of stacking inside the
 * box. The wrapper has to accept flow content.
 */
describe('Alert server rendering', () => {
	it('wraps block-level children in an element that can hold them', async () => {
		const { body } = await render(Harness);

		expect(body).toContain('role="alert"');
		expect(body.match(/role="alert"><(\w+)/)?.[1]).not.toBe('p');
	});

	it('keeps the block content in the markup it sends', async () => {
		const { body } = await render(Harness);

		expect(body).toContain('<p class="mt-1">Fix it below and submit it again.</p>');
		expect(body).toContain('<li>The date is in the past.</li>');
	});
});
