import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$lib/remote/bands.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	return {
		createBandApi: {
			enhance: () => ({ method: 'POST', action: '?/createBandApi' }),
			fields: {
				ownerId: field('ownerId'),
				name: field('name'),
				bio: field('bio'),
				allIssues: () => null
			},
			result: undefined
		}
	};
});

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`; a
// partial mock of this module is a missing-export error at import time rather
// than at the call.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const CreateBandAction = (await import('./CreateBandAction.svelte')).default;

const OWNERS = [
	{ id: 'user-7', name: 'Jane Doe', email: 'jane@example.dev' },
	{ id: 'user-8', name: 'Janet Ruiz', email: 'janet@example.dev' }
];

// `userEvent.type`, not `fill`: bits-ui's Combobox opens on real key events, so
// a programmatic value set leaves it closed with its results unrendered. The
// input is then swapped for a badge, which is how we know the pick committed.
const pick = async (name: string) => {
	const picker = page.getByRole('combobox');
	await picker.click();
	await userEvent.type(picker, name.slice(0, 3));
	await page.getByRole('option', { name: new RegExp(name) }).click();
	await vi.waitFor(() => expect(document.querySelector('[role="combobox"]')).toBeNull());
};

const open = async () => {
	await render(CreateBandAction, {});
	await page.getByRole('button', { name: 'New Band' }).first().click();
	return page.getByRole('dialog');
};

describe('CreateBandAction', () => {
	beforeEach(() => {
		// The owner picker searches over the network, not a remote function.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(OWNERS)))
		);
	});

	it('shows nothing until the trigger is used', async () => {
		await render(CreateBandAction, {});

		await expect.element(page.getByRole('button', { name: 'New Band' })).toBeVisible();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	// The trigger says "New Band" and the submit says "Create Band": one starts
	// the flow, the other ends it, and a modal whose button repeats its trigger
	// reads as a no-op.
	it('names the submit for what it does', async () => {
		await open();

		await expect.element(page.getByRole('button', { name: 'Create Band' })).toBeVisible();
	});

	it('takes a name and a bio under the names the handler reads', async () => {
		await open();

		expect(document.querySelector('input[name="name"]')).not.toBeNull();
		expect(document.querySelector('textarea[name="bio"]')).not.toBeNull();
	});

	// Staff create bands on someone else's behalf, so the owner is a choice
	// rather than the acting user. Nothing posts an ownerId until one is picked.
	it('posts no owner before one is chosen', async () => {
		await open();

		expect(document.querySelector('input[name="ownerId"]')).toBeNull();
		await expect.element(page.getByPlaceholder('Search by name or email...')).toBeVisible();
	});

	it('posts the chosen owner', async () => {
		await open();
		await pick('Janet Ruiz');

		const hidden = document.querySelector('input[name="ownerId"]') as HTMLInputElement;
		expect(hidden).not.toBeNull();
		expect(hidden.value).toBe('user-8');
	});

	// The picker collapses to a chip once a choice is made, and the chip's clear
	// button is the only way back — it is named because a bare ✕ is
	// indistinguishable from the modal's own close button.
	it('lets the choice be taken back', async () => {
		await open();
		await pick('Janet Ruiz');

		await page.getByRole('button', { name: 'Clear Janet Ruiz' }).click();

		await vi.waitFor(() => {
			expect(document.querySelector('input[name="ownerId"]')).toBeNull();
		});
	});
});
