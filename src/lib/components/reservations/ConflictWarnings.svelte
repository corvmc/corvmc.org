<script lang="ts">
	import { formatSlotTime, toLocalTime } from '$lib/utils/format';

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
	 * `checkConflicts` already returns the distinction: `conflicts` is typed
	 * (`type: 'reservation' | 'closure'`, with `label` naming whose booking it
	 * is) and `validationWarnings` is free text about hours, advance days and
	 * slot boundaries. This component used to flatten both into one `string[]`
	 * and collapse that into one boolean, which is why "the space is taken" and
	 * "that is later than we usually open" wore the same yellow and offered the
	 * same override.
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

	const conflictData = $derived(
		date && startTime && endTime
			? await checkConflicts({ date, startTime, endTime, excludeReservationId })
			: null
	);

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

	{#snippet pending()}
		<div class="flex items-center gap-2 py-1">
			<span class="loading loading-xs loading-spinner"></span>
			<span class="text-subtle">Checking conflicts...</span>
		</div>
	{/snippet}
</svelte:boundary>
