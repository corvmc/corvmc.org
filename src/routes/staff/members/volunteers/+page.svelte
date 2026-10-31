<script lang="ts">
	/**
	 * Everybody who signed up, as one roster (#1934). The under-18 queue is the
	 * "Awaiting sign-off" status and "who holds this clearance" is a filter: both
	 * were tabs once, over what is the same list of people. Each grant's own
	 * history, and revoking it, is on the person's record.
	 *
	 * Each row carries exactly one action, resolved by what is outstanding — a row
	 * offering Confirm, Chase and Log Hours at once has not decided what it is for.
	 */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import BadgeList from '$lib/components/ui/BadgeList.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Roster from '$lib/components/roster/Roster.svelte';
	import { rosterState } from '$lib/components/roster/roster-state.svelte';
	import RoleOptions from '$lib/components/volunteer/RoleOptions.svelte';
	import LogHoursForMemberAction from '$lib/components/volunteer/LogHoursForMemberAction.svelte';
	import CertificationOptions from '$lib/components/volunteer/CertificationOptions.svelte';
	import MemberRecordPanel from '../[id]/MemberRecordPanel.svelte';
	import MemberViews from '../MemberViews.svelte';
	import { subline, type RosterRow } from './subline';
	import { resolve } from '$app/paths';
	import { oneOf, text } from '$lib/urlState.svelte';
	import { withQuery } from '$lib/utils/with-query';
	import { formatDateShort } from '$lib/utils/format';
	import {
		formatVolunteerHours,
		volunteerProfileStatuses,
		volunteerProfileStatusLabels
	} from '$lib/config';
	import {
		getStaffVolunteers,
		getStaffVolunteerEmails,
		getVolunteerStatusCounts,
		confirmSignup,
		approveVolunteerSignup
	} from '$lib/remote/volunteer.remote';

	type StatusFilter = (typeof volunteerProfileStatuses)[number] | '';

	// Two fits the column at its narrowest without wrapping, and the overflow
	// count carries the rest. Someone with a dozen interests is a fact about them,
	// not a reason for their row to be four lines tall.
	const VISIBLE_ROLES = 2;

	const roster = rosterState(resolve('/staff/members/volunteers'), {
		role: text(),
		status: oneOf<StatusFilter>(['', ...volunteerProfileStatuses], ''),
		cert: text()
	});
	const f = roster.values;

	// Keyed as the URL is, which is what the export and "copy emails" read.
	const active = $derived({
		q: f.q || undefined,
		role: f.role || undefined,
		status: f.status || undefined,
		cert: f.cert || undefined
	});

	const list = $derived(
		getStaffVolunteers({
			search: active.q,
			volunteerRoleId: active.role,
			status: active.status,
			certificationId: active.cert,
			page: f.page
		})
	);

	const recordHref = (row: RosterRow) =>
		withQuery(resolve(`/staff/members/${row.userId}`), 'tab=volunteer');
</script>

