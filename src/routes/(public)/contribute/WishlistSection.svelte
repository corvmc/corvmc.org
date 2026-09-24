<script lang="ts">
	import Tile from '$lib/components/public/Tile.svelte';
	import Section from '$lib/components/public/Section.svelte';
	import SectionHeading from '$lib/components/public/SectionHeading.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { getPublicWishlist } from '$lib/remote/inventory.remote';
	import WishlistPledge from './WishlistPledge.svelte';

	/**
	 * What We Need (#604): planned gear suggestions and low consumables, names
	 * only. Renders nothing when there is nothing to ask for.
	 */
	const wishlist = $derived(await getPublicWishlist());
</script>

{#if wishlist.gear.length > 0 || wishlist.supplies.length > 0}
	<Section tint="info">
		<SectionHeading title="What We Need">
			Gear and supplies the space is short of right now. Have one to give? Say you'll bring it, so
			nobody else buys the same thing, and drop it off at the space.
		</SectionHeading>
		<div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
			{#if wishlist.gear.length > 0}
				<Tile fill="raised" align="stack">
					<h3 class="text-lg font-bold">Gear members have asked for</h3>
					<ul class="flex flex-col gap-2">
						{#each wishlist.gear as g (g.id)}
							<li class="flex flex-wrap items-center justify-between gap-2 leading-relaxed">
								<span>{g.title}</span>
								<WishlistPledge
									subjectType="suggestion"
									subjectId={g.id}
									claim={g.claim}
									pledgeId={g.pledgeId}
									signedIn={wishlist.signedIn}
								/>
							</li>
						{/each}
					</ul>
				</Tile>
			{/if}
			{#if wishlist.supplies.length > 0}
				<Tile fill="raised" align="stack">
					<h3 class="text-lg font-bold">Supplies running low</h3>
					<ul class="flex flex-col gap-2">
						{#each wishlist.supplies as item (item.id)}
							<li class="flex flex-wrap items-center justify-between gap-2 leading-relaxed">
								<span>
									{item.name}{#if item.isOut}<span class="text-fg-3"> — out</span>{/if}
								</span>
								<WishlistPledge
									subjectType="item"
									subjectId={item.id}
									claim={item.claim}
									pledgeId={item.pledgeId}
									signedIn={wishlist.signedIn}
								/>
							</li>
						{/each}
					</ul>
				</Tile>
			{/if}
		</div>
		<div class="measure-center mt-8 flex flex-wrap justify-center gap-3">
			{#if !wishlist.signedIn}
				<Button href="/login?redirect=/contribute" variant="default" size="lg" outline>
					Sign in to claim one
				</Button>
			{/if}
			<Button href="/contact" variant="default" size="lg">Offer an Item</Button>
		</div>
	</Section>
{/if}
