<script lang="ts">
	import CardTitle from '$lib/components/shared/Card/CardTitle.svelte';
	import {
		getUserVolunteerProfile,
		getUserShifts,
		getUserHourLogs,
		getMemberCertifications,
		getActiveCertifications,
		grantCertification,
		revokeCertification
	} from '$lib/remote/volunteer.remote';
	import { getUserOverview } from '$lib/remote/users.remote';
	import { RelatedList } from '$lib/components/shared/entity';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import Alert from '$lib/components/shared/Alert.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import DefinitionList from '$lib/components/shared/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/shared/DefinitionList/Fact.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { clubToday, formatVolunteerHours } from '$lib/config';
	import { formatDateShortYear } from '$lib/utils/format';

	let { id }: { id: string } = $props();

	// The scoreboard and the needs-attention list read off the overview query, so
	// granting or revoking has to invalidate it as well as the card's own data —
	// otherwise the badge keeps claiming an expired clearance that just went.
	function refreshCertifications() {
		void getMemberCertifications(id).refresh();
		void getUserOverview(id).refresh();
	}
</script>

<RelatedList title="Volunteer profile" result={getUserVolunteerProfile(id)}>
	{#snippet children(data)}
		{#if !data.profile}
			<EmptyState
				title="Not a volunteer"
				description="This member has never completed volunteer onboarding."
			/>
		{:else}
			{#if data.profile.status === 'blocked'}
				<Alert type="warning" class="mb-3">
					Signup is blocked. An under-18 volunteer stays blocked until staff record guardian
					approval.
				</Alert>
			{/if}
			<DefinitionList>
				<Fact label="Name on file">{data.profile.firstName} {data.profile.lastName}</Fact>

				<Fact label="Status"><StatusBadge status={data.profile.status} label /></Fact>

				<Fact label="Age">{data.profile.isAdult ? 'Adult' : 'Under 18'}</Fact>

				<Fact label="Hours">
					{formatVolunteerHours(data.summary.approvedMinutes)} approved ·
					{formatVolunteerHours(data.summary.approvedMinutesThisYear)} this year
					{#if data.summary.pendingMinutes > 0}
						· <span class="text-warning"
							>{formatVolunteerHours(data.summary.pendingMinutes)} pending</span
						>
					{/if}
				</Fact>

				<Fact label="Interested in" class="flex flex-wrap gap-1">
					{#each data.interests as i (i.roleId)}
						<a href={resolve(`/staff/volunteer/roles/${i.roleId}`)}>
							<Badge size="sm">{i.roleName}</Badge>
						</a>
					{:else}
						<span class="opacity-60">No roles picked</span>
					{/each}
				</Fact>
			</DefinitionList>
		{/if}
	{/snippet}
</RelatedList>

<!--
	Clearances. Revoke rather than delete is the normal way to end one: the
	window it covered stays answerable, which is the entire reason the table is
	append-only. A renewal is a second Grant, not an edit.

	These Actions used to sit inside the page-level profile <Form>, where their
	triggers were type=submit and each click saved the account.
-->
{#await Promise.all([getMemberCertifications(id), getActiveCertifications()]) then [held, catalog]}
	<InfoCard title="Certifications">
		{#snippet header(title: string)}
			<div class="flex items-center justify-between gap-2">
				<CardTitle>{title}</CardTitle>
				{#if catalog.length > 0}
					<Action
						action={grantCertification}
						label="Grant"
						variant="default"
						size="sm"
						modalTitle="Grant a certification"
						submitLabel="Grant"
						successToast="Certification granted"
						onsuccess={refreshCertifications}
					>
						{#snippet form()}
							<input type="hidden" name="userId" value={id} />
							<FormField
								name="certificationId"
								label="Certification"
								type="select"
								options={catalog.map((c) => ({ value: c.id, label: c.name }))}
							/>
							<FormField
								name="grantedOn"
								label="Granted on"
								type="date"
								value={clubToday()}
								max={clubToday()}
								description="Expiry is worked out from this date and locked in now — later edits to the catalog won't move it."
							/>
							<FormField
								name="reference"
								label="Card or licence number"
								type="text"
								description="For an external card. Leave blank for a CMC clearance."
							/>
							<FormField name="notes" label="Notes" type="textarea" />
						{/snippet}
					</Action>
				{/if}
			</div>
		{/snippet}

		{#if held.length === 0}
			<EmptyState title="Nothing on record" description="No clearances granted to this member." />
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
								Granted {formatDateShortYear(record.grantedAt)}{record.grantedByName
									? ` by ${record.grantedByName}`
									: ''}{record.expiresAt
									? ` · expires ${formatDateShortYear(record.expiresAt)}`
									: ' · no expiry'}
							</div>
							{#if record.reference}
								<div class="text-subtle">#{record.reference}</div>
							{/if}
							{#if record.revokedReason}
								<div class="text-xs text-error">Revoked: {record.revokedReason}</div>
							{/if}
						</div>

						{#if !record.revokedAt}
							<Action
								action={revokeCertification.for(record.id)}
								label="Revoke"
								variant="ghost"
								size="xs"
								class="text-error"
								modalTitle="Revoke {record.certificationName}?"
								submitLabel="Revoke"
								submitVariant="error"
								successToast="Certification revoked"
								onsuccess={refreshCertifications}
							>
								{#snippet form()}
									<input type="hidden" name="id" value={record.id} />
									<input type="hidden" name="userId" value={id} />
									<p class="text-sm">
										The record stays — the period it covered is history. They lose it from today, so
										shifts they already worked still read as cleared.
									</p>
									<FormField
										name="reason"
										label="Why"
										type="textarea"
										description="Shown to staff on this page. Most reasons are blameless — a replaced desk, an expired card, a change of duties."
									/>
								{/snippet}
							</Action>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</InfoCard>
{/await}

<RelatedList title="Shifts" result={getUserShifts(id)}>
	{#snippet children(shifts)}
		{#if shifts.length === 0}
			<EmptyState
				title="No shifts"
				description="This member has never claimed a volunteer shift."
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Role</th>
					<th class="col-extra">Date</th>
				{/snippet}
				{#each shifts as s (s.signupId)}
					<tr class="hover" use:rowLink={resolve(`/staff/volunteer/shifts/${s.shiftId}`)}>
						<td class="w-px"><StatusBadge status={s.status} /></td>
						<td class="cell-primary">
							<a class="font-medium" href={resolve(`/staff/volunteer/shifts/${s.shiftId}`)}>
								{s.roleName}
							</a>
							{#if s.shiftCancelledAt}
								<div class="text-muted">Shift was cancelled</div>
							{/if}
						</td>
						<td class="col-extra whitespace-nowrap">{formatDateShortYear(s.startsAt)}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/snippet}
</RelatedList>

<RelatedList title="Hour logs" result={getUserHourLogs(id)}>
	{#snippet children(logs)}
		{#if logs.length === 0}
			<EmptyState title="No hours logged" description="This member has never submitted hours." />
		{:else}
			{#if logs.length > 10}
				<p class="mb-3 text-muted">Showing the 10 most recent of {logs.length}.</p>
			{/if}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Role</th>
					<th class="cell-num">Hours</th>
					<th class="col-extra">Worked</th>
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
