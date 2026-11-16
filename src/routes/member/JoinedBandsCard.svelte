<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import { resolve } from '$app/paths';
	import type { getMemberDashboard } from '#lib/remote/users.remote.js';

	/**
	 * Bands the member joined at signup through an emailed invitation. Signup
	 * redeems it without asking, so without this card a bandmate's booking was
	 * the first sign they were in a band at all (#3051).
	 */
	let { bands }: { bands: Awaited<ReturnType<typeof getMemberDashboard>>['joinedBands'] } =
		$props();
</script>

{#if bands.length > 0}
	<InfoCard title={m.member_joined_bands_card_title()} testid="joined-bands">
		<ul class="flex flex-col divide-y divide-base-300">
			{#each bands as band (band.id)}
				<li class="py-3 first:pt-0 last:pb-0">
					<a class="link font-medium" href={resolve('/band/[slug]', { slug: band.slug })}
						>{band.name}</a
					>
					{#if band.invitedByName}
						<p class="text-subtle text-sm">
							{m.member_joined_bands_card_invited_by_text({ invitedByName: band.invitedByName })}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	</InfoCard>
{/if}
