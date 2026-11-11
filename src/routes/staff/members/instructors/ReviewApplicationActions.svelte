<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { approveInstructor, sendBackInstructor } from '#lib/remote/instructors.remote.js';
	import { refreshAll } from '$app/navigation';

	/**
	 * The two ways an application leaves the queue.
	 *
	 * "Reject" sends it back; it is not final and not an appealable decision: the
	 * member edits their listing and resubmits, and `reviewNotes` is stored rather
	 * than only emailed because they cannot fix what they cannot see.
	 */
	let { id, name }: { id: string; name: string } = $props();

	const sendBackFields = sendBackInstructor.fields;
	const approveFields = approveInstructor.fields;
</script>

<div class="flex w-max gap-2">
	<Action
		action={sendBackInstructor}
		label={m.staff_members_instructors_review_application_actions_reject_label()}
		modalTitle={m.staff_members_instructors_review_application_actions_reject_2_title({ name })}
		submitLabel={m.staff_members_instructors_review_application_actions_reject_label()}
		successToast={m.staff_rejected_toast()}
		variant="ghost"
		size="sm"
		onsuccess={() => refreshAll()}
	>
		{#snippet form()}
			<div class="space-y-4">
				<input {...sendBackFields.id.as('hidden', id)} />
				<FormField
					field={sendBackFields.note}
					label={m.staff_members_instructors_review_application_actions_what_ne_label()}
					type="textarea"
					required
				/>
				<p class="text-subtle">
					{m.staff_members_instructors_review_application_actions_they_se_text()}
				</p>
			</div>
		{/snippet}
	</Action>

	<Action
		action={approveInstructor}
		label={m.staff_approve_label()}
		modalTitle={m.staff_members_instructors_review_application_actions_approve_title({ name })}
		data-testid="approve-instructor"
		submitLabel={m.staff_approve_label()}
		successToast={m.staff_approved_toast()}
		variant="primary"
		size="sm"
		onsuccess={() => refreshAll()}
	>
		{#snippet form()}
			<div class="space-y-4">
				<input {...approveFields.id.as('hidden', id)} />
				<p class="text-subtle">
					{m.staff_members_instructors_review_application_actions_their_l_text()}
				</p>
			</div>
		{/snippet}
	</Action>
</div>
