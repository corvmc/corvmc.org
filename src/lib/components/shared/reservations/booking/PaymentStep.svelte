<script lang="ts">
	import { calculateTotalWithFeeCoverage } from '$lib/finance/fees';
	import { resolve } from '$app/paths';
	import { getReservationPricing } from '$lib/remote/reservations.remote';
	import { getFormContext } from '$lib/components/shared/Form/Form.svelte';
	import * as Form from '$lib/components/shared/Form';
	import { formatDollars, toLocalDate, toLocalTime } from '$lib/utils/format';
	import { creditsToHours } from '$lib/config';
	import type { RemoteFormField } from '@sveltejs/kit';

	let {
		reservation,
		fields,
		precedingSteps = reservation ? 1 : 2
	}: {
		reservation?: { id: string; startsAt: Date; endsAt: Date };
		fields: { id?: RemoteFormField<string>; coverFees: RemoteFormField<boolean> };
		precedingSteps?: number;
	} = $props();

	const formCtx = getFormContext()!;

	const activeStep = $derived(precedingSteps);

	let el: HTMLDivElement;
	let coverFees = $state(false);

	let pricing = $state<{
		durationHours: number;
		hourlyRateCents: number;
		totalCents: number;
		freeHoursBalance: number;
		creditsApplicable: number;
		creditDiscountCents: number;
		remainingCents: number;
		isSustainingMember: boolean;
	} | null>(null);

	function extractTimeFields(d: Date) {
		return { date: toLocalDate(d), time: toLocalTime(d) };
	}

	$effect(() => {
		if (formCtx.currentStep === activeStep && el) {
			let date: string | null = null;
			let startTime: string | null = null;
			let endTime: string | null = null;

			if (reservation) {
				const start = extractTimeFields(reservation.startsAt);
				const end = extractTimeFields(reservation.endsAt);
				date = start.date;
				startTime = start.time;
				endTime = end.time;
			} else {
				const form = el.closest('form');
				if (form) {
					const fd = new FormData(form);
					date = fd.get('date') as string;
					startTime = fd.get('startTime') as string;
					endTime = fd.get('endTime') as string;
				}
			}

			if (date && startTime && endTime) {
				pricing = null;
				getReservationPricing({ date, startTime, endTime, reservationId: reservation?.id }).then(
					(result) => {
						pricing = result;
					}
				);
			}
		}
	});

	let feeCents = $derived(
		pricing && coverFees ? calculateTotalWithFeeCoverage(pricing.remainingCents).feeCents : 0
	);
	let chargeTotal = $derived(pricing ? pricing.remainingCents + feeCents : 0);
	let payLabel = $derived(
		pricing
			? pricing.remainingCents <= 0
				? 'Confirm (Free Hours)'
				: `Pay $${formatDollars(chargeTotal)}`
			: 'Loading...'
	);
</script>

<div bind:this={el}>
	<Form.Step>
		{#if reservation && fields.id}
			<input {...fields.id.as('hidden', reservation.id)} />
		{/if}

		{#if !pricing}
			<div class="space-y-2 py-2">
				<div class="flex justify-between">
					<div class="skeleton h-5 w-48"></div>
					<div class="skeleton h-5 w-16"></div>
				</div>
				<div class="divider my-1"></div>
				<div class="flex justify-between">
					<div class="skeleton h-6 w-16"></div>
					<div class="skeleton h-6 w-20"></div>
				</div>
			</div>
		{:else}
			<div class="space-y-2">
				<div class="flex justify-between">
					<span
						>Room rental ({pricing.durationHours}hr × ${formatDollars(
							pricing.hourlyRateCents
						)}/hr)</span
					>
					<span>${formatDollars(pricing.totalCents)}</span>
				</div>

				{#if pricing.creditsApplicable > 0}
					<div class="flex justify-between text-success">
						<span
							>Free hours ({creditsToHours(pricing.creditsApplicable)} of {creditsToHours(
								pricing.freeHoursBalance
							)} available)</span
						>
						<span>-${formatDollars(pricing.creditDiscountCents)}</span>
					</div>
				{/if}

				{#if pricing.remainingCents > 0 && coverFees}
					<div class="flex justify-between text-muted">
						<span>Processing fee coverage</span>
						<span>+${formatDollars(feeCents)}</span>
					</div>
				{/if}

				<div class="divider my-1"></div>

				<div class="flex justify-between font-bold">
					<span>Total</span>
					<span>
						{#if pricing.remainingCents <= 0}
							$0.00 (covered by free hours)
						{:else}
							${formatDollars(chargeTotal)}
						{/if}
					</span>
				</div>
			</div>

			{#if pricing.remainingCents > 0}
				<Form.Field
					field={fields.coverFees}
					label=""
					type="checkbox"
					bind:value={coverFees}
					checkboxLabel="Cover ${formatDollars(
						calculateTotalWithFeeCoverage(pricing.remainingCents).feeCents
					)} processing fee so the Collective receives 100%"
				/>
			{/if}

			{#if !pricing.isSustainingMember}
				<div class="mt-2 rounded-box border border-base-300 bg-base-200 px-4 py-3 text-sm">
					Sustaining members get free rehearsal hours every month.
					<a href={resolve('/member/membership')} target="_blank" class="link link-primary"
						>Learn more</a
					>
				</div>
			{/if}
		{/if}

		<div class="flex justify-end pt-2">
			<Form.SubmitButton label={payLabel} class="btn-primary" />
		</div>
	</Form.Step>
</div>
