import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AssignedSummary from './AssignedSummary.svelte';
import type { Task } from './task-view';

const person = (userId: string, name: string) => ({
	userId,
	name,
	image: null,
	status: 'confirmed' as const
});

const task = (over: Partial<Task> = {}) =>
	({
		id: 't1',
		title: 'Hang the lights',
		mode: 'members',
		capacity: 1,
		claimed: 0,
		people: [],
		engagement: null,
		...over
	}) as Task;

const circles = (slot: 'person' | 'open') =>
	document.querySelectorAll(`[data-assigned-stack] [data-slot="${slot}"]`).length;

// #1922: the stack says how many are wanted by its length, one circle per
// `capacity`, so it needs no `0/1` count beside it.
describe('AssignedSummary stack', () => {
	it('draws one dashed slot for a capacity-1 task with nobody on it', async () => {
		await render(AssignedSummary, { task: task({ capacity: 1 }) });

		expect(circles('person')).toBe(0);
		expect(circles('open')).toBe(1);
		await expect.element(page.getByText('0/1')).not.toBeInTheDocument();
	});

	it('draws one circle per wanted person, faces first', async () => {
		await render(AssignedSummary, {
			task: task({ capacity: 6, claimed: 2, people: [person('a', 'Ana'), person('b', 'Bo')] })
		});

		expect(circles('person')).toBe(2);
		expect(circles('open')).toBe(4);
	});

	it('names a lone person beside their avatar', async () => {
		await render(AssignedSummary, {
			task: task({ capacity: 1, claimed: 1, people: [person('a', 'Ana Ortiz')] })
		});

		await expect.element(page.getByText('Ana Ortiz', { exact: true })).toBeVisible();
	});

	it('shows no Open badge on a task open to volunteers', async () => {
		await render(AssignedSummary, { task: task({ mode: 'open', capacity: 2 }) });

		expect(circles('open')).toBe(2);
		expect(document.querySelector('.badge')).toBeNull();
	});
});
