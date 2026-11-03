<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	/**
	 * One work order: who is on it, who to ask, its engagements, hours, reports
	 * and duties. Rendered by the shift page and by a project's task page, which
	 * passes its project as `context`. A cancelled work order's roster becomes the
	 * list of people still to be told, and the candidate column withdraws.
	 */
	import type { Snippet } from 'svelte';
	import { shiftLabel } from '#lib/utils/shift-label.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import type { Crumb } from '#lib/components/ui/breadcrumbs.js';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import ShiftRoleFields from './ShiftRoleFields.svelte';
	import ShiftChecklist from './ShiftChecklist.svelte';
	import CandidateColumn from './CandidateColumn.svelte';
	import WorkOrderHours from './WorkOrderHours.svelte';
	import WorkOrderReports from './WorkOrderReports.svelte';
	import EngagementCard from '#lib/components/contractor/EngagementCard.svelte';
	import { formatDateShort, formatDateShortYear, toLocalDateTime } from '#lib/utils/format.js';
	import { DEFAULT_TIMEZONE } from '#lib/config.js';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { IconCheck, IconUserX, IconUserMinus, IconPencil } from '@tabler/icons-svelte';
	import {
		confirmSignup,
		confirmSignups,
		releaseSignup,
		markSignupNoShow,
		markSignupNotified,
		notifyCancelledShift,
		cancelShift,
		duplicateShift,
		updateShift,
		type getStaffShiftPage
	} from '#lib/remote/volunteer.remote.js';

	type View = Omit<Awaited<ReturnType<typeof getStaffShiftPage>>, 'contractors'>;
	let {
		view,
		subtitle,
		parent,
		context,
		activity,
		actions
	}: {
		view: View;
		subtitle: string;
		/** Crumbs the URL cannot supply: the project above a task. */
		parent?: Crumb[];
		/** Leads the line under the header: the project a task belongs to. */
		context?: Snippet;
		/** The work order's history, read by each page through its own guard. */
		activity?: Snippet;
		/** Header actions a page adds to the view's own. */
		actions?: Snippet;
	} = $props();

	const shift = $derived(view.shift);
	const claimants = $derived(view.claimants);
	const unconfirmed = $derived(claimants.filter((c) => c.status === 'claimed'));
	const booked = $derived(
		claimants.filter((c) => c.status === 'confirmed' || c.status === 'completed')
	);
	const calledOff = $derived(!!shift.cancelledAt);
	const toNotify = $derived(claimants.filter((c) => !c.notifiedAt).length);
	const editForm = $derived(updateShift.for(shift.id));

	function timeRange(start: Date, end: Date): string {
		const fmt = new Intl.DateTimeFormat('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			timeZone: DEFAULT_TIMEZONE
		});
		return `${fmt.format(start)}–${fmt.format(end)}`;
	}

	const statusBadge: Record<string, string> = {
		claimed: 'badge-info',
		confirmed: 'badge-success',
		completed: 'badge-neutral',
		no_show: 'badge-error',
		cancelled: 'badge-ghost'
	};
</script>

<!-- An unscheduled work order has no date to name, so the title is the role
     and the body line says a window is still to be booked. -->
<PageHeader
	title={shift.startsAt
		? `${shiftLabel(shift)} · ${formatDateShortYear(shift.startsAt)}`
		: shiftLabel(shift)}
	{subtitle}
	{parent}
>
	{@render actions?.()}
</PageHeader>

