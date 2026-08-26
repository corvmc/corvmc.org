<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import CopyableId from './CopyableId.svelte';

	const { Story } = defineMeta({
		title: 'Shared/CopyableId',
		component: CopyableId,
		tags: ['autodocs'],
		parameters: { layout: 'padded' }
	});
</script>

<Story name="Long id" args={{ value: 'res_01HZX9K3M7QF8A2BNP4RVT6YDC', label: 'Reservation ID' }} />
<Story name="Short id" args={{ value: 'ABC123', label: 'Code' }} />
<Story name="No label" args={{ value: 'usr_01HZX9K3M7QF8A2BNP4RVT6YDC' }} />
