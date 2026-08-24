import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ButtonHarness from './Button.test.svelte';

/**
 * `title` renders the button inside a bits-ui `Tooltip.Trigger`, which defaults
 * to rendering its own `<button>`. That produced `<button><button>…</button></button>`
 * for every icon-only Action in the app: invalid HTML, a duplicate tab stop, and —
 * because the accessibility tree does not expose an interactive descendant of a
 * button — a control that vanished from the a11y tree despite a correct aria-label.
 * The trigger must merge its props onto the button instead of wrapping it.
 */

const nested = () => document.querySelectorAll('button button, button a, a button, a a');

describe('Button variants', () => {
	/** The rendered control's classes, found by its accessible name. */
	const classesOf = (name: string, role: 'button' | 'link' = 'button') =>
		(page.getByRole(role, { name }).element() as HTMLElement).className.split(/\s+/);

	it('defaults to primary', async () => {
		render(ButtonHarness, { label: 'Save' });

		await expect.element(page.getByRole('button', { name: 'Save' })).toBeInTheDocument();
		expect(classesOf('Save')).toContain('btn-primary');
	});

	it('emits no colour class for the default variant', async () => {
		render(ButtonHarness, { label: 'Plain', variant: 'default' });

		await expect.element(page.getByRole('button', { name: 'Plain' })).toBeInTheDocument();
		expect(classesOf('Plain').filter((c) => c.startsWith('btn-'))).toHaveLength(0);
	});

	it('stacks outline on top of a colour rather than replacing it', async () => {
		render(ButtonHarness, { label: 'Delete', variant: 'error', outline: true });

		await expect.element(page.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
		expect(classesOf('Delete')).toEqual(expect.arrayContaining(['btn-error', 'btn-outline']));
	});

	it('writes size and shape out in full so Tailwind can see them', async () => {
		render(ButtonHarness, { label: 'X', size: 'xs', shape: 'square' });

		await expect.element(page.getByRole('button', { name: 'X' })).toBeInTheDocument();
		expect(classesOf('X')).toEqual(expect.arrayContaining(['btn-xs', 'btn-square']));
	});

	/**
	 * `SubmitButton` renders `<Button type="submit">`, so a lost `type` would
	 * turn every save button in the app into a no-op. bits-ui's Button.Root
	 * supplies its own default, and `mergeProps` has to let the caller's win.
	 */
	it('forwards type through to the underlying button', async () => {
		render(ButtonHarness, { label: 'Save', type: 'submit' });

		await expect.element(page.getByRole('button', { name: 'Save' })).toBeInTheDocument();
		expect((page.getByRole('button', { name: 'Save' }).element() as HTMLButtonElement).type).toBe(
			'submit'
		);
	});

	/**
	 * `class` is an escape hatch for one-offs, but people reach for it with
	 * daisyUI colours out of habit. Two colour classes on one button is a
	 * coin-flip decided by stylesheet order, so an explicit one wins outright
	 * and the `primary` default steps aside.
	 */
	it('lets a colour passed through class suppress the default', async () => {
		render(ButtonHarness, { label: 'Legacy', class: 'btn-ghost' });

		await expect.element(page.getByRole('button', { name: 'Legacy' })).toBeInTheDocument();
		const classes = classesOf('Legacy');
		expect(classes).toContain('btn-ghost');
		expect(classes).not.toContain('btn-primary');
	});

	it('keeps a non-colour class alongside the default variant', async () => {
		render(ButtonHarness, { label: 'Spaced', class: 'mt-4' });

		await expect.element(page.getByRole('button', { name: 'Spaced' })).toBeInTheDocument();
		expect(classesOf('Spaced')).toEqual(expect.arrayContaining(['btn-primary', 'mt-4']));
	});
});

describe('Button with a tooltip', () => {
	it('does not nest an interactive element inside another', async () => {
		render(ButtonHarness, { title: 'Save changes', label: 'Save' });

		await expect.element(page.getByRole('button', { name: 'Save' })).toBeInTheDocument();
		expect(nested()).toHaveLength(0);
	});

	it('renders an href button as a single anchor', async () => {
		render(ButtonHarness, { title: 'Go home', href: '/', label: 'Home' });

		await expect.element(page.getByRole('link', { name: 'Home' })).toBeInTheDocument();
		expect(nested()).toHaveLength(0);
	});

	it('keeps the caller onclick when the tooltip trigger adds its own', async () => {
		const onclick = vi.fn();
		render(ButtonHarness, { title: 'Save changes', label: 'Save', onclick });

		await page.getByRole('button', { name: 'Save' }).click();
		expect(onclick).toHaveBeenCalledOnce();
	});

	/**
	 * Regression: a disabled `<button title="…">` was converted to `<Button>`,
	 * whose `title` becomes a bits-ui tooltip. A disabled trigger gets no hover
	 * events, so the tooltip never opened and the explanation for *why* the
	 * control was disabled became unreachable. Caught by
	 * e2e/community-events.e2e.ts, which asserts the attribute directly.
	 */
	it('falls back to a native title attribute when disabled', async () => {
		render(ButtonHarness, {
			title: "Events with tickets can't be deleted",
			label: 'Delete',
			disabled: true
		});

		const button = page.getByRole('button', { name: 'Delete', includeHidden: true });
		await expect.element(button).toHaveAttribute('title', "Events with tickets can't be deleted");
	});

	it('shows the tooltip on hover', async () => {
		render(ButtonHarness, { title: 'Save changes', label: 'Save' });

		await page.getByRole('button', { name: 'Save' }).hover();
		await expect.element(page.getByText('Save changes')).toBeVisible();
	});
});
