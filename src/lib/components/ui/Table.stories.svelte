<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Table from './Table.svelte';
	import StatusBadge from './StatusBadge.svelte';

	const { Story } = defineMeta({
		title: 'Shared/Table',
		component: Table,
		tags: ['autodocs'],
		parameters: {
			docs: {
				description: {
					component:
						'Table chrome only — the scroll wrapper and daisyUI modifiers. Pages write ' +
						'their own `<th>`/`<td>`. Column visibility comes from the `col-support` ' +
						'and `col-extra` utilities, which are container queries against the page ' +
						'body. The width stories below reproduce the three real content widths: ' +
						'327px (phone), 720px (tablet), 976px (laptop).'
				}
			}
		}
	});

	const rows = [
		{ id: '1', status: 'confirmed', name: 'Skyler Santos', role: 'Guitar', amount: '$15.00' },
		{ id: '2', status: 'scheduled', name: 'Taylor Chen', role: 'Drums', amount: '$30.00' },
		{ id: '3', status: 'completed', name: 'Sage Kim', role: 'Bass', amount: '$15.00' }
	];
</script>

{#snippet demo(width: number)}
	<!-- `@container` is what PageContent provides on every real page. -->
	<div class="@container" style="width: {width}px; max-width: 100%;">
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">Status</span></th>
				<th>Member</th>
				<th class="col-support cell-num">Amount</th>
				<th class="col-extra">Instrument</th>
			{/snippet}
			{#each rows as row (row.id)}
				<tr class="hover">
					<td class="w-px"><StatusBadge status={row.status} /></td>
					<td class="cell-primary">
						<div class="truncate font-medium">{row.name}</div>
						<div class="truncate text-sm opacity-60">{row.name.toLowerCase()}@example.com</div>
					</td>
					<td class="col-support cell-num">{row.amount}</td>
					<td class="col-extra">{row.role}</td>
				</tr>
			{/each}
		</Table>
	</div>
{/snippet}

<!-- Phone: only the status glyph and the primary cell survive. -->
<Story name="Narrow (327px)">
	{@render demo(327)}
</Story>

<!-- Tablet: col-support appears, col-extra still hidden. -->
<Story name="Medium (720px)">
	{@render demo(720)}
</Story>

<!-- Laptop: every column. -->
<Story name="Wide (976px)">
	{@render demo(976)}
</Story>

<Story name="Without zebra striping">
	<div class="@container" style="width: 976px; max-width: 100%;">
		<Table zebra={false}>
			{#snippet head()}
				<th>Member</th>
				<th class="cell-num">Amount</th>
			{/snippet}
			{#each rows as row (row.id)}
				<tr class="hover">
					<td class="cell-primary">{row.name}</td>
					<td class="cell-num">{row.amount}</td>
				</tr>
			{/each}
		</Table>
	</div>
</Story>

<Story name="Default size (md)">
	<div class="@container" style="width: 976px; max-width: 100%;">
		<Table size="md">
			{#snippet head()}
				<th>Member</th>
				<th class="cell-num">Amount</th>
			{/snippet}
			{#each rows as row (row.id)}
				<tr class="hover">
					<td class="cell-primary">{row.name}</td>
					<td class="cell-num">{row.amount}</td>
				</tr>
			{/each}
		</Table>
	</div>
</Story>
