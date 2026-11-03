<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import { calculateTotalWithFeeCoverage } from '$lib/finance/fees';
	import { creditsToHours } from '$lib/config';
	import { formatDateLong, formatDollars, formatTime } from '$lib/utils/format';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import Field from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { payReservation, getReservationPayment } from '$lib/remote/reservations.remote';
	import { page } from '$app/state';

	let data = $derived(await getReservationPayment(page.params.id!));

	const res = $derived(data.reservation);
	const totalCents = $derived(data.totalCents);
	const freeHoursBalance = $derived(data.freeHoursBalance);
	const durationHours = $derived(data.durationHours);

	let coverFees = $state(false);

	// A non-null cashDueCents means credits are already committed (confirmed
	// bookings): show the stored remainder. Otherwise preview against the live
	// balance — freeHoursBalance is in credits (30-min blocks).
	const committed = $derived(data.cashDueCents != null);
	const availableHours = $derived(creditsToHours(freeHoursBalance));
	const creditsApplicable = $derived(
		committed ? (data.creditsUsedHours ?? 0) : Math.min(availableHours, durationHours)
	);
	const creditDiscountCents = $derived(
		committed
			? totalCents - (data.cashDueCents ?? 0)
			: durationHours > 0
				? creditsApplicable * (totalCents / durationHours)
				: 0
	);
	const remainingCents = $derived(
		committed ? (data.cashDueCents ?? 0) : totalCents - creditDiscountCents
	);

	const feeCents = $derived(coverFees ? calculateTotalWithFeeCoverage(remainingCents).feeCents : 0);
	const chargeTotal = $derived(remainingCents + feeCents);
</script>

<PageHeader width="md" title={m.member_reservations_id_pay_title()} />
<PageContent width="md">
	<Card>
		<CardBody>
			<p class="font-medium">{formatDateLong(res.startsAt)}</p>
			<p>
				{m.member_reservations_id_pay_hours({
					formatTime: formatTime(res.startsAt),
					formatTime2: formatTime(res.endsAt),
					durationHours
				})}
			</p>
			{#if res.notes}
				<p class="text-muted">{res.notes}</p>
			{/if}
		</CardBody>
	</Card>

	<Card>
		<CardBody class="space-y-2">
			<div class="flex justify-between">
				<span
					>{m.member_reservations_id_pay_room_rental_hr_hr({
						durationHours,
						formatDollars: formatDollars(totalCents / durationHours)
					})}</span
				>
				<span>${formatDollars(totalCents)}</span>
			</div>

			{#if creditsApplicable > 0}
				<div class="flex justify-between text-success">
					<span>
						{#if committed}
							{m.member_reservations_id_pay_free_hours_applied_hr({ creditsApplicable })}
						{:else}
							{m.member_reservations_id_pay_free_hours_available({
								creditsApplicable,
								availableHours
							})}
						{/if}
					</span>
					<span>−${formatDollars(creditDiscountCents)}</span>
				</div>
			{/if}

			{#if remainingCents > 0 && coverFees}
				<div class="flex justify-between text-muted">
					<span>{m.member_reservations_id_pay_processing_fee_coverage()}</span>
					<span>+${formatDollars(feeCents)}</span>
				</div>
			{/if}

			<div class="divider my-1"></div>

			<div class="flex justify-between font-bold">
				<span>{m.member_reservations_id_pay_total()}</span>
				<span>
					{#if remainingCents <= 0}
						{m.member_reservations_id_pay_0_00_covered_by_free()}
					{:else}
						${formatDollars(chargeTotal)}
					{/if}
				</span>
			</div>
		</CardBody>
	</Card>

	<Form remote={payReservation}>
		{#if remainingCents > 0}
			<Field
				name="coverFees"
				type="checkbox"
				label=""
				bind:value={coverFees}
				checkboxLabel={m.member_reservations_id_pay_checkbox_label()}
			/>
		{/if}

		<!-- SubmitButton renders its `label` prop, not children. -->
		<SubmitButton
			variant="primary"
			class="mt-4 w-full"
			label={remainingCents <= 0
				? m.member_reservations_id_pay_pay_with_free_hours()
				: m.member_reservations_id_pay_pay({ formatDollars: formatDollars(chargeTotal) })}
		/>
	</Form>

	<Button href={data.backPath} variant="ghost" class="w-full">{m.member_back_reservations()}</Button
	>
</PageContent>
