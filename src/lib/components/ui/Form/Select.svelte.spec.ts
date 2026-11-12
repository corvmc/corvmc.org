import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import Select from './Select.svelte';
import '../../../../routes/layout.css';

const options = createRawSnippet(() => ({ render: () => '<option>All statuses</option>' }));

/**
 * `@tailwindcss/forms` pads every `select` by 0.5rem on each side. Inside
 * daisyUI's fixed-height wrapper that leaves less room than one line, and
 * Firefox (no `appearance: base-select`) draws the text below the top padding.
 */
describe('Select', () => {
	it.each(['sm', 'md'] as const)(
		'leaves no vertical padding on the inner control (%s)',
		async (size) => {
			const { container } = await render(Select, { size, children: options });
			const style = getComputedStyle(container.querySelector('select')!);
			expect([style.paddingTop, style.paddingBottom]).toEqual(['0px', '0px']);
		}
	);
});
