<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import ShiftFormFields from '$lib/components/volunteer/ShiftFormFields.svelte';
	import { toLocalDateTime } from '$lib/utils/format';
	import { createShift, getVolunteerRoles } from '$lib/remote/volunteer.remote';

	/**
	 * "New Shift", owning the role list it needs.
	 *
	 * `getVolunteerRoles` is unparameterized and refreshed by name, so it could not join the shift
	 * list's filter-keyed query. Everything that depended on it came with it: the seeding effect
	 * below and the per-role defaults.
	 */
	let { defaultStart }: { defaultStart: string } = $props();

	const FALLBACK_DURATION_MINUTES = 4 * 60;
	const FALLBACK_CAPACITY = 1;
	const START_MS = Date.now() + 86_400_000;

	const all = $derived(await getVolunteerRoles());
	const live = $derived(all.filter((r) => r.isActive));

	let pickedRoleId = $state('');

	// Seeded from the first live role rather than left empty. The select has no placeholder
	// option, so a bound value matching nothing leaves it with nothing selected — which posts an
	// empty role instead of the one on screen. Guarded on `pickedRoleId` so it seeds once and
	// never clobbers an actual choice.
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
		action={createShift}
		label="New Shift"
		modalTitle="Schedule a shift"
		submitLabel="Create"
		successToast="Shift scheduled"
	>
		{#snippet form()}
			<ShiftFormFields
				form={createShift}
				roles={live}
				bind:roleId={pickedRoleId}
				startsAt={defaultStart}
				endsAt={defaults.end}
				capacity={defaults.capacity}
			/>
		{/snippet}
	</Action>
{/if}
