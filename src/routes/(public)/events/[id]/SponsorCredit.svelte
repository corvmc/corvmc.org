<script lang="ts">
	/** The show's sponsors, disclosed as sponsored (#583). */
	import { SPONSOR_CREDIT_LEAD } from '$lib/utils/sponsor-credit';

	type Credit = { name: string; website: string | null; logoUrl: string | null };

	let { sponsors }: { sponsors: Credit[] } = $props();
</script>

{#if sponsors.length > 0}
	<aside class="sponsor-credit" aria-label="Sponsors">
		<p class="text-muted">{SPONSOR_CREDIT_LEAD}</p>
		<ul class="sponsor-credit__list">
			{#each sponsors as s (s.name)}
				<li>
					{#if s.website}
						<a href={s.website} target="_blank" rel="sponsored noopener external" class="link">
							{#if s.logoUrl}
								<img src={s.logoUrl} alt={s.name} class="sponsor-credit__logo" />
							{:else}
								{s.name}
							{/if}
						</a>
					{:else if s.logoUrl}
						<img src={s.logoUrl} alt={s.name} class="sponsor-credit__logo" />
					{:else}
						<span class="font-medium">{s.name}</span>
					{/if}
				</li>
			{/each}
		</ul>
	</aside>
{/if}

<style>
	.sponsor-credit {
		margin-top: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.sponsor-credit__list {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem 1.5rem;
	}
	.sponsor-credit__logo {
		height: 2.5rem;
		width: auto;
	}
</style>