<PageContent>
	<!-- Time and event lead the body rather than the header: PageHeader's
	     subtitle is the panel label everywhere else in the app. -->
	<p class="text-subtle text-sm">
		{#if context}{@render context()} ·{/if}
		{#if shift.startsAt && shift.endsAt}
			{timeRange(shift.startsAt, shift.endsAt)}
		{:else if shift.dueAt}
			{@const due = shift.dueAt}
			<!-- A deadline is not a window: "done by Friday" is not "happens Friday 6-8". -->
			<ParaglideMessage
				message={m.volunteer_work_order_view_due}
				inputs={{ formatDateShortYear: formatDateShortYear(due) }}
				>{#snippet time({ children })}<time datetime={new Date(due).toISOString()}
						>{@render children?.()}</time
					>{/snippet}</ParaglideMessage
			>
		{:else}{m.volunteer_work_order_view_time_arranged()}{/if} ·
		{#if shift.eventId && shift.eventTitle}
			<a href={resolve(`/staff/events/${shift.eventId}`)} class="link link-primary">
				{shift.eventTitle}
			</a>
		{:else}{m.volunteer_work_order_view_not_tied_event()}{/if}
		{#if shift.assetId && shift.assetName}
			·
			<a href={resolve(`/staff/inventory/assets/${shift.assetId}`)} class="link link-primary">
				{shift.assetName}
			</a>
		{/if}
	</p>

	{#if calledOff}
		<!-- Leads with the outstanding count, because that is the only thing
		     left to do about this shift. -->
		<Alert type="warning">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<p class="font-medium">
						{toNotify > 0
							? m.volunteer_work_order_view_notify({ toNotify })
							: m.volunteer_work_order_view_everybody_has_been_notified()}
					</p>
					<p class="text-sm">
						{shift.cancelledByName
							? m.volunteer_work_order_view_called_off_by({
									date: formatDateShort(shift.cancelledAt!),
									name: shift.cancelledByName
								})
							: m.volunteer_work_order_view_called_off({
									date: formatDateShort(shift.cancelledAt!)
								})}
					</p>
				</div>
				{#if toNotify > 0}
					<Action
						action={notifyCancelledShift.for(shift.id)}
						label={m.volunteer_work_order_view_notify_all()}
						variant="warning"
						size="sm"
						modalTitle={m.volunteer_work_order_view_tell_everybody_off()}
						submitLabel={m.volunteer_work_order_view_notify_all()}
						successToast={m.volunteer_work_order_view_sent_they_know()}
					>
						{#snippet form()}
							<input
								{...notifyCancelledShift.for(shift.id).fields.shiftId.as('hidden', shift.id)}
							/>
							<p class="text-sm">
								{m.volunteer_work_order_view_people_still_shift_will_emailed({ toNotify })}
							</p>
						{/snippet}
					</Action>
				{/if}
			</div>
		</Alert>
	{/if}

	<!-- Ahead of the roster: on a contractor's task the engagement is the work. -->
	{#if view.engagements.length > 0}
		<section class="flex flex-col gap-3" aria-labelledby="engagements-heading">
			<h2 id="engagements-heading" class="text-lg font-semibold">
				{m.volunteer_work_order_view_engagements()}
			</h2>
			{#each view.engagements as row (row.job.id)}
				<EngagementCard {row} />
			{/each}
		</section>
	{/if}

	<div class="grid gap-6 {calledOff ? '' : 'lg:grid-cols-2'}">
		<div class="flex flex-col gap-6">
			<InfoCard
				title={calledOff
					? m.volunteer_work_order_view_who_tell()
					: m.volunteer_work_order_view_who_s()}
			>
				{#snippet header()}
					<div class="flex items-center justify-between gap-2">
						<CardTitle>
							{calledOff
								? m.volunteer_work_order_view_who_tell()
								: m.volunteer_work_order_view_who_s()} · {claimants.length}
						</CardTitle>
						{#if !calledOff && unconfirmed.length > 1}
							<Action
								action={confirmSignups.for(shift.id)}
								label={m.volunteer_work_order_view_confirm_all({ length: unconfirmed.length })}
								variant="ghost"
								size="sm"
								class="text-success"
								modalTitle={m.volunteer_work_order_view_confirm_everyone_waiting()}
								submitLabel={m.volunteer_work_order_view_confirm_all_2()}
								successToast={m.volunteer_work_order_view_confirmed()}
							>
								{#snippet form()}
									<input {...confirmSignups.for(shift.id).fields.shiftId.as('hidden', shift.id)} />
									{#each unconfirmed as c, i (c.signupId)}
										<input
											{...confirmSignups.for(shift.id).fields.signupIds[i].as('hidden', c.signupId)}
										/>
									{/each}
									<p class="text-sm">
										{m.volunteer_work_order_view_all_confirmed_shift_each_them({
											join: unconfirmed.map((c) => c.member.title).join(', ')
										})}
									</p>
								{/snippet}
							</Action>
						{/if}
					</div>
				{/snippet}

				{#if claimants.length === 0}
					<EmptyState
						title={m.volunteer_work_order_view_nobody_yet()}
						description={view.engagements.length > 0
							? m.volunteer_work_order_view_contractor_answers_one_see_engagem()
							: m.volunteer_work_order_view_members_interested_role_see_at()}
					/>
				{:else}
					<ul class="flex flex-col gap-4">
						{#each claimants as claimant (claimant.signupId)}
							<li class="flex flex-col gap-2">
								<div class="flex flex-wrap items-center justify-between gap-3">
									<div class="flex min-w-0 flex-wrap items-center gap-2">
										<EntityIdentity ref={claimant.member} />
										{#if calledOff}
											<span
												class="badge badge-sm {claimant.notifiedAt
													? 'badge-success'
													: 'badge-warning'}"
											>
												{claimant.notifiedAt
													? m.volunteer_work_order_view_notified_2()
													: m.volunteer_work_order_view_not_notified()}
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
													>{m.volunteer_work_order_view_notified()}</span
												>
											{:else}
												<!-- The escape hatch beside the mail-out, for staff who
												     rang them. Sends nothing. -->
												<Action
													action={markSignupNotified.for(claimant.signupId)}
													label={m.volunteer_work_order_view_mark_as_notified()}
													variant="ghost"
													size="sm"
													modalTitle={m.volunteer_work_order_view_mark_as_told({
														title: claimant.member.title
													})}
													submitLabel={m.volunteer_work_order_view_mark_as_notified()}
													successToast={m.volunteer_work_order_view_marked()}
												>
													{#snippet form()}
														<input
															{...markSignupNotified
																.for(claimant.signupId)
																.fields.signupId.as('hidden', claimant.signupId)}
														/>
														<input
															{...markSignupNotified
																.for(claimant.signupId)
																.fields.shiftId.as('hidden', shift.id)}
														/>
														<p class="text-sm">
															{m.volunteer_work_order_view_use_when_reached_them_another()}
														</p>
													{/snippet}
												</Action>
											{/if}
										{:else}
											{#if claimant.status === 'claimed'}
												<Action
													action={confirmSignup.for(claimant.signupId)}
													label={m.volunteer_work_order_view_confirm()}
													iconOnly
													icon={checkIcon}
													variant="ghost"
													size="sm"
													class="text-success"
													modalTitle={m.volunteer_work_order_view_confirm_2({
														title: claimant.member.title
													})}
													submitLabel={m.volunteer_work_order_view_confirm()}
													successToast={m.volunteer_work_order_view_confirmed()}
												>
													{#snippet form()}
														<input
															{...confirmSignup
																.for(claimant.signupId)
																.fields.signupId.as('hidden', claimant.signupId)}
														/>
														<input
															{...confirmSignup
																.for(claimant.signupId)
																.fields.shiftId.as('hidden', shift.id)}
														/>
														<p class="text-sm">
															{m.volunteer_work_order_view_they_ll_get_reminder_day()}
														</p>
													{/snippet}
												</Action>
											{/if}

											{#if claimant.status === 'claimed' || claimant.status === 'confirmed'}
												<!-- Notice, not a no-show: somebody who rang to say they
												     can't make it should not get a mark against them. -->
												<Action
													action={releaseSignup.for(claimant.signupId)}
													label={m.volunteer_work_order_view_remove()}
													iconOnly
													icon={releaseIcon}
													variant="ghost"
													size="sm"
													modalTitle={m.volunteer_work_order_view_take_off_shift({
														title: claimant.member.title
													})}
													submitLabel={m.volunteer_work_order_view_take_them_off()}
													successToast={m.volunteer_work_order_view_taken_off_place_open_again()}
												>
													{#snippet form()}
														<input
															{...releaseSignup
																.for(claimant.signupId)
																.fields.signupId.as('hidden', claimant.signupId)}
														/>
														<input
															{...releaseSignup
																.for(claimant.signupId)
																.fields.shiftId.as('hidden', shift.id)}
														/>
														<p class="text-sm">
															{m.volunteer_work_order_view_their_place_opens_up_straight()}
														</p>
													{/snippet}
												</Action>
											{/if}

											{#if claimant.status === 'confirmed' || claimant.status === 'completed'}
												<!-- Confirmed people only: a claim nobody confirmed was never a booking. -->
												<Action
													action={markSignupNoShow.for(claimant.signupId)}
													label={m.volunteer_work_order_view_mark_no_show()}
													iconOnly
													icon={noShowIcon}
													variant="ghost"
													size="sm"
													class="text-error"
													modalTitle={m.volunteer_work_order_view_mark_as_no_show({
														title: claimant.member.title
													})}
													submitLabel={m.volunteer_work_order_view_no_show()}
													submitVariant="error"
													successToast={m.volunteer_work_order_view_marked_as_no_show()}
												>
													{#snippet form()}
														<input
															{...markSignupNoShow
																.for(claimant.signupId)
																.fields.signupId.as('hidden', claimant.signupId)}
														/>
														<input
															{...markSignupNoShow
																.for(claimant.signupId)
																.fields.shiftId.as('hidden', shift.id)}
														/>
														<p class="text-sm">
															{m.volunteer_work_order_view_different_from_removing_them_remov()}
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
										{m.volunteer_work_order_view_unconfirmed_no_reminder()}
									</p>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</InfoCard>

			{#if view.tasks.length > 0}
				<ShiftChecklist tasks={view.tasks} shiftId={shift.id} />
			{/if}

			<!-- Apart from "Who's on it", because neither an invitation nor a
			     refusal holds a place. -->
			{#if view.invitations.length > 0}
				<InfoCard title={m.volunteer_work_order_view_asked()}>
					<ul class="flex flex-col gap-2">
						{#each view.invitations as invitation (invitation.signupId)}
							<li class="flex flex-wrap items-center gap-2">
								<EntityIdentity ref={invitation.member} size="sm" />
								<Badge variant={invitation.status === 'declined' ? 'error' : 'ghost'} size="xs">
									{invitation.status === 'declined'
										? m.volunteer_work_order_view_said_no()
										: m.volunteer_work_order_view_waiting()}
								</Badge>
								{#if invitation.invitedByName}
									<span class="text-subtle text-xs"
										>{m.volunteer_asked({ invitedByName: invitation.invitedByName })}</span
									>
								{/if}
							</li>
						{/each}
					</ul>
					<p class="mt-2 text-subtle text-xs">
						{m.volunteer_work_order_view_invitation_holds_no_place_no()}
					</p>
				</InfoCard>
			{/if}

			<InfoCard title={m.volunteer_work_order_view_briefing()}>
				{#if shift.notes}
					<p class="text-sm">{shift.notes}</p>
				{:else}
					<p class="text-subtle text-sm">
						{m.volunteer_work_order_view_no_briefing_yet_add_one()}
					</p>
				{/if}

				<div class="mt-4 flex flex-wrap gap-2">
					<Action
						action={editForm}
						label={m.volunteer_work_order_view_edit()}
						data-testid="edit-shift"
						variant="ghost"
						size="sm"
						modalTitle={m.volunteer_work_order_view_edit_shift()}
						submitLabel={m.volunteer_save()}
						successToast={m.volunteer_work_order_view_shift_updated_everyone_stays()}
					>
						{#snippet icon()}<IconPencil size={16} />{/snippet}
						{#snippet form()}
							<input {...editForm.fields.id.as('hidden', shift.id)} />
							<!-- An archived role stays in the list when this shift is on it, or
							     the select would post an empty role and quietly reassign it. -->
							<ShiftRoleFields
								form={editForm}
								keepId={shift.volunteerRoleId}
								roleId={shift.volunteerRoleId ?? undefined}
								initialEvent={shift.eventId && shift.eventTitle
									? { id: shift.eventId, title: shift.eventTitle }
									: null}
								initialAsset={shift.assetId && shift.assetName
									? { id: shift.assetId, name: shift.assetName }
									: null}
								startsAt={shift.startsAt ? toLocalDateTime(shift.startsAt) : ''}
								endsAt={shift.endsAt ? toLocalDateTime(shift.endsAt) : ''}
								capacity={String(shift.capacity)}
								notes={shift.notes ?? ''}
								title={shift.title ?? ''}
							/>
							{#if view.reports.length > 0 || shift.closeReportsOnCompletion}
								<FormField
									field={editForm.fields.closeReports}
									type="select"
									label={m.volunteer_work_order_view_when_window_ends()}
									value={shift.closeReportsOnCompletion ? 'close' : 'wait'}
									options={[
										{
											value: 'close',
											label: m.volunteer_work_order_view_close_equipment_reports()
										},
										{ value: 'wait', label: m.volunteer_work_order_view_wait_today_me_confirm() }
									]}
								/>
							{/if}
						{/snippet}
					</Action>

					{#if shift.startsAt}
						{@const copy = duplicateShift.for(shift.id)}
						<Action
							action={copy}
							label={m.volunteer_work_order_view_copy_forward()}
							variant="ghost"
							size="sm"
							modalTitle={m.volunteer_work_order_view_copy_shift_forward()}
							submitLabel={m.volunteer_work_order_view_copy()}
							successToast={m.volunteer_work_order_view_copied_nobody_copy_yet()}
							onsuccess={(r) => {
								const copyId = (r as { id?: string } | undefined)?.id;
								// The shift URL sends a project's copy on to its task page.
								if (copyId) goto(resolve(`/staff/volunteer/shifts/${copyId}`));
							}}
						>
							{#snippet form()}
								<input {...copy.fields.id.as('hidden', shift.id)} />
								<FormField
									field={copy.fields.offsetDays}
									type="number"
									label={m.volunteer_work_order_view_days_later()}
									value={7}
									description={m.volunteer_work_order_view_same_role_times_capacity_later()}
								/>
							{/snippet}
						</Action>
					{/if}

					{#if !calledOff}
						<Action
							action={cancelShift.for(shift.id)}
							label={m.volunteer_work_order_view_cancel_shift()}
							variant="ghost"
							size="sm"
							class="text-error"
							modalTitle={m.volunteer_work_order_view_cancel_shift_2()}
							submitLabel={m.volunteer_work_order_view_cancel_shift()}
							submitVariant="error"
							successToast={m.volunteer_work_order_view_called_off_tell_people()}
						>
							{#snippet form()}
								<input {...cancelShift.for(shift.id).fields.id.as('hidden', shift.id)} />
								<p class="text-sm">
									{m.volunteer_work_order_view_claims_bookings_stay_place_they()}
								</p>
							{/snippet}
						</Action>
					{/if}
				</div>
			</InfoCard>
		</div>

		<!-- Nobody can be put on work with no role, so there is nobody to suggest. -->
		{#if !calledOff && shift.roleName !== null}
			<CandidateColumn shiftId={shift.id} startsAt={shift.startsAt} />
		{/if}
	</div>

	<!-- Staffing reads as two numbers wherever it appears: "3 of 3" where none
	     is confirmed gets no reminders, never completes and produces no hours. -->
	{#if shift.roleName !== null}
		<p class="text-subtle text-sm">
			{m.volunteer_work_order_view_confirmed_2({
				length: booked.length,
				capacity: shift.capacity
			})}{#if unconfirmed.length > 0}
				<Badge variant="warning" size="sm" class="ml-1">
					{m.volunteer_work_order_view_unconfirmed({ length: unconfirmed.length })}
				</Badge>
			{/if}
		</p>
	{/if}

	{#if view.hours.length > 0}
		<WorkOrderHours hours={view.hours} shiftId={shift.id} />
	{/if}

	{#if view.reports.length > 0}
		<WorkOrderReports reports={view.reports} />
	{/if}

	{#if view.feedback.length > 0}
		<InfoCard title={m.volunteer_work_order_view_how_went()}>
			<ul class="flex flex-col gap-3">
				{#each view.feedback as response (response.signupId)}
					<li class="text-sm">
						<div class="flex items-center gap-2">
							<span
								class="text-warning"
								aria-label={m.volunteer_work_order_view_aria_label({ rating: response.rating })}
							>
								{'★'.repeat(response.rating)}{'☆'.repeat(5 - response.rating)}
							</span>
							{#if !response.wasSetUp}
								<!-- The actionable signal: enjoyment and preparedness pull
								     apart exactly where the briefing needs work. -->
								<Badge variant="warning">{m.volunteer_work_order_view_wasn_t_set_up()}</Badge>
							{/if}
						</div>
						{#if response.comment}
							<p class="mt-1 opacity-80">{response.comment}</p>
						{/if}
					</li>
				{/each}
			</ul>
		</InfoCard>
	{/if}

	{@render activity?.()}
</PageContent>

{#snippet checkIcon()}
	<IconCheck size={16} />
{/snippet}

{#snippet noShowIcon()}
	<IconUserX size={16} />
{/snippet}

{#snippet releaseIcon()}
	<IconUserMinus size={16} />
{/snippet}
