<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { createWorkOrder, getVolunteerRoles } from '$lib/remote/volunteer.remote';

	/**
	 * "New Work Order": work with a role and a deadline but no window yet. It
	 * lands on the Needs scheduling card, which is not rendered while empty, so
	 * the action lives in the page header beside "New Shift" (#1527).
	 */
	const all = $derived(await getVolunteerRoles());
	const live = $derived(all.filter((r) => r.isActive));
</script>

{#if live.length > 0}
	<Action
		action={createWorkOrder}
		label="New Work Order"
		modalTitle="Raise a work order"
		submitLabel="Create"
		successToast="Work order created"
	>
		{#snippet form()}
			<p class="text-sm">
				Work that needs doing, with nobody booked yet. Give it a time later from Needs scheduling.
			</p>
			<FormField
				name="volunteerRoleId"
				label="Role"
				type="select"
				value={live[0].id}
				options={live.map((r) => ({ value: r.id, label: r.name }))}
			/>
			<FormField name="dueAt" label="Due by (optional)" type="datetime-local" />
			<FormField name="capacity" label="People needed" type="number" value="1" min="1" />
			<FormField name="notes" label="Notes" type="textarea" />
		{/snippet}
	</Action>
{/if}
