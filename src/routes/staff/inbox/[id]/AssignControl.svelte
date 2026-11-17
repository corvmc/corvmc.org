<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { RemoteForm } from '$app/server';
	import { getAssignableStaff } from '#lib/remote/inbox.remote.js';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { Latest } from '#lib/latest.svelte.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { errorMessage } from '#lib/error-message.js';

	/**
	 * The "Assigned to" control, with its own data.
	 *
	 * Awaiting the staff list here rather than in the page keeps the page down to
	 * one load-bearing query, per `custom/no-concurrent-remote-queries`: this
	 * starts once the thread has landed.
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
		/*
		 * `RemoteForm<Input, Output>` is invariant in `Input` — it appears
		 * covariantly in `fields` and contravariantly in `preflight`/`enhance` —
		 * so a container that accepts more than one remote form has no single
		 * generic instantiation. Expressing "some remote form, I don't care
		 * which" needs an existential type, which TypeScript does not have.
		 *
		 * Generics were tried and reverted; the page passes a `.for(...)` instance, whose
		 * type differs from the bare form's, proves the point.
		 */
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		action: RemoteForm<any, any> | Omit<RemoteForm<any, any>, 'for'>;
		threadId: string;
		assignedToUserId: string | null;
	} = $props();

	// Not `{#await}`: a refresh would re-pend it and remount the form (#2357).
	const staff = new Latest(() => getAssignableStaff());
	const staffList = $derived(staff.current ?? (await getAssignableStaff().catch(() => undefined)));
</script>

{#if staff.error && !staffList}
	<Alert type="warning" reset={() => void getAssignableStaff().refresh()}>
		{m.ui_load_failed_body({ error: errorMessage(staff.error.e) })}
	</Alert>
{:else if !staffList}
	<div class="flex items-end gap-2 py-2">
		<span class="loading loading-xs loading-spinner"></span>
		<span class="text-subtle text-sm"
			>{m.staff_inbox_id_assign_control_loading_assignees_text()}</span
		>
	</div>
{:else}
	{@const staffUsers = staffList}
	<Form
		remote={action}
		successToast={m.staff_inbox_id_assign_control_success_toast()}
		class="flex items-end gap-2"
	>
		<input {...action.fields.threadId.as('hidden', threadId)} />
		<FormField
			field={action.fields.userId}
			label={m.staff_assigned_2_label()}
			type="select"
			options={[
				{ value: '', label: m.staff_unassigned_label() },
				...staffUsers.map((s) => ({ value: s.id, label: s.name }))
			]}
			value={assignedToUserId ?? ''}
			class="flex-1"
		/>
		<SubmitButton
			label={m.staff_inbox_id_assign_control_update_label()}
			variant="default"
			size="sm"
		/>
	</Form>
{/if}
