<script lang="ts">
	/**
	 * The recurring-work definitions, shown above Schedule's table while its
	 * Recurring filter is on. The occurrences they write are rows of that table, so
	 * the next one's date and who is on it live there, not here.
	 *
	 * Self-contained, with its own query, so #1796 can move it to wherever
	 * recurring work ends up living without touching Schedule.
	 */
	import { resolve } from '$app/paths';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SearchSelect from '$lib/components/ui/Form/SearchSelect.svelte';
	import { formatDate } from '$lib/utils/format';
	import { clubToday } from '$lib/config';
	import { addIsoDays } from '$lib/utils/deadline';
	import {
		getRecurringWorkPage,
		createRecurringWork,
		retireRecurringWork,
		searchWorkAssets
	} from '$lib/remote/maintenance-schedules.remote';

	// Above the await: a declaration after it is async-gated.
	const assetField = createRecurringWork.fields.assetId;
	let asset = $state<{ id: string; name: string; detail: string | null } | null>(null);
	const defaultFirstDue = addIsoDays(clubToday(), 7);

	const data = $derived(await getRecurringWorkPage());
	const roleOptions = $derived(data.roles.map((r) => ({ value: r.id, label: r.name })));
	const projectOptions = $derived([
		{ value: '', label: 'None' },
		...data.projects.map((p) => ({ value: p.id, label: p.name }))
	]);

	function every(days: number): string {
		if (days === 1) return 'Daily';
		if (days === 7) return 'Weekly';
		if (days % 7 === 0) return `Every ${days / 7} weeks`;
		return `Every ${days} days`;
	}
</script>

<div class="flex items-center justify-between gap-2">
	<SectionLabel label="Recurring work" count={data.schedules.length} />
	{#if data.roles.length > 0}
		<Action
			action={createRecurringWork}
			label="New Recurring Work"
			variant="ghost"
			size="xs"
			modalTitle="New recurring work"
			submitLabel="Create"
			successToast="Recurring work created"
		>
			{#snippet form()}
				<FormField name="name" label="Name" type="text" placeholder="Monthly deep clean" />
				<FormField
					name="volunteerRoleId"
					label="Role"
					type="select"
					options={roleOptions}
					value={roleOptions[0]?.value}
				/>
				<FormField
					name="intervalDays"
					label="Repeat every (days)"
					type="number"
					value="30"
					description="Counted from when the last one closed, so a late one pushes the next one back."
				/>
				<FormField name="firstDueOn" label="First one due" type="date" value={defaultFirstDue} />
				<FormField name="capacity" label="How many people" type="number" value="1" />
				<FormField name="projectId" label="Project" type="select" options={projectOptions} />
				<FormField
					name="assetId"
					label="Equipment"
					description="Optional: the unit this work is about. Every work order it writes links to it."
				>
					<SearchSelect
						search={(q) => searchWorkAssets(q)}
						bind:value={asset}
						field={assetField}
						labelKey="name"
						descriptionKey="detail"
						placeholder="Search by item, tag or serial..."
					/>
				</FormField>
				<FormField name="notes" label="Notes" type="textarea" />
			{/snippet}
		</Action>
	{/if}
</div>

{#if data.schedules.length === 0}
	<p class="text-subtle text-sm">
		None yet. A monthly deep clean or a quarterly PA check: the next work order is written only when
		the open one is closed, so they never pile up.
	</p>
{:else}
	<Table>
		{#snippet head()}
			<th>Name</th>
			<th class="whitespace-nowrap">Repeats</th>
			<th class="col-support whitespace-nowrap">Last closed</th>
			<th class="w-px"><span class="sr-only">Actions</span></th>
		{/snippet}

		{#each data.schedules as s (s.id)}
			<tr class:text-subtle={s.retiredAt}>
				<td class="cell-primary">
					{#if s.openWorkOrderId}
						<a
							class="link font-medium"
							href={resolve('/staff/volunteer/shifts/[id]', { id: s.openWorkOrderId })}>{s.name}</a
						>
					{:else}
						<span class="font-medium">{s.name}</span>
					{/if}
					<div class="truncate text-subtle text-xs">
						{s.roleName}{#if s.groupName}
							· {s.groupName}{/if}{#if s.projectName}
							· {s.projectName}{/if}{#if s.assetId && s.assetName}
							·
							<a class="link" href={resolve('/staff/inventory/assets/[id]', { id: s.assetId })}
								>{s.assetName}</a
							>{/if}
					</div>
				</td>
				<td class="whitespace-nowrap">{s.retiredAt ? 'Retired' : every(s.intervalDays)}</td>
				<td class="col-support whitespace-nowrap">
					{#if s.lastClosedAt}
						{formatDate(s.lastClosedAt)}
					{:else}
						<span class="text-subtle">Never</span>
					{/if}
				</td>
				<td class="w-px">
					{#if !s.retiredAt}
						<Action
							action={retireRecurringWork.for(s.id)}
							label="Retire"
							variant="ghost"
							size="xs"
							modalTitle="Retire recurring work"
							submitLabel="Retire"
							submitVariant="error"
							successToast="Retired"
						>
							{#snippet form()}
								{@const fields = retireRecurringWork.for(s.id).fields}
								<input {...fields.id.as('hidden', s.id)} />
								<p>
									Stop writing new <strong>{s.name}</strong> work orders? The open one stays in the queue
									until someone closes it.
								</p>
							{/snippet}
						</Action>
					{/if}
				</td>
			</tr>
		{/each}
	</Table>
{/if}
