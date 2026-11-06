import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '#lib/test/locators.js';

const remote = vi.hoisted(() => (value: () => unknown = () => undefined) => {
	const fields = new Proxy({ allIssues: () => null } as Record<string, unknown>, {
		get: (target, key: string) =>
			target[key] ?? {
				as: (type: string, v?: unknown) => ({ type, name: key, value: v }),
				issues: () => null,
				value: () => undefined
			}
	});
	const fn = Object.assign(
		() => Object.assign(Promise.resolve(value()), { refresh: () => Promise.resolve() }),
		{ enhance: () => ({ method: 'POST' }), fields, result: undefined, pending: 0 }
	);
	return Object.assign(fn, { for: () => fn });
});

vi.mock('#lib/remote/projects.remote.js', () => ({
	getProjectsPage: remote(() => ({
		committees: [{ id: 'c1', name: 'Facilities' }],
		templates: [{ id: 't1', name: 'Show deliverables' }],
		projects: []
	})),
	createProjectForm: {
		enhance: () => ({ method: 'POST', action: '?/createProject' }),
		fields: remote().fields,
		result: undefined
	}
}));
const held = vi.hoisted(() => ({ capabilities: [] as string[] }));
vi.mock('#lib/remote/layout.remote.js', () => ({
	getStaffLayout: remote(() => ({ capabilities: held.capabilities }))
}));
vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const ProjectsPage = (await import('./+page.svelte')).default;

describe('the Projects row (#2411)', () => {
	it('puts the view tabs in the header and the create action with the list', async () => {
		held.capabilities = ['project.read', 'event.manage'];
		const { container } = await render(ProjectsPage);

		await vi.waitFor(() =>
			expect(
				container.querySelector('[data-page-header] a[href="/staff/projects/productions"]')
			).not.toBeNull()
		);
		expect(container.querySelector('[data-page-header] button')).toBeNull();
		expect(container.querySelector('button')).not.toBeNull();
	});
});

describe('the New Project modal', () => {
	// #2388: with no empty option the browser submits the first committee.
	it('leaves the committee and the template unset until somebody picks one', async () => {
		await render(ProjectsPage);
		await page.getByRole('button').first().click();

		const dialog = page.getByRole('dialog');
		await expect.element(dialog).toBeVisible();
		const selects = dialog.getByRole('combobox');
		await expect.element(selects.first()).toBeVisible();

		const all = [...dialog.element().querySelectorAll('select')];
		expect(all).toHaveLength(2);
		expect(all.map((s) => s.value)).toEqual(['', '']);
		expect(all.flatMap((s) => [...s.options].slice(1).map((o) => o.value))).toEqual(
			expect.arrayContaining(['c1', 't1'])
		);
	});
});
