<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { getDutyLists, createDutyList } from '$lib/remote/duty-lists.remote';
	import {
		dutyListAnchors,
		dutyListAnchorLabels,
		dutyListSubjects,
		dutyListSubjectLabels
	} from '$lib/config';

	let lists = $derived(getDutyLists());

	const anchorOptions = dutyListAnchors.map((a) => ({ value: a, label: dutyListAnchorLabels[a] }));
	const subjectOptions = dutyListSubjects.map((v) => ({
		value: v,
		label: dutyListSubjectLabels[v]
	}));
</script>

<PageHeader title="Duty Lists" subtitle="Staff" backHref="/staff/volunteer">
	<Action
		action={createDutyList}
		label="New Duty List"
		modalTitle="New duty list"
		submitLabel="Create"
		successToast="Duty list created"
	>
		{#snippet form()}
			<FormField name="name" label="Name" type="text" />
			<FormField
				name="description"
				label="Description"
				type="textarea"
				description="What this list is for. Staff read it when choosing which one to apply."
			/>
			<FormField
				name="subject"
				label="Applies to"
				type="select"
				options={subjectOptions}
				description="What this list gets stamped onto. A booking has no doors time, so anchor those to the start or the end."
			/>
			<FormField
				name="anchor"
				label="Measure offsets from"
				type="select"
				options={anchorOptions}
				description="Every item on the list is timed relative to this moment."
			/>
		{/snippet}
	</Action>
</PageHeader>

<PageContent width="3xl">
	{#await lists then rows}
		{#if rows.length === 0}
			<EmptyState
				title="No duty lists yet"
				description="A duty list is the set of work orders a night takes. Make one, and staffing a show becomes one action instead of six."
			/>
		{:else}
			<InfoCard title="Duty lists">
				<Table>
					{#snippet head()}
						<th class="w-px"><span class="sr-only">Status</span></th>
						<th>Name</th>
						<th>Anchor</th>
						<th>Applies to</th>
						<th class="cell-num">Items</th>
					{/snippet}

					{#each rows as list (list.id)}
						<tr use:rowLink={`/staff/volunteer/duty-lists/${list.id}`}>
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
							<td class="whitespace-nowrap">
								{dutyListSubjectLabels[list.subject]}
							</td>
							<td class="cell-num">{list.itemCount}</td>
						</tr>
					{/each}
				</Table>
			</InfoCard>
		{/if}
	{/await}
</PageContent>
