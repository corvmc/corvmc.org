<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * One shift as a staff row (#2625): when, the task, booked places against
	 * capacity, confirm all and roster matching. Volunteering's table and a
	 * record's `RelatedShifts` card both draw it; `compact` is the card, whose
	 * rows are not under day headers, so the date goes in the time cell.
	 * With `signup` it is a member's row (#2630): Sign up, or their own
	 * status, in place of confirm and roster matching, and no staff links.
	 */
	import { resolve } from '$app/paths';
	import { NO_ROLE_LABEL, shiftLabel } from '#lib/utils/shift-label.js';
	import { isShortStaffed } from '#lib/utils/shift-staffing.js';
	import { formatDateShort } from '#lib/utils/format.js';
	import { DEFAULT_TIMEZONE } from '#lib/config.js';
	import Action from '#lib/components/ui/Action.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import CandidateColumn from './CandidateColumn.svelte';
	import ShiftSignUpAction from './ShiftSignUpAction.svelte';
	import { confirmShiftClaims } from '#lib/remote/volunteer.remote.js';
	import type { getVolunteeringPage } from '#lib/remote/volunteer.remote.js';
	import type { getMemberRelatedShifts } from '#lib/remote/member-related.remote.js';

	type Row = Pick<
		Awaited<ReturnType<typeof getVolunteeringPage>>['shifts'][number],
		| 'id'
		| 'shiftId'
		| 'title'
		| 'roleName'
		| 'eventId'
		| 'eventTitle'
		| 'notes'
		| 'startsAt'
		| 'endsAt'
		| 'capacity'
		| 'claimed'
		| 'confirmed'
	>;
	type Signup = Awaited<
		ReturnType<typeof getMemberRelatedShifts>
	>['groups'][number]['shifts'][number]['signup'];

	let {
		shift: w,
		compact = false,
		open = false,
		ontoggle,
		onsuccess,
		signup
	}: {
		shift: Row;
		compact?: boolean;
		/** Roster matching is open beneath the row. */
		open?: boolean;
		ontoggle?: () => void;
		onsuccess?: () => void;
		/** The viewer's own facts on the shift: a member's row. */
		signup?: Signup;
	} = $props();

	const timeFmt = new Intl.DateTimeFormat('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		timeZone: DEFAULT_TIMEZONE
	});

	// A member opens only a shift they are on; staff open the task.
	const href = $derived(
		signup
			? signup.id
				? resolve('/member/volunteer/shifts/[signupId]', { signupId: signup.id })
				: null
			: resolve('/staff/tasks/[id]', { id: w.id })
	);
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
		{#if href}<a {href} class="link font-medium">{when}</a>{:else}{when}{/if}
	</td>

	<td class="cell-primary">
		{#if href}
			<a {href} class="link truncate font-medium">{label}</a>
		{:else}
			<span class="truncate font-medium">{label}</span>
		{/if}
		<!-- One subline: the role under a name, else the show, else the briefing. -->
		{#if w.title}
			<div class="truncate text-subtle text-xs">
				{w.roleName ?? NO_ROLE_LABEL}{#if w.eventTitle}
					· {w.eventTitle}{/if}
			</div>
		{:else if w.eventTitle && signup}
			<div class="truncate text-subtle text-xs">{w.eventTitle}</div>
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
		{#if signup}
			<!-- The board's count: places taken, booked or not. -->
			<span class:text-warning={empty}>
				{m.volunteer_open_shifts_filled_text({ claimed: w.claimed, capacity: w.capacity })}
			</span>
		{:else}
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
		{/if}
	</td>

	<td class="w-px">
		<div class="flex w-max justify-end gap-1">
			{#if signup}
				{#if signup.status}
					<StatusBadge status={signup.status} label />
				{:else if signup.missing.length > 0}
					<span class="text-subtle text-xs" data-testid="shift-needs">
						{m.volunteer_shift_row_needs_text({ names: signup.missing.join(', ') })}
					</span>
				{:else if w.claimed >= w.capacity}
					<span class="text-subtle text-xs">{m.volunteer_shift_row_full_text()}</span>
				{:else if w.shiftId}
					<ShiftSignUpAction shiftId={w.shiftId} shift={w} {onsuccess} />
				{/if}
			{:else if unconfirmed > 0 && w.shiftId}
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
			{#if !full && w.shiftId && !signup}
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
{#if open && w.shiftId && !signup}
	<tr data-testid="roster-match">
		<td colspan="4">
			<CandidateColumn workOrderId={w.id} shiftId={w.shiftId} startsAt={w.startsAt} />
		</td>
	</tr>
{/if}
