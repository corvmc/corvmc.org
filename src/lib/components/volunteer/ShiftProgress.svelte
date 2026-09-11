<script lang="ts">
	/**
	 * Claimed → Booked, and what the current step means.
	 *
	 * Shared by the card on `/member/volunteer` and the shift's own page, which
	 * had neither the rail nor the sentence — it loaded `status` and rendered it
	 * nowhere (#1066). Two steps rather than a percentage: the gap between them
	 * is a person deciding, and only one of the two earns you a reminder.
	 */
	let { status, notes = null }: { status: string; notes?: string | null } = $props();

	const booked = $derived(status !== 'claimed');
	const worked = $derived(status === 'completed');
</script>

<!-- Withdrawn once the shift is worked: by then the rail has answered its
     question, and leaving it up makes a finished thing look in progress. -->
{#if !worked}
	<div class="flex items-center gap-2 text-xs">
		<span class="font-bold text-success">Claimed</span>
		<span class="text-subtle">→</span>
		<span class={booked ? 'font-bold text-success' : 'text-subtle'}>Booked</span>
	</div>
{/if}

<p class="mt-1 text-subtle text-sm">
	{#if !booked}
		Awaiting staff confirmation.
	{:else if worked}
		Worked. Log your hours when you get a moment.
	{:else}
		{notes ? `${notes} ` : ''}Reminder lands the day before.
	{/if}
</p>
