<script lang="ts">
	import type { RemoteForm } from '@sveltejs/kit';
	import { getAssignableStaff } from '$lib/remote/inbox.remote';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';

	/**
	 * The "Assigned to" control, with its own data.
	 *
	 * The staff list is the page's only piece of non-first-paint data: nothing
	 * above the fold needs it, and it is a whole extra round trip. Awaiting it
	 * here rather than in the page means the conversation paints without it and
	 * this select fills in behind — and keeps the page down to one load-bearing
	 * query, per `custom/no-concurrent-remote-queries`.
	 *
	 * The whole form waits, rather than a placeholder select waiting inside it:
	 * two fields named `userId` in one <Form> is a duplicate submit name, which
	 * `custom/no-duplicate-field-names` rightly rejects.
	 */
	let {
		action,
		threadId,
		assignedToUserId
	}: {
		// `.for(...)` hands back a form with `for` omitted, which is what the page passes.
		action: RemoteForm<any, any> | Omit<RemoteForm<any, any>, 'for'>;
		threadId: string;
		assignedToUserId: string | null;
	} = $props();
</script>

{#await getAssignableStaff()}
	<div class="flex items-end gap-2 py-2">
		<span class="loading loading-xs loading-spinner"></span>
		<span class="text-subtle text-sm">Loading assignees…</span>
	</div>
{:then staffUsers}
	<Form remote={action} successToast="Assignment updated" class="flex items-end gap-2">
		<input {...action.fields.threadId.as('hidden', threadId)} />
		<FormField
			name="userId"
			label="Assigned to"
			type="select"
			options={[
				{ value: '', label: 'Unassigned' },
				...staffUsers.map((s) => ({ value: s.id, label: s.name }))
			]}
			value={assignedToUserId ?? ''}
			class="flex-1"
		/>
		<SubmitButton label="Update" variant="default" size="sm" />
	</Form>
{/await}
