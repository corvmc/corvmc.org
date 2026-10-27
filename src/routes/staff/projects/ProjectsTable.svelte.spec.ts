import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ComponentProps } from 'svelte';
import Harness from './ProjectsTable.test.svelte';
import '../../layout.css';

type Row = ComponentProps<typeof Harness>['projects'][number];

const row = {
	project: {
		id: 'p1',
		name: 'Live room refresh',
		status: 'active',
		budgetCents: 250_000,
		startsAt: new Date('2026-05-03'),
		endsAt: new Date('2026-05-17')
	},
	progress: { done: 1, total: 4 },
	burn: {
		contributed: { volunteerMinutes: 0 },
		remainingCents: 100_000,
		cash: { totalCents: 150_000 }
	},
	committeeNames: ['Facilities']
} as unknown as Row;

// #1968: with no actions column, the packed filler left the spare width as a
// dead band after "Spent". The project name takes it instead.
describe('ProjectsTable width', () => {
	it('lets the project column absorb the spare width on a wide page', async () => {
		await render(Harness, { width: 1400, projects: [row], view: 'active' });
		const header = page.getByText('Spent', { exact: true });
		await expect.element(header).toBeVisible();

		const table = header.element().closest('table')!.getBoundingClientRect();
		const spent = header.element().getBoundingClientRect();
		expect(table.right - spent.right).toBeLessThan(2);
	});
});
