import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SplitBar from './SplitBar.svelte';

/**
 * The "Adjust exactly" input is the accessible path to the same allocation the
 * drag performs, and the drag snaps to whole cents. A `step` coarser than a
 * cent makes positions the bar can reach — and the suggested share it opens at
 * — invalid to the browser, which blocks submission of the whole form it sits
 * in. The failure is silent: the input lives inside a closed `<details>`, so
 * the browser cannot even focus it to report the problem.
 */

const exactInput = () => document.querySelector<HTMLInputElement>('details input[type="number"]')!;

describe('SplitBar exact-amount input', () => {
	it('accepts any whole-cent value the bar can reach', async () => {
		// 30% of a $20 ticket's divisible amount — where the ticket split bar
		// opens on a fresh page load.
		await render(SplitBar, {
			totalCents: 2000,
			value: 574,
			onchange: () => {},
			fixedCents: 88,
			valueLabel: 'The Collective',
			otherLabel: 'The acts'
		});

		const input = exactInput();
		expect(input.value).toBe('5.74');
		expect(input.validationMessage).toBe('');
		expect(input.checkValidity()).toBe(true);
	});

	it('rejects an amount above the movable maximum', async () => {
		await render(SplitBar, {
			totalCents: 2000,
			value: 574,
			onchange: () => {},
			fixedCents: 88,
			valueLabel: 'The Collective',
			otherLabel: 'The acts'
		});

		const input = exactInput();
		input.value = '99.99';
		expect(input.checkValidity()).toBe(false);
	});
});
