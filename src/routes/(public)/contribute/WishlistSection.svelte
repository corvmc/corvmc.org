<script lang="ts">
	import Tile from '$lib/components/public/Tile.svelte';
	import Section from '$lib/components/public/Section.svelte';
	import SectionHeading from '$lib/components/public/SectionHeading.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { getPublicWishlist } from '$lib/remote/inventory.remote';

	/**
	 * What We Need (#604): planned gear suggestions and low consumables, names
	 * only. Renders nothing when there is nothing to ask for.
	 */
	const wishlist = $derived(await getPublicWishlist());
</script>

{#if wishlist.gear.length > 0 || wishlist.supplies.length > 0}
	<Section tint="info">
		<SectionHeading title="What We Need">
			Gear and supplies the space is short of right now. Have one to give? Get in touch and we'll
			arrange a drop-off.
		</SectionHeading>
		<div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
			{#if wishlist.gear.length > 0}
				<Tile fill="raised" align="stack">
					<h3 class="text-lg font-bold">Gear members have asked for</h3>
					<ul class="flex flex-col gap-2">
						{#each wishlist.gear as g, i (i)}
							<li class="leading-relaxed">{g.title}</li>
						{/each}
					</ul>
				</Tile>
			{/if}
			{#if wishlist.supplies.length > 0}
				<Tile fill="raised" align="stack">
					<h3 class="text-lg font-bold">Supplies running low</h3>
					<ul class="flex flex-col gap-2">
						{#each wishlist.supplies as item, i (i)}
							<li class="leading-relaxed">
								{item.name}{#if item.isOut}<span class="text-fg-3"> — out</span>{/if}
							</li>
						{/each}
					</ul>
				</Tile>
			{/if}
		</div>
		<div class="measure-center mt-8">
			<Button href="/contact" variant="default" size="lg">Offer an Item</Button>
		</div>
	</Section>
{/if}
