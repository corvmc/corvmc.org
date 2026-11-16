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
	import StaffViews from '../StaffViews.svelte';
	import { contentViews } from '../content/views';
	import { urlState, oneOf } from '#lib/urlState.svelte.js';
	import { localResourceStatuses } from '#lib/config.js';
	import { formatDateShort } from '#lib/utils/format.js';

	// A public tip is the only thing ever pending, so `?status=pending` is the tips queue (#2765).
	const f = urlState(resolve('staff/local-resources'), {
		status: oneOf<LocalResourceStatus | ''>(['', ...localResourceStatuses], '')
	});
	const data = $derived(await getStaffLocalResources({ status: f.status || undefined }));
	const tips = $derived(f.status === 'pending');
	const { fields } = createLocalResourceForm;
</script>

<PageHeader
	title={m.staff_content_title()}
	documentTitle={m.staff_local_resources_title()}
	subtitle={m.staff_outreach_body()}
>
	<StaffViews views={contentViews} active="resources" />
</PageHeader>

<PageContent>
	<FilterBar activeCount={f.status ? 1 : 0} onclear={() => (f.status = '')}>
		<Select
			size="sm"
			aria-label={m.staff_status_label()}
			value={f.status}
			onchange={(e: Event) => {
				f.status = (e.currentTarget as HTMLSelectElement).value as typeof f.status;
			}}
		>
			<option value="">{m.staff_local_resources_all_listings_label()}</option>
			<option value="pending"
				>{m.staff_local_resources_pending_tips_label({ count: data.tipCount })}</option
			>
			<option value="published">{m.staff_published_label()}</option>
			<option value="rejected">{m.staff_returned_label()}</option>
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
						<ResourceFields {fields} categories={data.categories} published />
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
	{:else if data.resources.length === 0 && tips}
		<EmptyState
			title={m.staff_local_resources_tips_no_tips_waiting_title()}
			description={m.staff_local_resources_tips_description_body()}
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
				{#if tips}
					<th class="col-support">{m.staff_from_label()}</th>
					<th class="whitespace-nowrap">{m.staff_sent_label()}</th>
				{:else}
					<th class="col-support">{m.staff_website_label()}</th>
				{/if}
			{/snippet}
			{#each data.resources as r (r.id)}
				{@const href = resolve(`staff/local-resources/${r.id}`)}
				<tr class="hover cursor-pointer" use:rowLink={href}>
					<td class="w-px"><StatusBadge status={r.status} label /></td>
					<td class="cell-primary"><a class="font-medium link-hover" {href}>{r.name}</a></td>
					<td class="col-support whitespace-nowrap">{r.categoryName}</td>
					{#if tips}
						<td class="col-support cell-text truncate">{r.submitterEmail ?? '—'}</td>
						<td class="whitespace-nowrap">{formatDateShort(r.createdAt)}</td>
					{:else}
						<td class="col-support cell-text truncate">{r.website ?? '—'}</td>
					{/if}
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
