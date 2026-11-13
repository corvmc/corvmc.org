import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import InForm from './InForm.test.svelte';
import SubmitButton from './SubmitButton.svelte';

const text = (value: string) => createRawSnippet(() => ({ render: () => `<span>${value}</span>` }));

describe('SubmitButton', () => {
	// #2804: children were spread into Button and lost, so every caller that
	// passed its text this way rendered the default label instead.
	it('renders the children it is given', async () => {
		await render(InForm, {
			component: SubmitButton,
			with: { children: text('Children text') }
		});

		await expect.element(page.getByRole('button')).toHaveTextContent('Children text');
	});

	it('renders its label prop when it has no children', async () => {
		await render(InForm, { component: SubmitButton, with: { label: 'Label text' } });

		await expect.element(page.getByRole('button')).toHaveTextContent('Label text');
	});
});
