<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { getDutyLists, createDutyList } from '$lib/remote/duty-lists.remote';
	import { dutyListAnchors, dutyListAnchorLabels } from '$lib/config';

	let lists = $derived(getDutyLists());

	const anchorOptions = dutyListAnchors.map((a) => ({ value: a, label: dutyListAnchorLabels[a] }));
</script>

<PageHeader title="Project Templates" subtitle="Planning">
	<Action
		action={createDutyList}
		label="New template"
		modalTitle="New project template"
		submitLabel="Create"
		successToast="Template created"
	>
		{#snippet form()}
			<FormField name="name" label="Name" type="text" />
			<FormField
				name="description"
				label="Description"
				type="textarea"
				description="Shown when choosing a template to apply."
			/>
			<FormField
				name="anchor"
				label="Measure offsets from"
				type="select"
				options={anchorOptions}
				description="Every item is timed from this."
			/>
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#await lists then rows}
		{#if rows.length === 0}
			<EmptyState
				title="No templates yet"
				description="A template is a set of work orders a project takes, applied in one step."
			/>
		{:else}
			<InfoCard title="Templates">
				<Table>
					{#snippet head()}
						<th class="w-px"><span class="sr-only">Status</span></th>
						<th>Name</th>
						<th>Anchor</th>
						<th class="cell-num">Items</th>
					{/snippet}

					{#each rows as list (list.id)}
						<tr use:rowLink={`/staff/project-templates/${list.id}`}>
							<td>
								<StatusBadge status={list.isActive ? 'active' : 'archived'} label />
							</td>
							<td>
								<div class="font-medium">{list.name}</div>
								{#if list.description}
									<div class="line-clamp-1 text-sm text-base-content/60">{list.description}</div>
								{/if}
							</td>
							<td class="whitespace-nowrap">
								{dutyListAnchorLabels[list.anchor]}
							</td>
							<td class="cell-num">{list.itemCount}</td>
						</tr>
					{/each}
				</Table>
				<Pagination total={rows.length} unit="templates" />
			</InfoCard>
		{/if}
	{/await}
</PageContent>
