<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import GrantCertificationAction from './GrantCertificationAction.svelte';
	import {
		getUserVolunteerProfile,
		getUserShifts,
		getUserHourLogs,
		getMemberCertifications,
		revokeCertification
	} from '$lib/remote/volunteer.remote';
	import { getUserPage } from '$lib/remote/users.remote';
	import { RelatedList } from '$lib/components/ui/entity';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { formatVolunteerHours } from '$lib/config';
	import { formatDateShortYear } from '$lib/utils/format';
	import { Latest } from '$lib/latest.svelte';

	let { id }: { id: string } = $props();

	// The scoreboard and the needs-attention list read off the overview query, so
	// granting or revoking has to invalidate it as well as the card's own data —
	// otherwise the badge keeps claiming an expired clearance that just went.
	function refreshCertifications() {
		void getMemberCertifications(id).refresh();
		void getUserPage(id).refresh();
	}

	// Not `{#await}`: a refresh would re-pend it and unmount an open Grant or
	// Revoke modal (#2356).
	const certifications = new Latest(() => getMemberCertifications(id));
	$effect(() => {
		if (certifications.error) throw certifications.error.e;
	});
</script>

<RelatedList
	title={m.staff_members_id_panels_volunteer_panel_volunteer_profile()}
	result={getUserVolunteerProfile(id)}
