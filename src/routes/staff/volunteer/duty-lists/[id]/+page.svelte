<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { dutyListAnchors, dutyListAnchorLabels } from '$lib/config';
	import {
		getDutyListPage,
		addDutyListItem,
		updateDutyList,
		removeDutyListItem,
		deleteDutyList
	} from '$lib/remote/duty-lists.remote';
	import { describeDuration, describeOffset } from '../offsets';

	const id = $derived(page.params.id!);
	let data = $derived(getDutyListPage(id));

	const anchorOptions = dutyListAnchors.map((a) => ({ value: a, label: dutyListAnchorLabels[a] }));

	const kindOptions = [
		{ value: 'scheduled', label: 'Scheduled — a shift with a start and an end' },
		{ value: 'due', label: 'Due by — a work order with a deadline and no window' }
	];
	const unitOptions = [
		{ value: 'minutes', label: 'minutes' },
		{ value: 'hours', label: 'hours' },
		{ value: 'days', label: 'days' }
	];
	const directionOptions = [
		{ value: 'before', label: 'before' },
		{ value: 'after', label: 'after' }
	];
</script>

{#await data then d}
	{@const anchorLabel = dutyListAnchorLabels[d.list.anchor]}
	{@const roleOptions = d.roles.map((r) => ({ value: r.id, label: r.name }))}

	<PageHeader title={d.list.name} subtitle="Duty list" backHref="/staff/volunteer/duty-lists">
		<Action
			action={updateDutyList}
			label="Edit"
			variant="ghost"
			modalTitle="Edit duty list"
			submitLabel="Save"
			successToast="Saved"
		>
			{#snippet form()}
				<input type="hidden" name="id" value={d.list.id} />
				<FormField name="name" label="Name" type="text" value={d.list.name} />
				<FormField
					name="description"
					label="Description"
					type="textarea"
					value={d.list.description ?? ''}
				/>
				<FormField
					name="anchor"
					label="Measure offsets from"
					type="select"
					options={anchorOptions}
					value={d.list.anchor}
				/>
				<FormField
					name="isActive"
					type="checkbox"
					label="Active"
					checkboxLabel="Offer this list when staffing a show"
					value={d.list.isActive}
				/>
			{/snippet}
		</Action>

		<Action
			action={addDutyListItem}
			label="Add Item"
			modalTitle="Add an item"
			submitLabel="Add"
			successToast="Item added"
		>
			{#snippet form()}
				<input type="hidden" name="dutyListId" value={d.list.id} />
				<FormField name="volunteerRoleId" label="Role" type="select" options={roleOptions} />
				<FormField
					name="kind"
					label="Kind"
					type="select"
					options={kindOptions}
					description="A deadline item becomes an unscheduled work order — claimable, and hour-loggable, but not a shift anyone is “on”."
				/>
				<div class="grid gap-4 sm:grid-cols-3">
					<FormField name="offsetAmount" label="Offset" type="number" value="3" />
					<FormField name="offsetUnit" label="Unit" type="select" options={unitOptions} />
					<FormField
						name="offsetDirection"
						label="Direction"
						type="select"
						options={directionOptions}
					/>
				</div>
				<FormField
					name="durationMinutes"
					label="Duration (minutes)"
					type="number"
					value="120"
					description="Scheduled items only. Ignored on a deadline item."
				/>
				<FormField name="capacity" label="How many people" type="number" value="1" />
				<FormField name="sortOrder" label="Sort order" type="number" value="0" />
				<FormField name="notes" label="Notes" type="textarea" />
				<FormField
					name="tasks"
					label="Tasks"
					type="textarea"
					description="One per line. These become the checklist on the work order this item produces."
				/>
			{/snippet}
		</Action>
	</PageHeader>

	<PageContent width="3xl">
		<InfoCard title="Items">
			<p class="mb-3 text-sm text-base-content/70">
				Offsets are measured from {anchorLabel.toLowerCase()}.
			</p>
			{#if d.items.length === 0}
				<EmptyState
					title="Nothing on this list yet"
					description="Add the work orders a night takes — a Booking Lead a week out, then the roles that run the room."
				/>
			{:else}
				<Table>
					{#snippet head()}
						<th>Role</th>
						<th>When</th>
						<th class="col-support">For</th>
						<th class="cell-num">People</th>
						<th class="col-support cell-num">Tasks</th>
						<th class="w-px"><span class="sr-only">Actions</span></th>
					{/snippet}

					{#each d.items as item (item.id)}
						<tr>
							<td>
								<div class="font-medium">{item.roleName}</div>
								{#if item.notes}
									<div class="line-clamp-1 text-sm text-base-content/60">{item.notes}</div>
								{/if}
							</td>
							<td class="whitespace-nowrap">
								{#if item.offsetMinutes !== null}
									{describeOffset(item.offsetMinutes, anchorLabel)}
								{:else if item.dueOffsetMinutes !== null}
									<Badge variant="ghost"
										>due {describeOffset(item.dueOffsetMinutes, anchorLabel)}</Badge
									>
								{/if}
							</td>
							<td class="col-support whitespace-nowrap">
								{item.durationMinutes !== null ? describeDuration(item.durationMinutes) : '—'}
							</td>
							<td class="cell-num">{item.capacity}</td>
							<td class="col-support cell-num">{item.tasks.length}</td>
							<td>
								<Action
									action={removeDutyListItem}
									label="Remove"
									variant="ghost"
									size="sm"
									confirm="Remove this item from the list? Work orders already created from it are not touched."
									successToast="Item removed"
								>
									{#snippet form()}
										<input type="hidden" name="id" value={item.id} />
										<input type="hidden" name="dutyListId" value={d.list.id} />
									{/snippet}
								</Action>
							</td>
						</tr>
					{/each}
				</Table>
			{/if}
		</InfoCard>

		<InfoCard title="Danger zone">
			<p class="mb-3 text-sm text-base-content/70">
				Deleting a list leaves every work order it ever produced alone — those are the record of
				work that actually happened.
			</p>
			<Action
				action={deleteDutyList}
				label="Delete duty list"
				variant="error"
				outline
				confirm={`Delete “${d.list.name}”?`}
				successToast="Duty list deleted"
				onsuccess={() => goto(resolve('/staff/volunteer/duty-lists'))}
			>
				{#snippet form()}
					<input type="hidden" name="id" value={d.list.id} />
				{/snippet}
			</Action>
		</InfoCard>
	</PageContent>
{/await}
