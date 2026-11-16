<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { refreshAll } from '$app/navigation';
	import { receiveStock } from '#lib/remote/inventory.remote.js';
	import LocationField from '#lib/components/inventory/LocationField.svelte';
	import { Field, MoneyField } from '../ui/Form';
	import MemberPicker from '../ui/MemberPicker.svelte';
	import { acquisitionKinds, acquisitionKindLabels, clubToday } from '#lib/config.js';

	const { fields } = receiveStock;

	let {
		itemId,
		variant = 'primary',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		itemId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	/**
	 * A donation has to answer things a purchase does not — what it was worth and
	 * how that was arrived at — because FASB ASU 2020-07 wants both, and neither
	 * is reconstructable a year later when the report is due.
	 */
	let kind = $state<(typeof acquisitionKinds)[number]>('purchase');

	/**
	 * Only a gift owes the FASB ASU 2020-07 disclosure, so this is an allow-list
	 * rather than `kind !== 'purchase'`. That negation was correct while there
	 * were three kinds and quietly wrong the moment `opening_balance` arrived —
	 * it would have asked how the fair value of a decade-old amp was determined
	 * and put the answer in the gifts-in-kind report.
	 */
	const isGift = $derived(kind === 'donation' || kind === 'grant');

	/**
	 * Who fronted the money. Blank means the collective's own card, which is the
	 * common case — so this stays out of the way until somebody fills it in.
	 */
	let paidByUserId = $state('');
	let paidByName = $state('');
</script>

<Action
	action={receiveStock}
	label={m.actions_receive_stock_receive_label()}
	modalTitle={m.actions_receive_stock_modal_title()}
	successToast={m.actions_receive_stock_success_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.itemId.as('hidden', itemId)} />
		<div class="grid grid-cols-2 gap-3">
			<Field field={fields.quantity} type="number" label={m.actions_quantity_label()} value={1} />
			<Field
				field={fields.kind}
				type="select"
				label={m.actions_receive_stock_how_arrived_label()}
				bind:value={kind}
				options={acquisitionKinds.map((k) => ({ value: k, label: acquisitionKindLabels[k] }))}
			/>
		</div>
		<!-- Defaulted to today in club time, not UTC — after 5pm PT the UTC date is
		     tomorrow, which a date input would offer as a default. -->
		<Field
			field={fields.occurredAt}
			type="date"
			label={m.actions_receive_stock_when_arrived_label()}
			value={clubToday()}
			description={kind === 'opening_balance'
				? m.actions_receive_stock_guess_fine_nothing_counts_opening_body()
				: undefined}
		/>
		{#if kind !== 'opening_balance'}
			<Field
				field={fields.sourceName}
				type="text"
				label={kind === 'purchase'
					? m.actions_supplier_label()
					: m.actions_receive_stock_donor_grantor_label()}
			/>
		{/if}
		<div class="grid grid-cols-2 gap-3">
			<MoneyField
				field={fields.unitValueCents}
				label={kind === 'purchase'
					? m.actions_unit_cost_label()
					: m.actions_receive_stock_value_each_label()}
			/>
			<Field
				field={fields.reference}
				type="text"
				label={m.actions_receive_stock_reference_receipt_no_label()}
			/>
		</div>
		{#if isGift}
			<Field
				field={fields.fairValueBasis}
				type="text"
				label={m.actions_receive_stock_how_value_was_determined_label()}
				description={m.actions_receive_stock_required_gifts_kind_disclosure_e_body()}
			/>
			<Field
				field={fields.intendedUse}
				type="text"
				label={m.actions_receive_stock_intended_use_label()}
			/>
			<MoneyField
				field={fields.fairValueCents}
				label={m.actions_receive_stock_total_fair_value_label()}
				description={m.actions_receive_stock_gift_as_whole_leave_blank_body()}
			/>
			<!-- ASU 2020-07 asks whether a gift was sold or put to use, and discloses
			     the two on separate lines. Nothing could set this before, so every
			     gift on record reads as utilized. -->
			<Field
				field={fields.monetized}
				type="checkbox"
				label={m.actions_receive_stock_sold_rather_than_used_label()}
				checkboxLabel={m.actions_receive_stock_checkbox_label_checkbox()}
			/>
		{/if}
		<!-- Distinct from the donor: a volunteer who buys strings is owed for them,
		     and one who donates strings is not. -->
		<MemberPicker
			field={fields.paidByUserId}
			bind:value={paidByUserId}
			bind:name={paidByName}
			label={m.actions_receive_stock_paid_by_leave_blank_if_label()}
		/>
		<LocationField field={fields.locationId} />
		<Field field={fields.notes} type="textarea" label={m.actions_notes_label()} />
	{/snippet}
</Action>
