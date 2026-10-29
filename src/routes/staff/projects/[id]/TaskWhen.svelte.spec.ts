import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TaskWhen from './TaskWhen.svelte';
import type { Task } from './task-view';

const task = (over: Partial<Task> = {}) =>
	({
		id: 't1',
		title: 'Book the sound tech',
		state: 'open',
		resolvedAt: null,
		cancelledAt: null,
		startsAt: null,
		endsAt: null,
		dueAt: null,
		...over
	}) as Task;

const dated = () => page.getByText(/Mar 4/).element() as HTMLElement;

// #1922: the When cell is plain date text, red once its day has passed.
describe('TaskWhen', () => {
	it('colours a past due date red on an open task', async () => {
		await render(TaskWhen, { task: task({ dueAt: new Date('2020-03-04T20:00:00Z') }) });

		expect(dated().closest('.text-error')).not.toBeNull();
	});

	it('leaves a past due date plain once the task is done', async () => {
		await render(TaskWhen, {
			task: task({ state: 'done', dueAt: new Date('2020-03-04T20:00:00Z') })
		});

		expect(dated().closest('.text-error')).toBeNull();
	});

	it('leaves a future due date plain', async () => {
		await render(TaskWhen, { task: task({ dueAt: new Date('2099-03-04T20:00:00Z') }) });

		expect(dated().closest('.text-error')).toBeNull();
	});

	it('draws an empty When as a dashed calendar circle', async () => {
		await render(TaskWhen, { task: task() });

		await expect.element(page.getByLabelText('No date')).toBeInTheDocument();
		expect(document.querySelector('.border-dashed .tabler-icon-calendar')).not.toBeNull();
	});
});
