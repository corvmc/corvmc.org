<script lang="ts">
	import { formatSlotTime, toLocalTime } from '$lib/utils/format';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { errorMessage } from '$lib/error-message';

	type Conflict = {
		type: 'reservation' | 'closure';
		id?: string;
		startsAt: Date | string;
		endsAt: Date | string;
		label: string;
	};

	type ConflictResult = {
		conflicts: Conflict[];
		validationWarnings: string[];
	};

	/**
	 * Two lists, two flags — a double-booking is not a late night.
	 *
	 * `conflicts` (an existing booking or a closure) blocks; `validationWarnings`
	 * (hours, advance days, slot boundaries) only advises. Keep them apart: one
	 * merged list gave both the same yellow and the same override.
	 */
	let {
		date,
		startTime,
		endTime,
		checkConflicts,
		excludeReservationId,
		hasBlockingConflict = $bindable(),
		hasAdvisories = $bindable()
	}: {
		date: string;
		startTime: string;
		endTime: string;
		checkConflicts: (params: {
			date: string;
			startTime: string;
			endTime: string;
			excludeReservationId?: string;
		}) => Promise<ConflictResult>;
		excludeReservationId?: string;
		/** The space is already spoken for — an existing booking or a closure. */
		hasBlockingConflict?: boolean;
		/** Bookable, but outside the usual shape: hours, advance days, boundaries. */
		hasAdvisories?: boolean;
	} = $props();

	/**
	 * The rejection is caught here, not by the boundary below: a script `await`
	 * reports to the boundary *around* this component, so its failed snippet
	 * cannot see it and a down check would take the caller's form with it.
	 * Do not move the await under a pending boundary of its own either: that
	 * stalls CreateEventModal's re-timing effect (staff-event-reserve-space e2e).
	 */
	const checked = $derived(
		date && startTime && endTime
			? await checkConflicts({ date, startTime, endTime, excludeReservationId }).then(
					(result) => ({ result, error: null }),
					(error: unknown) => ({ result: null, error: error ?? new Error('Unknown error') })
				)
			: { result: null, error: null }
	);
	const conflictData = $derived(checked.result);

	const blockers = $derived.by(() => {
		if (!conflictData) return [];
		return conflictData.conflicts.map((c) => {
			const start = typeof c.startsAt === 'string' ? new Date(c.startsAt) : c.startsAt;
			const end = typeof c.endsAt === 'string' ? new Date(c.endsAt) : c.endsAt;
			const range = `${formatSlotTime(toLocalTime(start))} – ${formatSlotTime(toLocalTime(end))}`;
			return c.type === 'reservation'
				? `Double-books the space: ${c.label} has it ${range}`
				: `The space is closed: ${c.label}`;
		});
	});

	const advisories = $derived(conflictData?.validationWarnings ?? []);

	$effect(() => {
		const next = blockers.length > 0;
		if (hasBlockingConflict !== next) hasBlockingConflict = next;
	});

	$effect(() => {
		const next = advisories.length > 0;
		if (hasAdvisories !== next) hasAdvisories = next;
	});
</script>

<svelte:boundary>
	{#if checked.error}
		<!-- No `data-conflicts` here: the check never settled, so nothing may read it as clear. -->
		<Alert type="warning">
			Could not check this time for conflicts: {errorMessage(checked.error)}
		</Alert>
	{:else}
		<!-- `data-conflicts` marks the settled state — the answer is in, whether or
		     not it has anything to say. The wrapper renders unconditionally for that
		     reason; the alerts inside it do not. -->
		<div data-conflicts>
			<div class="space-y-2">
				{#each blockers as blocker, i (i)}
					<div class="alert py-2 text-sm alert-error">
						{blocker}
					</div>
				{/each}
				{#each advisories as advisory, i (i)}
					<div class="alert py-2 text-sm alert-warning">
						{advisory}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#snippet pending()}
		<div class="flex items-center gap-2 py-1">
			<span class="loading loading-xs loading-spinner"></span>
			<span class="text-subtle">Checking conflicts...</span>
		</div>
	{/snippet}

	<!-- No `data-conflicts` here: the check never settled, so nothing may read it as clear. -->
	{#snippet failed(error, reset)}
		<Alert type="warning" {reset}>
			Could not check this time for conflicts: {errorMessage(error)}
		</Alert>
	{/snippet}
</svelte:boundary>
