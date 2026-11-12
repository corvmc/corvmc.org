import { describe, expect, it } from 'vitest';
import { dropSection, dropSlot, stepSection, stepTask, tasksBySection } from './task-order';
import type { TaskList } from './task-view';

const list = {
	sections: [{ id: 's1' }, { id: 's2' }],
	tasks: [
		{ id: 'loose', sectionId: null },
		{ id: 'a', sectionId: 's1' },
		{ id: 'b', sectionId: 's1' },
		{ id: 'c', sectionId: 's2' },
		{ id: 'orphan', sectionId: 'gone' }
	]
} as unknown as Pick<TaskList, 'sections' | 'tasks'>;

describe('task positions', () => {
	it('groups by section, sending a task whose section is gone to the unlabelled group', () => {
		expect([...tasksBySection(list)]).toEqual([
			[null, ['loose', 'orphan']],
			['s1', ['a', 'b']],
			['s2', ['c']]
		]);
	});

	it('steps within a section, then across into the next one', () => {
		expect(stepTask(list, 'a', 1)).toEqual({ sectionId: 's1', index: 1 });
		expect(stepTask(list, 'b', 1)).toEqual({ sectionId: 's2', index: 0 });
		expect(stepTask(list, 'c', -1)).toEqual({ sectionId: 's1', index: 2 });
		expect(stepTask(list, 'c', 1)).toBeNull();
		expect(stepTask(list, 'loose', -1)).toBeNull();
	});

	it('drops before a row, or at the top of a heading, counting without the moved task', () => {
		expect(dropSlot(list, 'c', { sectionId: 's1', beforeId: 'b' })).toEqual({
			sectionId: 's1',
			index: 1
		});
		expect(dropSlot(list, 'a', { sectionId: 's1', beforeId: 'b' })).toEqual({
			sectionId: 's1',
			index: 0
		});
		expect(dropSlot(list, 'a', { sectionId: 's2', beforeId: null })).toEqual({
			sectionId: 's2',
			index: 0
		});
	});
});

describe('section order', () => {
	it('swaps with a neighbour, and stays put at the ends', () => {
		expect(stepSection(['x', 'y', 'z'], 'y', -1)).toEqual(['y', 'x', 'z']);
		expect(stepSection(['x', 'y'], 'x', -1)).toBeNull();
	});

	it('drops one before another', () => {
		expect(dropSection(['x', 'y', 'z'], 'z', 'x')).toEqual(['z', 'x', 'y']);
		expect(dropSection(['x', 'y'], 'x', 'x')).toBeNull();
	});
});
