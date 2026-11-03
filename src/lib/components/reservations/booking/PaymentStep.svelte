<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { calculateTotalWithFeeCoverage } from '$lib/finance/fees';
	import { resolve } from '$app/paths';
	import { getReservationPricing } from '$lib/remote/reservations.remote';
	import { getFormContext } from '$lib/components/ui/Form/Form.svelte';
	import * as Form from '$lib/components/ui/Form';
	import { formatDollars, toLocalDate, toLocalTime } from '$lib/utils/format';
	import { creditsToHours } from '$lib/config';
	import type { RemoteFormField } from '@sveltejs/kit';

	let {
		reservation,
		fields,
		precedingSteps = reservation ? 1 : 2,
		submit
	}: {
		reservation?: { id: string; startsAt: Date; endsAt: Date };
		fields: { id?: RemoteFormField<string>; coverFees: RemoteFormField<boolean> };
		precedingSteps?: number;
		/** Set on the submitter only, for a remote that pays just when asked to. */
		submit?: Record<string, unknown>;
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
				? m.reservations_booking_payment_step_pay_with_free_hours()
				: m.reservations_booking_payment_step_pay({ formatDollars: formatDollars(chargeTotal) })
			: m.reservations_booking_payment_step_loading()
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
					<div class="h-5 w-48 skeleton"></div>
					<div class="h-5 w-16 skeleton"></div>
				</div>
				<div class="divider my-1"></div>
				<div class="flex justify-between">
					<div class="h-6 w-16 skeleton"></div>
					<div class="h-6 w-20 skeleton"></div>
				</div>
			</div>
		{:else}
			<div class="space-y-2">
				<div class="flex justify-between">
					<span
						>{m.reservations_booking_payment_step_room_rental_hr_hr({
							durationHours: pricing.durationHours,
							formatDollars: formatDollars(pricing.hourlyRateCents)
						})}</span
					>
					<span>${formatDollars(pricing.totalCents)}</span>
				</div>

				{#if pricing.creditsApplicable > 0}
					<div class="flex justify-between text-success">
						<span
							>{m.reservations_booking_payment_step_free_hours_available({
								creditsToHours: creditsToHours(pricing.creditsApplicable),
								creditsToHours2: creditsToHours(pricing.freeHoursBalance)
							})}</span
						>
						<span>-${formatDollars(pricing.creditDiscountCents)}</span>
					</div>
				{/if}

				{#if pricing.remainingCents > 0 && coverFees}
					<div class="flex justify-between text-muted">
						<span>{m.reservations_booking_payment_step_processing_fee_coverage()}</span>
						<span>+${formatDollars(feeCents)}</span>
					</div>
				{/if}

				<div class="divider my-1"></div>

				<div class="flex justify-between font-bold">
					<span>{m.reservations_booking_payment_step_total()}</span>
					<span>
						{#if pricing.remainingCents <= 0}{m.reservations_booking_payment_step_0_00_covered_by_free()}{:else}
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
					checkboxLabel={m.reservations_booking_payment_step_checkbox_label({
						formatDollars: formatDollars(
							calculateTotalWithFeeCoverage(pricing.remainingCents).feeCents
						)
					})}
				/>
			{/if}

			{#if !pricing.isSustainingMember}
				<div class="mt-2 rounded-box border border-base-300 bg-base-200 px-4 py-3 text-sm">
					<ParaglideMessage
						message={m.reservations_booking_payment_step_sustaining_members_get_fre}
						inputs={{}}
						>{#snippet a({ children })}<a
								href={resolve('/member/membership')}
								target="_blank"
								class="link link-primary">{@render children?.()}</a
							>{/snippet}</ParaglideMessage
					>
				</div>
			{/if}
		{/if}

		<div class="flex justify-end pt-2">
			<Form.SubmitButton label={payLabel} class="btn-primary" {...submit} />
		</div>
	</Form.Step>
</div>
