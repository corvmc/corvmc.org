<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import CommitteeGrantsAction, { committeeReach } from './CommitteeGrantsAction.svelte';
	import { grantRuleFor } from '$lib/config';

	/** What this committee's active members may do. */
	let { groupId, name, held }: { groupId: string; name: string; held: string[] } = $props();
</script>

<InfoCard title="Grants">
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			<CardTitle>{title}</CardTitle>
			<CommitteeGrantsAction {groupId} {name} {held} />
		</div>
	{/snippet}

	{#if held.length === 0}
		<p class="text-muted">Members of this committee hold nothing beyond their seat.</p>
	{:else}
		<ul class="space-y-2 text-sm">
			{#each held as cap (cap)}
				<li>
					<span class="font-medium">{grantRuleFor(cap)?.label ?? cap}</span>
					<span class="opacity-60">· {committeeReach(cap)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</InfoCard>
