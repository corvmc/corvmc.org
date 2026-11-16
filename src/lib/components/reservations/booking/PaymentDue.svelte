<script module lang="ts">
	/** The member's fee gate as the booking pages receive it (#2748, #2859). */
	export interface FeeGate {
		state: 'off' | 'clear' | 'warn' | 'refuse';
		fees: { id: string; startsAt: Date; endsAt: Date; amountCents: number | null }[];
	}
</script>

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/ui/Button.svelte';
	import type { ButtonSize, ButtonVariant } from '#lib/components/ui/Button.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { startConversation } from '#lib/remote/inbox.remote.js';
	import { formatMonthDayYear } from '#lib/utils/format.js';

	/**
	 * Stands in for a booking button while the member owes a fee (#2859). The
	 * remote refuses the booking on its own; this says why and offers the staff
	 * compose in the same dialog, since a dialog opened over a bits-ui dialog
	 * cannot be clicked.
	 */
	let {
		gate,
		label,
		icon,
		variant = 'primary',
		size,
		...rest
	}: {
		gate: FeeGate;
		label: string;
		icon?: Snippet;
		variant?: ButtonVariant;
		size?: ButtonSize;
		[key: string]: unknown;
	} = $props();

	const compose = startConversation.for('payment-due');
	const date = $derived(gate.fees[0] ? formatMonthDayYear(gate.fees[0].startsAt) : '');

	let open = $state(false);
	let composing = $state(false);

	function startCompose() {
		compose.fields.subject.set(m.reservations_booking_payment_due_subject_text({ date }));
		composing = true;
	}
</script>

<Button
	{variant}
	{size}
	{...rest}
	onclick={() => {
		composing = false;
		open = true;
	}}
>
	{@render icon?.()}
	{label}
</Button>

<Modal
	bind:open
	title={composing
		? m.member_messages_compose_message_corvmc_staff_title()
		: m.reservations_booking_payment_due_title()}
	maxWidth="max-w-sm"
>
	{#if composing}
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
	{:else}
		<div class="space-y-4" data-testid="payment-due">
			<p>{m.reservations_booking_payment_due_text({ date })}</p>
			<div class="flex justify-end">
				<Button type="button" variant="primary" onclick={startCompose}>
					{m.member_messages_compose_message_staff_label()}
				</Button>
			</div>
		</div>
	{/if}
</Modal>
