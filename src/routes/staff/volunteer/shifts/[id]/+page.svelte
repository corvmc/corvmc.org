<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import Action from '$lib/components/ui/Action.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import ShiftRoleFields from '$lib/components/volunteer/ShiftRoleFields.svelte';
	import AddVolunteerAction from './AddVolunteerAction.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
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
		direct child of a block, and both the header and the two cards below read them.
	-->
	{@const unconfirmed = claimants.filter((c) => c.status === 'claimed')}
	{@const booked = claimants.filter((c) => c.status === 'confirmed' || c.status === 'completed')}
	<PageHeader
		title={shift.startsAt ? formatDateShortYear(shift.startsAt) : 'Unscheduled'}
		subtitle={shift.startsAt ? 'Shift' : 'Work order'}
		backHref="/staff/volunteer/shifts"
	>
		{#if !shift.cancelledAt}
			<AddVolunteerAction
				shiftId={shift.id}
				volunteerRoleId={shift.volunteerRoleId}
				roleName={shift.roleName}
				startsAt={shift.startsAt}
				label="Add someone"
				iconOnly={false}
			/>

			<!--
					Until now a shift could only be created, copied, or called off —
					a wrong time or a missing event meant cancelling and starting over,
					which drops every claim on the floor. `updateShift` was written for
					this and had no caller.
				-->
			{@const editForm = updateShift.for(shift.id)}
			<Action
				action={editForm}
				label="Edit"
				variant="ghost"
				size="sm"
				modalTitle="Edit this shift"
				submitLabel="Save"
				successToast="Shift updated"
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
						startsAt={shift.startsAt ? toLocalDateTime(shift.startsAt) : ''}
						endsAt={shift.endsAt ? toLocalDateTime(shift.endsAt) : ''}
						capacity={String(shift.capacity)}
						notes={shift.notes ?? ''}
					/>
				{/snippet}
			</Action>

			<Action
				action={cancelShift.for(shift.id)}
				label="Call it off"
				variant="ghost"
				size="sm"
				class="text-error"
				modalTitle="Cancel this shift?"
				submitLabel="Cancel shift"
				submitVariant="error"
				successToast="Shift cancelled"
			>
				{#snippet form()}
					<input type="hidden" name="id" value={shift.id} />
					<p class="text-sm">
						{claimants.length}
						{claimants.length === 1 ? 'person has' : 'people have'} claimed this. The shift and its claims
						stay on record so you can still see what was called off.
					</p>
				{/snippet}
			</Action>
		{/if}
	</PageHeader>

	<PageContent width="3xl">
		<InfoCard
			title={shift.cancelledAt ? 'Cancelled shift' : shift.startsAt ? 'Shift' : 'Work order'}
		>
			<DefinitionList>
				<Fact label="When"
					>{#if shift.startsAt && shift.endsAt}{formatDateShort(shift.startsAt)}, {timeRange(
							shift.startsAt,
							shift.endsAt
						)}{:else}Not scheduled yet{/if}</Fact
				>
				<Fact label="Role">{shift.roleName}</Fact>
				<!--
					Always shown, never hidden when unset — the same reasoning as the
					event page's Space Reservation card. "Not tied to an event" and
					"this page doesn't track that" have to look different.
				-->
				<Fact label="Event">
					{#if shift.eventId && shift.eventTitle}
						<a href={resolve(`/staff/events/${shift.eventId}`)} class="link link-primary">
							{shift.eventTitle}
						</a>
					{:else}
						<span class="text-muted">Not tied to an event</span>
					{/if}
				</Fact>
				<!--
					Two numbers, because "filled" was doing work it had not earned: a shift
					reading "3 of 3 filled" where none of the three was confirmed gets no
					reminders, never completes, and produces no hours
					(docs/reports/volunteer-workflow-findings.md#a3).
				-->
				<Fact label="Confirmed">
					{booked.length} of {shift.capacity}
					{#if unconfirmed.length > 0}
						<Badge variant="warning" size="sm" class="ml-1">
							{unconfirmed.length} unconfirmed
						</Badge>
					{/if}
				</Fact>
				{#if shift.notes}
					<Fact label="Notes">{shift.notes}</Fact>
				{/if}
			</DefinitionList>
		</InfoCard>

		<InfoCard title="Who's on it">
			{#snippet header(title)}
				<div class="flex items-center justify-between gap-2">
					<CardTitle>{title}</CardTitle>
					{#if unconfirmed.length > 1}
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
					title="Nobody yet"
					description="Members interested in this role see it at the top of their list."
				/>
			{:else}
				<ul class="flex flex-col gap-3">
					{#each claimants as claimant (claimant.signupId)}
						<li class="flex flex-wrap items-center justify-between gap-3">
							<div class="flex min-w-0 items-center gap-2">
								<EntityIdentity ref={claimant.member} />
								<span class="badge badge-sm {statusBadge[claimant.status]}">
									{claimant.status.replace('_', ' ')}
								</span>
							</div>

							<div class="flex shrink-0 gap-1">
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
												They'll get a reminder the day before. Only confirmed claims complete
												automatically afterwards, so this is what turns a claim into a booking.
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
										label="Take off the shift"
										iconOnly
										icon={releaseIcon}
										variant="ghost"
										size="sm"
										modalTitle="Take {claimant.member.title} off this shift?"
										submitLabel="Take them off"
										successToast="Place reopened"
									>
										{#snippet form()}
											<input type="hidden" name="signupId" value={claimant.signupId} />
											<input type="hidden" name="shiftId" value={shift.id} />
											<p class="text-sm">
												Their place opens up straight away. Use this when they gave you notice — a
												no-show is for somebody who simply didn't turn up.
											</p>
										{/snippet}
									</Action>
								{/if}

								{#if claimant.status !== 'no_show'}
									<Action
										action={markSignupNoShow.for(claimant.signupId)}
										label="No-show"
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
												Different from cancelling: a cancellation is notice, a no-show isn't, and
												only one of them is worth remembering next time.
											</p>
										{/snippet}
									</Action>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</InfoCard>
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
