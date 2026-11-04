<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { invalidateAll } from '$app/navigation';
	import { compTickets } from '#lib/remote/events.remote.js';

	const { fields } = compTickets;

	let {
		eventId,
		variant = 'primary',
		size = 'sm',
		outline = true,
		class: className = '',
		onsuccess,
		...rest
	}: {
		eventId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		outline?: boolean;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={compTickets}
	label={m.actions_comp_tickets_comp_tickets()}
	modalTitle={m.actions_comp_tickets_comp_tickets()}
	submitLabel={m.actions_comp_tickets_submit_label()}
	successToast={m.actions_comp_tickets_success_toast()}
	{variant}
	{size}
	{outline}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.eventId.as('hidden', eventId)} />
		<div class="space-y-3">
			<FormField
				field={fields.attendeeName}
				label={m.actions_comp_tickets_attendee_name()}
				required
			/>
			<FormField field={fields.attendeeEmail} type="email" label={m.actions_email()} required />
			<!-- Custom input: the handler's schema reads quantity as a string
			     (`z.string().transform(Number)`), so the field stays registered
			     `as('text')` and `type="number"` is the spinner alone. Registering
			     it `as('number')` submits an `n:` field the schema rejects. -->
			<FormField field={fields.quantity} label={m.actions_quantity()}>
				{#snippet input(id)}
					<input
						{...fields.quantity.as('text')}
						{id}
						type="number"
						class="input w-full"
						value="1"
						min="1"
						max="50"
					/>
				{/snippet}
			</FormField>
		</div>
	{/snippet}
</Action>
