<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { startConversation } from '#lib/remote/inbox.remote.js';
	import { formatMonthDayYear } from '#lib/utils/format.js';

	/**
	 * Where the door code would show while the booker owes a fee (#2874). The
	 * remote has already withheld the code. `dueOn` is the booker's oldest fee,
	 * given only to the booker; a bandmate reads the booker's name instead.
	 */
	let { dueOn, bookerName }: { dueOn: Date | null; bookerName?: string | null } = $props();

	const compose = startConversation.for('door-code-held');
	const date = $derived(dueOn ? formatMonthDayYear(dueOn) : '');

	let open = $state(false);

	function startCompose() {
		compose.fields.subject.set(
			date ? m.reservations_booking_payment_due_subject_text({ date }) : ''
		);
		open = true;
	}
</script>

<div data-testid="door-code-held">
	<Alert type="warning">
		{#snippet action()}
			<Button type="button" size="sm" variant="primary" onclick={startCompose}>
				{m.member_messages_compose_message_staff_label()}
			</Button>
		{/snippet}
		{date
			? m.reservations_booking_payment_due_body({ date })
			: m.reservations_door_code_held_band_body({ name: bookerName ?? '' })}
	</Alert>
</div>

<Modal bind:open title={m.member_messages_compose_message_corvmc_staff_title()} maxWidth="max-w-sm">
	<Form
		class="space-y-4"
		remote={compose}
		successToast={m.member_messages_compose_message_sent_toast()}
		onsuccess={(result) => {
			open = false;
			const { threadId } = (result ?? {}) as { threadId?: string };
			if (threadId) goto(resolve(`member/messages/${threadId}`));
		}}
	>
		<FormField
			field={compose.fields.subject}
			label={m.member_messages_compose_what_s_about_label()}
			type="text"
		/>
		<FormField
			field={compose.fields.body}
			label={m.member_messages_compose_message_label()}
			type="textarea"
		/>
		<div class="flex justify-end pt-2">
			<SubmitButton label={m.member_messages_compose_send_label()} />
		</div>
	</Form>
</Modal>
