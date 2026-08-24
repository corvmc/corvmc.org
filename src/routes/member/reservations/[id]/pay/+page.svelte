<script lang="ts">
	import Card from '$lib/components/shared/Card/Card.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import { calculateTotalWithFeeCoverage } from '$lib/finance/fees';
	import { creditsToHours } from '$lib/config';
	import { formatDateLong, formatDollars, formatTime } from '$lib/utils/format';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import Field from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import Button from '$lib/components/shared/Button.svelte';
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

<PageHeader title="Pay for Your Session" />
<PageContent width="md">
	<Card>
		<CardBody>
			<p class="font-medium">{formatDateLong(res.startsAt)}</p>
			<p>
				{formatTime(res.startsAt)}–{formatTime(res.endsAt)} ({durationHours} hour{durationHours ===
				1
					? ''
					: 's'})
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
					>Room rental ({durationHours}hr × ${formatDollars(totalCents / durationHours)}/hr)</span
				>
				<span>${formatDollars(totalCents)}</span>
			</div>

			{#if creditsApplicable > 0}
				<div class="flex justify-between text-success">
					<span>
						{#if committed}
							Free hours applied ({creditsApplicable} hr)
						{:else}
							Free hours ({creditsApplicable} of {availableHours} available)
						{/if}
					</span>
					<span>−${formatDollars(creditDiscountCents)}</span>
				</div>
			{/if}

			{#if remainingCents > 0 && coverFees}
				<div class="flex justify-between text-muted">
					<span>Processing fee coverage</span>
					<span>+${formatDollars(feeCents)}</span>
				</div>
			{/if}

			<div class="divider my-1"></div>

			<div class="flex justify-between font-bold">
				<span>Total</span>
				<span>
					{#if remainingCents <= 0}
						$0.00 (covered by free hours)
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
				checkboxLabel="Cover processing fees so the Collective receives 100%"
			/>
		{/if}

		<!-- SubmitButton renders its `label` prop, not children. -->
		<SubmitButton
			variant="primary"
			class="w-full mt-4"
			label={remainingCents <= 0 ? 'Confirm (Free Hours)' : `Pay $${formatDollars(chargeTotal)}`}
		/>
	</Form>

	<Button href="/member/reservations" variant="ghost" class="w-full">Back to Reservations</Button>
</PageContent>
