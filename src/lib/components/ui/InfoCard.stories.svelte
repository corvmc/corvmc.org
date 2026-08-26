<script module lang="ts">
	import type { ComponentProps } from 'svelte';
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import InfoCard from './InfoCard.svelte';

	const { Story } = defineMeta({
		title: 'Shared/InfoCard',
		component: InfoCard,
		tags: ['autodocs'],
		parameters: { layout: 'padded' }
	});
</script>

{#snippet template(args: Omit<ComponentProps<typeof InfoCard>, 'children'>)}
	<InfoCard {...args}>
		<p>Your membership is active through June 2026.</p>
		<ul class="mt-2 list-disc pl-5">
			<li>Fri — The Hidden Room</li>
			<li>Sat — Common Fields</li>
		</ul>
	</InfoCard>
{/snippet}

<Story name="Default" args={{ title: 'Account details' }} {template} />
<Story name="Long title" args={{ title: 'Your upcoming reservations and shows' }} {template} />
