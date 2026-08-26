<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, within } from 'storybook/test';
	import EmptyState from './EmptyState.svelte';

	// EmptyState is a pure, prop-driven component, so its stories double as
	// automated render/interaction tests via the `storybook` Vitest project — no
	// DB, auth, or server needed.
	const { Story } = defineMeta({
		title: 'Shared/EmptyState',
		component: EmptyState,
		tags: ['autodocs'],
		args: {
			message: 'No items found.'
		}
	});
</script>

<Story name="Default" />

<Story
	name="With Title"
	args={{
		title: 'No reservations',
		description: "You haven't booked any practice time yet."
	}}
/>

<Story
	name="With Action"
	args={{
		title: 'No bands',
		description: 'Create your first band to get started.',
		actionLabel: 'Create a band',
		actionHref: '/member/bands/new'
	}}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const link = canvas.getByRole('link', { name: 'Create a band' });
		await expect(link).toBeInTheDocument();
		await expect(link).toHaveAttribute('href', '/member/bands/new');
	}}
/>
