<script lang="ts">
	/**
	 * The recurring-work definitions. Each writes work orders, one open at a time,
	 * and those occurrences are rows of the Schedule's other view. A row opens its
	 * record in the side panel; `?id` is that panel's address.
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
	import { urlState, text } from '$lib/urlState.svelte';
	import {
		getRecurringWorkPage,
		createRecurringWork,
		searchWorkAssets
	} from '$lib/remote/maintenance-schedules.remote';
	import RecurringPanel from './RecurringPanel.svelte';
	import { every } from './every';

	// Above the await: a declaration after it is async-gated.
	const assetField = createRecurringWork.fields.assetId;
	let asset = $state<{ id: string; name: string; detail: string | null } | null>(null);
	const defaultFirstDue = addIsoDays(clubToday(), 7);
	const url = urlState(resolve('/staff/volunteer/schedule/recurring'), { id: text() });

	const data = $derived(await getRecurringWorkPage());
	const roleOptions = $derived(data.roles.map((r) => ({ value: r.id, label: r.name })));
	const projectOptions = $derived([
		{ value: '', label: 'None' },
		...data.projects.map((p) => ({ value: p.id, label: p.name }))
	]);
	const selected = $derived(data.schedules.find((s) => s.id === url.id));
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
					description="Counted from when the last one closed."
				/>
				<FormField name="firstDueOn" label="First one due" type="date" value={defaultFirstDue} />
				<FormField name="capacity" label="How many people" type="number" value="1" />
				<FormField name="projectId" label="Project" type="select" options={projectOptions} />
				<FormField name="assetId" label="Equipment">
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
	<p class="text-subtle text-sm">None yet.</p>
{:else}
	<Table>
		{#snippet head()}
			<th>Name</th>
			<th class="whitespace-nowrap">Repeats</th>
			<th class="col-support whitespace-nowrap">Last closed</th>
		{/snippet}

		{#each data.schedules as s (s.id)}
			<tr class:text-subtle={s.retiredAt}>
				<td class="cell-primary">
					<button type="button" class="link font-medium" onclick={() => (url.id = s.id)}
						>{s.name}</button
					>
					<div class="truncate text-subtle text-xs">
						{s.roleName}{#if s.groupName}
							· {s.groupName}{/if}{#if s.projectName}
							· {s.projectName}{/if}
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
			</tr>
		{/each}
	</Table>
{/if}

{#if selected}
	{#key selected.id}
		<RecurringPanel
			series={selected}
			{projectOptions}
			bind:open={() => true, (v) => !v && (url.id = '')}
		/>
	{/key}
{/if}
