<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import StatCard from './StatCard.svelte';

	const { Story } = defineMeta({
		title: 'Shared/StatCard',
		component: StatCard,
		tags: ['autodocs'],
		parameters: { layout: 'padded' }
	});
</script>

<Story name="Number" args={{ title: 'Hours this month', value: 12 }} />
<Story name="Currency" args={{ title: 'Credit balance', value: '$45.00' }} />
<Story name="Long label" args={{ title: 'Active bands you belong to', value: 3 }} />
