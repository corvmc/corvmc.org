import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * The project's task graph (#2625): each task on an edge is a link to its page,
 * done ones are marked, every edge is drawn, and a project with none says so.
 */

vi.mock('$app/paths', () => ({
	resolve: (path: string, params: Record<string, string> = {}) =>
		path.replace(/\[(\w+)\]/g, (_, k: string) => params[k])
}));

const graph = vi.hoisted(() => ({
	value: {
		nodes: [
			{ id: 'narrative', label: 'Draft the narrative', done: true },
			{ id: 'budget', label: 'Build the budget', done: false },
			{ id: 'submit', label: 'Submit the application', done: false },
			{ id: 'alone', label: 'Book the room', done: false }
		],
		edges: [
			{ taskId: 'budget', dependsOnId: 'narrative' },
			{ taskId: 'submit', dependsOnId: 'budget' }
		]
	}
}));
vi.mock('#lib/remote/tasks.remote.js', () => ({
	getProjectGraph: () => Promise.resolve(graph.value)
}));

const TaskGraph = (await import('./TaskGraph.svelte')).default;

describe('TaskGraph', () => {
	it('links each task on an edge, marks the done ones, and draws every edge', async () => {
		const { container } = await render(TaskGraph, { projectId: 'p1' });
		await vi.waitFor(() =>
			expect(container.querySelector('[data-testid="task-graph"]')).not.toBeNull()
		);

		const nodes = [...container.querySelectorAll('[data-node]')];
		expect(nodes.map((n) => n.getAttribute('data-node')).sort()).toEqual([
			'budget',
			'narrative',
			'submit'
		]);
		expect(container.querySelector('[data-node="narrative"]')?.getAttribute('data-done')).toBe(
			'true'
		);
		expect(container.querySelector('[data-node="budget"]')?.getAttribute('href')).toBe(
			'/staff/tasks/budget'
		);
		expect(container.querySelectorAll('[data-edge]')).toHaveLength(2);
	});

	it('shows an empty state when no task waits on another', async () => {
		graph.value = { nodes: graph.value.nodes, edges: [] };
		const { container } = await render(TaskGraph, { projectId: 'p1' });
		await vi.waitFor(() => expect(container.querySelector('[data-node]')).toBeNull());
		expect(container.querySelector('[data-testid="task-graph"]')).toBeNull();
	});
});
