<script lang="ts">
	import { m as msg } from '$lib/paraglide/messages.js';
	import type { Snippet } from 'svelte';
	import { getBandHistory, getStaffBandPage, updateMemberRole } from '$lib/remote/bands.remote';
	import { ActivityFeedCard, feedItemRow } from '$lib/components/ui/ActivityFeed';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { formatDateShort, formatTimeRange } from '$lib/utils/format';
	import {
		InviteByEmailAction,
		InviteMemberAction,
		RevokeInviteAction,
		TransferOwnershipAction,
		RemoveBandMemberAction,
		RevokeEmailInviteAction
	} from '$lib/components/actions';
	import RosterTable from '$lib/components/roster/RosterTable.svelte';
	import CopyEmailsButton from '$lib/components/roster/CopyEmailsButton.svelte';
	import StaffBandForm from './StaffBandForm.svelte';

	/** A band's staff record: the page at /staff/groups/[id], and the Bands view's side panel. */
	let {
		id,
		variant = 'page',
		actions
	}: { id: string; variant?: 'page' | 'panel'; actions?: Snippet } = $props();

	const data = $derived(await getStaffBandPage(id));
	const band = $derived(data.band);
	const members = $derived(data.members);
	const reservations = $derived(data.reservations);
	const emailInvites = $derived(data.emailInvites);
</script>

<!-- The band info form lives in a fully synchronous component: a top-level
     await here marks later declarations "blocked", compiling its bind:value /
     fields expressions into async deriveds — the churn behind the
     effect_update_depth_exceeded crash (same bug as /member/profile). -->
<StaffBandForm {band} {id} {variant} {actions} />

{#snippet body()}
	<InfoCard title={msg.staff_members()}>
		{#snippet header(title)}
			<header class="flex items-center justify-between">
				<CardTitle>{title}</CardTitle>
				<div class="flex gap-2">
					{#if members.length > 0}<CopyEmailsButton emails={members.map((m) => m.email)} />{/if}
					<InviteByEmailAction bandId={id} />
					<InviteMemberAction bandId={id} />
				</div>
			</header>
		{/snippet}
		{#if members.length === 0}
			<EmptyState description={msg.staff_groups_id_band_record_no_members()} />
		{:else}
			<RosterTable rows={members} personLabel={msg.staff_member()}>
				{#snippet lead(m)}<StatusBadge status={m.status} />{/snippet}
				{#snippet columns()}
					<th class="w-px">{msg.staff_role()}</th>
					<th class="col-extra whitespace-nowrap">{msg.staff_joined()}</th>
				{/snippet}
				{#snippet cells(m)}
					<td class="w-px">
						{#if m.role !== 'owner' && m.status === 'active'}
							{@const rf = updateMemberRole.for(m.id)}
							<Form remote={rf} successToast={msg.staff_groups_id_band_record_success_toast()}>
								<input {...rf.fields.memberId.as('hidden', m.id)} />
								<Select
									class="select-xs"
									name="role"
									aria-label={msg.staff_groups_id_band_record_aria_label({ title: m.member.title })}
									value={m.role}
									onchange={(e: Event) =>
										(e.currentTarget as HTMLSelectElement).form?.requestSubmit()}
								>
									<option value="member">{msg.staff_member()}</option>
									<option value="admin">{msg.staff_groups_id_band_record_admin()}</option>
								</Select>
							</Form>
						{:else}
							<Badge size="sm" variant="outline">{m.role}</Badge>
						{/if}
					</td>
					<td class="col-extra whitespace-nowrap">{formatDateShort(m.createdAt)}</td>
				{/snippet}
				{#snippet actions(m)}
					{#if m.role !== 'owner'}
						<div class="flex w-max justify-end gap-1">
							{#if m.status === 'pending'}
								<RevokeInviteAction memberId={m.id} name={m.member.title} />
							{/if}
							{#if m.status === 'active'}
								<TransferOwnershipAction bandId={id} newOwnerId={m.userId} name={m.member.title} />
							{/if}
							<RemoveBandMemberAction memberId={m.id} name={m.member.title} />
						</div>
					{/if}
				{/snippet}
			</RosterTable>
		{/if}
	</InfoCard>

	<!-- Email invites — sent to an address with no account behind it -->
	{#if emailInvites.filter((i) => i.status === 'pending').length > 0}
		<InfoCard title={msg.staff_groups_id_band_record_awaiting_signup()}>
			<Table>
				{#snippet head()}
					<th>{msg.staff_groups_id_band_record_invitee()}</th>
					<th class="w-px">{msg.staff_role()}</th>
					<th class="col-extra">{msg.staff_groups_id_band_record_invited_by()}</th>
					<th class="w-px"><span class="sr-only">{msg.staff_actions()}</span></th>
				{/snippet}
				{#each emailInvites.filter((i) => i.status === 'pending') as inv (inv.id)}
					<tr class="hover">
						<td class="cell-primary">
							<div class="truncate font-medium">{inv.email}</div>
							{#if inv.position}
								<div class="truncate text-muted">{inv.position}</div>
							{/if}
						</td>
						<td class="w-px"><Badge size="sm" variant="outline">{inv.role}</Badge></td>
						<td class="col-extra cell-text truncate">{inv.invitedByName}</td>
						<td class="w-px">
							<RevokeEmailInviteAction inviteId={inv.id} email={inv.email} />
						</td>
					</tr>
				{/each}
			</Table>
		</InfoCard>
	{/if}

	<InfoCard title={msg.staff_groups_id_band_record_recent_reservations()}>
		{#if reservations.length === 0}
			<EmptyState description={msg.staff_groups_id_band_record_no_reservations()} />
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{msg.staff_status()}</span></th>
					<th>{msg.staff_reservation()}</th>
					<th class="col-support">{msg.staff_booked_by()}</th>
					<th class="col-extra">{msg.staff_notes()}</th>
				{/snippet}
				{#each reservations as r (r.id)}
					{@const href = resolve(`/staff/reservations/${r.id}`)}
					<tr class="hover cursor-pointer" use:rowLink={href}>
						<td class="w-px"><StatusBadge status={r.status} /></td>
						<td class="cell-primary">
							<a {href} class="block font-medium whitespace-nowrap hover:underline">
								{formatDateShort(r.startsAt)}
							</a>
							<div class="truncate text-muted">
								{formatTimeRange(r.startsAt, r.endsAt)}
							</div>
						</td>
						<td class="col-support cell-text truncate">{r.bookedByName ?? '—'}</td>
						<td class="col-extra max-w-xs truncate opacity-70">{r.notes ?? '—'}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>

	{#if variant === 'page'}
		<ActivityFeedCard
			title={msg.staff_history()}
			query={(limit) => getBandHistory(limit ? { id, limit } : { id })}
			toRow={feedItemRow}
			empty={{ title: msg.staff_no_recorded_changes() }}
		/>
	{/if}
{/snippet}

{#if variant === 'page'}
	<PageContent>{@render body()}</PageContent>
{:else}
	<div class="@container mt-6 space-y-6">{@render body()}</div>
{/if}
