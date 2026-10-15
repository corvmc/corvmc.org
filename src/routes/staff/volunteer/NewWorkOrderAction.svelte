<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import ShiftFormFields from '$lib/components/volunteer/ShiftFormFields.svelte';
	import { toLocalDateTime } from '$lib/utils/format';
	import { createWorkOrder, getVolunteerRoles } from '$lib/remote/volunteer.remote';

	/**
	 * The one "New Work Order". A shift is a work order with a window (#1933), so
	 * the window is a checkbox here rather than a second action: ticked, the order
	 * is posted and claimable; unticked, it waits on Needs scheduling.
	 */
	let { onsuccess }: { onsuccess?: () => void } = $props();

	const FALLBACK_DURATION_MINUTES = 4 * 60;
	const FALLBACK_CAPACITY = 1;
	// Tomorrow, so the form never opens on a time that has already passed.
	const START_MS = Date.now() + 86_400_000;
	const defaultStart = toLocalDateTime(new Date(START_MS));

	let pickedRoleId = $state('');
	let timed = $state(true);

	const all = $derived(await getVolunteerRoles());
	const live = $derived(all.filter((r) => r.isActive));

	// Seeded from the first live role: the select has no placeholder option, so a
	// bound value matching nothing would post an empty role instead of the one shown.
	$effect(() => {
		if (pickedRoleId) return;
		const first = live[0];
		if (first) pickedRoleId = first.id;
	});

	const defaults = $derived.by(() => {
		const picked = live.find((r) => r.id === pickedRoleId) ?? live[0];
		const minutes = picked?.defaultDurationMinutes ?? FALLBACK_DURATION_MINUTES;
		return {
			end: toLocalDateTime(new Date(START_MS + minutes * 60_000)),
			capacity: String(picked?.defaultCapacity ?? FALLBACK_CAPACITY)
		};
	});
</script>

{#if live.length > 0}
	<Action
		action={createWorkOrder}
		label="New Work Order"
		modalTitle="New work order"
		submitLabel="Create"
		successToast="Work order created"
		{onsuccess}
	>
		{#snippet form()}
			<FormField
				name="timed"
				type="checkbox"
				checkboxLabel="It has a set time"
				bind:value={timed}
			/>
			<ShiftFormFields
				form={createWorkOrder}
				roles={live}
				bind:roleId={pickedRoleId}
				{timed}
				startsAt={defaultStart}
				endsAt={defaults.end}
				capacity={defaults.capacity}
			/>
		{/snippet}
	</Action>
{/if}
