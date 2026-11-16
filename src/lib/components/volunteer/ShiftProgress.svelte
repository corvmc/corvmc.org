<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Claimed → Booked, and what the current step means.
	 *
	 * Shared by the card on `/member/volunteer` and the shift's own page, which
	 * had neither the rail nor the sentence — it loaded `status` and rendered it
	 * nowhere (#1066). Two steps rather than a percentage: the gap between them
	 * is a person deciding, and only one of the two earns you a reminder.
	 */
	import { formatTime } from '#lib/utils/format.js';

	let {
		status,
		notes = null,
		startsAt = null,
		endsAt = null
	}: {
		status: string;
		notes?: string | null;
		startsAt?: Date | null;
		endsAt?: Date | null;
	} = $props();

	const booked = $derived(status !== 'claimed');
	const worked = $derived(status === 'completed');
	// Read once at render: a running shift says when it ends, not that a reminder is coming.
	const now = new Date();
	const onNow = $derived(!!startsAt && !!endsAt && startsAt <= now && now < endsAt);
</script>

<!-- Withdrawn once the shift is worked: by then the rail has answered its
     question, and leaving it up makes a finished thing look in progress.
     Also withdrawn while unconfirmed, where the sentence below says the same
     thing in words — two rows for one bit of state in a 480px column (#1044). -->
{#if booked && !worked}
	<div class="flex items-center gap-2 text-xs">
		<span class="font-bold text-success">{m.volunteer_shift_progress_claimed_text()}</span>
		<span class="text-subtle">→</span>
		<span class="font-bold text-success">{m.volunteer_booked_text()}</span>
	</div>
{/if}

<p class="mt-1 text-subtle text-sm">
	{#if !booked}{m.volunteer_shift_progress_awaiting_staff_confirmation_text()}{:else if worked}{m.volunteer_shift_progress_worked_log_hours_when_get_text()}{:else if onNow && endsAt}{m.volunteer_shift_progress_on_until_text(
			{ time: formatTime(endsAt) }
		)}{:else}{m.volunteer_shift_progress_reminder_lands_day_before_text()}{/if}
</p>

<!-- Its own line. Spliced in front of the fixed copy, an unbounded staff note
     and the boilerplate ran together into one paragraph, and the note then set
     the card's height. -->
{#if notes && booked && !worked}
	<p class="mt-1 text-sm">{notes}</p>
{/if}
