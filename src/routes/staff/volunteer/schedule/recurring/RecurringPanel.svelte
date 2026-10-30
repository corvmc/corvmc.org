<script lang="ts">
	import { resolve } from '$app/paths';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { formatDate, formatDateShort } from '$lib/utils/format';
	import {
		retireRecurringWork,
		updateRecurringWork,
		type getRecurringWorkPage
	} from '$lib/remote/maintenance-schedules.remote';
	import { every } from './every';

	type Page = Awaited<ReturnType<typeof getRecurringWorkPage>>;

	let {
		series: s,
		projectOptions,
		open = $bindable(false)
	}: {
		series: Page['schedules'][number];
		projectOptions: { value: string; label: string }[];
		open?: boolean;
	} = $props();
</script>

<Modal bind:open title={s.name} placement="end" maxWidth="max-w-xl">
	<div class="space-y-4">
		{#if !s.retiredAt}
			<div class="flex gap-2">
				{#if s.openWorkOrderId}
					<Button
						href={resolve('/staff/volunteer/shifts/[id]', { id: s.openWorkOrderId })}
						variant="ghost"
						size="sm">Open work order</Button
					>
				{/if}
				<Action
					action={updateRecurringWork.for(s.id)}
					label="Edit"
					variant="ghost"
					size="sm"
					modalTitle="Edit {s.name}"
					submitLabel="Save"
					successToast="Saved"
				>
					{#snippet form()}
						{@const fields = updateRecurringWork.for(s.id).fields}
						<input {...fields.id.as('hidden', s.id)} />
						<FormField name="name" label="Name" type="text" value={s.name} />
						<FormField
							name="intervalDays"
							label="Repeat every (days)"
							type="number"
							value={String(s.intervalDays)}
						/>
						<FormField
							name="capacity"
							label="How many people"
							type="number"
							value={String(s.capacity)}
						/>
						<FormField
							name="projectId"
							label="Project"
							type="select"
							options={projectOptions}
							value={s.projectId ?? ''}
						/>
						<FormField name="notes" label="Notes" type="textarea" value={s.notes ?? ''} />
					{/snippet}
				</Action>
				<Action
					action={retireRecurringWork.for(s.id)}
					label="Retire"
					variant="ghost"
					size="sm"
					modalTitle="Retire {s.name}?"
					submitLabel="Retire"
					submitVariant="error"
					successToast="Retired"
				>
					{#snippet form()}
						{@const fields = retireRecurringWork.for(s.id).fields}
						<input {...fields.id.as('hidden', s.id)} />
						<p>No new work orders. The open one stays queued.</p>
					{/snippet}
				</Action>
			</div>
		{/if}

		<DefinitionList>
			<Fact label="Repeats" value={s.retiredAt ? 'Retired' : every(s.intervalDays)} />
			<Fact label="Role" value={s.roleName} />
			<Fact label="People" value={String(s.capacity)} />
			{#if s.groupName}<Fact label="Committee" value={s.groupName} />{/if}
			{#if s.projectName}<Fact label="Project" value={s.projectName} />{/if}
			{#if s.assetId && s.assetName}
				<Fact label="Equipment">
					<a class="link" href={resolve('/staff/inventory/assets/[id]', { id: s.assetId })}
						>{s.assetName}</a
					>
				</Fact>
			{/if}
			{#if s.openDueAt}<Fact label="Next due" value={formatDateShort(s.openDueAt)} />{/if}
			{#if s.assignees.length > 0}<Fact label="On it" value={s.assignees.join(', ')} />{/if}
			<Fact label="Last closed" value={s.lastClosedAt ? formatDate(s.lastClosedAt) : 'Never'} />
			{#if s.notes}<Fact label="Notes" wrap value={s.notes} />{/if}
		</DefinitionList>
	</div>
</Modal>