{#snippet rowAction(volunteer: RosterRow)}
	<!-- Exactly one, resolved the same way the subline is. A minor awaiting
	     sign-off can do nothing else until it is given. -->
	{#if volunteer.status === 'blocked'}
		<Action
			action={approveVolunteerSignup.for(volunteer.userId)}
			label="Approve"
			variant="ghost"
			size="xs"
			class="text-success"
			modalTitle="Let {volunteer.member.title} volunteer?"
			submitLabel="Approve"
			successToast="{volunteer.member.title} can volunteer now"
			onsuccess={() => void list.refresh()}
		>
			{#snippet form()}
				<input type="hidden" name="userId" value={volunteer.userId} />
				<p class="text-sm">
					Confirms a guardian has signed off. They can claim shifts and log hours from then on, and
					their record still says they are under 18 — which is what changes how a shift is staffed.
				</p>
			{/snippet}
		</Action>
	{:else if volunteer.claim}
		<Action
			action={confirmSignup.for(volunteer.claim.signupId)}
			label="Confirm"
			variant="ghost"
			size="xs"
			class="text-success"
			modalTitle="Confirm {volunteer.member.title}?"
			submitLabel="Confirm"
			successToast="Confirmed"
		>
			{#snippet form()}
				<input type="hidden" name="signupId" value={volunteer.claim!.signupId} />
				<input type="hidden" name="shiftId" value={volunteer.claim!.shiftId} />
				<p class="text-sm">
					{volunteer.claim!.roleName} on {formatDateShort(volunteer.claim!.startsAt)}. Confirming
					books them: they get the reminder the day before, and the shift completes afterwards with
					hours to log.
				</p>
			{/snippet}
		</Action>
	{:else if volunteer.lapse}
		<Button href={recordHref(volunteer)} variant="ghost" size="xs" class="text-warning">
			Chase
		</Button>
	{:else}
		<LogHoursForMemberAction
			presetUser={{ id: volunteer.userId, name: volunteer.member.title }}
			label="Log Hours"
			size="xs"
		/>
	{/if}
{/snippet}

<PageHeader title="Members">
	<LogHoursForMemberAction />
</PageHeader>

<PageContent>
	<MemberViews active="volunteers" />
	<Roster
		{roster}
		result={list}
		empty="No one has signed up to volunteer yet."
		searchPlaceholder="Search volunteers..."
		personLabel="Volunteer"
		exportPath={resolve('/staff/members/volunteers/export')}
		emails={() => getStaffVolunteerEmails(active)}
		tone={(v) => (v.status === 'blocked' ? 'muted' : undefined)}
	>
		{#snippet filters()}
			<Select
				size="sm"
				aria-label="Interested in role"
				value={f.role}
				onchange={(e: Event) => {
					f.role = (e.currentTarget as HTMLSelectElement).value;
					f.page = 1;
				}}
			>
				<option value="">Any role</option>
				<RoleOptions />
			</Select>

			<Select
				size="sm"
				aria-label="Status"
				value={f.status}
				onchange={(e: Event) => {
					f.status = (e.currentTarget as HTMLSelectElement).value as StatusFilter;
					f.page = 1;
				}}
			>
				<option value="">Any status</option>
				<!-- Labels come from the vocabulary, not from here: "blocked" reads as a
				     punishment for answering honestly, and the enum's label already says so. -->
				{#each volunteerProfileStatuses as s (s)}
					<option value={s}>{volunteerProfileStatusLabels[s]}</option>
				{/each}
			</Select>

			<Select
				size="sm"
				aria-label="Clearance"
				value={f.cert}
				onchange={(e: Event) => {
					f.cert = (e.currentTarget as HTMLSelectElement).value;
					f.page = 1;
				}}
			>
				<option value="">Any clearance</option>
				<CertificationOptions />
			</Select>
		{/snippet}

		<!-- The count is a shortcut to the filter: the queue a tab used to hold. -->
		{#snippet summary(total)}
			{total}
			{total === 1 ? 'volunteer' : 'volunteers'}
			{#await list then { minorsWaiting }}
				{#if minorsWaiting > 0 && f.status !== 'blocked'}
					·
					<button
						type="button"
						class="link"
						onclick={() => {
							f.status = 'blocked';
							f.page = 1;
						}}
					>
						{minorsWaiting} awaiting sign-off
					</button>
				{/if}
			{/await}
			{#await getVolunteerStatusCounts() then { pending }}
				{#if pending > 0}
					·
					<a class="link" href={resolve('/staff/members/volunteers/hours')}>
						{pending} hour {pending === 1 ? 'log' : 'logs'} to review
					</a>
				{/if}
			{/await}
		{/snippet}

		{#snippet aside(volunteer)}
			{#if !volunteer.isAdult}
				<!-- Kept after a staff override: an approved minor still changes how a shift is staffed. -->
				<Badge variant="ghost" size="xs">minor</Badge>
			{/if}
		{/snippet}

		{#snippet detail(volunteer)}
			{@const line = subline(volunteer)}
			{#if line}
				<div class="{line.tone} truncate text-xs">{line.text}</div>
			{/if}
		{/snippet}

		{#snippet columns()}
			<th class="col-support">Followed Roles</th>
			<th class="col-support cell-num">Hours</th>
		{/snippet}

		{#snippet cells(volunteer)}
			<td class="col-support">
				{#if volunteer.roleNames.length > 0}
					<BadgeList items={volunteer.roleNames} max={VISIBLE_ROLES} />
				{:else}
					<!-- The interests step is skippable, so this is an answer, not
					     missing data: they signed up without picking anything. -->
					<span class="text-subtle">None picked</span>
				{/if}
			</td>
			<td class="col-support cell-num">
				{#if volunteer.minutes > 0}
					{formatVolunteerHours(volunteer.minutes)}
				{:else}
					<span class="text-subtle">—</span>
				{/if}
			</td>
		{/snippet}

		{#snippet actions(volunteer)}
			{@render rowAction(volunteer)}
		{/snippet}

		{#snippet panel(volunteer, ctl)}
			<MemberRecordPanel
				id={volunteer.personId}
				name={volunteer.member.title}
				tab="volunteer"
				bind:open={ctl.open}
			/>
		{/snippet}
	</Roster>
</PageContent>
