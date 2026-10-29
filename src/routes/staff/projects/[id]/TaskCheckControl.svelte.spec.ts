import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Task } from './task-view';
import '../../../layout.css';
import '../../../retro-buttons.css';

vi.mock('$lib/remote/tasks.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	const form = () => ({
		enhance: () => ({ method: 'POST', action: '?/x' }),
		fields: {
			projectId: field('projectId'),
			workOrderId: field('workOrderId'),
			allIssues: () => null
		},
		result: undefined
	});
	const instance = form();
	const keyed = { ...instance, for: () => instance };
	return { resolveTaskForm: keyed, reopenTaskForm: keyed };
});

const TaskCheckControl = (await import('./TaskCheckControl.svelte')).default;

const task = (over: Partial<Task> = {}) =>
	({
		id: 't1',
		title: 'Sweep the stage',
		state: 'open',
		doneWhen: null,
		resolvedAt: null,
		cancelledAt: null,
		...over
	}) as Task;

const props = (t: Task) => ({ task: t, projectId: 'p1', place: 'row' as const, onopen: vi.fn() });

/** The tick's own drawing: a ring until done, a filled circle once it is. */
const glyph = () => document.querySelector('[data-check-state] svg')!.getAttribute('class')!;

// #1922: a thin circled check, filled when done, with no button frame round it.
describe('TaskCheckControl', () => {
	it('draws an open task as an unfilled ring', async () => {
		await render(TaskCheckControl, props(task()));

		await expect
			.element(page.getByRole('button', { name: 'Mark Sweep the stage done' }))
			.toBeVisible();
		expect(glyph()).toContain('tabler-icon-circle-check');
		expect(glyph()).not.toContain('filled');
	});

	it('fills the circle once the task is ticked', async () => {
		await render(TaskCheckControl, props(task({ state: 'done', resolvedAt: new Date() })));

		await expect
			.element(page.getByRole('button', { name: 'Mark Sweep the stage not done' }))
			.toBeVisible();
		expect(glyph()).toContain('tabler-icon-circle-check-filled');
	});

	it('draws no frame around the control', async () => {
		await render(TaskCheckControl, props(task()));
		const button = page.getByRole('button', { name: 'Mark Sweep the stage done' });
		await expect.element(button).toBeVisible();

		const style = getComputedStyle(button.element());
		expect(style.borderTopColor).toBe('rgba(0, 0, 0, 0)');
		expect(style.boxShadow).toBe('none');
	});
});
