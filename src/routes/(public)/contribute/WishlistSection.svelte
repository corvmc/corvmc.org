<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Tile from '#lib/components/public/Tile.svelte';
	import Section from '#lib/components/public/Section.svelte';
	import SectionHeading from '#lib/components/public/SectionHeading.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { getPublicWishlist } from '#lib/remote/inventory.remote.js';
	import WishlistPledge from './WishlistPledge.svelte';

	/**
	 * What We Need (#604): planned gear suggestions and low consumables, names
	 * only. Renders nothing when there is nothing to ask for.
	 */
	const wishlist = $derived(await getPublicWishlist());
</script>

{#if wishlist.gear.length > 0 || wishlist.supplies.length > 0}
	<Section tint="info">
		<SectionHeading title={m.public_contribute_wishlist_section_title()}>
			{m.public_contribute_wishlist_section_gear_supplies_space_short_title()}
		</SectionHeading>
		<div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
			{#if wishlist.gear.length > 0}
				<Tile fill="raised" align="stack">
					<h3 class="text-lg font-bold">
						{m.public_contribute_wishlist_section_gear_members_have_asked_title()}
					</h3>
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
									entryName={g.title}
								/>
							</li>
						{/each}
					</ul>
				</Tile>
			{/if}
			{#if wishlist.supplies.length > 0}
				<Tile fill="raised" align="stack">
					<h3 class="text-lg font-bold">
						{m.public_contribute_wishlist_section_supplies_running_low_title()}
					</h3>
					<ul class="flex flex-col gap-2">
						{#each wishlist.supplies as item (item.id)}
							<li class="flex flex-wrap items-center justify-between gap-2 leading-relaxed">
								<span>
									{item.name}{#if item.isOut}<span class="text-fg-3">
											{m.public_contribute_wishlist_section_out_text()}</span
										>{/if}
								</span>
								<WishlistPledge
									subjectType="item"
									subjectId={item.id}
									claim={item.claim}
									pledgeId={item.pledgeId}
									signedIn={wishlist.signedIn}
									entryName={item.name}
								/>
							</li>
						{/each}
					</ul>
				</Tile>
			{/if}
		</div>
		<div class="measure-center mt-8 flex flex-wrap justify-center gap-3">
			<Button href="/contact" variant="default" size="lg"
				>{m.public_contribute_wishlist_section_offer_item_label()}</Button
			>
		</div>
	</Section>
{/if}
