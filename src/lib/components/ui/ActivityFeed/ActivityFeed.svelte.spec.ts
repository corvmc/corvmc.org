import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ResolvedPathname } from '$app/types';
import ActivityFeed from './ActivityFeed.svelte';

const now = new Date();
const earlierYear = now.getFullYear() - 2;
const rows = [
	{
		id: 'a',
		at: now,
		actor: { name: 'Sam Staff' },
		summary: 'Edited name, phone',
		href: '/staff/projects/p' as ResolvedPathname
	},
	{ id: 'b', at: new Date(now.getTime() - 3_600_000), actor: null, summary: 'Reopened it' },
	{
		id: 'c',
		at: new Date(earlierYear, 4, 13, 14, 30),
		actor: { name: 'Ada' },
		summary: 'Ticked a duty',
		context: { label: 'Paint the hall' }
	}
];
const empty = { title: 'Nothing recorded yet' };

describe('ActivityFeed', () => {
	it('renders one item per row, the year only on a row from an earlier year', async () => {
		const { container } = await render(ActivityFeed, { rows, empty });
		const items = container.querySelectorAll('li');
		expect(items).toHaveLength(3);
		expect(items[2].querySelector('time')?.textContent).toContain(String(earlierYear));
		expect(items[0].querySelector('time')?.textContent).not.toContain(String(earlierYear));
		expect(items[0].querySelector('a')?.getAttribute('href')).toBe('/staff/projects/p');
		expect(container.querySelector('button')).toBeNull();
	});

	it('calls onmore once from the show-older button', async () => {
		const onmore = vi.fn();
		const { container } = await render(ActivityFeed, { rows, empty, hasMore: true, onmore });
		const button = container.querySelector('button');
		expect(button).not.toBeNull();
		button!.click();
		expect(onmore).toHaveBeenCalledOnce();
	});

	it('renders no list items when there are no rows', async () => {
		const { container } = await render(ActivityFeed, { rows: [], empty });
		expect(container.querySelectorAll('li')).toHaveLength(0);
	});
});
