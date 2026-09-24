<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import type { LocalResourceStatus } from '$lib/config';
	import {
		getStaffLocalResources,
		createLocalResourceForm
	} from '$lib/remote/local-resources.remote';
	import ResourceFields from './ResourceFields.svelte';
	import ResourceTabs from './ResourceTabs.svelte';

	let status = $state<LocalResourceStatus | ''>('');
	const data = $derived(await getStaffLocalResources({ status: status || undefined }));
	const { fields } = createLocalResourceForm;
</script>

<PageHeader title="Local Resources" subtitle="Outreach">
	<Button href="/staff/local-resources/categories" variant="ghost" size="sm">Categories</Button>
	{#if data.categories.length > 0}
		<Action
			action={createLocalResourceForm}
			label="New listing"
			modalTitle="New listing"
			successToast="Listing published"
		>
			{#snippet form()}
				<ResourceFields {fields} categories={data.categories} />
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent>
	<ResourceTabs active="listings" tipCount={data.tipCount} />

	<FilterBar activeCount={status ? 1 : 0} onclear={() => (status = '')}>
		<Select
			size="sm"
			aria-label="Status"
			value={status}
			onchange={(e: Event) => {
				status = (e.currentTarget as HTMLSelectElement).value as typeof status;
			}}
		>
			<option value="">All listings</option>
			<option value="pending">Pending</option>
			<option value="published">Published</option>
			<option value="rejected">Rejected</option>
		</Select>
	</FilterBar>

	{#if data.categories.length === 0}
		<EmptyState
			title="No categories yet"
			description="Add categories first — instrument shops, venues, record stores — then the listings that go in them."
			actionLabel="Add categories"
			actionHref={resolve('/staff/local-resources/categories')}
		/>
	{:else if data.resources.length === 0}
		<EmptyState
			title="No listings"
			description="Add the music businesses and services the community should know about."
		/>
	{:else}
		<!-- A table: short fields and no row actions, so no card test passes. -->
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">Status</span></th>
				<th class="cell-primary">Name</th>
				<th class="col-support">Category</th>
				<th class="col-support">Website</th>
			{/snippet}
			{#each data.resources as r (r.id)}
				{@const href = resolve(`/staff/local-resources/${r.id}`)}
				<tr class="hover cursor-pointer" use:rowLink={href}>
					<td class="w-px"><StatusBadge status={r.status} label /></td>
					<td class="cell-primary"><a class="font-medium link-hover" {href}>{r.name}</a></td>
					<td class="col-support whitespace-nowrap">{r.categoryName}</td>
					<td class="col-support truncate">{r.website ?? '—'}</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
