<script lang="ts">
	/**
	 * One shift, two columns: who is on it, and who to ask.
	 *
	 * The shortlist used to live on the role's own page — a navigation away from
	 * the shift you were trying to fill, and evaluated against *today* rather
	 * than the shift's date (docs/reports/volunteer-workflow-findings.md#a5, #a7).
	 * It is now the right-hand column, and it says which date it judged.
	 *
	 * A cancelled shift is the same page with one column. Its roster is not a
	 * roster any more — it is the list of people who still have to be told, so
	 * the chips and the buttons switch to saying how far down it staff have got,
	 * and the candidate column and the cancel action withdraw.
	 */
	import { page } from '$app/state';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import Action from '$lib/components/ui/Action.svelte';
	import ShiftRoleFields from '$lib/components/volunteer/ShiftRoleFields.svelte';
	import CandidateColumn from './CandidateColumn.svelte';
	import { formatDateShort, formatDateShortYear, toLocalDateTime } from '$lib/utils/format';
	import { DEFAULT_TIMEZONE } from '$lib/config';
	import { resolve } from '$app/paths';
	import { IconCheck, IconUserX, IconUserMinus, IconPencil } from '@tabler/icons-svelte';
	import {
		getStaffShiftPage,
		confirmSignup,
		confirmSignups,
		releaseSignup,
		markSignupNoShow,
		markSignupNotified,
		notifyCancelledShift,
		cancelShift,
		updateShift
	} from '$lib/remote/volunteer.remote';

	let id = $derived(page.params.id!);
	// One query. The role list the edit form needs moved into ShiftRoleFields — it is
	// unparameterized and refreshed by name, so it could not join this one.
	const pageData = $derived(getStaffShiftPage(id));
	const data = $derived(pageData.then((d) => d.shift));
	const feedback = $derived(pageData.then((d) => d.feedback));

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

