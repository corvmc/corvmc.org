<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { pauseInstructor, retireInstructor } from '#lib/remote/instructors.remote.js';
	import { refreshAll } from '$app/navigation';

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

<div class="flex w-max gap-2">
	<Action
		action={pauseInstructor}
		label={m.staff_members_instructors_end_grant_actions_pause_label()}
		modalTitle={m.staff_members_instructors_end_grant_actions_pause_2_title({ name })}
		submitLabel={m.staff_members_instructors_end_grant_actions_pause_label()}
		successToast={m.staff_members_instructors_end_grant_actions_paused_toast()}
		variant="ghost"
		size="sm"
		onsuccess={() => refreshAll()}
	>
		{#snippet form()}
			<div class="space-y-4">
				<input {...pauseFields.id.as('hidden', id)} />
				<FormField
					field={pauseFields.note}
					label={m.staff_members_instructors_end_grant_actions_why_label()}
					type="textarea"
					required
				/>
				<p class="text-subtle">
					{m.staff_members_instructors_end_grant_actions_they_stop_being_text()}
				</p>
			</div>
		{/snippet}
	</Action>

	<Action
		action={retireInstructor}
		label={m.staff_retire_label()}
		modalTitle={m.staff_members_instructors_end_grant_actions_retire_title({ name })}
		submitLabel={m.staff_retire_label()}
		successToast={m.staff_retired_toast()}
		variant="ghost"
		size="sm"
		onsuccess={() => refreshAll()}
	>
		{#snippet form()}
			<div class="space-y-4">
				<input {...retireFields.id.as('hidden', id)} />
				<FormField
					field={retireFields.note}
					label={m.staff_members_instructors_end_grant_actions_why_label()}
					type="textarea"
					required
				/>
				<p class="text-subtle">
					{m.staff_members_instructors_end_grant_actions_someone_who_has_text()}
				</p>
			</div>
		{/snippet}
	</Action>
</div>
