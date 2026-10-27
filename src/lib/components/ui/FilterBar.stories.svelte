<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import FilterBar from './FilterBar.svelte';
	import Select from './Form/Select.svelte';

	const { Story } = defineMeta({
		title: 'Shared/FilterBar',
		component: FilterBar,
		tags: ['autodocs'],
		parameters: {
			layout: 'padded',
			docs: {
				description: {
					component:
						'Filter toolbar layout; pages own the state. Search and `children` sit ' +
						'inline; `menu` holds the secondary filters behind a "Filters" button whose ' +
						'badge is `menuCount`. Clear shows while `activeCount` is above zero.'
				}
			}
		}
	});
</script>

{#snippet bar(width: number, menuCount: number)}
	<!-- `@container` is what PageContent provides on every real page. -->
	<div class="@container" style="width: {width}px; max-width: 100%;">
		<FilterBar activeCount={menuCount} {menuCount} onclear={() => {}}>
			{#snippet search()}
				<input type="search" class="input w-full input-sm" placeholder="Search by name..." />
			{/snippet}
			<Select size="sm" aria-label="Category">
				<option value="">All categories</option>
			</Select>
			{#snippet menu()}
				<Select size="sm" aria-label="Status">
					<option value="active">Active</option>
					<option value="all">All statuses</option>
				</Select>
				<Select size="sm" aria-label="Tier">
					<option value="">All tiers</option>
				</Select>
			{/snippet}
		</FilterBar>
	</div>
{/snippet}

<Story name="Wide (976px)">
	{#snippet template()}
		{@render bar(976, 0)}
	{/snippet}
</Story>

<Story name="With active menu filters">
	{#snippet template()}
		{@render bar(976, 2)}
	{/snippet}
</Story>

<Story name="Narrow (327px)">
	{#snippet template()}
		{@render bar(327, 1)}
	{/snippet}
</Story>