{#await data then { shift, claimants }}
	<!--
		Immediate children of the await block, not of `PageContent`: `{@const}` has to be a
		direct child of a block, and both the header and the cards below read them.
	-->
	{@const unconfirmed = claimants.filter((c) => c.status === 'claimed')}
	{@const booked = claimants.filter((c) => c.status === 'confirmed' || c.status === 'completed')}
	{@const calledOff = !!shift.cancelledAt}
	{@const toNotify = claimants.filter((c) => !c.notifiedAt).length}
	{@const editForm = updateShift.for(shift.id)}

	<PageHeader
		title="{shift.roleName} · {formatDateShortYear(shift.startsAt)}"
		subtitle="Shift"
		backHref="/staff/volunteer/schedule"
	/>

	<PageContent>
		<!-- Time and event lead the body rather than the header: PageHeader's
		     subtitle is the panel label everywhere else in the app, and one page
		     redefining it is how a convention stops being one. -->
		<p class="text-subtle text-sm">
			{timeRange(shift.startsAt, shift.endsAt)} ·
			{#if shift.eventId && shift.eventTitle}
				<a href={resolve(`/staff/events/${shift.eventId}`)} class="link link-primary">
					{shift.eventTitle}
				</a>
			{:else}
				not tied to an event
			{/if}
		</p>

		{#if calledOff}
			<!-- Leads with the outstanding count, because that is the only thing
			     left to do about this shift. -->
			<Alert type="warning">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div>
						<p class="font-medium">
							{toNotify > 0 ? `${toNotify} to notify` : 'Everybody has been notified'}
						</p>
						<p class="text-sm">
							Called off {formatDateShort(shift.cancelledAt!)}{shift.cancelledByName
								? ` by ${shift.cancelledByName}`
								: ''}. Claims and bookings stay on the roster — they are who you need to tell.
						</p>
					</div>
					{#if toNotify > 0}
						<Action
							action={notifyCancelledShift.for(shift.id)}
							label="Notify all"
							variant="warning"
							size="sm"
							modalTitle="Tell everybody this is off?"
							submitLabel="Notify all"
							successToast="Sent. They know."
						>
							{#snippet form()}
								<input type="hidden" name="shiftId" value={shift.id} />
								<p class="text-sm">
									{toNotify}
									{toNotify === 1 ? 'person' : 'people'} still on this shift will be emailed that it is
									off. Anybody you already marked by hand is skipped, and pressing this twice mails nobody
									twice.
								</p>
							{/snippet}
						</Action>
					{/if}
				</div>
			</Alert>
		{/if}

		<div class="grid gap-6 {calledOff ? '' : 'lg:grid-cols-2'}">
			<div class="flex flex-col gap-6">
				<InfoCard title={calledOff ? 'Who to tell' : "Who's on it"}>
					{#snippet header()}
						<div class="flex items-center justify-between gap-2">
							<CardTitle>
								{calledOff ? 'Who to tell' : "Who's on it"} · {claimants.length}
							</CardTitle>
							{#if !calledOff && unconfirmed.length > 1}
								<Action
									action={confirmSignups.for(shift.id)}
									label="Confirm all {unconfirmed.length}"
									variant="ghost"
									size="sm"
									class="text-success"
									modalTitle="Confirm everyone waiting?"
									submitLabel="Confirm all"
									successToast="Confirmed"
								>
									{#snippet form()}
										<input type="hidden" name="shiftId" value={shift.id} />
										{#each unconfirmed as c (c.signupId)}
											<input type="hidden" name="signupIds" value={c.signupId} />
										{/each}
										<p class="text-sm">
											{unconfirmed.map((c) => c.member.title).join(', ')} — all confirmed for this shift.
											Each of them gets a reminder the day before.
										</p>
									{/snippet}
								</Action>
							{/if}
						</div>
					{/snippet}

					{#if claimants.length === 0}
						<EmptyState
							title="Nobody on it yet"
							description="Members interested in this role see it at the top of their list."
						/>
					{:else}
						<ul class="flex flex-col gap-4">
							{#each claimants as claimant (claimant.signupId)}
								<li class="flex flex-col gap-2">
									<div class="flex flex-wrap items-center justify-between gap-3">
										<div class="flex min-w-0 items-center gap-2">
											<EntityIdentity ref={claimant.member} />
											{#if calledOff}
												<span
													class="badge badge-sm {claimant.notifiedAt
														? 'badge-success'
														: 'badge-warning'}"
												>
													{claimant.notifiedAt ? 'notified' : 'not notified'}
												</span>
											{:else}
												<span class="badge badge-sm {statusBadge[claimant.status]}">
													{claimant.status.replace('_', ' ')}
												</span>
											{/if}
										</div>

										<div class="flex shrink-0 gap-1">
											{#if calledOff}
												{#if claimant.notifiedAt}
													<span class="text-sm text-success">✓ Notified</span>
												{:else}
													<!-- The escape hatch beside the mail-out, for staff who
													     rang them. Sends nothing. -->
													<Action
														action={markSignupNotified.for(claimant.signupId)}
														label="Mark as notified"
														variant="ghost"
														size="sm"
														modalTitle="Mark {claimant.member.title} as told?"
														submitLabel="Mark as notified"
														successToast="Marked"
													>
														{#snippet form()}
															<input type="hidden" name="signupId" value={claimant.signupId} />
															<input type="hidden" name="shiftId" value={shift.id} />
															<p class="text-sm">
																Use this when you reached them another way. Nothing is sent — it
																just takes them off the list.
															</p>
														{/snippet}
													</Action>
												{/if}
											{:else}
												{#if claimant.status === 'claimed'}
													<Action
														action={confirmSignup.for(claimant.signupId)}
														label="Confirm"
														iconOnly
														icon={checkIcon}
														variant="ghost"
														size="sm"
														class="text-success"
														modalTitle="Confirm {claimant.member.title}?"
														submitLabel="Confirm"
														successToast="Confirmed"
													>
														{#snippet form()}
															<input type="hidden" name="signupId" value={claimant.signupId} />
															<input type="hidden" name="shiftId" value={shift.id} />
															<p class="text-sm">
																They'll get a reminder the day before. Only confirmed claims
																complete automatically afterwards, so this is what turns a claim
																into a booking.
															</p>
														{/snippet}
													</Action>
												{/if}

												{#if claimant.status === 'claimed' || claimant.status === 'confirmed'}
													<!--
														Notice, not a no-show. Before this the only lever staff had on a
														claimant was No-show, so somebody who rang on Thursday to say they
														couldn't make Saturday either stayed on the roster or got a mark
														against them (docs/reports/volunteer-workflow-findings.md#a2).
													-->
													<Action
														action={releaseSignup.for(claimant.signupId)}
														label="Remove"
														iconOnly
														icon={releaseIcon}
														variant="ghost"
														size="sm"
														modalTitle="Take {claimant.member.title} off this shift?"
														submitLabel="Take them off"
														successToast="Taken off. The place is open again."
													>
														{#snippet form()}
															<input type="hidden" name="signupId" value={claimant.signupId} />
															<input type="hidden" name="shiftId" value={shift.id} />
															<p class="text-sm">
																Their place opens up straight away. Use this when they gave you
																notice — a no-show is for somebody who simply didn't turn up.
															</p>
														{/snippet}
													</Action>
												{/if}

												{#if claimant.status === 'confirmed' || claimant.status === 'completed'}
													<!-- Confirmed people only: a no-show is a mark against
													     somebody who was booked and didn't come, and a claim
													     nobody confirmed was never a booking. -->
													<Action
														action={markSignupNoShow.for(claimant.signupId)}
														label="Mark no-show"
														iconOnly
														icon={noShowIcon}
														variant="ghost"
														size="sm"
														class="text-error"
														modalTitle="Mark {claimant.member.title} as a no-show?"
														submitLabel="No-show"
														submitVariant="error"
														successToast="Marked as no-show"
													>
														{#snippet form()}
															<input type="hidden" name="signupId" value={claimant.signupId} />
															<input type="hidden" name="shiftId" value={shift.id} />
															<p class="text-sm">
																Different from removing them: a removal is notice, a no-show isn't,
																and only one of them is worth remembering next time.
															</p>
														{/snippet}
													</Action>
												{/if}
											{/if}
										</div>
									</div>

									{#if !calledOff && claimant.status === 'claimed'}
										<!-- The state that silently produces nothing, said out loud
										     on the row it applies to. -->
										<p class="border-l-2 border-warning pl-2 text-xs text-warning">
											Unconfirmed: no reminder, no auto-complete.
										</p>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</InfoCard>

				<InfoCard title="Briefing">
					{#if shift.notes}
						<p class="text-sm">{shift.notes}</p>
					{:else}
						<p class="text-subtle text-sm">
							No briefing yet — add one and claimants see it before they commit.
						</p>
					{/if}

					<div class="mt-4 flex flex-wrap gap-2">
						<!--
								Until #a-series a shift could only be created, copied, or called
								off — a wrong time or a missing event meant cancelling and
								starting over, which drops every claim on the floor.
								`updateShift` was written for this and had no caller.
							-->
						<Action
							action={editForm}
							label="Edit"
							variant="ghost"
							size="sm"
							modalTitle="Edit this shift"
							submitLabel="Save"
							successToast="Shift updated. Everyone on it stays on it."
						>
							{#snippet icon()}<IconPencil size={16} />{/snippet}
							{#snippet form()}
								<input type="hidden" name="id" value={shift.id} />
								<!--
										An archived role stays in the list when this shift is already on
										it. Dropping it would leave the select showing nothing selected,
										which posts an empty role and reads as a save that quietly
										reassigned the shift.
									-->
								<ShiftRoleFields
									form={editForm}
									keepId={shift.volunteerRoleId}
									roleId={shift.volunteerRoleId}
									initialEvent={shift.eventId && shift.eventTitle
										? { id: shift.eventId, title: shift.eventTitle }
										: null}
									startsAt={toLocalDateTime(shift.startsAt)}
									endsAt={toLocalDateTime(shift.endsAt)}
									capacity={String(shift.capacity)}
									notes={shift.notes ?? ''}
								/>
							{/snippet}
						</Action>

						{#if !calledOff}
							<Action
								action={cancelShift.for(shift.id)}
								label="Cancel shift"
								variant="ghost"
								size="sm"
								class="text-error"
								modalTitle="Cancel this shift?"
								submitLabel="Cancel shift"
								submitVariant="error"
								successToast="Called off. Tell the people on it."
							>
								{#snippet form()}
									<input type="hidden" name="id" value={shift.id} />
									<p class="text-sm">
										Claims and bookings stay in place — they are who you need to notify. The shift
										stops taking claims.
									</p>
								{/snippet}
							</Action>
						{/if}
					</div>
				</InfoCard>
			</div>

			{#if !calledOff}
				<CandidateColumn shiftId={shift.id} roleName={shift.roleName} startsAt={shift.startsAt} />
			{/if}
		</div>

		<!-- Staffing reads as two numbers wherever it appears: a shift showing
		     "3 of 3" where none of the three is confirmed gets no reminders, never
		     completes, and produces no hours (#a3). -->
		<p class="text-subtle text-sm">
			{booked.length} of {shift.capacity} confirmed{#if unconfirmed.length > 0}
				<Badge variant="warning" size="sm" class="ml-1">
					{unconfirmed.length} unconfirmed
				</Badge>
			{/if}
		</p>

		{#await feedback then responses}
			{#if responses.length > 0}
				<InfoCard title="How it went">
					<ul class="flex flex-col gap-3">
						{#each responses as response (response.signupId)}
							<li class="text-sm">
								<div class="flex items-center gap-2">
									<span class="text-warning" aria-label="{response.rating} out of 5">
										{'★'.repeat(response.rating)}{'☆'.repeat(5 - response.rating)}
									</span>
									{#if !response.wasSetUp}
										<!-- The actionable signal: enjoyment and preparedness pull
										     apart exactly where the briefing needs work. -->
										<Badge variant="warning">wasn't set up</Badge>
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
		{/await}
	</PageContent>
{/await}

{#snippet checkIcon()}
	<IconCheck size={16} />
{/snippet}

{#snippet noShowIcon()}
	<IconUserX size={16} />
{/snippet}

{#snippet releaseIcon()}
	<IconUserMinus size={16} />
{/snippet}
