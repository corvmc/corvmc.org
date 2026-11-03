<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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
		{ value: '', label: m.staff_volunteer_schedule_recurring_recurring_work_none() },
		...data.projects.map((p) => ({ value: p.id, label: p.name }))
	]);
	const selected = $derived(data.schedules.find((s) => s.id === url.id));
</script>

<div class="flex items-center justify-between gap-2">
	<SectionLabel
		label={m.staff_volunteer_schedule_recurring_recurring_work_recurring()}
		count={data.schedules.length}
	/>
	{#if data.roles.length > 0}
		<Action
			action={createRecurringWork}
			label={m.staff_volunteer_schedule_recurring_recurring_work_new_recurr()}
			data-testid="new-recurring-work"
			variant="ghost"
			size="xs"
			modalTitle={m.staff_volunteer_schedule_recurring_recurring_work_modal_titl()}
			submitLabel={m.staff_create()}
			successToast={m.staff_volunteer_schedule_recurring_recurring_work_success_to()}
		>
			{#snippet form()}
				<FormField
					field={createRecurringWork.fields.name}
					label={m.staff_name()}
					type="text"
					placeholder={m.staff_volunteer_schedule_recurring_recurring_work_monthly_de()}
				/>
				<FormField
					field={createRecurringWork.fields.volunteerRoleId}
					label={m.staff_role()}
					type="select"
					options={roleOptions}
					value={roleOptions[0]?.value}
				/>
				<FormField
					field={createRecurringWork.fields.intervalDays}
					submitAs="text"
					label={m.staff_repeat_every_days()}
					type="number"
					value="30"
					description={m.staff_volunteer_schedule_recurring_recurring_work_descriptio()}
				/>
				<FormField
					field={createRecurringWork.fields.firstDueOn}
					label={m.staff_volunteer_schedule_recurring_recurring_work_first_one()}
					type="date"
					value={defaultFirstDue}
				/>
				<FormField
					field={createRecurringWork.fields.capacity}
					submitAs="text"
					label={m.staff_how_many_people()}
					type="number"
					value="1"
				/>
				<FormField
					field={createRecurringWork.fields.projectId}
					label={m.staff_project()}
					type="select"
					options={projectOptions}
				/>
				<FormField field={createRecurringWork.fields.assetId} label={m.staff_equipment()}>
					<SearchSelect
						search={(q) => searchWorkAssets(q)}
						bind:value={asset}
						field={assetField}
						labelKey="name"
						descriptionKey="detail"
						placeholder={m.staff_search_by_item_tag_serial()}
					/>
				</FormField>
				<FormField
					field={createRecurringWork.fields.notes}
					label={m.staff_notes()}
					type="textarea"
				/>
			{/snippet}
		</Action>
	{/if}
</div>

{#if data.schedules.length === 0}
	<p class="text-subtle text-sm">
		{m.staff_volunteer_schedule_recurring_recurring_work_none_yet()}
	</p>
{:else}
	<Table>
		{#snippet head()}
			<th>{m.staff_name()}</th>
			<th class="whitespace-nowrap">{m.staff_repeats()}</th>
			<th class="col-support whitespace-nowrap">{m.staff_last_closed()}</th>
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
				<td class="whitespace-nowrap">{s.retiredAt ? m.staff_retired() : every(s.intervalDays)}</td>
				<td class="col-support whitespace-nowrap">
					{#if s.lastClosedAt}
						{formatDate(s.lastClosedAt)}
					{:else}
						<span class="text-subtle"
							>{m.staff_volunteer_schedule_recurring_recurring_work_never()}</span
						>
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
