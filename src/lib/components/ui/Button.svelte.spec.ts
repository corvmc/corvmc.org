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

/** The harness renders one control, so its role alone finds it inside the container. */
const mount = async (props: Record<string, unknown>, role: 'button' | 'link' = 'button') => {
	const screen = await render(ButtonHarness, props as never);
	return screen.locator.getByRole(role);
};

describe('Button variants', () => {
	/** The rendered control's classes. */
	const classesOf = (control: { element(): Element }) =>
		(control.element() as HTMLElement).className.split(/\s+/);

	it('defaults to primary', async () => {
		const control = await mount({ label: 'Save' });

		await expect.element(control).toBeInTheDocument();
		expect(classesOf(control)).toContain('btn-primary');
	});

	it('emits no colour class for the default variant', async () => {
		const control = await mount({ label: 'Plain', variant: 'default' });

		await expect.element(control).toBeInTheDocument();
		expect(classesOf(control).filter((c) => c.startsWith('btn-'))).toHaveLength(0);
	});

	it('stacks outline on top of a colour rather than replacing it', async () => {
		const control = await mount({ label: 'Delete', variant: 'error', outline: true });

		await expect.element(control).toBeInTheDocument();
		expect(classesOf(control)).toEqual(expect.arrayContaining(['btn-error', 'btn-outline']));
	});

	it('writes size and shape out in full so Tailwind can see them', async () => {
		const control = await mount({ label: 'X', size: 'xs', shape: 'square' });

		await expect.element(control).toBeInTheDocument();
		expect(classesOf(control)).toEqual(expect.arrayContaining(['btn-xs', 'btn-square']));
	});

	/**
	 * `SubmitButton` renders `<Button type="submit">`, so a lost `type` would
	 * turn every save button in the app into a no-op. bits-ui's Button.Root
	 * supplies its own default, and `mergeProps` has to let the caller's win.
	 */
	it('forwards type through to the underlying button', async () => {
		const control = await mount({ label: 'Save', type: 'submit' });

		await expect.element(control).toBeInTheDocument();
		expect((control.element() as HTMLButtonElement).type).toBe('submit');
	});

	/**
	 * `class` is an escape hatch for one-offs, but people reach for it with
	 * daisyUI colours out of habit. Two colour classes on one button is a
	 * coin-flip decided by stylesheet order, so an explicit one wins outright
	 * and the `primary` default steps aside.
	 */
	it('lets a colour passed through class suppress the default', async () => {
		const control = await mount({ label: 'Legacy', class: 'btn-ghost' });

		await expect.element(control).toBeInTheDocument();
		const classes = classesOf(control);
		expect(classes).toContain('btn-ghost');
		expect(classes).not.toContain('btn-primary');
	});

	it('keeps a non-colour class alongside the default variant', async () => {
		const control = await mount({ label: 'Spaced', class: 'mt-4' });

		await expect.element(control).toBeInTheDocument();
		expect(classesOf(control)).toEqual(expect.arrayContaining(['btn-primary', 'mt-4']));
	});
});

describe('Button with a tooltip', () => {
	it('does not nest an interactive element inside another', async () => {
		const control = await mount({ title: 'Save changes', label: 'Save' });

		await expect.element(control).toBeInTheDocument();
		expect(nested()).toHaveLength(0);
	});

	it('renders an href button as a single anchor', async () => {
		const control = await mount({ title: 'Go home', href: '/', label: 'Home' }, 'link');

		await expect.element(control).toBeInTheDocument();
		expect(nested()).toHaveLength(0);
	});

	it('keeps the caller onclick when the tooltip trigger adds its own', async () => {
		const onclick = vi.fn();
		const control = await mount({ title: 'Save changes', label: 'Save', onclick });

		await control.click();
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
		const title = "Events with tickets can't be deleted";
		const { locator } = await render(ButtonHarness, { title, label: 'Delete', disabled: true });

		const button = locator.getByRole('button', { includeHidden: true });
		await expect.element(button).toHaveAttribute('title', title);
	});

	it('shows the tooltip on hover', async () => {
		const title = 'Save changes';
		const control = await mount({ title, label: 'Save' });

		await control.hover();
		await expect.element(page.getByText(title)).toBeVisible();
	});
});
