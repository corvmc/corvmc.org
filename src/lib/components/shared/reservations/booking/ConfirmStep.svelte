<script lang="ts">
	import {
		getReservationPricing,
		previewRecurringInstances
	} from '$lib/remote/reservations.remote';
	import { getFormContext } from '$lib/components/shared/Form/Form.svelte';
	import * as Form from '$lib/components/shared/Form';
	import Button from '$lib/components/shared/Button.svelte';
	import {
		formatDate,
		formatDollars,
		formatScheduleLabel,
		formatTimeRange,
		fullDate,
		toLocalDate,
		toLocalTime
	} from '$lib/utils/format';
	import { creditsToHours } from '$lib/config';
	import type { RemoteFormField } from '@sveltejs/kit';

	let {
		reservation,
		fields = {},
		staff = false,
		band = false
	}: {
		reservation?: { id: string; startsAt: Date; endsAt: Date };
		fields?: { id?: RemoteFormField<string> };
		// Staff confirming on the owner's behalf: render a single Confirm action
		// (no Pay Ahead / online checkout) and key pricing to the reservation owner.
		staff?: boolean;
		/**
		 * A band booking its practice space. One Book action and no Pay Ahead —
		 * `bookBandReservation` takes no payment, so a payment step would charge
		 * nobody and show a receipt for it.
		 */
		band?: boolean;
	} = $props();

	const formCtx = getFormContext()!;

	const activeStep = $derived(reservation ? 0 : 1);

	let el: HTMLDivElement;

	function extractTimeFields(d: Date) {
		return { date: toLocalDate(d), time: toLocalTime(d) };
	}

	let pricing = $state<{
		durationHours: number;
		hourlyRateCents: number;
		totalCents: number;
		creditsApplicable: number;
		remainingCents: number;
	} | null>(null);

	let dateLabel = $state('');
	let timeLabel = $state('');
	let recurringFrequency = $state('');
	let recurringPreview = $state<{ dates: string[]; totalInWindow: number } | null>(null);
	let scheduleLabel = $state('');

	const isRecurring = $derived(recurringFrequency !== '');

	// Only offer "Pay Ahead" when a balance is actually owed; otherwise "Confirm"
	// (which skips payment) is the single action — no redundant payment screen.
	const showPayAhead = $derived(!!pricing && pricing.remainingCents > 0);

	function formatPreviewDate(iso: string): string {
		return formatDate(new Date(iso));
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
				dateLabel = fullDate(reservation.startsAt);
				timeLabel = formatTimeRange(reservation.startsAt, reservation.endsAt);
				recurringFrequency = '';
			} else {
				const form = el.closest('form');
				if (form) {
					const fd = new FormData(form);
					date = fd.get('date') as string;
					startTime = fd.get('startTime') as string;
					endTime = fd.get('endTime') as string;
					recurringFrequency = (fd.get('recurring') as string) || '';
					const monthlyMode = (fd.get('monthlyMode') as 'weekday' | 'monthday') || 'weekday';
					if (date && startTime) {
						const startIso = new Date(`${date}T${startTime}:00`);
						const endIso = endTime ? new Date(`${date}T${endTime}:00`) : startIso;
						dateLabel = fullDate(startIso);
						timeLabel = formatTimeRange(startIso, endIso);
					}

					if (recurringFrequency && date && startTime) {
						const freqLabel =
							recurringFrequency === 'weekly'
								? 'Weekly'
								: recurringFrequency === 'biweekly'
									? 'Every 2 weeks'
									: 'Monthly';
						scheduleLabel = formatScheduleLabel(
							freqLabel,
							new Date(`${date}T${startTime}:00`),
							monthlyMode
						);
						recurringPreview = null;
						previewRecurringInstances({
							date,
							startTime,
							frequency: recurringFrequency as 'weekly' | 'biweekly' | 'monthly',
							monthlyMode
						}).then((result) => {
							recurringPreview = result;
						});
					}
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
</script>

<div bind:this={el}>
	<Form.Step>
		{#if reservation && fields.id}
			<input {...fields.id.as('hidden', reservation.id)} />
		{/if}

		<div class="rounded-lg border border-base-300 bg-base-200/50 px-4 py-3">
			{#if dateLabel}
				<p class="font-medium">{dateLabel}</p>
				<p class="text-muted">{timeLabel}</p>
			{:else}
				<div class="skeleton h-5 w-48"></div>
			{/if}
		</div>

		{#if !pricing}
			<div class="flex justify-between py-2">
				<div class="skeleton h-5 w-32"></div>
				<div class="skeleton h-5 w-16"></div>
			</div>
		{:else}
			<div class="py-2 text-sm">
				<div class="flex justify-between">
					<span>{pricing.durationHours} hr × ${formatDollars(pricing.hourlyRateCents)}/hr</span>
					{#if pricing.creditsApplicable > 0}
						<span>
							<span class="line-through opacity-60">${formatDollars(pricing.totalCents)}</span>
							<span class="ml-1 font-medium text-success"
								>${formatDollars(pricing.remainingCents)}</span
							>
						</span>
					{:else}
						<span>${formatDollars(pricing.totalCents)}</span>
					{/if}
				</div>
				{#if pricing.creditsApplicable > 0}
					{@const freeHours = creditsToHours(pricing.creditsApplicable)}
					<div class="mt-1 flex justify-between text-success">
						<span>Free hours applied</span>
						<span>−{freeHours} {freeHours === 1 ? 'hr' : 'hrs'}</span>
					</div>
				{/if}
			</div>
		{/if}

		{#if isRecurring}
			<div class="rounded-lg border border-base-300 bg-base-200/50 px-4 py-3 mt-2">
				{#if scheduleLabel}
					<p class="text-sm font-medium">{scheduleLabel}</p>
				{/if}
				<div class="mt-2">
					<p class="mb-1 text-subtle font-medium">Upcoming instances</p>
					{#if !recurringPreview}
						<div class="space-y-1">
							{#each Array(3), i (i)}
								<div class="skeleton h-4 w-36 rounded"></div>
							{/each}
						</div>
					{:else if recurringPreview.dates.length === 0}
						<p class="text-subtle">No upcoming instances in the next 60 days.</p>
					{:else}
						<ul class="space-y-0.5 text-xs">
							{#each recurringPreview.dates as iso (iso)}
								<li class="opacity-70">{formatPreviewDate(iso)}</li>
							{/each}
						</ul>
						{#if recurringPreview.totalInWindow > recurringPreview.dates.length}
							<p class="mt-1 text-xs opacity-50">
								and {recurringPreview.totalInWindow - recurringPreview.dates.length} more...
							</p>
						{/if}
					{/if}
				</div>
				<p class="mt-2 text-xs opacity-50">
					Future instances are generated automatically. You'll confirm each one individually.
				</p>
			</div>
		{/if}

		{#if band}
			<!-- Worth saying out loud: two bandmates opening this dialog for the
			     same slot can see different prices, because credits are keyed to
			     `createdByUserId` and a band has no balance of its own. Unexplained
			     that reads as a bug. -->
			<p class="text-subtle">
				Bands don't have their own free hours.
				{#if pricing && pricing.creditsApplicable > 0}
					{@const freeHours = creditsToHours(pricing.creditsApplicable)}
					Your personal free hours apply to this booking — {freeHours}
					{freeHours === 1 ? 'hr' : 'hrs'} of yours will cover it, and the rest is due at the door.
				{:else}
					This is booked in your name, so your personal free hours would apply — you have none left
					this month, so the full amount is due at the door.
				{/if}
			</p>
		{:else if staff}
			<p class="text-subtle">
				Comp makes this reservation fully free without using the member's free hours.
				{#if pricing && pricing.creditsApplicable > 0}
					Apply Credits commits their free hours; any remainder is due at the door.
				{:else}
					Confirm leaves the full amount due at the door.
				{/if}
			</p>
		{/if}

		<div class="flex justify-end gap-2 pt-2">
			{#if formCtx.currentStep > 0}
				<Button type="button" variant="ghost" onclick={() => formCtx.back()}>Back</Button>
			{/if}
			{#if band}
				<Button type="submit" variant="primary">Book Session</Button>
			{:else if staff}
				<!-- Staff choice: comp (fully free, no credits used) or apply the member's
				     credits (submitter name/value sets comp only when that button submits). -->
				<Button type="submit" name="comp" value="on" variant="info" outline>Comp</Button>
				<Button type="submit" variant="primary">
					{pricing && pricing.creditsApplicable > 0 ? 'Apply Credits' : 'Confirm'}
				</Button>
			{:else}
				<!-- Native submit: the button's name/value sets skipPayment only when it's the submitter. -->
				<Button
					type="submit"
					name="skipPayment"
					value="on"
					variant={showPayAhead ? 'ghost' : 'primary'}>Confirm</Button
				>
				{#if showPayAhead}
					<Button type="button" onclick={() => formCtx.next()}>Pay Ahead</Button>
				{/if}
			{/if}
		</div>
	</Form.Step>
</div>
