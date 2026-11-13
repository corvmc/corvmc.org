import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * What a record's task card shows (#2630): relation headers only when there
 * are two relations, chips only with a count, done work only on request, and
 * New task only where the record can make one.
 */

type Related = {
	groups: { key: string; tasks: Record<string, unknown>[]; more: boolean }[];
	contractors: Record<string, unknown[]>;
	prefill: Record<string, string> | null;
};
let response: Related | null;
const getRelatedTasks = vi.hoisted(() => vi.fn());

vi.mock('#lib/remote/tasks.remote.js', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	return {
		getRelatedTasks,
		createCatalogueTaskForm: {
			enhance: () => ({ method: 'POST', action: '?/create' }),
			fields: {
				...Object.fromEntries(
					['title', 'dueAt', 'projectId', 'eventId', 'groupId', 'volunteerRoleId'].map((n) => [
						n,
						field(n)
					])
				),
				allIssues: () => null
			},
			result: undefined
		}
	};
});
vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const RelatedTasks = (await import('./RelatedTasks.svelte')).default;

const task = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	title: id,
	volunteerRoleId: null,
	roleName: null,
	eventId: null,
	eventTitle: null,
	projectId: null,
	projectName: null,
	projectKind: null,
	projectStatus: null,
	dueAt: null,
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

const card = () => document.querySelector('[data-testid="related-tasks"]')!;
const cardOrNull = () => document.querySelector('[data-testid="related-tasks"]');
const rows = () => card().querySelectorAll('tr[data-task]');
const groupRows = () => card().querySelectorAll('[data-testid="related-task-group"]');
const chips = () =>
	[...card().querySelectorAll('[data-chip]')].map((c) => c.getAttribute('data-chip'));

beforeEach(() => {
	document.body.innerHTML = '';
	getRelatedTasks.mockReset().mockImplementation(async () => response);
});

describe('RelatedTasks', () => {
	it('heads each relation when there are two, and a task row per task', async () => {
		response = {
			groups: [
				{ key: 'event', tasks: [task('a')], more: false },
				{ key: 'show', tasks: [task('b'), task('c')], more: false }
			],
			contractors: {},
			prefill: { eventId: 'e1' }
		};
		await render(RelatedTasks, { subject: { type: 'event', id: 'e1' } });
		await vi.waitFor(() => expect(rows()).toHaveLength(3));
		expect([...groupRows()].map((r) => r.getAttribute('data-relation'))).toEqual(['event', 'show']);
	});

	it('leaves out the header for one relation, and chips with no count', async () => {
		response = {
			groups: [{ key: 'project', tasks: [task('a', { assignees: 0 })], more: false }],
			contractors: {},
			prefill: { projectId: 'p1' }
		};
		await render(RelatedTasks, { subject: { type: 'project', id: 'p1' } });
		await vi.waitFor(() => expect(rows()).toHaveLength(1));
		expect(groupRows()).toHaveLength(0);
		expect(chips()).toEqual(['unassigned']);
	});

	it('asks for done tasks only when Show done is pressed', async () => {
		response = {
			groups: [{ key: 'project', tasks: [task('a')], more: false }],
			contractors: {},
			prefill: null
		};
		await render(RelatedTasks, { subject: { type: 'project', id: 'p1' } });
		await vi.waitFor(() => expect(rows()).toHaveLength(1));
		expect(getRelatedTasks).toHaveBeenLastCalledWith({
			type: 'project',
			id: 'p1',
			includeDone: false
		});
		(card().querySelector('[data-testid="related-tasks-done"]') as HTMLButtonElement).click();
		await vi.waitFor(() =>
			expect(getRelatedTasks).toHaveBeenLastCalledWith({
				type: 'project',
				id: 'p1',
				includeDone: true
			})
		);
	});

	it('links View all to the Tasks table filtered to the record', async () => {
		response = {
			groups: [{ key: 'group', tasks: [task('a')], more: true }],
			contractors: {},
			prefill: { groupId: 'g1' }
		};
		await render(RelatedTasks, { subject: { type: 'group', id: 'g1' } });
		await vi.waitFor(() => expect(rows()).toHaveLength(1));
		const hrefs = [...card().querySelectorAll('a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toContain('/staff/tasks?about=group%3Ag1');
	});

	it('shows only the title and New task when nothing relates', async () => {
		response = { groups: [], contractors: {}, prefill: { groupId: 'g1' } };
		await render(RelatedTasks, { subject: { type: 'group', id: 'g1' } });
		await vi.waitFor(() =>
			expect(card().querySelector('[data-testid="related-new-task"]')).not.toBeNull()
		);
		expect(card().querySelector('table')).toBeNull();
		expect(card().querySelector('[data-testid="related-tasks-done"]')).toBeNull();
		expect(card().querySelectorAll('button')).toHaveLength(1);
	});

	it('offers no New task for a record that makes none by hand', async () => {
		response = {
			groups: [{ key: 'recurringWork', tasks: [task('a')], more: false }],
			contractors: {},
			prefill: null
		};
		await render(RelatedTasks, { subject: { type: 'recurring_work', id: 's1' } });
		await vi.waitFor(() => expect(rows()).toHaveLength(1));
		expect(card().querySelector('[data-testid="related-new-task"]')).toBeNull();
	});

	it('draws nothing for a viewer who may not read tasks', async () => {
		response = null;
		await render(RelatedTasks, { subject: { type: 'group', id: 'g1' } });
		await vi.waitFor(() => expect(getRelatedTasks).toHaveBeenCalled());
		await Promise.resolve();
		expect(cardOrNull()).toBeNull();
	});
});
