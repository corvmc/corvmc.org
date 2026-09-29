<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { EntityChip } from '$lib/components/ui/entity';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import CreateGroupAction from '$lib/components/groups/CreateGroupAction.svelte';
	import { getStaffCommittees } from '$lib/remote/groups.remote';

	/**
	 * Every committee, each with what is waiting on it. Its applications are on
	 * its own page, which is also where a chair-less committee gets read.
	 */
	const data = $derived(await getStaffCommittees());
	const committees = $derived(data.committees.filter((c) => data.canManage || !c.deletedAt));
</script>

<PageHeader title="Committees" subtitle="The Collective's working groups">
	{#if data.canManage}
		<CreateGroupAction kind="committee" />
	{/if}
</PageHeader>

<PageContent>
	{#if committees.length === 0}
		<EmptyState title="No committees" description="Create one to start taking applications." />
	{:else}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">Status</span></th>
				<th>Committee</th>
				<th>Chair</th>
				<th class="col-support cell-num">Members</th>
			{/snippet}
			{#each committees as c (c.id)}
				{@const href = resolve(`/staff/committees/${c.id}`)}
				<tr class="hover cursor-pointer" use:rowLink={href}>
					<td class="w-px">
						<StatusBadge status={c.deletedAt ? 'deactivated' : 'active'} />
					</td>
					<td class="cell-primary">
						{c.name}
						{#if c.openApplications > 0}
							<Badge variant="info">
								{c.openApplications}
								{c.openApplications === 1 ? 'application' : 'applications'}
							</Badge>
						{/if}
					</td>
					<td class="min-w-0">
						{#if c.owner.id}
							<EntityChip ref={c.owner} icon={false} />
						{:else}
							<Badge variant="warning">No chair</Badge>
						{/if}
					</td>
					<td class="col-support cell-num">{c.memberCount}</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
