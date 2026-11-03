<script lang="ts" generics="TInput extends RemoteFormInput, TOutput">
	import { m } from '#lib/paraglide/messages.js';
	import { calculateTotalWithFeeCoverage } from '#lib/finance/fees.js';
	import { formatDollars } from '#lib/utils/format.js';
	import { untrack } from 'svelte';
	import { DOLLARS_PER_UNIT } from '#lib/config.js';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import Field from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import type { RemoteForm } from '#lib/components/ui/Form/Form.svelte';
	import type { RemoteFormInput } from '@sveltejs/kit';

	const STEP = DOLLARS_PER_UNIT;
	const MIN_AMOUNT = DOLLARS_PER_UNIT * 2; // $10 → 2 free hours
	const MAX_AMOUNT = DOLLARS_PER_UNIT * 12; // $60 → 12 free hours

	let {
		mode,
		currentAmount,
		currentCoverFees = false,
		remote,
		onsuccess
	}: {
		mode: 'create' | 'modify';
		currentAmount?: number;
		currentCoverFees?: boolean;
		remote: RemoteForm<TInput, TOutput>;
		onsuccess?: () => void;
	} = $props();

	let amount = $state(untrack(() => currentAmount ?? MIN_AMOUNT));
	let coverFees = $state(untrack(() => currentCoverFees));

	const freeHours = $derived(Math.floor(amount / DOLLARS_PER_UNIT));
	const feeCents = $derived(coverFees ? calculateTotalWithFeeCoverage(amount * 100).feeCents : 0);
	const feeDisplay = $derived(formatDollars(feeCents));
	const totalDisplay = $derived(formatDollars(amount * 100 + feeCents));

	// Tick labels under the slider: $10, $20 … $60.
	const ticks = Array.from(
		{ length: (MAX_AMOUNT - MIN_AMOUNT) / STEP + 1 },
		(_, i) => MIN_AMOUNT + i * STEP
	);
	const labelledTicks = ticks.filter((v) => v % 10 === 0);
</script>

<Form {remote} {onsuccess} class="space-y-6">
	<div>
		<div class="flex items-baseline justify-between">
			<span class="fieldset-legend font-medium"
				>{m.member_membership_subscription_form_monthly_contribution()}</span
			>
			<span class="text-3xl font-bold text-primary">${amount}</span>
		</div>

		<input
			id="amount"
			{...remote.fields.amount.as('text')}
			type="range"
			min={MIN_AMOUNT}
			max={MAX_AMOUNT}
			step={STEP}
			bind:value={amount}
			class="range mt-3 w-full range-primary"
			aria-label={m.member_membership_subscription_form_aria_label()}
		/>
		<div class="mt-1 flex w-full justify-between px-1 text-xs opacity-50">
			{#each ticks as tick (tick)}
				<span class="flex flex-col items-center">
					<span aria-hidden="true">|</span>
					{#if labelledTicks.includes(tick)}
						<span class="mt-0.5">${tick}</span>
					{/if}
				</span>
			{/each}
		</div>

		<p class="mt-4 text-sm font-medium text-primary">
			{m.member_membership_subscription_form_free_practice_hours_ever({ freeHours })}
		</p>
	</div>

	<div>
		<Field
			field={remote.fields.coverFees}
			type="toggle"
			label=""
			bind:value={coverFees}
			checkboxLabel={m.member_membership_subscription_form_checkbox_label()}
		/>
		{#if coverFees}
			<p class="ml-12 text-muted">
				{m.member_membership_subscription_form_adds_cover_processing_fe({ feeDisplay })}
			</p>
		{/if}
	</div>

	<div class="rounded-lg bg-base-200/50 p-4">
		<p class="text-muted">{m.member_membership_subscription_form_new_monthly_total()}</p>
		<p class="mt-1 font-semibold text-primary">
			{m.member_membership_subscription_form_00_membership({
				amount
			})}{#if coverFees}{m.member_membership_subscription_form_processing_fees({ feeDisplay })}{/if}
			{m.member_membership_subscription_form_total_per_month({ totalDisplay })}
		</p>
	</div>

	<SubmitButton
		variant="primary"
		class="w-full"
		label={mode === 'create'
			? m.member_membership_subscription_form_become_sustaining_member()
			: m.member_update_contribution()}
	/>
</Form>
