import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '#lib/test/locators.js';

const remoteForm = (action: string) => ({
	enhance: () => ({ method: 'POST', action }),
	fields: new Proxy({ allIssues: () => null } as Record<string, unknown>, {
		get: (target, key: string) =>
			target[key] ?? {
				as: (type: string, value?: unknown) => ({ type, name: key, value }),
				issues: () => null
			}
	}),
	result: undefined
});

const attachable = vi.hoisted(() => ({
	rows: [] as { id: string; title: string; startsAt: Date }[]
}));

vi.mock('#lib/remote/productions.remote.js', () => ({
	createProduction: remoteForm('?/createProduction'),
	createShow: remoteForm('?/createShow'),
	getAttachableListings: vi.fn(async () => attachable.rows)
}));
vi.mock('#lib/remote/events.remote.js', () => ({
	createEvent: remoteForm('?/createEvent'),
	getProgramGroups: vi.fn(async () => [])
}));
vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const NewProductionModal = (await import('./NewProductionModal.svelte')).default;

describe('NewProductionModal', () => {
	it('attaches the production to a show already on the calendar', async () => {
		attachable.rows = [
			{ id: 'evt-1', title: 'Friday Fuzz', startsAt: new Date('2026-11-07T03:00:00Z') }
		];
		await render(NewProductionModal, { open: true });

		const select = page.getByLabelText('Listing');
		await expect.element(select).toBeVisible();
		await expect.element(select).toHaveValue('evt-1');
		expect(select.element().querySelectorAll('option[value="evt-1"]')).toHaveLength(1);
		expect(document.querySelector('form')?.getAttribute('action')).toBe('?/createProduction');
	});

	it('creates the listing through the listing form when there is none to attach to', async () => {
		attachable.rows = [];
		await render(NewProductionModal, { open: true });

		// Nothing to attach: no Listing picker, and the footer's last button creates one.
		const footer = page.getByRole('dialog').getByCss('.modal-action button');
		await expect.element(footer.last()).toBeVisible();
		expect(document.querySelector('form')).toBeNull();
		await footer.last().click();

		await expect.element(page.getByLabelText('Title')).toBeVisible();
		// #1947: a show with its production, so kind and "Run by" are not the staffer's to pick.
		await expect.element(page.getByLabelText('Kind')).not.toBeInTheDocument();
		await expect.element(page.getByLabelText('Run by')).not.toBeInTheDocument();
		expect(document.querySelector('form')?.getAttribute('action')).toBe('?/createShow');
	});
});
