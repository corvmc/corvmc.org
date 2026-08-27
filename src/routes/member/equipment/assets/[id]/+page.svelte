<script lang="ts">
	import { page } from '$app/state';
	import { getMemberAsset } from '$lib/remote/inventory.remote';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { equipmentConditionBadge, assetStatusLabels } from '$lib/config';
	import { titleCase } from '$lib/utils/format';

	/**
	 * Where a member lands after scanning the sticker on a piece of gear.
	 *
	 * Deliberately narrower than the staff record: what this is, what shape it is
	 * in, and whether it can be borrowed. Not who has it, not what it cost, not
	 * who gave it.
	 *
	 * Nearly empty on purpose for now — the manual, the tutorial and the
	 * report-damage button are the next phase, and this page exists from the
	 * start so the URL printed on the tag never has to change to get them.
	 */
	let id = $derived(page.params.id!);
	const asset = $derived(await getMemberAsset(id));
</script>

<PageHeader subtitle={asset.categoryName} title={asset.name} backHref="/member/equipment" />

<PageContent width="2xl">
	<InfoCard title={asset.assetTag ?? 'This unit'}>
		{#if !asset.isAvailable}
			<Alert type="warning" class="mb-4">
				This one is {assetStatusLabels[asset.status].toLowerCase()} right now.
			</Alert>
		{/if}

		{#if asset.description}
			<p class="mb-4 text-sm opacity-80">{asset.description}</p>
		{/if}

		<DefinitionList>
			<Fact label="Condition">
				<Badge size="sm" class={equipmentConditionBadge[asset.condition] ?? 'badge-ghost'}>
					{titleCase(asset.condition)}
				</Badge>
			</Fact>
			{#if asset.locationName}
				<Fact label="Kept in">{asset.locationName}</Fact>
			{/if}
			{#if asset.assetTag}
				<Fact label="Tag" mono>{asset.assetTag}</Fact>
			{/if}
		</DefinitionList>
	</InfoCard>
</PageContent>
