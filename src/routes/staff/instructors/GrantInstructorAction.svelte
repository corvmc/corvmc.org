<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import SearchSelect from '$lib/components/ui/Form/SearchSelect.svelte';
	import { searchMembers } from '$lib/remote/reservations.remote';
	import { grantInstructor } from '$lib/remote/instructors.remote';
	import { invalidateAll } from '$app/navigation';

	/**
	 * Grant teaching status to a member who never applied — the staffer already
	 * knows them. Also the way back from paused or retired, because reinstating
	 * and granting are the same decision made twice.
	 */
	let member = $state<{ id: string; name: string; email: string } | null>(null);
</script>

<Action
	action={grantInstructor}
	label="Grant teaching status"
	modalTitle="Grant teaching status"
	submitLabel="Grant"
	successToast="Teaching status granted"
	variant="primary"
	size="sm"
	onsuccess={() => invalidateAll()}
>
	{#snippet form()}
		<div class="space-y-4">
			<SearchSelect
				search={searchMembers}
				bind:value={member}
				name="userId"
				placeholder="Search by name or email..."
			/>

			<p class="text-subtle">
				They can book the room on teaching terms immediately — there is nothing for them to accept.
				Teaching time is charged at the member rate with the monthly cap lifted, not at the drop-in
				rate.
			</p>
		</div>
	{/snippet}
</Action>
