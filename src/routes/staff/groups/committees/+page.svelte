<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CreateGroupAction from '$lib/components/groups/CreateGroupAction.svelte';
	import { getStaffCommittees } from '$lib/remote/groups.remote';
	import GroupViews from '../GroupViews.svelte';
	import GroupRecordPanel from '../[id]/GroupRecordPanel.svelte';

	// Declared above the await so they are not async-gated.
	let selected = $state<{ id: string; name: string } | null>(null);
	let panelOpen = $state(false);
	function openPanel(id: string, name: string) {
		selected = { id, name };
		panelOpen = true;
	}

	/** Every committee, each with what is waiting on it. */
	const data = $derived(await getStaffCommittees());
	const committees = $derived(data.committees.filter((c) => data.canManage || !c.deletedAt));
</script>

<PageHeader title="Groups">
	{#if data.canManage}
		<CreateGroupAction kind="committee" />
	{/if}
</PageHeader>

<PageContent>
	<GroupViews active="committees" />
	{#if committees.length === 0}
		<EmptyState title="No committees" />
	{:else}
		<!-- Cards, not a table: there are a handful of committees, and each card is
		     one control, so the chairs are names rather than chips of their own. -->
		<ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{#each committees as c (c.id)}
				<li>
					<button
						type="button"
						class="block h-full w-full text-left"
						onclick={() => openPanel(c.id, c.name)}
					>
						<Card bordered class="h-full p-4 hover:border-primary">
							<span class="flex items-center gap-2">
								<span class="truncate font-medium">{c.name}</span>
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
						</Card>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</PageContent>

{#if selected}
	{#key selected.id}
		<GroupRecordPanel
			kind="committee"
			id={selected.id}
			name={selected.name}
			bind:open={panelOpen}
		/>
	{/key}
{/if}
