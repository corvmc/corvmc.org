<script lang="ts">
	import { page } from '$app/state';

	import {
		getStaffBand as getBand,
		getStaffBandMembers as getBandMembers,
		getBandReservations,
		updateMemberRole,
		getStaffPlatformInvites as getPlatformInvites
	} from '$lib/remote/bands.remote';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import Select from '$lib/components/shared/Form/Select.svelte';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import Table from '$lib/components/shared/Table.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { formatDateShort, formatTimeRange } from '$lib/utils/format';
	import { toast } from 'svelte-sonner';
	import {
		InviteByEmailAction,
		InviteMemberAction,
		RevokeInviteAction,
		TransferOwnershipAction,
		RemoveBandMemberAction,
		RevokePlatformInviteAction
	} from '$lib/components/shared/actions';
	import StaffBandForm from './StaffBandForm.svelte';

	let id = $derived(page.params.id!);
	let band = $derived(await getBand(id));
	let members = $derived(await getBandMembers(id));
	let reservations = $derived(await getBandReservations(id));
	let platformInvites = $derived(await getPlatformInvites(id));
</script>

<!-- The band info form lives in a fully synchronous component: a top-level
     await here marks later declarations "blocked", compiling its bind:value /
     fields expressions into async deriveds — the churn behind the
     effect_update_depth_exceeded crash (same bug as /member/profile). -->
<StaffBandForm {band} {id} />

<PageContent width="3xl">
	<InfoCard title="Members">
		{#snippet header(title)}
			<header class="flex justify-between items-center">
				<span class="card-title">{title}</span>
				<div class="flex gap-2">
					<InviteByEmailAction bandId={id} />
					<InviteMemberAction bandId={id} />
				</div>
			</header>
		{/snippet}
		{#if members.length === 0}
			<EmptyState description="No members" />
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Member</th>
					<th class="w-px">Role</th>
					<th class="col-extra whitespace-nowrap">Joined</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}
				{#each members as m (m.id)}
					<tr class="hover">
						<td class="w-px"><StatusBadge status={m.status} /></td>
						<!-- Position was its own column; it qualifies the member, so the
						     ref carries it as the subline. -->
						<td class="cell-primary">
							<EntityIdentity ref={m.member} />
						</td>
						<td class="w-px">
							{#if m.role !== 'owner' && m.status === 'active'}
								{@const rf = updateMemberRole.for(m.id)}
								<form
									{...rf.enhance(async ({ submit }) => {
										if (await submit()) toast.success('Role updated');
										else toast.error('Failed to update role');
									})}
								>
									<input {...rf.fields.memberId.as('hidden', m.id)} />
									<Select
										class="select-xs"
										name="role"
										aria-label="Role for {m.member.title}"
										value={m.role}
										onchange={(e: Event) =>
											(e.currentTarget as HTMLSelectElement).form?.requestSubmit()}
									>
										<option value="member">Member</option>
										<option value="admin">Admin</option>
									</Select>
								</form>
							{:else}
								<Badge size="sm" variant="outline">{m.role}</Badge>
							{/if}
						</td>
						<td class="col-extra whitespace-nowrap">{formatDateShort(m.createdAt)}</td>
						<td class="w-px">
							{#if m.role !== 'owner'}
								<div class="flex justify-end gap-1">
									{#if m.status === 'pending'}
										<RevokeInviteAction bandId={id} memberId={m.id} name={m.member.title} />
									{/if}
									{#if m.status === 'active'}
										<TransferOwnershipAction
											bandId={id}
											newOwnerId={m.userId}
											name={m.member.title}
										/>
									{/if}
									<RemoveBandMemberAction bandId={id} memberId={m.id} name={m.member.title} />
								</div>
							{/if}
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>

	<!-- Platform invites -->
	{#if platformInvites.filter((i) => i.status === 'pending').length > 0}
		<InfoCard title="Awaiting Signup">
			<Table>
				{#snippet head()}
					<th>Invitee</th>
					<th class="w-px">Role</th>
					<th class="col-extra">Invited by</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}
				{#each platformInvites.filter((i) => i.status === 'pending') as inv (inv.id)}
					<tr class="hover">
						<td class="cell-primary">
							<div class="truncate font-medium">{inv.email}</div>
							{#if inv.position}
								<div class="truncate text-muted">{inv.position}</div>
							{/if}
						</td>
						<td class="w-px"><Badge size="sm" variant="outline">{inv.role}</Badge></td>
						<td class="col-extra truncate">{inv.invitedByName}</td>
						<td class="w-px">
							<RevokePlatformInviteAction bandId={id} inviteId={inv.id} email={inv.email} />
						</td>
					</tr>
				{/each}
			</Table>
		</InfoCard>
	{/if}

	<InfoCard title="Recent Reservations">
		{#if reservations.length === 0}
			<EmptyState description="No reservations" />
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Reservation</th>
					<th class="col-support">Booked by</th>
					<th class="col-extra">Notes</th>
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
						<td class="col-support truncate">{r.bookedByName ?? '—'}</td>
						<td class="col-extra max-w-xs truncate opacity-70">{r.notes ?? '—'}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>
</PageContent>
