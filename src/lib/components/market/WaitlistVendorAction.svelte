<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { IconClockPause } from '@tabler/icons-svelte';
	import { decideVendorForm } from '#lib/remote/market.remote.js';
	import { toastDelivery } from '#lib/utils/delivery-toast.js';

	/** Put an applied vendor on the market's waitlist, and tell them (#2832). */
	let {
		vendorId,
		businessName,
		eventTitle
	}: { vendorId: string; businessName: string; eventTitle: string } = $props();

	const remote = $derived(decideVendorForm.for(`waitlist-${vendorId}`));
</script>

<Action
	action={remote}
	label={m.market_waitlist_label()}
	iconOnly
	modalTitle={m.market_waitlist_title({ businessName })}
	onsuccess={(r) =>
		toastDelivery(r, {
			sent: m.market_waitlisted_vendor_told_toast(),
			notSent: m.market_waitlisted_message_not_sent_toast()
		})}
	variant="ghost"
	size="sm"
>
	{#snippet icon()}<IconClockPause size={16} />{/snippet}
	{#snippet form()}
		<input {...remote.fields.vendorId.as('hidden', vendorId)} />
		<input {...remote.fields.decision.as('hidden', 'waitlisted')} />
		<FormField
			field={remote.fields.message}
			type="textarea"
			label={m.market_waitlist_message_label()}
			description={m.market_waitlist_message_body()}
			value={m.market_waitlist_message_default({ businessName, eventTitle })}
		/>
	{/snippet}
</Action>
