<script lang="ts">
	/**
	 * One shift the member is on, with the two-step rail that is the whole point.
	 *
	 * `claimed` and `confirmed` are different states and always have been, but
	 * the member's half never said so: a claim nobody confirms gets no reminder
	 * and never auto-completes, and the person who made it had no way to tell
	 * that from a booking. Claimed → Booked, with only the reached step lit,
	 * says it without needing a sentence.
	 */
	import Action from '$lib/components/ui/Action.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';
	import { DEFAULT_TIMEZONE } from '$lib/config';
	import { cancelMySignup } from '$lib/remote/volunteer.remote';

	let {
		shift
	}: {
		shift: {
			signupId: string;
			roleName: string;
			startsAt: Date;
			endsAt: Date;
			status: string;
			notes: string | null;
			eventTitle: string | null;
			shiftCancelledAt: Date | null;
		};
	} = $props();

	const booked = $derived(shift.status !== 'claimed');
	const worked = $derived(shift.status === 'completed');
	const calledOff = $derived(!!shift.shiftCancelledAt);

	const timeRange = $derived.by(() => {
		const fmt = new Intl.DateTimeFormat('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			timeZone: DEFAULT_TIMEZONE
		});
		return `${fmt.format(shift.startsAt)}–${fmt.format(shift.endsAt)}`;
	});

	const dayParts = $derived.by(() => {
		const tz = DEFAULT_TIMEZONE;
		return {
			month: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: tz }).format(
				shift.startsAt
			),
			day: new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: tz }).format(shift.startsAt)
		};
	});
</script>

<div class="flex gap-3 rounded-lg border border-base-300 p-3">
	<div class="text-center leading-tight">
		<div class="text-subtle text-xs uppercase">{dayParts.month}</div>
		<div class="text-xl font-bold">{dayParts.day}</div>
	</div>

	<div class="min-w-0 flex-1">
		<div class="font-medium">{shift.roleName}</div>
		<div class="text-subtle text-xs">
			{timeRange}{#if shift.eventTitle}
				· {shift.eventTitle}{/if}
		</div>

		{#if calledOff}
			<p class="mt-2 text-sm text-error">This was called off. There's nothing to turn up for.</p>
		{:else}
			<!--
				Two steps, not a percentage: the gap between them is a person deciding,
				and only one of the two earns you a reminder. Withdrawn once the shift
				is worked — by then the rail has answered its question, and leaving it
				up makes a finished thing look like it is still in progress.
			-->
			{#if !worked}
				<div class="mt-2 flex items-center gap-2 text-xs">
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
					{shift.notes ? `${shift.notes} ` : ''}Reminder lands the day before.
				{/if}
			</p>
		{/if}

		<div class="mt-2 flex flex-wrap gap-2">
			{#if worked}
				<Button
					href={resolve(`/member/volunteer/feedback/${shift.signupId}`)}
					variant="ghost"
					size="xs"
				>
					How did it go?
				</Button>
			{:else if !calledOff}
				<Action
					action={cancelMySignup.for(shift.signupId)}
					label="Drop out"
					variant="ghost"
					size="xs"
					modalTitle="Drop out of this shift?"
					submitLabel="Drop out"
					successToast="Dropped. The place is back on the board."
				>
					{#snippet form()}
						<input type="hidden" name="signupId" value={shift.signupId} />
						<p class="text-sm">
							{shift.roleName} on {formatDateShort(shift.startsAt)}, {timeRange}.
						</p>
						<p class="text-sm">
							Notice isn't a no-show. The place goes back on the board for someone else, and nothing
							is held against you for telling us.
						</p>
					{/snippet}
				</Action>
			{/if}
		</div>
	</div>
</div>