>
	{#snippet children(data)}
		{#if !data.profile}
			<EmptyState
				title={m.staff_members_id_panels_volunteer_panel_not_volunteer()}
				description={m.staff_members_id_panels_volunteer_panel_member_has_never_com()}
			/>
		{:else}
			{#if data.profile.status === 'blocked'}
				<Alert type="warning" class="mb-3">
					{m.staff_members_id_panels_volunteer_panel_signup_blocked_under()}
				</Alert>
			{/if}
			<DefinitionList>
				<Fact label={m.staff_members_id_panels_volunteer_panel_name_file()}
					>{data.profile.firstName} {data.profile.lastName}</Fact
				>

				<Fact label={m.staff_status()}><StatusBadge status={data.profile.status} label /></Fact>

				<Fact label={m.staff_members_id_panels_volunteer_panel_age()}
					>{data.profile.isAdult
						? m.staff_members_id_panels_volunteer_panel_adult()
						: m.staff_members_id_panels_volunteer_panel_under_18()}</Fact
				>

				<Fact label={m.staff_hours()}>
					{m.staff_members_id_panels_volunteer_panel_approved_year({
						formatVolunteerHours: formatVolunteerHours(data.summary.approvedMinutes),
						formatVolunteerHours2: formatVolunteerHours(data.summary.approvedMinutesThisYear)
					})}
					{#if data.summary.pendingMinutes > 0}
						· <span class="text-warning"
							>{m.staff_members_id_panels_volunteer_panel_pending({
								formatVolunteerHours: formatVolunteerHours(data.summary.pendingMinutes)
							})}</span
						>
					{/if}
				</Fact>

				<!--
					Written on the member's own interests form and, until now, read back only
					into that same form (docs/reports/volunteer-workflow-findings.md#a6).
					Always rendered, never hidden when unset: "they didn't say" and "this page
					doesn't track that" have to look different.
				-->
				<Fact label={m.staff_when_they_can_help()}>
					{#if data.profile.availability}
						{data.profile.availability}
					{:else}
						<span class="text-muted">{m.staff_members_id_panels_volunteer_panel_not_given()}</span>
					{/if}
				</Fact>

				<Fact
					label={m.staff_members_id_panels_volunteer_panel_interested()}
					class="flex flex-wrap gap-1"
				>
					{#each data.interests as i (i.roleId)}
						<a href={resolve(`/staff/volunteer/roles/${i.roleId}`)}>
							<Badge size="sm">{i.roleName}</Badge>
						</a>
					{:else}
						<span class="opacity-60"
							>{m.staff_members_id_panels_volunteer_panel_no_roles_picked()}</span
						>
					{/each}
				</Fact>
			</DefinitionList>
		{/if}
	{/snippet}
</RelatedList>

<!--
	Clearances. Revoke rather than delete is the normal way to end one: the
	window it covered stays answerable, which is the entire reason the table is
	append-only. A renewal is a second Grant, not an edit. Keep these Actions
	outside the profile <Form>: inside it their triggers submit the account.
-->
{#if certifications.current}
	{@const held = certifications.current}
	<InfoCard title={m.staff_members_id_panels_volunteer_panel_certifications()}>
		{#snippet header(title: string)}
			<div class="flex items-center justify-between gap-2">
				<CardTitle>{title}</CardTitle>
				<GrantCertificationAction userId={id} onsuccess={refreshCertifications} />
			</div>
		{/snippet}

		{#if held.length === 0}
			<EmptyState
				title={m.staff_members_id_panels_volunteer_panel_nothing_record()}
				description={m.staff_members_id_panels_volunteer_panel_no_clearances_grante()}
			/>
		{:else}
			<ul class="flex flex-col gap-3">
				{#each held as record (record.id)}
					<li class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<span class="font-medium">{record.certificationName}</span>
								<StatusBadge status={record.state} label />
							</div>
							<div class="text-subtle">
								{m.staff_clearance_granted({
									date: formatDateShortYear(record.grantedAt)
								})}{#if record.grantedByName}{m.staff_clearance_granted_by({
										name: record.grantedByName
									})}{/if}{record.expiresAt
									? m.staff_clearance_expires({ date: formatDateShortYear(record.expiresAt) })
									: m.staff_clearance_no_expiry()}
							</div>
							{#if record.reference}
								<div class="text-subtle">#{record.reference}</div>
							{/if}
							{#if record.revokedReason}
								<div class="text-xs text-error">
									{m.staff_members_id_panels_volunteer_panel_revoked({
										revokedReason: record.revokedReason
									})}
								</div>
							{/if}
						</div>

						{#if !record.revokedAt}
							<Action
								action={revokeCertification.for(record.id)}
								label={m.staff_revoke()}
								variant="ghost"
								size="xs"
								class="text-error"
								modalTitle={m.staff_members_id_panels_volunteer_panel_modal_title({
									certificationName: record.certificationName
								})}
								submitLabel={m.staff_revoke()}
								submitVariant="error"
								successToast={m.staff_members_id_panels_volunteer_panel_success_toast()}
								onsuccess={refreshCertifications}
							>
								{#snippet form()}
									<input type="hidden" name="id" value={record.id} />
									<input type="hidden" name="userId" value={id} />
									<p class="text-sm">
										{m.staff_members_id_panels_volunteer_panel_record_stays_period()}
									</p>
									<FormField
										name="reason"
										label={m.staff_why()}
										type="textarea"
										description={m.staff_members_id_panels_volunteer_panel_shown_staff_page_mos()}
									/>
								{/snippet}
							</Action>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</InfoCard>
{/if}

<RelatedList title={m.staff_members_id_panels_volunteer_panel_shifts()} result={getUserShifts(id)}>
	{#snippet children(shifts)}
		{#if shifts.length === 0}
			<EmptyState
				title={m.staff_members_id_panels_volunteer_panel_no_shifts()}
				description={m.staff_members_id_panels_volunteer_panel_member_has_never_cla()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
					<th>{m.staff_role()}</th>
					<th class="col-extra">{m.staff_date()}</th>
				{/snippet}
				{#each shifts as s (s.signupId)}
					<tr class="hover" use:rowLink={resolve(`/staff/volunteer/shifts/${s.shiftId}`)}>
						<td class="w-px"><StatusBadge status={s.status} /></td>
						<td class="cell-primary">
							<a class="font-medium" href={resolve(`/staff/volunteer/shifts/${s.shiftId}`)}>
								{s.roleName}
							</a>
							{#if s.shiftCancelledAt}
								<div class="text-muted">
									{m.staff_members_id_panels_volunteer_panel_shift_was_cancelled()}
								</div>
							{/if}
						</td>
						<td class="col-extra whitespace-nowrap">
							{s.startsAt
								? formatDateShortYear(s.startsAt)
								: m.staff_members_id_panels_volunteer_panel_unscheduled()}
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/snippet}
</RelatedList>

<RelatedList
	title={m.staff_members_id_panels_volunteer_panel_hour_logs()}
	result={getUserHourLogs(id)}
>
	{#snippet children(logs)}
		{#if logs.length === 0}
			<EmptyState
				title={m.staff_members_id_panels_volunteer_panel_no_hours_logged()}
				description={m.staff_members_id_panels_volunteer_panel_member_has_never_sub()}
			/>
		{:else}
			{#if logs.length > 10}
				<p class="mb-3 text-muted">
					{m.staff_members_id_panels_volunteer_panel_showing_10_most_rece({ length: logs.length })}
				</p>
			{/if}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
					<th>{m.staff_role()}</th>
					<th class="cell-num">{m.staff_hours()}</th>
					<th class="col-extra">{m.staff_worked()}</th>
				{/snippet}
				{#each logs.slice(0, 10) as log (log.id)}
					<tr class="hover">
						<td class="w-px"><StatusBadge status={log.status} /></td>
						<td class="cell-primary">
							<div class="font-medium">{log.roleName}</div>
							<div class="text-muted">{log.description}</div>
						</td>
						<td class="cell-num">{formatVolunteerHours(log.minutes)}</td>
						<td class="col-extra whitespace-nowrap">{formatDateShortYear(log.workedOn)}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/snippet}
</RelatedList>
