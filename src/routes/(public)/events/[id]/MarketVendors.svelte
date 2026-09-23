<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import { formatDateTime } from '$lib/utils/format';
	import { getPublicMarket } from '$lib/remote/market.remote';

	/**
	 * A market day's vendors, and the way in for new ones.
	 *
	 * Only accepted vendors are listed, and only what they agreed to publish when
	 * they applied (#1504).
	 */
	let { eventId }: { eventId: string } = $props();

	const market = $derived(await getPublicMarket(eventId));
	const info = $derived(market?.info);
	const vendors = $derived(market?.vendors ?? []);
</script>

{#if info}
	<section class="market">
		<SectionLabel label="Vendors" />

		{#if info.accepting}
			<div class="market__apply">
				<Button href={resolve(`/events/${eventId}/vendors/apply`)} variant="primary">
					Apply for a table
				</Button>
				{#if info.closesAt}
					<span class="text-muted">Applications close {formatDateTime(info.closesAt)}</span>
				{/if}
			</div>
		{/if}

		{#if vendors.length > 0}
			<ul class="market__list">
				{#each vendors as v (v.businessName)}
					<li>
						<div class="font-semibold">
							{#if v.website}
								<!-- eslint-disable svelte/no-navigation-without-resolve -- a vendor's own site -->
								<a href={v.website} class="link" target="_blank" rel="noopener noreferrer nofollow"
									>{v.businessName}</a
								>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							{:else}
								{v.businessName}
							{/if}
							{#if v.tableLabel}<span class="text-muted font-normal">
									· Table {v.tableLabel}</span
								>{/if}
						</div>
						<p class="text-muted">{v.offering}</p>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-muted">The vendor list is announced as tables are confirmed.</p>
		{/if}
	</section>
{/if}

<style>
	.market {
		margin-top: 3rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.market__apply {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}

	.market__list {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
	}
</style>
