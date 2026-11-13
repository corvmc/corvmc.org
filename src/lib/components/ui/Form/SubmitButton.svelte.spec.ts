import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import InForm from './InForm.test.svelte';
import SubmitButton from './SubmitButton.svelte';

// Test markers, not UI copy: the assertion is that the given text arrives.
const CHILDREN = 'children-marker';
const LABEL = 'label-marker';
const text = (value: string) => createRawSnippet(() => ({ render: () => `<span>${value}</span>` }));

describe('SubmitButton', () => {
	// #2804: children were spread into Button and lost, so every caller that
	// passed its text this way rendered the default label instead.
	it('renders the children it is given', async () => {
		await render(InForm, {
			component: SubmitButton,
			with: { children: text(CHILDREN) }
		});

		await expect.element(page.getByRole('button')).toHaveTextContent(CHILDREN);
	});

	it('renders its label prop when it has no children', async () => {
		await render(InForm, { component: SubmitButton, with: { label: LABEL } });

		await expect.element(page.getByRole('button')).toHaveTextContent(LABEL);
	});
});
