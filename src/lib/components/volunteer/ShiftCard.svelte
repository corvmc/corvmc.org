<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * One shift of a task, with its own roster (#2518): who signed up, who was
	 * invited, and the shift's own edit, copy and cancel. Cancelling here calls
	 * off this shift only; the task's own Cancel is on the task. A called-off
	 * shift's roster becomes the list of people still to tell.
	 */
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import { formatDateShort, formatDateShortYear, toLocalDateTime } from '#lib/utils/format.js';
	import { DEFAULT_TIMEZONE, VOLUNTEER_SHIFT_NOTES_MAX } from '#lib/config.js';
	import { IconCheck, IconUserX, IconUserMinus, IconPencil } from '@tabler/icons-svelte';
	import {
		cancelShift,
		confirmSignup,
		confirmSignups,
		duplicateShift,
		markSignupNoShow,
		markSignupNotified,
		notifyCancelledShift,
		releaseSignup,
		updateShift,
		type getStaffShiftPage
	} from '#lib/remote/volunteer.remote.js';

	type Shift = Awaited<ReturnType<typeof getStaffShiftPage>>['shifts'][number];
	let {
		shift,
		taskOpen
	}: {
		shift: Shift;
		/** Neither done nor called off: only then can its shifts change. */
		taskOpen: boolean;
	} = $props();

	const claimants = $derived(shift.claimants);
	const unconfirmed = $derived(claimants.filter((c) => c.status === 'claimed'));
	const calledOff = $derived(!!shift.cancelledAt);
	const toNotify = $derived(claimants.filter((c) => !c.notifiedAt).length);
	const editable = $derived(taskOpen && !calledOff);
	const edit = $derived(updateShift.for(shift.id));
	const copy = $derived(duplicateShift.for(shift.id));

	const timeFmt = new Intl.DateTimeFormat('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		timeZone: DEFAULT_TIMEZONE
	});
	const when = $derived(
		`${formatDateShortYear(shift.startsAt)} · ${timeFmt.format(shift.startsAt)}–${timeFmt.format(shift.endsAt)}`
	);

	const statusBadge: Record<string, string> = {
		claimed: 'badge-info',
		confirmed: 'badge-success',
		completed: 'badge-neutral',
		no_show: 'badge-error',
		cancelled: 'badge-ghost'
	};
</script>

