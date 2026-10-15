<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { approveInstructor, sendBackInstructor } from '$lib/remote/instructors.remote';
	import { invalidateAll } from '$app/navigation';

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
		label="Reject"
		modalTitle="Reject {name}"
		submitLabel="Reject"
		successToast="Rejected"
		variant="ghost"
		size="sm"
		onsuccess={() => invalidateAll()}
	>
		{#snippet form()}
			<div class="space-y-4">
				<input {...sendBackFields.id.as('hidden', id)} />
				<FormField
					field={sendBackFields.note}
					label="What needs changing?"
					type="textarea"
					required
				/>
				<p class="text-subtle">
					They see this note, edit their listing and send it back. Nothing is deleted and they do
					not have to start again.
				</p>
			</div>
		{/snippet}
	</Action>

	<Action
		action={approveInstructor}
		label="Approve"
		modalTitle="Approve {name}"
		submitLabel="Approve"
		successToast="Approved"
		variant="primary"
		size="sm"
		onsuccess={() => invalidateAll()}
	>
		{#snippet form()}
			<div class="space-y-4">
				<input {...approveFields.id.as('hidden', id)} />
				<p class="text-subtle">
					Their listing goes live and they can book the room on teaching terms. Approving is what
					publishes what you are looking at — there is no second draft.
				</p>
			</div>
		{/snippet}
	</Action>
</div>
