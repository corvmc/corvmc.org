import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SplitBar from './SplitBar.svelte';

// The app stylesheet, so `user-select` below resolves against real Tailwind
// output rather than the browser default. The `client` project loads no CSS of
// its own.
import '../../../routes/layout.css';

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

/**
 * The track is the drag surface. Without `user-select: none` a drag doubles as a
 * text selection, so the segment labels highlight under the pointer and stay
 * highlighted afterwards. And the labels themselves are amounts only — the
 * legend below the bar and `aria-valuetext` both name every segment, so a name
 * inside the bar costs width that decides whether the amount renders at all.
 */

const trackEl = () => document.querySelector<HTMLDivElement>('[role="presentation"]')!;

describe('SplitBar track', () => {
	const props = {
		totalCents: 2000,
		value: 574,
		onchange: () => {},
		fixedCents: 88,
		valueLabel: 'The Collective',
		otherLabel: 'The acts'
	};

	it('cannot be selected by dragging across it', async () => {
		await render(SplitBar, props);

		expect(getComputedStyle(trackEl()).userSelect).toBe('none');
	});

	it('labels each segment with the amount alone', async () => {
		await render(SplitBar, props);

		const text = trackEl().textContent ?? '';
		expect(text).toContain('$13.38');
		expect(text).toContain('$5.74');
		expect(text).not.toContain('The acts');
		expect(text).not.toContain('The Collective');
	});

	it('hides the amount in a segment too narrow to hold it', async () => {
		await render(SplitBar, props);

		// 88¢ of $20 is 4% of the track — the `title` is all that segment has.
		expect(trackEl().textContent).not.toContain('$0.88');
	});

	it('still names each segment on hover', async () => {
		await render(SplitBar, props);

		const titles = [...trackEl().children].map((el) => el.getAttribute('title'));
		expect(titles).toEqual(['The acts $13.38', 'The Collective $5.74', 'Fees $0.88']);
	});
});

/**
 * The slider is `sr-only`, so 1x1 — correct for a screen reader and nothing at
 * all for somebody who uses a keyboard and can see, who tabbed from "$30.00"
 * into apparently nothing (#995). The ring goes on the bar, which is why this
 * reads the parent. A real focus, because the rule is `:focus-visible`.
 */
describe('SplitBar focus visibility', () => {
	it('rings the bar when the slider is focused by keyboard', async () => {
		await render(SplitBar, {
			totalCents: 2000,
			value: 574,
			onchange: () => {},
			fixedCents: 88,
			valueLabel: 'The Collective',
			otherLabel: 'The acts'
		});

		const slider = document.querySelector<HTMLElement>('[role="slider"]')!;
		const ringed = slider.parentElement!;
		expect(getComputedStyle(ringed).outlineStyle).toBe('none');

		slider.focus();
		// `:focus-visible` needs the browser to believe the focus was not a click.
		slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

		const ring = getComputedStyle(ringed);
		expect(ring.outlineStyle).not.toBe('none');
		expect(parseFloat(ring.outlineWidth)).toBeGreaterThan(0);
	});
});
