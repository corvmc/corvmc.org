<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * A member's Sign up on one shift: the volunteer board's and a record's
	 * `RelatedShifts` card (#2630). Signing up is not booking, so the modal
	 * shows the three steps with the first one lit.
	 */
	import Action from '#lib/components/ui/Action.svelte';
	import { formatDateShort } from '#lib/utils/format.js';
	import { shiftLabel } from '#lib/utils/shift-label.js';
	import { DEFAULT_TIMEZONE } from '#lib/config.js';
	import { claimShift } from '#lib/remote/volunteer.remote.js';

	let {
		shiftId,
		shift,
		onsuccess
	}: {
		shiftId: string;
		shift: {
			title?: string | null;
			eventTitle?: string | null;
			roleName: string | null;
			startsAt: Date;
			endsAt: Date;
			notes: string | null;
		};
		onsuccess?: () => void;
	} = $props();

	const claim = $derived(claimShift.for(shiftId));
	const fmt = new Intl.DateTimeFormat('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		timeZone: DEFAULT_TIMEZONE
	});
</script>

<Action
	action={claim}
	label={m.volunteer_open_shifts_label()}
	variant="primary"
	size="xs"
	modalTitle={m.volunteer_open_shifts_modal_title()}
	submitLabel={m.volunteer_open_shifts_label()}
	successToast={m.volunteer_open_shifts_success_toast()}
	{onsuccess}
	data-testid="shift-sign-up"
>
	{#snippet form()}
		<input {...claim.fields.shiftId.as('hidden', shiftId)} />
		<p class="text-sm">
			{shiftLabel(shift)}, {formatDateShort(shift.startsAt)},
			{fmt.format(shift.startsAt)}–{fmt.format(shift.endsAt)}.
		</p>

		<div class="flex flex-wrap items-center gap-2 text-xs">
			<span class="font-bold text-success">{m.volunteer_open_shifts_claim_text()}</span>
			<span class="text-subtle">→</span>
			<span class="text-subtle">{m.volunteer_open_shifts_staff_confirm_text()}</span>
			<span class="text-subtle">→</span>
			<span class="text-subtle">{m.volunteer_booked_text()}</span>
		</div>

		<p class="text-sm">
			{m.volunteer_open_shifts_re_not_booked_until_staff_text()}
		</p>

		{#if shift.notes}
			<p class="text-muted text-sm">“{shift.notes}”</p>
		{/if}
	{/snippet}
</Action>
