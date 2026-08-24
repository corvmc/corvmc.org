<script lang="ts">
	import StatCard from '$lib/components/shared/StatCard.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import SectionLabel from '$lib/components/shared/SectionLabel.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { getStaffDashboard } from '$lib/remote/users.remote';
	import { resolve } from '$app/paths';
	import { formatDateShortYear } from '$lib/utils/format';

	let data = $derived(await getStaffDashboard());
</script>

<PageHeader title="Dashboard" />
<PageContent>
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		<StatCard title="Total Members" value={data.stats.totalUsers} />
		<StatCard title="Active Roles" value={data.stats.totalRoles} />
		<StatCard title="New This Month" value={data.stats.newUsersThisMonth} />
	</div>

	<SectionLabel label="Recent members" />
	{#if data.recentUsers.length === 0}
		<EmptyState description="No members yet" />
	{:else}
		<Table>
			{#snippet head()}
				<th>Member</th>
				<th class="col-support whitespace-nowrap">Joined</th>
			{/snippet}
			{#each data.recentUsers as u (u.id)}
				<tr class="hover cursor-pointer" use:rowLink={resolve(`/staff/users/${u.id}`)}>
					<!-- The ref already carries the email as its subline, so the
					     separate Email column is gone. -->
					<td class="cell-primary">
						<EntityIdentity ref={u.ref} />
					</td>
					<td class="col-support whitespace-nowrap">{formatDateShortYear(u.createdAt)}</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
