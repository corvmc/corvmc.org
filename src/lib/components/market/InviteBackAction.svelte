<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { inviteBackForm } from '#lib/remote/market.remote.js';

	/**
	 * Record whether to ask a vendor back (#1505). Nothing is chosen until
	 * somebody chooses: a preselected answer is saved unread (#2827). A recorded
	 * answer shows as recorded.
	 */
	let {
		vendor
	}: {
		vendor: {
			id: string;
			businessName: string;
			inviteBack: boolean | null;
			inviteBackNote: string | null;
		};
	} = $props();

	const remote = $derived(inviteBackForm.for(vendor.id));
	let choice = $derived(vendor.inviteBack === null ? '' : vendor.inviteBack ? 'yes' : 'no');

	const options = [
		{ value: 'yes', label: m.market_vendor_check_in_invite_back_label() },
		{ value: 'no', label: m.market_vendor_check_in_do_not_invite_back_label() }
	];
</script>

<Action
	action={remote}
	label={m.market_vendor_check_in_invite_back_2_label()}
	modalTitle={m.market_vendor_check_in_modal_title({ businessName: vendor.businessName })}
	submitLabel={m.market_vendor_check_in_submit_label()}
	successToast={m.market_vendor_check_in_saved_toast()}
	canSubmit={choice !== ''}
	variant="ghost"
	size="sm"
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...remote.fields.vendorId.as('hidden', vendor.id)} />
			<FormField
				field={remote.fields.inviteBack}
				type="select"
				label={m.market_vendor_check_in_next_market_label()}
				placeholder={m.market_vendor_check_in_choose_placeholder()}
				{options}
				required
				bind:value={choice}
			/>
			<FormField
				field={remote.fields.note}
				label={m.market_vendor_check_in_note_label()}
				description={m.market_vendor_check_in_shown_vendor_s_next_application_body()}
				value={vendor.inviteBackNote ?? ''}
			/>
		</div>
	{/snippet}
</Action>
