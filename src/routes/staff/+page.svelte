<script lang="ts">
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { getStaffDashboard } from '$lib/remote/users.remote';
	import { resolve } from '$app/paths';
	import { formatDateShortYear } from '$lib/utils/format';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';

	let data = $derived(await getStaffDashboard());
</script>

<PageHeader title="Dashboard" />
<PageContent>
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		<StatCard title="Total Members" value={data.stats.totalUsers} />
		<StatCard title="Active Roles" value={data.stats.totalRoles} />
		<StatCard title="New This Month" value={data.stats.newUsersThisMonth} />
	</div>

	{#if data.lowStock.length > 0}
		<!-- Above recent members on purpose: this is the only thing on the
		     dashboard that is asking for an action today. -->
		<SectionLabel label="Running low" />
		<Table>
			{#snippet head()}
				<th>Item</th>
				<th class="col-support">Category</th>
				<th class="cell-num">On hand</th>
				<th class="col-support cell-num">Buy</th>
			{/snippet}
			{#each data.lowStock as item (item.id)}
				<tr class="hover cursor-pointer" use:rowLink={resolve(`/staff/inventory/${item.id}`)}>
					<td class="cell-primary">
						{item.name}
						{#if item.isOut}
							<Badge variant="error" size="xs">Out</Badge>
						{/if}
					</td>
					<td class="col-support">{item.category.name}</td>
					<td class="cell-num" class:text-error={item.isOut}>{item.onHand}</td>
					<td class="col-support cell-num">{item.suggestedOrder}</td>
				</tr>
			{/each}
		</Table>
		<div class="mt-2">
			<Button variant="ghost" size="sm" href={resolve('/staff/inventory/restock')}>
				{data.lowStockCount > data.lowStock.length
					? `See all ${data.lowStockCount} to restock`
					: 'Open the restock list'}
			</Button>
		</div>
	{/if}

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
