<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
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
		<!-- Cards, not a table: there are a handful of committees, and each card is
		     one link, so the chairs are names rather than chips of their own. -->
		<ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{#each committees as c (c.id)}
				<li>
					<a
						href={resolve(`/staff/committees/${c.id}`)}
						class="card h-full border border-base-300 bg-base-100 p-4 hover:border-primary"
					>
						<span class="flex items-center gap-2">
							<span class="cell-primary truncate font-medium">{c.name}</span>
							{#if c.deletedAt}<StatusBadge status="deactivated" label />{/if}
						</span>
						<span class="mt-1 text-sm text-fg-2">
							{c.chairs.length === 0
								? 'No chairs'
								: `Chaired by ${c.chairs.map((ch) => ch.title).join(', ')}`}
						</span>
						<span class="mt-3 flex flex-wrap items-center gap-2 text-sm">
							<span>{c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}</span>
							{#if c.openApplications > 0}
								<Badge variant="info">
									{c.openApplications}
									{c.openApplications === 1 ? 'application' : 'applications'}
								</Badge>
							{/if}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</PageContent>
