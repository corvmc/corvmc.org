<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import { resolve } from '$app/paths';
	import type { LocalResourceStatus } from '#lib/config.js';
	import {
		getStaffLocalResources,
		createLocalResourceForm
	} from '#lib/remote/local-resources.remote.js';
	import ResourceFields from './ResourceFields.svelte';
	import ResourceTabs from './ResourceTabs.svelte';

	let status = $state<LocalResourceStatus | ''>('');
	const data = $derived(await getStaffLocalResources({ status: status || undefined }));
	const { fields } = createLocalResourceForm;
</script>

<PageHeader title={m.staff_local_resources_title()} subtitle={m.staff_outreach_body()}>
	<ResourceTabs active="listings" tipCount={data.tipCount} />
</PageHeader>

<PageContent>
	<FilterBar activeCount={status ? 1 : 0} onclear={() => (status = '')}>
		<Select
			size="sm"
			aria-label={m.staff_status_label()}
			value={status}
			onchange={(e: Event) => {
				status = (e.currentTarget as HTMLSelectElement).value as typeof status;
			}}
		>
			<option value="">{m.staff_local_resources_all_listings_label()}</option>
			<option value="pending">{m.staff_pending_label()}</option>
			<option value="published">{m.staff_published_label()}</option>
			<option value="rejected">{m.staff_local_resources_rejected_label()}</option>
		</Select>
		{#snippet actions()}
			<Button href="/staff/local-resources/categories" variant="ghost" size="sm"
				>{m.staff_categories_label()}</Button
			>
			{#if data.categories.length > 0}
				<Action
					action={createLocalResourceForm}
					label={m.staff_local_resources_label()}
					modalTitle={m.staff_local_resources_2_title()}
					successToast={m.staff_local_resources_success_toast()}
				>
					{#snippet form()}
						<ResourceFields {fields} categories={data.categories} />
					{/snippet}
				</Action>
			{/if}
		{/snippet}
	</FilterBar>

	{#if data.categories.length === 0}
		<EmptyState
			title={m.staff_no_categories_yet_title()}
			description={m.staff_local_resources_add_categories_first_instrument_shops_body()}
			actionLabel={m.staff_local_resources_action_label()}
			actionHref={resolve('staff/local-resources/categories')}
		/>
	{:else if data.resources.length === 0}
		<EmptyState
			title={m.staff_local_resources_no_listings_title()}
			description={m.staff_local_resources_add_music_businesses_services_communit_body()}
		/>
	{:else}
		<!-- A table: short fields and no row actions, so no card test passes. -->
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
				<th class="cell-primary">{m.staff_name_label()}</th>
				<th class="col-support">{m.staff_category_label()}</th>
				<th class="col-support">{m.staff_website_label()}</th>
			{/snippet}
			{#each data.resources as r (r.id)}
				{@const href = resolve(`staff/local-resources/${r.id}`)}
				<tr class="hover cursor-pointer" use:rowLink={href}>
					<td class="w-px"><StatusBadge status={r.status} label /></td>
					<td class="cell-primary"><a class="font-medium link-hover" {href}>{r.name}</a></td>
					<td class="col-support whitespace-nowrap">{r.categoryName}</td>
					<td class="col-support cell-text truncate">{r.website ?? '—'}</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
