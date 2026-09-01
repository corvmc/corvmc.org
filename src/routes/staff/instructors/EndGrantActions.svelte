<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { pauseInstructor, retireInstructor } from '$lib/remote/instructors.remote';
	import { invalidateAll } from '$app/navigation';

	/**
	 * Pause and retire both block booking and differ only in intent — which is the
	 * whole of their value, because the roster has to tell "back in autumn" from
	 * "no longer teaches here".
	 *
	 * **Neither cancels future teaching bookings.** Ending a grant is a decision
	 * about the future, and a booked lesson has a student on the other end who has
	 * already been told a time. Cancelling those is a separate, deliberate act.
	 */
	let { id, name }: { id: string; name: string } = $props();

	const pauseFields = pauseInstructor.fields;
	const retireFields = retireInstructor.fields;
</script>

<div class="flex gap-2">
	<Action
		action={pauseInstructor}
		label="Pause"
		modalTitle="Pause {name}"
		submitLabel="Pause"
		successToast="Paused"
		variant="ghost"
		size="sm"
		onsuccess={() => invalidateAll()}
	>
		{#snippet form()}
			<div class="space-y-4">
				<input {...pauseFields.id.as('hidden', id)} />
				<FormField field={pauseFields.note} label="Why?" type="textarea" required />
				<p class="text-subtle">
					They stop being listed and cannot book teaching time. Bookings they already hold stand.
				</p>
			</div>
		{/snippet}
	</Action>

	<Action
		action={retireInstructor}
		label="Retire"
		modalTitle="Retire {name}"
		submitLabel="Retire"
		successToast="Retired"
		variant="ghost"
		size="sm"
		onsuccess={() => invalidateAll()}
	>
		{#snippet form()}
			<div class="space-y-4">
				<input {...retireFields.id.as('hidden', id)} />
				<FormField field={retireFields.note} label="Why?" type="textarea" required />
				<p class="text-subtle">
					For someone who has stopped teaching here rather than paused. Bookings they already hold
					stand — cancel those separately if they need cancelling.
				</p>
			</div>
		{/snippet}
	</Action>
</div>
