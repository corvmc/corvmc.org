<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, userEvent, within } from 'storybook/test';
	import type { ResolvedPathname } from '$app/types';
	import ActivityFeed from './ActivityFeed.svelte';

	const now = new Date();
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
			at: new Date(now.getFullYear() - 2, 4, 13, 14, 30),
			actor: { name: 'Ada' },
			summary: 'Ticked a duty',
			context: { label: 'Paint the hall' }
		}
	];

	const { Story } = defineMeta({
		title: 'Shared/ActivityFeed',
		component: ActivityFeed,
		tags: ['autodocs'],
		args: { rows, empty: { title: 'Nothing recorded yet' }, onmore: fn() }
	});
</script>

<Story
	name="Rows"
	play={async ({ canvasElement }) => {
		const items = within(canvasElement).getAllByRole('listitem');
		await expect(items).toHaveLength(3);
		// Only the row from an earlier year carries its year.
		const year = String(now.getFullYear() - 2);
		await expect(items[2].querySelector('time')?.textContent).toContain(year);
		await expect(items[0].querySelector('time')?.textContent).not.toContain(year);
		await expect(items[0].querySelector('a')?.getAttribute('href')).toBe('/staff/projects/p');
		await expect(canvasElement.querySelector('button')).toBeNull();
	}}
/>

<Story
	name="Show older"
	args={{ hasMore: true }}
	play={async ({ canvasElement, args }) => {
		const button = canvasElement.querySelector('button');
		await expect(button).not.toBeNull();
		await userEvent.click(button!);
		await expect(args.onmore).toHaveBeenCalledOnce();
	}}
/>

<Story
	name="Empty"
	args={{ rows: [] }}
	play={async ({ canvasElement }) => {
		await expect(within(canvasElement).queryAllByRole('listitem')).toHaveLength(0);
	}}
/>
