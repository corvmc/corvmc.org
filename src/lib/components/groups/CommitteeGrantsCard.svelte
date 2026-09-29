<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import CheckboxGroup from '$lib/components/ui/Form/CheckboxGroup.svelte';
	import { grantableBy, grantRuleFor } from '$lib/config';
	import { setCommitteeGrants } from '$lib/remote/groups.remote';

	/** What this committee's active members may do. */
	let { groupId, name, held }: { groupId: string; name: string; held: string[] } = $props();

	function reach(cap: string): string {
		return grantRuleFor(cap)?.committee === 'owned'
			? 'On records this committee owns.'
			: 'Across the whole collective.';
	}

	const options = grantableBy('committee').map((cap) => ({
		value: cap,
		label: grantRuleFor(cap)?.label ?? cap,
		description: reach(cap)
	}));
</script>

<InfoCard title="Grants">
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			<CardTitle>{title}</CardTitle>
			<Action
				action={setCommitteeGrants}
				label="Edit"
				variant="ghost"
				size="sm"
				modalTitle="What {name} members may do"
				successToast="Grants saved"
			>
				{#snippet form()}
					<input type="hidden" name="groupId" value={groupId} />
					<p class="text-muted">
						Every active member of this committee holds these. Leaving the committee takes them
						away.
					</p>
					<CheckboxGroup field={setCommitteeGrants.fields.capabilities} selected={held} {options} />
				{/snippet}
			</Action>
		</div>
	{/snippet}

	{#if held.length === 0}
		<p class="text-muted">Members of this committee hold nothing beyond their seat.</p>
	{:else}
		<ul class="space-y-2 text-sm">
			{#each held as cap (cap)}
				<li>
					<span class="font-medium">{grantRuleFor(cap)?.label ?? cap}</span>
					<span class="opacity-60">· {reach(cap)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</InfoCard>
