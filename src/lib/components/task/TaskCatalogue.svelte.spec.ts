import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '#lib/test/locators.js';

/**
 * The task table on Tasks and on a project's page (#2625). On a project's page
 * it asks for that project's tasks and offers no project to group or filter
 * by; a chip shows only while it counts something.
 */

vi.mock('$app/paths', () => ({
	resolve: (path: string, params: Record<string, string> = {}) =>
		path.replace(/\[(\w+)\]/g, (_, k: string) => params[k]).replace(/^(?!\/)/, '/')
}));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/staff/tasks') } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), beforeNavigate: vi.fn() }));

const query = vi.hoisted(() => {
	const remote = (value: () => unknown) => {
		const fields = new Proxy({ allIssues: () => null } as Record<string, unknown>, {
			get: (target, key: string) =>
				target[key] ?? {
					as: (type: string, v?: unknown) => ({ type, name: key, value: v }),
					issues: () => null,
					value: () => undefined
				}
		});
		const fn = Object.assign(
			vi.fn(() => Object.assign(Promise.resolve(value()), { refresh: () => Promise.resolve() })),
			{ enhance: () => ({ method: 'POST' }), fields, result: undefined, pending: 0 }
		);
		return Object.assign(fn, { for: () => fn });
	};
	return { remote };
});

const NOW = Date.now();
const task = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	title: id,
	volunteerRoleId: null,
	roleName: null,
	eventId: null,
	eventTitle: null,
	projectId: 'p1',
	projectName: 'Renovation',
	projectKind: 'general',
	projectStatus: 'in_progress',
	sectionId: null,
	dueAt: new Date(NOW + 86_400_000),
	shiftAt: null,
	shifts: 0,
	capacity: 0,
	claimed: 0,
	assignees: 1,
	blockers: 0,
	maintenanceScheduleId: null,
	pendingCapacity: null,
	resolvedAt: null,
	createdAt: new Date(0),
	...over
});

const getTasksPage = vi.hoisted(() => ({ fn: undefined as unknown as ReturnType<typeof vi.fn> }));
const fixture = vi.hoisted(() => ({ sections: [] as { id: string; name: string }[] }));
vi.mock('#lib/remote/tasks.remote.js', () => {
	getTasksPage.fn = query.remote(() => ({
		tasks: [
			task('paint', { sectionId: fixture.sections[1]?.id ?? null }),
			task('sweep', { assignees: 0 }),
			task('submit', { blockers: 1, sectionId: fixture.sections[1]?.id ?? null })
		],
		contractors: {},
		waitsOn: { submit: [{ id: 'paint', label: 'paint' }] },
		contractorAccess: false,
		projects: [{ id: 'p1', name: 'Renovation' }],
		committees: [],
		templates: [],
		sections: fixture.sections
	}));
	return {
		getTasksPage: getTasksPage.fn,
		createCatalogueTaskForm: query.remote(() => undefined),
		createSectionForm: query.remote(() => undefined),
		renameSectionForm: query.remote(() => undefined),
		deleteSectionForm: query.remote(() => undefined),
		reorderSectionsCommand: query.remote(() => undefined)
	};
});
vi.mock('#lib/remote/projects.remote.js', () => ({
	createProjectForm: query.remote(() => undefined)
}));
vi.mock('#lib/remote/volunteer.remote.js', () => ({
	getVolunteerRoles: query.remote(() => []),
	resolveWorkOrder: query.remote(() => undefined),
	openShift: query.remote(() => undefined)
}));

const TaskCatalogue = (await import('./TaskCatalogue.test.svelte')).default;

beforeEach(() => {
	getTasksPage.fn.mockClear();
	fixture.sections = [];
});

describe('TaskCatalogue', () => {
	it('on Tasks, offers grouping and a project column, and counts only what is there', async () => {
		const { container } = await render(TaskCatalogue);
		await vi.waitFor(() => expect(container.querySelector('[data-task="paint"]')).not.toBeNull());

		expect(container.querySelector('[data-testid="task-group"]')).not.toBeNull();
		expect(
			container.querySelector('[data-task="paint"] a[href="/staff/tasks/projects/p1"]')
		).not.toBeNull();
		// One task has nobody on it; none is overdue, so that chip is not drawn.
		expect(container.querySelector('[data-chip="unassigned"]')).not.toBeNull();
		expect(container.querySelector('[data-chip="overdue"]')).toBeNull();
		expect(getTasksPage.fn).toHaveBeenCalledWith(expect.objectContaining({ projectId: undefined }));
	});

	it('dims a task waiting on an open one, names what it waits on, and counts it', async () => {
		const { container } = await render(TaskCatalogue);
		await vi.waitFor(() => expect(container.querySelector('[data-task="submit"]')).not.toBeNull());

		const row = container.querySelector('[data-task="submit"]')!;
		expect(row.hasAttribute('data-blocked')).toBe(true);
		expect(row.classList.contains('opacity-60')).toBe(true);
		expect(row.querySelector('.cell-primary')?.textContent).toContain('paint');
		expect(container.querySelector('[data-task="paint"]')?.hasAttribute('data-blocked')).toBe(
			false
		);
		expect(container.querySelector('[data-chip="blocked"]')).not.toBeNull();
	});

	it("on a project's page, asks for its tasks and drops the project controls", async () => {
		const { container } = await render(TaskCatalogue, { projectId: 'p1' });
		await vi.waitFor(() => expect(container.querySelector('[data-task="paint"]')).not.toBeNull());

		expect(getTasksPage.fn).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }));
		const groupBy = container.querySelector<HTMLSelectElement>('[data-testid="task-group"]')!;
		expect([...groupBy.options].map((o) => o.value)).toEqual(['due', 'section']);
		// No sections: grouped by date, as before.
		expect(groupBy.value).toBe('due');
		expect(container.querySelector('[data-section]')).toBeNull();
		expect(container.querySelector('a[href="/staff/tasks/projects/p1"]')).toBeNull();
		expect(
			container.querySelector('[data-task="paint"] a[href="/staff/tasks/paint"]')
		).not.toBeNull();
	});

	it("groups a project's tasks by its sections in order, empty ones kept, none last", async () => {
		fixture.sections = [
			{ id: 's-strike', name: 'Strike' },
			{ id: 's-prep', name: 'Prep' },
			{ id: 's-empty', name: 'Later' }
		];
		const { container } = await render(TaskCatalogue, { projectId: 'p1' });
		await vi.waitFor(() => expect(container.querySelector('[data-task="paint"]')).not.toBeNull());

		expect(container.querySelector<HTMLSelectElement>('[data-testid="task-group"]')?.value).toBe(
			'section'
		);
		// Each heading, then the tasks under it, top to bottom.
		const order = [...container.querySelectorAll('tr[data-section], tr[data-task]')].map(
			(r) => r.getAttribute('data-section') ?? r.getAttribute('data-task')
		);
		expect(order).toEqual(['s-strike', 's-prep', 'paint', 'submit', 's-empty', 'none', 'sweep']);
		// A section has its menu and its own New task; No section has only New task.
		const strike = container.querySelector('tr[data-section="s-strike"]')!;
		expect(strike.querySelector('details summary')).not.toBeNull();
		expect(strike.querySelector('[data-testid="new-task-in-section"]')).not.toBeNull();
		const none = container.querySelector('tr[data-section="none"]')!;
		expect(none.querySelector('details summary')).toBeNull();
		expect(none.querySelector('[data-testid="new-task-in-section"]')).not.toBeNull();
	});
});
