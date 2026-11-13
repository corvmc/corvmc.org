<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * One shift as a staff row (#2625): when, the task, booked places against
	 * capacity, confirm all and roster matching. Volunteering's table and a
	 * record's `RelatedShifts` card both draw it; `compact` is the card, whose
	 * rows are not under day headers, so the date goes in the time cell.
	 */
	import { resolve } from '$app/paths';
	import { NO_ROLE_LABEL, shiftLabel } from '#lib/utils/shift-label.js';
	import { isShortStaffed } from '#lib/utils/shift-staffing.js';
	import { formatDateShort } from '#lib/utils/format.js';
	import { DEFAULT_TIMEZONE } from '#lib/config.js';
	import Action from '#lib/components/ui/Action.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import CandidateColumn from './CandidateColumn.svelte';
	import { confirmShiftClaims } from '#lib/remote/volunteer.remote.js';
	import type { getVolunteeringPage } from '#lib/remote/volunteer.remote.js';

	type Row = Awaited<ReturnType<typeof getVolunteeringPage>>['shifts'][number];

	let {
		shift: w,
		compact = false,
		open = false,
		ontoggle,
		onsuccess
	}: {
		shift: Row;
		compact?: boolean;
		/** Roster matching is open beneath the row. */
		open?: boolean;
		ontoggle?: () => void;
		onsuccess?: () => void;
	} = $props();

	const timeFmt = new Intl.DateTimeFormat('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		timeZone: DEFAULT_TIMEZONE
	});

	const href = $derived(resolve('/staff/tasks/[id]', { id: w.id }));
	const unconfirmed = $derived(w.claimed - w.confirmed);
	const full = $derived(!isShortStaffed(w));
	const empty = $derived(w.claimed === 0);
	// On a record's card the record is already named, so the role leads instead of the show.
	const label = $derived(
		compact ? shiftLabel({ title: w.title, roleName: w.roleName }) : shiftLabel(w)
	);
	const when = $derived(
		`${compact ? `${formatDateShort(w.startsAt)}, ` : ''}${timeFmt.format(w.startsAt)}–${timeFmt.format(w.endsAt)}`
	);
</script>

<!-- Nobody on it at all is the state worth seeing from across the room. -->
<tr class="hover {empty ? 'border-l-4 border-l-warning bg-warning/5' : ''}" data-shift={w.shiftId}>
	<td class="whitespace-nowrap">
		<a {href} class="link font-medium">{when}</a>
	</td>

	<td class="cell-primary">
		<a {href} class="link truncate font-medium">{label}</a>
		<!-- One subline: the role under a name, else the show, else the briefing. -->
		{#if w.title}
			<div class="truncate text-subtle text-xs">
				{w.roleName ?? NO_ROLE_LABEL}{#if w.eventTitle}
					· {w.eventTitle}{/if}
			</div>
		{:else if w.eventTitle}
			<div class="truncate text-xs">
				<a href={resolve(`staff/events/${w.eventId}`)} class="link text-info">
					{w.eventTitle}
				</a>
			</div>
		{:else if w.notes}
			<div class="truncate text-subtle text-xs" title={w.notes}>{w.notes}</div>
		{/if}
	</td>

	<td class="cell-num whitespace-nowrap">
		<span
			class:text-success={full}
			class:text-error={!full && w.confirmed === 0}
			class:text-warning={!full && w.confirmed > 0 && unconfirmed > 0}
		>
			{m.staff_volunteer_schedule_text({ confirmed: w.confirmed, capacity: w.capacity })}
		</span>
		{#if unconfirmed > 0}
			<span class="text-xs text-warning"
				>{m.staff_volunteer_schedule_unconfirmed_text({ unconfirmed })}</span
			>
		{/if}
	</td>

	<td class="w-px">
		<div class="flex w-max justify-end gap-1">
			{#if unconfirmed > 0 && w.shiftId}
				<Action
					label={m.staff_volunteer_schedule_label({ unconfirmed })}
					variant="ghost"
					size="xs"
					class="text-success"
					action={confirmShiftClaims.for(w.id)}
					modalTitle={m.staff_confirm_all_volunteers_title()}
					submitLabel={m.staff_confirm_all_label()}
					successToast={m.staff_volunteer_schedule_success_toast()}
					{onsuccess}
				>
					{#snippet form()}
						<input {...confirmShiftClaims.for(w.id).fields.shiftId.as('hidden', w.shiftId ?? '')} />
						<p class="text-sm">
							{m.staff_volunteer_schedule_people_have_put_hand_up_text({
								unconfirmed,
								shiftLabel: shiftLabel(w),
								formatDateShort: formatDateShort(w.startsAt)
							})}
						</p>
					{/snippet}
				</Action>
			{/if}
			{#if !full && w.shiftId}
				<!-- Roster matching: the people interested in its role, to invite. -->
				<Button
					variant={empty ? 'primary' : 'ghost'}
					size="xs"
					aria-expanded={open}
					data-testid="find-volunteers"
					onclick={ontoggle}
				>
					{m.staff_volunteering_find_volunteers_label()}
				</Button>
			{/if}
		</div>
	</td>
</tr>
{#if open && w.shiftId}
	<tr data-testid="roster-match">
		<td colspan="4">
			<CandidateColumn workOrderId={w.id} shiftId={w.shiftId} startsAt={w.startsAt} />
		</td>
	</tr>
{/if}
