<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
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
			label={m.staff_approve()}
			data-testid="approve-volunteer-signup"
			variant="ghost"
			size="xs"
			class="text-success"
			modalTitle={m.staff_members_volunteers_let_volunteer({ title: volunteer.member.title })}
			submitLabel={m.staff_approve()}
			successToast={m.staff_members_volunteers_can_volunteer_now({ title: volunteer.member.title })}
			onsuccess={() => void list.refresh()}
		>
			{#snippet form()}
				<input type="hidden" name="userId" value={volunteer.userId} />
				<p class="text-sm">
					{m.staff_members_volunteers_confirms_guardian_has_signed_off()}
				</p>
			{/snippet}
		</Action>
	{:else if volunteer.claim}
		<Action
			action={confirmSignup.for(volunteer.claim.signupId)}
			label={m.staff_confirm()}
			variant="ghost"
			size="xs"
			class="text-success"
			modalTitle={m.staff_confirm_2({ title: volunteer.member.title })}
			submitLabel={m.staff_confirm()}
			successToast={m.staff_confirmed()}
		>
			{#snippet form()}
				<input type="hidden" name="signupId" value={volunteer.claim!.signupId} />
				<input type="hidden" name="shiftId" value={volunteer.claim!.shiftId} />
				<p class="text-sm">
					{m.staff_members_volunteers_confirming_books_them_they_get({
						roleName: volunteer.claim!.roleName,
						formatDateShort: formatDateShort(volunteer.claim!.startsAt)
					})}
				</p>
			{/snippet}
		</Action>
	{:else if volunteer.lapse}
		<Button href={recordHref(volunteer)} variant="ghost" size="xs" class="text-warning">
			{m.staff_members_volunteers_chase()}
		</Button>
	{:else}
		<LogHoursForMemberAction
			presetUser={{ id: volunteer.userId, name: volunteer.member.title }}
			label={m.staff_members_volunteers_log_hours()}
			size="xs"
		/>
	{/if}
{/snippet}

<PageHeader title={m.staff_members()}>
	<LogHoursForMemberAction />
</PageHeader>

<PageContent>
	<MemberViews active="volunteers" />
	<Roster
		{roster}
		result={list}
		empty={m.staff_members_volunteers_empty()}
		searchPlaceholder={m.staff_members_volunteers_search_placeholder()}
		personLabel={m.staff_members_volunteers_person_label()}
		exportPath={resolve('/staff/members/volunteers/export')}
		emails={() => getStaffVolunteerEmails(active)}
		tone={(v) => (v.status === 'blocked' ? 'muted' : undefined)}
	>
		{#snippet filters()}
			<Select
				size="sm"
				aria-label={m.staff_members_volunteers_interested_role()}
				value={f.role}
				onchange={(e: Event) => {
					f.role = (e.currentTarget as HTMLSelectElement).value;
					f.page = 1;
				}}
			>
				<option value="">{m.staff_members_volunteers_any_role()}</option>
				<RoleOptions />
			</Select>

			<Select
				size="sm"
				aria-label={m.staff_status()}
				value={f.status}
				onchange={(e: Event) => {
					f.status = (e.currentTarget as HTMLSelectElement).value as StatusFilter;
					f.page = 1;
				}}
			>
				<option value="">{m.staff_members_volunteers_any_status()}</option>
				<!-- Labels come from the vocabulary, not from here: "blocked" reads as a
				     punishment for answering honestly, and the enum's label already says so. -->
				{#each volunteerProfileStatuses as s (s)}
					<option value={s}>{volunteerProfileStatusLabels[s]}</option>
				{/each}
			</Select>

			<Select
				size="sm"
				aria-label={m.staff_clearance()}
				value={f.cert}
				onchange={(e: Event) => {
					f.cert = (e.currentTarget as HTMLSelectElement).value;
					f.page = 1;
				}}
			>
				<option value="">{m.staff_members_volunteers_any_clearance()}</option>
				<CertificationOptions />
			</Select>
		{/snippet}

		<!-- The count is a shortcut to the filter: the queue a tab used to hold. -->
		{#snippet summary(total)}
			{total}
			{total === 1
				? m.staff_members_volunteers_volunteer()
				: m.staff_members_volunteers_volunteers()}
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
						{m.staff_members_volunteers_awaiting_sign_off({ minorsWaiting })}
					</button>
				{/if}
			{/await}
			{#await getVolunteerStatusCounts() then { pending }}
				{#if pending > 0}
					<ParaglideMessage
						message={m.staff_members_volunteers_hour_logs_review}
						inputs={{ pending }}
						>{#snippet a({ children })}<a
								class="link"
								href={resolve('/staff/members/volunteers/hours')}>{@render children?.()}</a
							>{/snippet}</ParaglideMessage
					>
				{/if}
			{/await}
		{/snippet}

		{#snippet aside(volunteer)}
			{#if !volunteer.isAdult}
				<!-- Kept after a staff override: an approved minor still changes how a shift is staffed. -->
				<Badge variant="ghost" size="xs">{m.staff_members_volunteers_minor()}</Badge>
			{/if}
		{/snippet}

		{#snippet detail(volunteer)}
			{@const line = subline(volunteer)}
			{#if line}
				<div class="{line.tone} truncate text-xs">{line.text}</div>
			{/if}
		{/snippet}

		{#snippet columns()}
			<th class="col-support">{m.staff_members_volunteers_followed_roles()}</th>
			<th class="col-support cell-num">{m.staff_hours()}</th>
		{/snippet}

		{#snippet cells(volunteer)}
			<td class="col-support">
				{#if volunteer.roleNames.length > 0}
					<BadgeList items={volunteer.roleNames} max={VISIBLE_ROLES} />
				{:else}
					<!-- The interests step is skippable, so this is an answer, not
					     missing data: they signed up without picking anything. -->
					<span class="text-subtle">{m.staff_members_volunteers_none_picked()}</span>
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
