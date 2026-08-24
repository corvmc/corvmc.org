<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import Action from '$lib/components/shared/Action.svelte';
	import DefinitionList from '$lib/components/shared/DefinitionList/DefinitionList.svelte';
	import ShiftFormFields from '$lib/components/shared/volunteer/ShiftFormFields.svelte';
	import Fact from '$lib/components/shared/DefinitionList/Fact.svelte';
	import { formatDateShort, formatDateShortYear, toLocalDateTime } from '$lib/utils/format';
	import { DEFAULT_TIMEZONE } from '$lib/config';
	import { resolve } from '$app/paths';
	import { IconCheck, IconUserX, IconPencil } from '@tabler/icons-svelte';
	import {
		getShift,
		getShiftFeedback,
		confirmSignup,
		markSignupNoShow,
		cancelShift,
		updateShift,
		getVolunteerRoles
	} from '$lib/remote/volunteer.remote';

	let id = $derived(page.params.id!);
	let data = $derived(getShift(id));
	let feedback = $derived(getShiftFeedback(id));
	let roles = $derived(getVolunteerRoles());

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
	<PageHeader
		title={formatDateShortYear(shift.startsAt)}
		subtitle="Shift"
		backHref="/staff/volunteer/shifts"
	>
		{#if !shift.cancelledAt}
			{#await roles then roleOptions}
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
						<ShiftFormFields
							form={editForm}
							roles={roleOptions.filter((r) => r.isActive || r.id === shift.volunteerRoleId)}
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
			{/await}

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
		<InfoCard title={shift.cancelledAt ? 'Cancelled shift' : 'Shift'}>
			<DefinitionList>
				<Fact label="When"
					>{formatDateShort(shift.startsAt)}, {timeRange(shift.startsAt, shift.endsAt)}</Fact
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
				<Fact label="Needed">
					{claimants.filter((c) => c.status !== 'no_show').length} of {shift.capacity} filled
				</Fact>
				{#if shift.notes}
					<Fact label="Notes">{shift.notes}</Fact>
				{/if}
			</DefinitionList>
		</InfoCard>

		<InfoCard title="Who's on it">
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
										<span class="badge badge-warning badge-sm">wasn't set up</span>
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
