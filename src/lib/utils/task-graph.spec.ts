import { describe, it, expect } from 'vitest';
import { layoutGraph, type GraphNode } from './task-graph';

const node = (id: string, done = false): GraphNode => ({ id, label: id, done });
const where = (layout: ReturnType<typeof layoutGraph>) =>
	Object.fromEntries(layout.nodes.map((n) => [n.id, [n.layer, n.row]]));

describe('layoutGraph', () => {
	it('puts each task one layer right of the furthest task it waits on', () => {
		const layout = layoutGraph(
			[node('narrative'), node('budget'), node('letters'), node('submit')],
			[
				{ taskId: 'budget', dependsOnId: 'narrative' },
				{ taskId: 'submit', dependsOnId: 'budget' },
				{ taskId: 'submit', dependsOnId: 'letters' }
			]
		);
		const layers = Object.fromEntries(layout.nodes.map((n) => [n.id, n.layer]));
		expect(layers).toEqual({ narrative: 0, letters: 0, budget: 1, submit: 2 });
		expect(layout.layers).toBe(3);
		expect(layout.rows).toBe(2);
	});

	it('draws only tasks on an edge, and keeps whether each is done', () => {
		const layout = layoutGraph(
			[node('a', true), node('b'), node('alone')],
			[{ taskId: 'b', dependsOnId: 'a' }]
		);
		expect(layout.nodes.map((n) => [n.id, n.done])).toEqual([
			['a', true],
			['b', false]
		]);
	});

	it('sits a task beside what it waits on, so lines run flat', () => {
		const layout = layoutGraph(
			[node('a'), node('b'), node('z-after-b'), node('y-after-a')],
			[
				{ taskId: 'y-after-a', dependsOnId: 'a' },
				{ taskId: 'z-after-b', dependsOnId: 'b' }
			]
		);
		expect(where(layout)).toEqual({
			a: [0, 0],
			b: [0, 1],
			'y-after-a': [1, 0],
			'z-after-b': [1, 1]
		});
	});

	it('ignores an edge to a task it was not given, and ends on a loop rather than hanging', () => {
		expect(layoutGraph([node('a')], [{ taskId: 'a', dependsOnId: 'gone' }]).nodes).toEqual([]);
		const loop = layoutGraph(
			[node('a'), node('b')],
			[
				{ taskId: 'a', dependsOnId: 'b' },
				{ taskId: 'b', dependsOnId: 'a' }
			]
		);
		expect(loop.nodes).toHaveLength(2);
	});

	it('is empty with no edges', () => {
		expect(layoutGraph([node('a')], [])).toEqual({ nodes: [], layers: 0, rows: 0 });
	});
});
