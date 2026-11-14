import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ShortShiftsTable from './ShortShiftsTable.svelte';

// #2787: a task with two short shifts gives two rows sharing the task id.
// Keying by that id threw `each_key_duplicate` and took down /staff.
describe('ShortShiftsTable', () => {
	it('renders one row per shift when a task has two', async () => {
		const shift = (shiftId: string, day: number) => ({
			id: 'task-door',
			shiftId,
			startsAt: new Date(Date.UTC(2099, 2, day, 19)),
			roleName: 'Door',
			eventTitle: null,
			capacity: 2,
			claimed: 0
		});
		const screen = await render(ShortShiftsTable, {
			rows: [shift('shift-a', 14), shift('shift-b', 15)]
		});
		expect(screen.container.querySelectorAll('tbody tr')).toHaveLength(2);
	});
});
