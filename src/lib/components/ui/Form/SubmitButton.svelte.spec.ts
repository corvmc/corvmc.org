import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet, type ComponentProps } from 'svelte';
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

	// #2839: with a default label, a submit that withdraws or sends read "Save".
	// The props type now refuses a button with neither label nor children;
	// svelte-check runs over this file, so an unused directive fails CI.
	it('cannot be given neither a label nor children', () => {
		type Props = ComponentProps<typeof SubmitButton>;
		// @ts-expect-error -- a submit must name its action
		const unnamed: Props = { variant: 'primary' };
		const labelled: Props = { label: LABEL };
		const withChildren: Props = { children: text(CHILDREN) };

		expect([unnamed, labelled, withChildren]).toHaveLength(3);
	});
});
