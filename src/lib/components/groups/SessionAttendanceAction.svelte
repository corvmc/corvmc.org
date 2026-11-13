<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import CheckboxGroup from '#lib/components/ui/Form/CheckboxGroup.svelte';
	import { errorMessage } from '#lib/error-message.js';
	import {
		getSessionAttendance,
		markSessionAttendance
	} from '#lib/remote/session-attendance.remote.js';

	/**
	 * Tick who came to a session. The list is the roster plus the RSVPs, read
	 * when the modal opens, so a walk-in from the roster needs no RSVP first.
	 */
	let {
		groupId,
		session,
		onchanged
	}: { groupId: string; session: { id: string; title: string }; onchanged: () => void } = $props();

	const fields = markSessionAttendance.fields;
	const ref = $derived({ groupId, eventId: session.id });
</script>

<Action
	action={markSessionAttendance.for(session.id)}
	label={m.groups_session_attendance_label()}
	aria-label={m.groups_session_attendance_aria_label({ title: session.title })}
	modalTitle={m.groups_session_attendance_modal_title()}
	submitLabel={m.groups_save_label()}
	successToast={m.groups_session_attendance_success_toast()}
	variant="ghost"
	size="xs"
	onsuccess={onchanged}
>
	{#snippet form()}
		<input {...fields.groupId.as('hidden', groupId)} />
		<input {...fields.eventId.as('hidden', session.id)} />
		{#await getSessionAttendance(ref)}
			<div class="flex items-center justify-center p-8">
				<span class="loading loading-md loading-spinner"></span>
			</div>
		{:then people}
			{#if people.length === 0}
				<p class="text-subtle">{m.groups_session_attendance_empty_text()}</p>
			{:else}
				<CheckboxGroup
					field={fields.attended}
					options={people.map((p) => ({
						value: p.userId,
						label: p.name,
						description: p.rsvped ? m.groups_session_attendance_rsvped_body() : null
					}))}
					selected={people.filter((p) => p.attended).map((p) => p.userId)}
				/>
			{/if}
		{:catch err}
			<Alert type="warning">
				{m.groups_session_attendance_load_failed_body({ errorMessage: errorMessage(err) })}
			</Alert>
		{/await}
	{/snippet}
</Action>