<InfoCard title={when} testid="task-shift">
	{#snippet header()}
		<div class="flex flex-wrap items-center justify-between gap-2">
			<CardTitle>
				{when}
				{#if calledOff}
					<Badge variant="ghost" size="sm">{m.volunteer_shift_card_called_off_label()}</Badge>
				{/if}
			</CardTitle>
			<!-- Two numbers: "3 of 3" where none is confirmed gets no reminders,
			     never completes and produces no hours. -->
			<span class="text-subtle text-sm">
				{m.volunteer_work_order_view_confirmed_2_text({
					length: shift.confirmed,
					capacity: shift.capacity
				})}{#if unconfirmed.length > 0}
					<Badge variant="warning" size="sm" class="ml-1">
						{m.volunteer_work_order_view_unconfirmed_label({ length: unconfirmed.length })}
					</Badge>
				{/if}
			</span>
		</div>
	{/snippet}

	{#if calledOff}
		<!-- Leads with the outstanding count: the only thing left to do about it. -->
		<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
			<div class="text-sm">
				<p class="font-medium">
					{toNotify > 0
						? m.volunteer_work_order_view_notify_text({ toNotify })
						: m.volunteer_work_order_view_everybody_has_been_notified_text()}
				</p>
				<p class="text-subtle">
					{shift.cancelledByName
						? m.volunteer_work_order_view_called_off_by_text({
								date: formatDateShort(shift.cancelledAt!),
								name: shift.cancelledByName
							})
						: m.volunteer_work_order_view_called_off_text({
								date: formatDateShort(shift.cancelledAt!)
							})}
				</p>
			</div>
			{#if toNotify > 0}
				<Action
					action={notifyCancelledShift.for(shift.id)}
					label={m.volunteer_work_order_view_notify_all_label()}
					variant="warning"
					size="sm"
					modalTitle={m.volunteer_work_order_view_tell_everybody_off_title()}
					submitLabel={m.volunteer_work_order_view_notify_all_label()}
					successToast={m.volunteer_work_order_view_sent_they_know_toast()}
				>
					{#snippet form()}
						<input {...notifyCancelledShift.for(shift.id).fields.shiftId.as('hidden', shift.id)} />
						<p class="text-sm">
							{m.volunteer_work_order_view_people_still_shift_will_emailed_text({ toNotify })}
						</p>
					{/snippet}
				</Action>
			{/if}
		</div>
	{/if}

	{#if shift.notes}
		<p class="mb-3 text-sm">{shift.notes}</p>
	{/if}

	{#if claimants.length === 0}
		<p class="text-subtle text-sm">{m.volunteer_work_order_view_nobody_yet_title()}</p>
	{:else}
		<ul class="flex flex-col gap-4" data-testid="shift-roster">
			{#each claimants as claimant (claimant.signupId)}
				<li class="flex flex-col gap-2">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="flex min-w-0 flex-wrap items-center gap-2">
							<EntityIdentity ref={claimant.member} />
							{#if calledOff}
								<span
									class="badge badge-sm {claimant.notifiedAt ? 'badge-success' : 'badge-warning'}"
								>
									{claimant.notifiedAt
										? m.volunteer_work_order_view_notified_2_text()
										: m.volunteer_work_order_view_not_notified_text()}
								</span>
							{:else}
								<span
									class="badge badge-sm {statusBadge[claimant.status]}"
									data-status={claimant.status}
								>
									{claimant.status.replace('_', ' ')}
								</span>
							{/if}
						</div>

						<div class="flex shrink-0 gap-1">
							{#if calledOff}
								{#if claimant.notifiedAt}
									<span class="text-sm text-success"
										>{m.volunteer_work_order_view_notified_text()}</span
									>
								{:else}
									<!-- The escape hatch beside the mail-out, for staff who rang
									     them. Sends nothing. -->
									{@const told = markSignupNotified.for(claimant.signupId)}
									<Action
										action={told}
										label={m.volunteer_work_order_view_mark_as_notified_label()}
										variant="ghost"
										size="sm"
										modalTitle={m.volunteer_work_order_view_mark_as_told_title({
											title: claimant.member.title
										})}
										submitLabel={m.volunteer_work_order_view_mark_as_notified_label()}
										successToast={m.volunteer_work_order_view_marked_toast()}
									>
										{#snippet form()}
											<input {...told.fields.signupId.as('hidden', claimant.signupId)} />
											<input {...told.fields.shiftId.as('hidden', shift.id)} />
											<p class="text-sm">
												{m.volunteer_work_order_view_use_when_reached_them_another_text()}
											</p>
										{/snippet}
									</Action>
								{/if}
							{:else}
								{#if claimant.status === 'claimed'}
									{@const confirm = confirmSignup.for(claimant.signupId)}
									<Action
										action={confirm}
										label={m.volunteer_work_order_view_confirm_label()}
										iconOnly
										icon={checkIcon}
										variant="ghost"
										size="sm"
										class="text-success"
										modalTitle={m.volunteer_work_order_view_confirm_2_title({
											title: claimant.member.title
										})}
										submitLabel={m.volunteer_work_order_view_confirm_label()}
										successToast={m.volunteer_work_order_view_confirmed_toast()}
									>
										{#snippet form()}
											<input {...confirm.fields.signupId.as('hidden', claimant.signupId)} />
											<input {...confirm.fields.shiftId.as('hidden', shift.id)} />
											<p class="text-sm">
												{m.volunteer_work_order_view_they_ll_get_reminder_day_text()}
											</p>
										{/snippet}
									</Action>
								{/if}

								{#if claimant.status === 'claimed' || claimant.status === 'confirmed'}
									<!-- Notice, not a no-show: somebody who rang to say they can't
									     make it should not get a mark against them. -->
									{@const release = releaseSignup.for(claimant.signupId)}
									<Action
										action={release}
										label={m.volunteer_work_order_view_remove_label()}
										iconOnly
										icon={releaseIcon}
										variant="ghost"
										size="sm"
										modalTitle={m.volunteer_work_order_view_take_off_shift_title({
											title: claimant.member.title
										})}
										submitLabel={m.volunteer_work_order_view_take_them_off_label()}
										successToast={m.volunteer_work_order_view_taken_off_place_open_again_toast()}
									>
										{#snippet form()}
											<input {...release.fields.signupId.as('hidden', claimant.signupId)} />
											<input {...release.fields.shiftId.as('hidden', shift.id)} />
											<p class="text-sm">
												{m.volunteer_work_order_view_their_place_opens_up_straight_text()}
											</p>
										{/snippet}
									</Action>
								{/if}

								{#if claimant.status === 'confirmed' || claimant.status === 'completed'}
									<!-- Confirmed people only: a claim nobody confirmed was never a booking. -->
									{@const noShow = markSignupNoShow.for(claimant.signupId)}
									<Action
										action={noShow}
										label={m.volunteer_work_order_view_mark_no_show_label()}
										iconOnly
										icon={noShowIcon}
										variant="ghost"
										size="sm"
										class="text-error"
										modalTitle={m.volunteer_work_order_view_mark_as_no_show_title({
											title: claimant.member.title
										})}
										submitLabel={m.volunteer_work_order_view_no_show_label()}
										submitVariant="error"
										successToast={m.volunteer_work_order_view_marked_as_no_show_toast()}
									>
										{#snippet form()}
											<input {...noShow.fields.signupId.as('hidden', claimant.signupId)} />
											<input {...noShow.fields.shiftId.as('hidden', shift.id)} />
											<p class="text-sm">
												{m.volunteer_work_order_view_different_from_removing_them_remov_text()}
											</p>
										{/snippet}
									</Action>
								{/if}
							{/if}
						</div>
					</div>

					{#if !calledOff && claimant.status === 'claimed'}
						<!-- Only confirmation sends the reminder; the claim still
						     completes as worked once the shift ends. -->
						<p class="border-l-2 border-warning pl-2 text-xs text-warning">
							{m.volunteer_work_order_view_unconfirmed_no_reminder_text()}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<!-- Apart from the roster: neither an invitation nor a refusal holds a place. -->
	{#if shift.invitations.length > 0}
		<div class="mt-4">
			<h3 class="text-sm font-semibold">{m.volunteer_work_order_view_asked_title()}</h3>
			<ul class="mt-2 flex flex-col gap-2">
				{#each shift.invitations as invitation (invitation.signupId)}
					<li class="flex flex-wrap items-center gap-2">
						<EntityIdentity ref={invitation.member} size="sm" />
						<Badge variant={invitation.status === 'declined' ? 'error' : 'ghost'} size="xs">
							{invitation.status === 'declined'
								? m.volunteer_work_order_view_said_no_label()
								: m.volunteer_work_order_view_waiting_label()}
						</Badge>
						{#if invitation.invitedByName}
							<span class="text-subtle text-xs"
								>{m.volunteer_asked_text({ invitedByName: invitation.invitedByName })}</span
							>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if taskOpen}
		<div class="mt-4 flex flex-wrap gap-2">
			{#if editable && unconfirmed.length > 1}
				{@const all = confirmSignups.for(shift.id)}
				<Action
					action={all}
					label={m.volunteer_work_order_view_confirm_all_label({ length: unconfirmed.length })}
					variant="ghost"
					size="sm"
					class="text-success"
					modalTitle={m.volunteer_work_order_view_confirm_everyone_waiting_title()}
					submitLabel={m.volunteer_work_order_view_confirm_all_2_label()}
					successToast={m.volunteer_work_order_view_confirmed_toast()}
				>
					{#snippet form()}
						<input {...all.fields.shiftId.as('hidden', shift.id)} />
						{#each unconfirmed as c, i (c.signupId)}
							<input {...all.fields.signupIds[i].as('hidden', c.signupId)} />
						{/each}
						<p class="text-sm">
							{m.volunteer_work_order_view_all_confirmed_shift_each_them_text({
								join: unconfirmed.map((c) => c.member.title).join(', ')
							})}
						</p>
					{/snippet}
				</Action>
			{/if}

			{#if editable}
				<Action
					action={edit}
					label={m.volunteer_work_order_view_edit_label()}
					data-testid="edit-shift"
					variant="ghost"
					size="sm"
					modalTitle={m.volunteer_work_order_view_edit_shift_title()}
					submitLabel={m.volunteer_save_label()}
					successToast={m.volunteer_work_order_view_shift_updated_everyone_stays_toast()}
				>
					{#snippet icon()}<IconPencil size={16} />{/snippet}
					{#snippet form()}
						<input {...edit.fields.shiftId.as('hidden', shift.id)} />
						<FormField
							field={edit.fields.startsAt}
							label={m.volunteer_shift_form_fields_starts_label()}
							type="datetime-local"
							value={toLocalDateTime(shift.startsAt)}
						/>
						<FormField
							field={edit.fields.endsAt}
							label={m.volunteer_shift_form_fields_ends_label()}
							type="datetime-local"
							value={toLocalDateTime(shift.endsAt)}
						/>
						<FormField
							field={edit.fields.capacity}
							submitAs="text"
							label={m.volunteer_shift_form_fields_people_needed_label()}
							type="number"
							min="1"
							value={String(shift.capacity)}
							description={m.volunteer_shift_form_fields_claims_beyond_refused_body()}
						/>
						<FormField
							field={edit.fields.notes}
							label={m.volunteer_shift_form_fields_anything_they_should_know_label()}
							type="textarea"
							value={shift.notes ?? ''}
							description={m.volunteer_shift_form_fields_where_meet_what_bring_shown_body({
								VOLUNTEER_SHIFT_NOTES_MAX
							})}
						/>
					{/snippet}
				</Action>
			{/if}

			<Action
				action={copy}
				label={m.volunteer_work_order_view_copy_forward_label()}
				variant="ghost"
				size="sm"
				modalTitle={m.volunteer_work_order_view_copy_shift_forward_title()}
				submitLabel={m.volunteer_work_order_view_copy_label()}
				successToast={m.volunteer_work_order_view_copied_nobody_copy_yet_toast()}
			>
				{#snippet form()}
					<input {...copy.fields.shiftId.as('hidden', shift.id)} />
					<FormField
						field={copy.fields.offsetDays}
						type="number"
						label={m.volunteer_work_order_view_days_later_label()}
						value={7}
						description={m.volunteer_work_order_view_same_role_times_capacity_later_body()}
					/>
				{/snippet}
			</Action>

			{#if editable}
				{@const cancel = cancelShift.for(shift.id)}
				<Action
					action={cancel}
					label={m.volunteer_work_order_view_cancel_shift_label()}
					data-testid="cancel-shift"
					variant="ghost"
					size="sm"
					class="text-error"
					modalTitle={m.volunteer_work_order_view_cancel_shift_2_title()}
					submitLabel={m.volunteer_work_order_view_cancel_shift_label()}
					submitVariant="error"
					successToast={m.volunteer_work_order_view_called_off_tell_people_toast()}
				>
					{#snippet form()}
						<input {...cancel.fields.shiftId.as('hidden', shift.id)} />
						<p class="text-sm">
							{m.volunteer_work_order_view_claims_bookings_stay_place_they_text()}
						</p>
					{/snippet}
				</Action>
			{/if}
		</div>
	{/if}
</InfoCard>

{#snippet checkIcon()}
	<IconCheck size={16} />
{/snippet}

{#snippet noShowIcon()}
	<IconUserX size={16} />
{/snippet}

{#snippet releaseIcon()}
	<IconUserMinus size={16} />
{/snippet}
